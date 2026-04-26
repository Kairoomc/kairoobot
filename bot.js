// ============================================================
// SLIDE STUDIO — Discord Bot (PROD READY)
// ============================================================

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Events
} = require('discord.js');

const express = require('express');
const cors = require('cors');

// ── ENV CONFIG ──────────────────────────────────────────────
const token = process.env.TOKEN;

console.log("TOKEN exists:", !!process.env.TOKEN);

if (!token) {
  console.error("TOKEN manquant ! Vérifie tes variables d'environnement.");
  process.exit(1);
}

const GUILD_ID      = process.env.GUILD_ID;
const CATEGORY_ID   = process.env.CATEGORY_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const NOTIF_CHAN_ID  = process.env.NOTIF_CHAN_ID;
const PORT = process.env.PORT || 8080;

// ── PENDING ORDERS (awaiting client DM confirmation) ────────
// Map<token, { orderData, resolve, reject, timeout }>
const pendingOrders = new Map();

// ── CLIENT DISCORD ──────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL'], // required to receive DMs
});

client.once(Events.ClientReady, () => {
  console.log(`Bot connecté : ${client.user.tag}`);
});

// ── INTERACTION HANDLER ──────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, user } = interaction;

  // ── DM CONFIRMATION: client confirms or refuses the order ──
  if (customId.startsWith('confirm_oui_') || customId.startsWith('confirm_non_')) {
    const pendingToken = customId.replace('confirm_oui_', '').replace('confirm_non_', '');
    const pending = pendingOrders.get(pendingToken);

    if (!pending) {
      return interaction.reply({
        content: "Cette confirmation a expiré ou n'existe plus.",
        ephemeral: true,
      });
    }

    if (customId.startsWith('confirm_oui_')) {
      // Disable buttons on the DM message
      await interaction.update({
        embeds: interaction.message.embeds,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('done_oui')
              .setLabel('Commande confirmée')
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('done_non')
              .setLabel('Refuser')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true),
          ),
        ],
      });

      clearTimeout(pending.timeout);
      pendingOrders.delete(pendingToken);
      pending.resolve({ confirmed: true, userId: user.id });

    } else {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('Commande annulée')
            .setDescription(
              "Vous avez refusé la commande. Nous sommes désolés de ne pas avoir pu vous satisfaire. N'hésitez pas à nous recontacter si vous changez d'avis !"
            ),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('done_oui')
              .setLabel('Accepter')
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('done_non')
              .setLabel('Commande refusée')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(true),
          ),
        ],
      });

      clearTimeout(pending.timeout);
      pendingOrders.delete(pendingToken);
      pending.resolve({ confirmed: false, userId: user.id });
    }

    return;
  }

  // ── TICKET BUTTONS (inside order channel) ───────────────────
  const { channel, member } = interaction;

  if (customId.startsWith('acompte_recu_')) {
    await interaction.reply({ content: `Acompte validé par <@${member.id}>`, ephemeral: false });
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('Acompte reçu')
          .setDescription('Le projet peut commencer.'),
      ],
    });
  }

  if (customId.startsWith('livre_')) {
    await interaction.reply({ content: 'Commande livrée !', ephemeral: false });
    const newName = channel.name.startsWith('commande')
      ? channel.name.replace('commande', 'livre')
      : `livre-${channel.name}`;
    await channel.setName(newName);
  }

  if (customId.startsWith('annuler_')) {
    await interaction.reply({ content: 'Commande annulée.', ephemeral: false });
    const newName = channel.name.startsWith('commande')
      ? channel.name.replace('commande', 'annule')
      : `annule-${channel.name}`;
    await channel.setName(newName);
  }
});

