// ============================================================
//  SLIDE STUDIO — Discord Bot commandes
//  Lance avec : node bot.js
// ============================================================
const {
  Client, GatewayIntentBits, PermissionsBitField,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ChannelType, Events
} = require('discord.js');
const express = require('express');
const cors    = require('cors');

// ── CONFIG ────────────────────────────────────────────────
const token = process.env.TOKEN;
const GUILD_ID       = process.env.GUILD_ID       || '1472546608204742727';
const CATEGORY_ID    = process.env.CATEGORY_ID    || '1474097674281029704';   // catégorie "Commandes" (optionnel)
const ADMIN_ROLE_ID  = process.env.ADMIN_ROLE_ID  || '1472727551712559315';   // rôle équipe (optionnel)
const NOTIF_CHAN_ID  = process.env.NOTIF_CHAN_ID  || '1475687603909951559';   // salon #nouvelles-commandes (optionnel)
const PORT           = process.env.PORT           || 3001;
// ─────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
});

// ── Boutons acompte / livraison ────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, channel, member } = interaction;

  if (customId.startsWith('acompte_recu_')) {
    await interaction.reply({
      content: `✅ **Acompte confirmé** par <@${member.id}>. Le projet peut démarrer ! 🎬`,
      ephemeral: false,
    });
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('💰 Acompte reçu')
        .setDescription('Le client a payé l\'acompte. Démarrage de la production.')
        .setTimestamp()
      ]
    });
  }

  if (customId.startsWith('livre_')) {
    await interaction.reply({
      content: `🎉 **Vidéo livrée !** Le statut de cette commande est maintenant TERMINÉ.`,
      ephemeral: false,
    });
    await channel.setName(channel.name.replace('commande', '✅commande'));
  }

  if (customId.startsWith('annuler_')) {
    await interaction.reply({
      content: `❌ **Commande annulée.** Ce salon sera archivé dans 24h.`,
      ephemeral: false,
    });
    await channel.setName(channel.name.replace('commande', '❌commande'));
  }
});

// ── Fonction principale : créer salon commande ─────────────
async function handleNewOrder(orderData) {
  const guild = await client.guilds.fetch(GUILD_ID);

  const { name, discord, pack, type, desc, timestamp } = orderData;

  // Nom du salon : commande-pseudo (épuré)
  const safeName = discord
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .substring(0, 30);
  const channelName = `commande-${safeName}`;

  // Options de création du salon
  const channelOptions = {
    name: channelName,
    type: ChannelType.GuildText,
    topic: `Commande de ${name} (${discord}) — ${pack}`,
    permissionOverwrites: [
      {
        // @everyone ne voit pas
        id: guild.roles.everyone,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
    ],
  };

  // Mettre dans la catégorie si configurée
  if (CATEGORY_ID) channelOptions.parent = CATEGORY_ID;

  // Donner accès au rôle admin si configuré
  if (ADMIN_ROLE_ID) {
    channelOptions.permissionOverwrites.push({
      id: ADMIN_ROLE_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    });
  }

  const orderChannel = await guild.channels.create(channelOptions);

  // ── Embed principal ──────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(0xE8642A)
    .setTitle('🎬 Nouvelle commande reçue !')
    .addFields(
      { name: '👤 Client',          value: `**${name}**`,       inline: true  },
      { name: '💬 Discord',         value: `\`${discord}\``,    inline: true  },
      { name: '📦 Pack',            value: `**${pack}**`,       inline: false },
      { name: '🎥 Type de vidéo',   value: type,                inline: true  },
      { name: '📝 Description',     value: desc.length > 1000 ? desc.slice(0, 997) + '…' : desc, inline: false },
    )
    .setFooter({ text: `Commande reçue le ${timestamp}` })
    .setTimestamp();

  // ── Boutons d'action ─────────────────────────────────────
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`acompte_recu_${safeName}`)
      .setLabel('💰 Acompte reçu')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`livre_${safeName}`)
      .setLabel('✅ Livré')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`annuler_${safeName}`)
      .setLabel('❌ Annuler')
      .setStyle(ButtonStyle.Danger),
  );

  await orderChannel.send({
    content: ADMIN_ROLE_ID ? `<@&${ADMIN_ROLE_ID}> — Nouvelle commande !` : '🔔 Nouvelle commande !',
    embeds: [embed],
    components: [row],
  });

  // ── Message accueil client ────────────────────────────────
  await orderChannel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x2A7AE8)
      .setTitle('👋 Bienvenue dans ton salon de commande !')
      .setDescription(
        `Salut **${name}** ! Ton salon de commande est créé.\n\n` +
        `📋 **Prochaines étapes :**\n` +
        `1. Notre équipe te contacte sous **24h**\n` +
        `2. On valide les détails de ton projet\n` +
        `3. Tu règles l\'acompte pour démarrer\n` +
        `4. On produit ta vidéo ! 🎬\n\n` +
        `💬 Tu peux écrire dans ce salon si tu as des questions.`
      )
      .setTimestamp()
    ]
  });

  // ── Notif dans salon général (optionnel) ─────────────────
  if (NOTIF_CHAN_ID) {
    const notifChan = guild.channels.cache.get(NOTIF_CHAN_ID);
    if (notifChan) {
      await notifChan.send({
        embeds: [new EmbedBuilder()
          .setColor(0xE8642A)
          .setDescription(`📥 Nouvelle commande de **${name}** (${discord}) — ${pack}\n👉 <#${orderChannel.id}>`)
          .setTimestamp()
        ]
      });
    }
  }

  return { channelId: orderChannel.id, channelName };
}

// ── API HTTP pour recevoir les commandes du site ───────────
const app = express();
app.use(cors());
app.use(express.json());

app.post('/commande', async (req, res) => {
  try {
    const { name, discord, pack, type, desc } = req.body;

    if (!name || !discord || !pack || !type || !desc) {
      return res.status(400).json({ error: 'Champs manquants' });
    }

    const now = new Date();
    const timestamp = now.toLocaleDateString('fr-FR') + ' à ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const result = await handleNewOrder({ name, discord, pack, type, desc, timestamp });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Erreur commande:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`🌐 API bot sur http://localhost:${PORT}`));
client.login(token);
