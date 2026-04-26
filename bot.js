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

const GUILD_ID      = process.env.GUILD_ID;
const CATEGORY_ID   = process.env.CATEGORY_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;
const NOTIF_CHAN_ID = process.env.NOTIF_CHAN_ID;
const PORT          = process.env.PORT || 3000;

// ── SAFETY CHECK ────────────────────────────────────────────
if (!token) {
  console.error("❌ TOKEN manquant ! Vérifie tes variables d'environnement.");
  process.exit(1);
}

// ── CLIENT DISCORD ──────────────────────────────────────────
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

// ── BUTTONS ACTIONS ─────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, channel, member } = interaction;

  if (customId.startsWith('acompte_recu_')) {
    await interaction.reply({ content: `💰 Acompte validé par <@${member.id}>`, ephemeral: false });

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('💰 Acompte reçu')
          .setDescription('Le projet peut commencer.')
      ]
    });
  }

  if (customId.startsWith('livre_')) {
    await interaction.reply({ content: `🎉 Commande livrée !`, ephemeral: false });
    await channel.setName(channel.name.replace('commande', '✅commande'));
  }

  if (customId.startsWith('annuler_')) {
    await interaction.reply({ content: `❌ Commande annulée`, ephemeral: false });
    await channel.setName(channel.name.replace('commande', '❌commande'));
  }
});

// ── CREATE ORDER CHANNEL ────────────────────────────────────
async function handleNewOrder(orderData) {
  const guild = await client.guilds.fetch(GUILD_ID);

  const { name, discord, pack, type, desc, timestamp } = orderData;

  const safeName = discord
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .substring(0, 30);

  const channel = await guild.channels.create({
    name: `commande-${safeName}`,
    type: ChannelType.GuildText,
    topic: `Commande ${name} (${discord})`,

    parent: CATEGORY_ID || null,

    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      ...(ADMIN_ROLE_ID ? [{
        id: ADMIN_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      }] : [])
    ],
  });

  const embed = new EmbedBuilder()
    .setColor(0xE8642A)
    .setTitle("🎬 Nouvelle commande")
    .addFields(
      { name: "Client", value: name, inline: true },
      { name: "Discord", value: discord, inline: true },
      { name: "Pack", value: pack, inline: false },
      { name: "Type", value: type, inline: true },
      { name: "Description", value: desc }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`acompte_recu_${safeName}`)
      .setLabel("💰 Acompte reçu")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`livre_${safeName}`)
      .setLabel("✅ Livré")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`annuler_${safeName}`)
      .setLabel("❌ Annuler")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: ADMIN_ROLE_ID ? `<@&${ADMIN_ROLE_ID}> nouvelle commande` : null,
    embeds: [embed],
    components: [row],
  });

  return { channelId: channel.id };
}

// ── EXPRESS API ─────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.post('/commande', async (req, res) => {
  try {
    const { name, discord, pack, type, desc } = req.body;

    if (!name || !discord || !pack || !type || !desc) {
      return res.status(400).json({ error: "Champs manquants" });
    }

    const timestamp = new Date().toLocaleString('fr-FR');

    const result = await handleNewOrder({
      name,
      discord,
      pack,
      type,
      desc,
      timestamp
    });

    res.json({ success: true, ...result });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get('/health', (_, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`🌐 API sur port ${PORT}`);
});

// ── LOGIN DISCORD ───────────────────────────────────────────
client.login(token);
