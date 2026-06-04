// ═══════════════════════════════════════════════════════════════════════════
//  BOT DISCORD — Administration Générale de la Gendarmerie
//  Panel Prise de Service + Casiers Judiciaires B3
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
} = require('discord.js');
const Database = require('better-sqlite3');

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
const CONFIG = {
  TOKEN:         process.env.DISCORD_TOKEN,
  CLIENT_ID:     process.env.CLIENT_ID,
  FORUM_ID:      '1511843116066279444',
  ROLE_GEND_ID:  '1508283902672896055',
  BOT_NAME:      'Administration Générale de la Gendarmerie',
  BOT_COLOR:     0x003189,
  COLOR_SUCCESS: 0x2ecc71,
  COLOR_DANGER:  0xe74c3c,
  COLOR_INFO:    0x5865F2,
};

if (!CONFIG.TOKEN)     { console.error('❌ DISCORD_TOKEN manquant.'); process.exit(1); }
if (!CONFIG.CLIENT_ID) { console.error('❌ CLIENT_ID manquant.');     process.exit(1); }

// ─── BASE DE DONNÉES ─────────────────────────────────────────────────────────
const db = new Database('./bot_data.db');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS casiers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nom_prenom   TEXT    NOT NULL,
    faits        TEXT    NOT NULL,
    amende       TEXT    NOT NULL,
    amende_payee INTEGER NOT NULL DEFAULT 0,
    photo_url    TEXT,
    thread_id    TEXT,
    created_by   TEXT,
    created_at   TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS en_service (
    user_id    TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    prise_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS historique_service (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    username   TEXT NOT NULL,
    action     TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS panels (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL
  );
`);

const stmt = {
  insertCasier:   db.prepare(`INSERT INTO casiers (nom_prenom, faits, amende, amende_payee, photo_url, created_by) VALUES (?, ?, ?, ?, ?, ?)`),
  updateThread:   db.prepare(`UPDATE casiers SET thread_id = ? WHERE id = ?`),
  searchCasier:   db.prepare(`SELECT * FROM casiers WHERE nom_prenom LIKE ? ORDER BY created_at DESC`),
  listCasiers:    db.prepare(`SELECT * FROM casiers ORDER BY created_at DESC LIMIT 20`),

  getService:     db.prepare(`SELECT * FROM en_service WHERE user_id = ?`),
  addService:     db.prepare(`INSERT OR REPLACE INTO en_service (user_id, username, prise_at) VALUES (?, ?, datetime('now'))`),
  removeService:  db.prepare(`DELETE FROM en_service WHERE user_id = ?`),
  listService:    db.prepare(`SELECT * FROM en_service ORDER BY prise_at ASC`),

  logAction:      db.prepare(`INSERT INTO historique_service (user_id, username, action) VALUES (?, ?, ?)`),

  insertPanel:    db.prepare(`INSERT INTO panels (message_id, channel_id) VALUES (?, ?)`),
  getPanels:      db.prepare(`SELECT * FROM panels`),
  deletePanel:    db.prepare(`DELETE FROM panels WHERE message_id = ?`),
};

// ─── CLIENT ──────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── COMMANDES SLASH ─────────────────────────────────────────────────────────
const slashCommands = [
  new SlashCommandBuilder()
    .setName('panel_service')
    .setDescription('📋 Poster le panel de gestion des services (persistant)'),

  new SlashCommandBuilder()
    .setName('casier')
    .setDescription('📁 Créer un extrait de casier judiciaire B3')
    .addStringOption(o =>
      o.setName('nom_prenom').setDescription('Nom et prénom RP du suspect').setRequired(true))
    .addStringOption(o =>
      o.setName('faits').setDescription('Faits reprochés / infractions').setRequired(true))
    .addStringOption(o =>
      o.setName('amende').setDescription('Montant de l\'amende (ex: 5000$)').setRequired(true))
    .addStringOption(o =>
      o.setName('amende_payee').setDescription('Amende payée ?').setRequired(true)
        .addChoices(
          { name: '✅ Oui — payée',   value: 'oui' },
          { name: '❌ Non — impayée', value: 'non' },
        ))
    .addAttachmentOption(o =>
      o.setName('photo').setDescription('Photo du suspect de face, fond blanc').setRequired(true)),

  new SlashCommandBuilder()
    .setName('recherche_casier')
    .setDescription('🔍 Rechercher un casier judiciaire par nom/prénom')
    .addStringOption(o =>
      o.setName('nom_prenom').setDescription('Nom et prénom RP à rechercher').setRequired(true)),

  new SlashCommandBuilder()
    .setName('liste_casiers')
    .setDescription('📋 Lister les 20 derniers casiers enregistrés'),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
  try {
    console.log('🔄 Enregistrement des commandes slash...');
    await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: slashCommands });
    console.log(`✅ ${slashCommands.length} commande(s) enregistrée(s).`);
  } catch (err) {
    console.error('❌ Erreur commandes:', err.message);
  }
}

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────
function nowFR() {
  return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

function hasGendRole(member) {
  return member?.roles?.cache?.has(CONFIG.ROLE_GEND_ID) ?? false;
}

async function denyAccess(interaction) {
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(CONFIG.COLOR_DANGER)
        .setTitle('🚫 Accès refusé')
        .setDescription('Vous devez avoir le rôle **Gendarmerie Nationale** pour utiliser cette commande.')
        .setFooter({ text: CONFIG.BOT_NAME }),
    ],
    ephemeral: true,
  });
}

// ─── CONSTRUCTION DU PANEL ───────────────────────────────────────────────────
function buildPanelEmbed() {
  const agents = stmt.listService.all();

  let description;
  if (agents.length === 0) {
    description = '*Aucun agent en service pour le moment.*';
  } else {
    description = agents.map((a, i) => {
      // prise_at est en UTC SQLite, on l'affiche en heure FR
      const date = new Date(a.prise_at + 'Z');
      const heure = date.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
      return `> **${i + 1}.** <@${a.user_id}> — \`${a.username}\`\n> 🕐 En service depuis **${heure}**`;
    }).join('\n\n');
  }

  return new EmbedBuilder()
    .setColor(CONFIG.BOT_COLOR)
    .setAuthor({ name: CONFIG.BOT_NAME })
    .setTitle('🎖️ PANEL DE SERVICE — Gendarmerie Nationale')
    .setDescription(description)
    .addFields({
      name: '📊 Effectif',
      value: `**${agents.length}** agent(s) en service`,
      inline: false,
    })
    .setFooter({ text: `${CONFIG.BOT_NAME} • Dernière mise à jour` })
    .setTimestamp();
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_prendre_service')
      .setLabel('✅ Prendre le service')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_retirer_service')
      .setLabel('🔴 Retirer le service')
      .setStyle(ButtonStyle.Danger),
  );
}

