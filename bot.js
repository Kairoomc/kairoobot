// ============================================================
//  SLIDE STUDIO — Discord Bot + Dashboard API + OTP Auth
//  Lance avec : node bot.js
// ============================================================
require('dotenv').config();

const {
  Client, GatewayIntentBits, PermissionsBitField,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ChannelType, Events
} = require('discord.js');
const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

// ── CONFIG ────────────────────────────────────────────────
const TOKEN          = process.env.BOT_TOKEN;
const GUILD_ID       = process.env.GUILD_ID      || '';
const CATEGORY_ID    = process.env.CATEGORY_ID   || '';
const ADMIN_ROLE_ID  = process.env.ADMIN_ROLE_ID  || '';
const NOTIF_CHAN_ID   = process.env.NOTIF_CHAN_ID  || '';
const PORT           = process.env.PORT           || 3001;
const OTP_TTL_MS     = 10 * 60 * 1000;   // code valable 10 min
const SESSION_TTL_MS = 2  * 60 * 60 * 1000; // session 2h
const MAX_OTP_TRIES  = 5;                 // tentatives max
const OTP_COOLDOWN   = 60 * 1000;         // 1 min entre chaque demande

// ── OTP STORE (en mémoire — s'efface au redémarrage) ─────
// Map : discordTag → { code, expiresAt, tries, lastSentAt }
const otpStore = new Map();

// ── SESSION STORE (en mémoire) ────────────────────────────
// Map : token → { discord, expiresAt }
const sessionStore = new Map();

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}
function cleanExpired() {
  const now = Date.now();
  for (const [k, v] of otpStore) {
    if (v.expiresAt < now) otpStore.delete(k);
  }
  for (const [k, v] of sessionStore) {
    if (v.expiresAt < now) sessionStore.delete(k);
  }
}
// Nettoyage toutes les 5 minutes
setInterval(cleanExpired, 5 * 60 * 1000);

// ── STOCKAGE COMMANDES (JSON local) ───────────────────────
const DB_FILE = path.join(__dirname, 'orders.json');
function loadOrders() {
  if (!fs.existsSync(DB_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return []; }
}
function saveOrders(orders) {
  fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));
}
function addOrder(order) {
  const orders = loadOrders();
  orders.push(order);
  saveOrders(orders);
  return order;
}
function updateOrder(id, fields) {
  const orders = loadOrders();
  const idx = orders.findIndex(o => o.id === id);
  if (idx === -1) return null;
  orders[idx] = { ...orders[idx], ...fields, updatedAt: new Date().toISOString() };
  saveOrders(orders);
  return orders[idx];
}
function getByDiscord(tag) {
  return loadOrders().filter(o => o.discord === tag.toLowerCase().trim());
}

// ── BOT ───────────────────────────────────────────────────
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL', 'MESSAGE'],
});

bot.once(Events.ClientReady, () => {
  console.log(`✅ Bot connecté : ${bot.user.tag}`);
});

// ── ENVOYER OTP EN MP ─────────────────────────────────────
async function sendOTP(discordTag) {
  const guild = await bot.guilds.fetch(GUILD_ID);
  await guild.members.fetch(); // cache tous les membres

  // Chercher le membre par username
  const member = guild.members.cache.find(m =>
    m.user.username.toLowerCase() === discordTag.toLowerCase() ||
    m.user.tag.toLowerCase() === discordTag.toLowerCase() ||
    (m.nickname && m.nickname.toLowerCase() === discordTag.toLowerCase())
  );

  if (!member) return { success: false, error: 'not_found' };

  const code = generateOTP();
  otpStore.set(discordTag.toLowerCase(), {
    code,
    expiresAt: Date.now() + OTP_TTL_MS,
    tries: 0,
    lastSentAt: Date.now(),
    userId: member.user.id,
  });

  try {
    const dm = await member.user.createDM();
    await dm.send({
      embeds: [new EmbedBuilder()
        .setColor(0xA855F7)
        .setTitle('🔐 Ton code de connexion — Slide Studio')
        .setDescription(
          `Voici ton code pour accéder à ton dashboard :\n\n` +
          `# \`${code}\`\n\n` +
          `⏱ **Valable 10 minutes** · Ne le partage à personne.\n\n` +
          `Si tu n'as pas demandé ce code, ignore ce message.`
        )
        .setFooter({ text: 'Slide Studio · Dashboard Client' })
        .setTimestamp()
      ]
    });
    return { success: true };
  } catch (err) {
    // L'utilisateur a peut-être bloqué les MPs
    otpStore.delete(discordTag.toLowerCase());
    return { success: false, error: 'dm_blocked' };
  }
}