// ── SEND DM CONFIRMATION TO CLIENT ──────────────────────────
async function sendDMConfirmation(orderData) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const { name, discord, pack, type, desc } = orderData;

  // Resolve member by username or user ID
  await guild.members.fetch();
  const member = guild.members.cache.find(
    (m) =>
      m.user.username.toLowerCase() === discord.toLowerCase() ||
      m.user.tag.toLowerCase() === discord.toLowerCase() ||
      m.user.id === discord
  );

  if (!member) {
    throw new Error(`Membre Discord introuvable : ${discord}`);
  }

  const pendingToken = `${member.id}_${Date.now()}`;

  const dmEmbed = new EmbedBuilder()
    .setColor(0xE8642A)
    .setTitle('Nouvelle commande — Slide Studio')
    .setDescription(
      "Bonjour ! Une commande a été passée en votre nom. Veuillez confirmer ou refuser ci-dessous."
    )
    .addFields(
      { name: 'Nom', value: name, inline: true },
      { name: 'Pack', value: pack, inline: true },
      { name: 'Type', value: type, inline: true },
      { name: 'Description', value: desc },
    )
    .setTimestamp()
    .setFooter({ text: 'Cette confirmation expire dans 30 minutes.' });

  const dmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_oui_${pendingToken}`)
      .setLabel('Oui, je confirme')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`confirm_non_${pendingToken}`)
      .setLabel('Non, annuler')
      .setStyle(ButtonStyle.Danger),
  );

  await member.send({ embeds: [dmEmbed], components: [dmRow] });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingOrders.delete(pendingToken);
      reject(new Error('DM confirmation timeout (30 min)'));
    }, 30 * 60 * 1000);

    pendingOrders.set(pendingToken, { orderData, userId: member.id, resolve, reject, timeout });
  });
}

// ── CREATE ORDER CHANNEL ─────────────────────────────────────
async function createOrderChannel(orderData, userId) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const { name, discord, pack, type, desc } = orderData;

  const safeName = discord
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .substring(0, 30);

  const permissionOverwrites = [
    {
      id: guild.roles.everyone,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    // Grant access to the client
    {
      id: userId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
  ];

  if (ADMIN_ROLE_ID) {
    permissionOverwrites.push({
      id: ADMIN_ROLE_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: `commande-${safeName}`,
    type: ChannelType.GuildText,
    topic: `Commande de ${name} (${discord})`,
    parent: CATEGORY_ID || null,
    permissionOverwrites,
  });

  const embed = new EmbedBuilder()
    .setColor(0xE8642A)
    .setTitle('Nouvelle commande')
    .addFields(
      { name: 'Client', value: name, inline: true },
      { name: 'Discord', value: `<@${userId}>`, inline: true },
      { name: 'Pack', value: pack, inline: false },
      { name: 'Type', value: type, inline: true },
      { name: 'Description', value: desc },
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`acompte_recu_${safeName}`)
      .setLabel('Acompte reçu')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`livre_${safeName}`)
      .setLabel('Livré')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`annuler_${safeName}`)
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Danger),
  );

  const pingContent = [
    ADMIN_ROLE_ID ? `<@&${ADMIN_ROLE_ID}>` : null,
    `<@${userId}>`,
  ]
    .filter(Boolean)
    .join(' ');

  await channel.send({
    content: `${pingContent} — nouvelle commande confirmée !`,
    embeds: [embed],
    components: [row],
  });

  return { channelId: channel.id };
}

// ── EXPRESS API ──────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.post('/commande', async (req, res) => {
  try {
    const { name, discord, pack, type, desc } = req.body;

    if (!name || !discord || !pack || !type || !desc) {
      return res.status(400).json({ error: 'Champs manquants' });
    }

    const orderData = {
      name,
      discord,
      pack,
      type,
      desc,
      timestamp: new Date().toLocaleString('fr-FR'),
    };

    // Step 1 — send DM to client and wait for confirmation
    let confirmation;
    try {
      confirmation = await sendDMConfirmation(orderData);
    } catch (dmErr) {
      console.error('DM error:', dmErr.message);
      return res.status(422).json({ error: dmErr.message });
    }

    if (!confirmation.confirmed) {
      return res.status(200).json({ success: false, reason: 'client_refused' });
    }

    // Step 2 — create the ticket channel and add the client
    const result = await createOrderChannel(orderData, confirmation.userId);

    res.json({ success: true, ...result });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`API sur port ${PORT}`);
});

// ── LOGIN DISCORD ────────────────────────────────────────────
client.login(token);