// ─── MISE À JOUR DE TOUS LES PANELS ──────────────────────────────────────────
async function updateAllPanels() {
  const panels = stmt.getPanels.all();
  const embed  = buildPanelEmbed();
  const row    = buildPanelRow();

  for (const panel of panels) {
    try {
      const channel = await client.channels.fetch(panel.channel_id).catch(() => null);
      if (!channel) { stmt.deletePanel.run(panel.message_id); continue; }

      const message = await channel.messages.fetch(panel.message_id).catch(() => null);
      if (!message) { stmt.deletePanel.run(panel.message_id); continue; }

      await message.edit({ embeds: [embed], components: [row] });
    } catch (err) {
      console.warn(`⚠️ Impossible de mettre à jour le panel ${panel.message_id}:`, err.message);
    }
  }
}

// ─── CASIER ───────────────────────────────────────────────────────────────────
function buildEmbedCasier(data) {
  const payeeStr = data.amende_payee ? '✅ Payée' : '❌ Non payée';
  return new EmbedBuilder()
    .setColor(data.amende_payee ? CONFIG.COLOR_SUCCESS : CONFIG.COLOR_DANGER)
    .setAuthor({ name: CONFIG.BOT_NAME })
    .setTitle('📂 EXTRAIT DE CASIER JUDICIAIRE — B3')
    .setDescription('*Document officiel — Usage interne uniquement*')
    .addFields(
      { name: '👤 Identité',         value: `\`\`\`${data.nom_prenom}\`\`\``, inline: false },
      { name: '📋 Faits reprochés',  value: `\`\`\`${data.faits}\`\`\``,      inline: false },
      { name: '💰 Amende',           value: `**${data.amende}**`,              inline: true  },
      { name: '📌 Statut amende',    value: payeeStr,                          inline: true  },
      { name: '📅 Date d\'émission', value: nowFR(),                           inline: true  },
    )
    .setImage(data.photo_url ?? null)
    .setFooter({ text: `Casier #${data.id ?? '?'} • ${CONFIG.BOT_NAME}` })
    .setTimestamp();
}