// ── INTERACTIONS (boutons admin) ──────────────────────────
bot.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  const { customId, channel, member } = interaction;

  const sep     = customId.indexOf('_');
  const action  = customId.slice(0, sep);
  const orderId = customId.slice(sep + 1);

  const statusMap = {
    acompte:    { status: 'Acompte reçu',  acomptePaid: true },
    production: { status: 'En production' },
    revision:   { status: 'En révision'   },
    livre:      { status: 'Livré', deliveredAt: new Date().toISOString() },
    annuler:    { status: 'Annulé' },
  };

  const upd = statusMap[action];
  if (!upd) return;

  const order = updateOrder(orderId, upd);

  const labels = {
    acompte:    '💰 Acompte confirmé — production peut démarrer !',
    production: '🎬 Statut : En production',
    revision:   '🔄 Statut : En révision',
    livre:      '✅ Vidéo livrée !',
    annuler:    '❌ Commande annulée.',
  };

  await interaction.reply({
    content: `${labels[action]} _(par <@${member.id}>)_`,
    ephemeral: false,
  });

  if (action === 'livre')   try { await channel.setName('✅-' + channel.name.replace(/^[^-]+-/, '')); } catch {}
  if (action === 'annuler') try { await channel.setName('❌-' + channel.name.replace(/^[^-]+-/, '')); } catch {}

  if (action === 'livre' && order) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x34D399)
        .setTitle('🎉 Ta vidéo est prête !')
        .setDescription(
          `Salut **${order.name}** !\n\n` +
          `Ton montage est terminé 🎬\n` +
          `📥 Télécharge ta vidéo via le lien ci-dessus.\n\n` +
          `📊 Retrouve ta commande sur ton dashboard : **slidestudio.fr/dashboard**\n\n` +
          `⭐ Un avis sur notre Discord nous ferait vraiment plaisir !\nMerci 🙏`
        )
        .setTimestamp()
      ]
    });
  }

  if (action === 'acompte') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`production_${orderId}`).setLabel('🎬 En production').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`revision_${orderId}`).setLabel('🔄 En révision').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`livre_${orderId}`).setLabel('✅ Livrer').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`annuler_${orderId}`).setLabel('❌ Annuler').setStyle(ButtonStyle.Danger),
    );
    await channel.send({ content: '**Avancement :**', components: [row] });
  }
});

// ── CRÉER SALON COMMANDE ──────────────────────────────────
async function createOrderChannel(order) {
  const guild = await bot.guilds.fetch(GUILD_ID);
  const { id, name, discord, pack, type, desc, timestamp } = order;

  const safeName = discord.replace(/[^a-z0-9\-_]/g, '-').substring(0, 28);
  const chOpts = {
    name: `commande-${safeName}`,
    type: ChannelType.GuildText,
    topic: `${name} (${discord}) — ${pack} | ID: ${id}`,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
    ],
  };
  if (CATEGORY_ID) chOpts.parent = CATEGORY_ID;
  if (ADMIN_ROLE_ID) chOpts.permissionOverwrites.push({
    id: ADMIN_ROLE_ID,
    allow: [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
    ],
  });

  const ch = await guild.channels.create(chOpts);
  updateOrder(id, { channelId: ch.id });

  const embed = new EmbedBuilder()
    .setColor(0xA855F7)
    .setTitle('🎬 Nouvelle commande !')
    .addFields(
      { name: '👤 Client',      value: `**${name}**`,    inline: true },
      { name: '💬 Discord',     value: `\`${discord}\``, inline: true },
      { name: '🆔 ID',          value: `\`${id}\``,      inline: true },
      { name: '📦 Pack',        value: `**${pack}**`,    inline: true },
      { name: '🎥 Type',        value: type,             inline: true },
      { name: '📝 Description', value: desc && desc !== 'Non renseigné' ? desc.slice(0,1000) : '_Non renseigné_', inline: false },
    )
    .setFooter({ text: `Reçue le ${timestamp}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`acompte_${id}`).setLabel('💰 Acompte reçu').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`annuler_${id}`).setLabel('❌ Annuler').setStyle(ButtonStyle.Danger),
  );

  await ch.send({
    content: ADMIN_ROLE_ID ? `<@&${ADMIN_ROLE_ID}> — Nouvelle commande !` : '🔔 Nouvelle commande !',
    embeds: [embed],
    components: [row],
  });

  await ch.send({
    embeds: [new EmbedBuilder()
      .setColor(0x38BDF8)
      .setTitle(`👋 Bienvenue ${name} !`)
      .setDescription(
        `Ton salon de commande est créé ✨\n\n` +
        `📋 **Étapes :**\n` +
        `1. On te contacte sous **24h**\n` +
        `2. Validation du brief\n` +
        `3. Acompte 50% pour démarrer\n` +
        `4. Production & livraison sous **48h**\n\n` +
        `📊 **Suis ta commande :** **slidestudio.fr/dashboard**\n` +
        `→ Connecte-toi avec ton tag Discord \`${discord}\` + code reçu en MP\n\n` +
        `💬 Écris ici pour toute question.`
      )
      .setTimestamp()
    ]
  });

  if (NOTIF_CHAN_ID) {
    try {
      const notifCh = guild.channels.cache.get(NOTIF_CHAN_ID);
      if (notifCh) await notifCh.send({
        embeds: [new EmbedBuilder()
          .setColor(0xA855F7)
          .setDescription(`📥 Nouvelle commande de **${name}** (${discord}) — ${pack}\n👉 <#${ch.id}>`)
          .setTimestamp()
        ]
      });
    } catch {}
  }

  return { channelId: ch.id, channelName: ch.name };
}

// ── EXPRESS API ───────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ─── Middleware vérification session ─────────────────────
function requireSession(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  const session = sessionStore.get(token);
  if (!session) return res.status(401).json({ error: 'Session invalide ou expirée' });
  if (session.expiresAt < Date.now()) {
    sessionStore.delete(token);
    return res.status(401).json({ error: 'Session expirée', expired: true });
  }

  req.sessionDiscord = session.discord;
  next();
}