async function postCasierForum(guild, casierID, nomPrenom, embed, photoUrl) {
  let forum = guild.channels.cache.get(CONFIG.FORUM_ID);
  if (!forum) {
    try { forum = await guild.channels.fetch(CONFIG.FORUM_ID); } catch { forum = null; }
  }
  if (!forum || forum.type !== ChannelType.GuildForum) {
    throw new Error(`Forum introuvable (ID: ${CONFIG.FORUM_ID})`);
  }
  const thread = await forum.threads.create({
    name: nomPrenom,
    message: {
      embeds: [embed],
      files: [{ attachment: photoUrl, name: `casier_${casierID}.png` }],
    },
  });
  stmt.updateThread.run(thread.id, casierID);
  return thread;
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── BOUTONS ──────────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const { customId, user, guild } = interaction;

    if (customId !== 'btn_prendre_service' && customId !== 'btn_retirer_service') return;

    const member = guild?.members.cache.get(user.id)
                 ?? await guild?.members.fetch(user.id).catch(() => null);

    if (!hasGendRole(member)) return denyAccess(interaction);

    const dejaEnService = stmt.getService.get(user.id);

    if (customId === 'btn_prendre_service') {
      if (dejaEnService) {
        return interaction.reply({
          content: '⚠️ Vous êtes **déjà en service**. Utilisez le bouton 🔴 pour retirer votre service.',
          ephemeral: true,
        });
      }
      stmt.addService.run(user.id, user.tag);
      stmt.logAction.run(user.id, user.tag, 'PRISE');
      await interaction.reply({
        content: `✅ **Prise de service enregistrée.** Bonne patrouille, ${user}!`,
        ephemeral: true,
      });
    }

    if (customId === 'btn_retirer_service') {
      if (!dejaEnService) {
        return interaction.reply({
          content: '⚠️ Vous n\'êtes **pas en service**. Utilisez le bouton ✅ pour prendre votre service.',
          ephemeral: true,
        });
      }
      stmt.removeService.run(user.id);
      stmt.logAction.run(user.id, user.tag, 'FIN');
      await interaction.reply({
        content: `🔴 **Service terminé.** Bonne fin de journée, ${user}!`,
        ephemeral: true,
      });
    }

    // Mettre à jour tous les panels après chaque action
    await updateAllPanels();
    return;
  }

  // ── COMMANDES SLASH ───────────────────────────────────────────────────────
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.guild?.members.cache.get(interaction.user.id)
               ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);

  // ── /panel_service ────────────────────────────────────────────
  if (interaction.commandName === 'panel_service') {
    if (!hasGendRole(member)) return denyAccess(interaction);

    const embed = buildPanelEmbed();
    const row   = buildPanelRow();

    await interaction.reply({ content: '✅ Panel posté.', ephemeral: true });

    const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
    stmt.insertPanel.run(msg.id, msg.channel.id);
    return;
  }

  // ── /casier ───────────────────────────────────────────────────
  if (interaction.commandName === 'casier') {
    if (!hasGendRole(member)) return denyAccess(interaction);

    await interaction.deferReply({ ephemeral: true });

    const nomPrenom   = interaction.options.getString('nom_prenom');
    const faits       = interaction.options.getString('faits');
    const amende      = interaction.options.getString('amende');
    const amendePayee = interaction.options.getString('amende_payee') === 'oui' ? 1 : 0;
    const photo       = interaction.options.getAttachment('photo');

    if (!photo?.contentType?.startsWith('image/')) {
      return interaction.editReply({ content: '❌ Fichier invalide. Joignez une image JPG/PNG.' });
    }

    try {
      const result   = stmt.insertCasier.run(nomPrenom, faits, amende, amendePayee, photo.url, interaction.user.tag);
      const casierID = Number(result.lastInsertRowid);
      const data     = { id: casierID, nom_prenom: nomPrenom, faits, amende, amende_payee: amendePayee, photo_url: photo.url };
      const embed    = buildEmbedCasier(data);

      try {
        const thread = await postCasierForum(interaction.guild, casierID, nomPrenom, embed, photo.url);
        await interaction.editReply({ content: `✅ Casier **#${casierID}** créé — <#${thread.id}>` });
      } catch (forumErr) {
        console.warn('⚠️ Fallback message classique:', forumErr.message);
        await interaction.channel.send({
          embeds: [embed],
          files: [{ attachment: photo.url, name: `casier_${casierID}.png` }],
        });
        await interaction.editReply({
          content: `✅ Casier **#${casierID}** créé.\n⚠️ Forum introuvable — posté en message classique.`,
        });
      }
    } catch (err) {
      console.error('Erreur /casier:', err);
      await interaction.editReply({ content: `❌ Erreur : ${err.message}` });
    }
    return;
  }

  // ── /recherche_casier ─────────────────────────────────────────
  if (interaction.commandName === 'recherche_casier') {
    if (!hasGendRole(member)) return denyAccess(interaction);

    await interaction.deferReply({ ephemeral: true });

    const query = interaction.options.getString('nom_prenom');
    const rows  = stmt.searchCasier.all(`%${query}%`);

    if (!rows.length) {
      return interaction.editReply({ content: `🔍 Aucun casier pour \`${query}\`.` });
    }

    const embeds = rows.slice(0, 5).map(row => {
      const e = buildEmbedCasier(row);
      if (row.thread_id) e.addFields({ name: '🔗 Post Forum', value: `<#${row.thread_id}>`, inline: true });
      return e;
    });

    await interaction.editReply({
      content: `🔍 **${rows.length}** casier(s) pour \`${query}\` (5 max) :`,
      embeds,
    });
    return;
  }

  // ── /liste_casiers ────────────────────────────────────────────
  if (interaction.commandName === 'liste_casiers') {
    if (!hasGendRole(member)) return denyAccess(interaction);

    await interaction.deferReply({ ephemeral: true });

    const rows = stmt.listCasiers.all();

    if (!rows.length) {
      return interaction.editReply({ content: '📋 Aucun casier enregistré.' });
    }

    const list = rows.map((r, i) => {
      const payee = r.amende_payee ? '✅' : '❌';
      const link  = r.thread_id ? ` → <#${r.thread_id}>` : '';
      return `**${i + 1}.** \`${r.nom_prenom}\` — ${r.amende} ${payee}${link}`;
    }).join('\n');

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(CONFIG.COLOR_INFO)
          .setAuthor({ name: CONFIG.BOT_NAME })
          .setTitle('📋 Liste des Casiers Judiciaires')
          .setDescription(list)
          .setFooter({ text: `${rows.length} casier(s) — 20 derniers` })
          .setTimestamp(),
      ],
    });
    return;
  }
});

// ─── READY ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Connecté : ${client.user.tag}`);
  client.user.setActivity('Gendarmerie Nationale', { type: ActivityType.Watching });
  await registerCommands();

  // Rafraîchir tous les panels au démarrage
  await updateAllPanels();
  console.log('✅ Panels rafraîchis au démarrage.');
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
client.login(CONFIG.TOKEN).catch(err => {
  console.error('❌ Connexion échouée :', err.message);
  process.exit(1);
});