// ─── POST /auth/request — demander un code OTP ───────────
app.post('/auth/request', async (req, res) => {
  try {
    const { discord } = req.body;
    if (!discord || discord.trim().length < 2) {
      return res.status(400).json({ error: 'Tag Discord invalide' });
    }

    const tag = discord.toLowerCase().trim();

    // Vérifier cooldown
    const existing = otpStore.get(tag);
    if (existing && (Date.now() - existing.lastSentAt) < OTP_COOLDOWN) {
      const wait = Math.ceil((OTP_COOLDOWN - (Date.now() - existing.lastSentAt)) / 1000);
      return res.status(429).json({ error: `Attends ${wait}s avant de redemander un code.`, wait });
    }

    // Vérifier que le tag a au moins une commande
    const orders = getByDiscord(tag);
    if (orders.length === 0) {
      return res.status(404).json({ error: 'no_orders', message: 'Aucune commande trouvée pour ce tag Discord.' });
    }

    const result = await sendOTP(tag);

    if (!result.success) {
      if (result.error === 'not_found') {
        return res.status(404).json({ error: 'discord_not_found', message: 'Tag Discord introuvable sur notre serveur. Rejoins-le d\'abord !' });
      }
      if (result.error === 'dm_blocked') {
        return res.status(400).json({ error: 'dm_blocked', message: 'Impossible d\'envoyer un MP. Active les MPs privés dans Discord.' });
      }
    }

    res.json({ success: true, message: 'Code envoyé en MP Discord !' });
  } catch (err) {
    console.error('Erreur /auth/request:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── POST /auth/verify — vérifier le code OTP ────────────
app.post('/auth/verify', (req, res) => {
  const { discord, code } = req.body;
  if (!discord || !code) return res.status(400).json({ error: 'Champs manquants' });

  const tag = discord.toLowerCase().trim();
  const otp = otpStore.get(tag);

  if (!otp) {
    return res.status(400).json({ error: 'no_otp', message: 'Aucun code en attente. Redemande un code.' });
  }
  if (otp.expiresAt < Date.now()) {
    otpStore.delete(tag);
    return res.status(400).json({ error: 'expired', message: 'Code expiré. Redemande un nouveau code.' });
  }

  otp.tries++;
  if (otp.tries > MAX_OTP_TRIES) {
    otpStore.delete(tag);
    return res.status(400).json({ error: 'too_many', message: 'Trop de tentatives. Redemande un nouveau code.' });
  }

  if (otp.code !== String(code).trim()) {
    const left = MAX_OTP_TRIES - otp.tries;
    return res.status(400).json({ error: 'wrong_code', message: `Code incorrect. ${left} tentative${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}.` });
  }

  // ✅ Code correct — créer la session
  otpStore.delete(tag);
  const token = generateSessionToken();
  sessionStore.set(token, {
    discord: tag,
    expiresAt: Date.now() + SESSION_TTL_MS,
    createdAt: Date.now(),
  });

  res.json({ success: true, token, expiresIn: SESSION_TTL_MS });
});

// ─── POST /commande ───────────────────────────────────────
app.post('/commande', async (req, res) => {
  try {
    const { name, discord, pack, type, desc } = req.body;
    if (!name || !discord || !pack || !type) {
      return res.status(400).json({ error: 'Champs manquants' });
    }

    const now = new Date();
    const timestamp = now.toLocaleDateString('fr-FR') + ' à ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const id = 'SS-' + Date.now().toString(36).toUpperCase();

    const order = addOrder({
      id, name,
      discord: discord.toLowerCase().trim(),
      pack, type,
      desc: desc || 'Non renseigné',
      status: 'En attente',
      timestamp,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      acomptePaid: false,
      soldePaid: false,
      channelId: null,
      deliveryLink: null,
      deliveredAt: null,
    });

    const result = await createOrderChannel(order);
    res.json({ success: true, orderId: id, ...result });
  } catch (err) {
    console.error('Erreur /commande:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── GET /dashboard — commandes du client authentifié ────
app.get('/dashboard', requireSession, (req, res) => {
  const tag = req.sessionDiscord;
  const orders = getByDiscord(tag);

  const safe = orders.map(o => ({
    id:          o.id,
    pack:        o.pack,
    type:        o.type,
    status:      o.status,
    timestamp:   o.timestamp,
    createdAt:   o.createdAt,
    updatedAt:   o.updatedAt,
    acomptePaid: o.acomptePaid,
    soldePaid:   o.soldePaid,
    deliveryLink:o.deliveryLink || null,
    deliveredAt: o.deliveredAt || null,
    desc:        o.desc,
  }));

  res.json({ discord: tag, orders: safe, total: safe.length });
});

// ─── GET /health ──────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`🌐 API sur port ${PORT}`));
bot.login(TOKEN);
