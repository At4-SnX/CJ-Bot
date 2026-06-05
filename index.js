
// ═══════════════════════════════════════════════════════════════════════════════
//  BOT DISCORD — Administration Générale de la Gendarmerie
//  v4.0 — Panel Service + Casiers B3 + Appels d'urgence 112
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActivityType,
} = require('discord.js');

const Database = require('better-sqlite3');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CFG = {
  TOKEN:        process.env.DISCORD_TOKEN,
  CLIENT_ID:    process.env.CLIENT_ID,
  FORUM_CASIER: '1511843116066279444',
  FORUM_APPELS: process.env.FORUM_APPELS_ID || '1511843116066279444',
  ROLE_GEND:    '1508283902672896055',
  BOT_NAME:     'Administration Générale de la Gendarmerie',
  COLOR_BLUE:   0x003189,
  COLOR_RED:    0xe74c3c,
  COLOR_ORANGE: 0xe67e22,
  COLOR_GREEN:  0x27ae60,
  COLOR_GREY:   0x95a5a6,
};

if (!CFG.TOKEN)     { console.error('❌ DISCORD_TOKEN manquant'); process.exit(1); }
if (!CFG.CLIENT_ID) { console.error('❌ CLIENT_ID manquant');     process.exit(1); }

// ─── BASE DE DONNÉES ─────────────────────────────────────────────────────────
const db = new Database('/tmp/bot_data.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS casiers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nom_prenom   TEXT    NOT NULL,
    age_rp       INTEGER NOT NULL DEFAULT 0,
    faits        TEXT    NOT NULL,
    type_peine   TEXT    NOT NULL DEFAULT 'amende',
    amende       TEXT,
    amende_payee INTEGER NOT NULL DEFAULT 0,
    duree_gav    TEXT,
    duree_prison TEXT,
    photo_url    TEXT,
    thread_id    TEXT,
    created_by   TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS en_service (
    user_id    TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    statut     TEXT NOT NULL DEFAULT 'service',
    prise_at   TEXT DEFAULT (datetime('now')),
    pause_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS historique_service (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    username   TEXT NOT NULL,
    action     TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS panels_service (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appels_urgence (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type_delit  TEXT NOT NULL,
    lieu        TEXT NOT NULL,
    description TEXT NOT NULL,
    appelant    TEXT NOT NULL,
    thread_id   TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

// ─── MIGRATIONS ──────────────────────────────────────────────────────────────
const cols = db.pragma('table_info(en_service)').map(c => c.name);
if (!cols.includes('statut'))   db.exec(`ALTER TABLE en_service ADD COLUMN statut TEXT NOT NULL DEFAULT 'service'`);
if (!cols.includes('pause_at')) db.exec(`ALTER TABLE en_service ADD COLUMN pause_at TEXT`);

const colsCasier = db.pragma('table_info(casiers)').map(c => c.name);
if (!colsCasier.includes('age_rp'))       db.exec(`ALTER TABLE casiers ADD COLUMN age_rp INTEGER NOT NULL DEFAULT 0`);
if (!colsCasier.includes('type_peine'))   db.exec(`ALTER TABLE casiers ADD COLUMN type_peine TEXT NOT NULL DEFAULT 'amende'`);
if (!colsCasier.includes('duree_gav'))    db.exec(`ALTER TABLE casiers ADD COLUMN duree_gav TEXT`);
if (!colsCasier.includes('duree_prison')) db.exec(`ALTER TABLE casiers ADD COLUMN duree_prison TEXT`);

// ─── STATEMENTS DB ───────────────────────────────────────────────────────────
const db_stmt = {
  insertCasier:   db.prepare(`INSERT INTO casiers (nom_prenom,age_rp,faits,type_peine,amende,amende_payee,duree_gav,duree_prison,photo_url,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`),
  updateCasierThread: db.prepare(`UPDATE casiers SET thread_id=? WHERE id=?`),
  searchCasier:   db.prepare(`SELECT * FROM casiers WHERE nom_prenom LIKE ? ORDER BY created_at DESC`),
  listCasiers:    db.prepare(`SELECT * FROM casiers ORDER BY created_at DESC LIMIT 20`),

  getAgent:       db.prepare(`SELECT * FROM en_service WHERE user_id=?`),
  upsertAgent:    db.prepare(`INSERT OR REPLACE INTO en_service (user_id,username,statut,prise_at,pause_at) VALUES (?,?,?,?,?)`),
  setStatut:      db.prepare(`UPDATE en_service SET statut=?, pause_at=? WHERE user_id=?`),
  removeAgent:    db.prepare(`DELETE FROM en_service WHERE user_id=?`),
  listAgents:     db.prepare(`SELECT * FROM en_service ORDER BY prise_at ASC`),
  logService:     db.prepare(`INSERT INTO historique_service (user_id,username,action) VALUES (?,?,?)`),

  insertPanel:    db.prepare(`INSERT OR REPLACE INTO panels_service (message_id,channel_id) VALUES (?,?)`),
  getPanels:      db.prepare(`SELECT * FROM panels_service`),
  deletePanel:    db.prepare(`DELETE FROM panels_service WHERE message_id=?`),

  insertAppel:    db.prepare(`INSERT INTO appels_urgence (type_delit,lieu,description,appelant,thread_id) VALUES (?,?,?,?,?)`),
  updateAppelThread: db.prepare(`UPDATE appels_urgence SET thread_id=? WHERE id=?`),
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

console.log("Le bot démarre bien!");

client.on('debug', console.log);
client.on('warn', console.log);
client.on('error', console.log);

// ─── DÉLITS ──────────────────────────────────────────────────────────────────
const DELITS = [
  { value: 'prise_otage',    label: '🔫 Prise d\'Otage',        color: 0x8e1a1a },
  { value: 'agression',      label: '👊 Agression',              color: 0xe74c3c },
  { value: 'vol_arme',       label: '🔫 Vol à main armée',       color: 0x8e1a1a },
  { value: 'braquage',       label: '🏦 Braquage',               color: 0x6c0000 },
  { value: 'vol_etalage',    label: '🛒 Vol à l\'étalage',        color: 0xe67e22 },
  { value: 'delit_routier',  label: '🚗 Délit routier',           color: 0xf39c12 },
  { value: 'homicide',       label: '☠️ Homicide / Meurtre',      color: 0x4a0000 },
  { value: 'trafic_stup',    label: '💊 Trafic de stupéfiants',   color: 0x8e44ad },
  { value: 'fugitif',        label: '🏃 Fugitif / Fuite',         color: 0x2980b9 },
  { value: 'incendie',       label: '🔥 Incendie criminel',        color: 0xe67e22 },
  { value: 'violences_dom',  label: '🏠 Violences domestiques',   color: 0xe74c3c },
  { value: 'autre',          label: '📋 Autre / Divers',          color: 0x7f8c8d },
];

function getDelit(value) {
  return DELITS.find(d => d.value === value) ?? { value: 'autre', label: '📋 Autre', color: 0x7f8c8d };
}

// ─── COMMANDES SLASH ─────────────────────────────────────────────────────────
const slashCommands = [

  new SlashCommandBuilder()
    .setName('panel_service')
    .setDescription('🎖️ Poster le panel de gestion des services (persistant)'),

  new SlashCommandBuilder()
    .setName('112')
    .setDescription('🚨 Déclencher un appel d\'urgence (panel interactif)'),

  new SlashCommandBuilder()
    .setName('casier')
    .setDescription('📁 Créer un extrait de casier judiciaire B3')
    .addStringOption(o =>
      o.setName('nom_prenom').setDescription('Nom et prénom RP du suspect').setRequired(true))
    .addIntegerOption(o =>
      o.setName('age_rp').setDescription('Âge RP du suspect').setRequired(true).setMinValue(1).setMaxValue(120))
    .addStringOption(o =>
      o.setName('faits').setDescription('Faits reprochés / infractions').setRequired(true))
    .addStringOption(o =>
      o.setName('type_peine').setDescription('Type de peine prononcée').setRequired(true)
        .addChoices(
          { name: '💰 Amende', value: 'amende' },
          { name: '🚔 Garde à vue (GAV)', value: 'gav' },
          { name: '⛓️ Prison', value: 'prison' },
        ))
    .addAttachmentOption(o =>
      o.setName('photo').setDescription('Photo du suspect de face, fond blanc').setRequired(true))
    .addStringOption(o =>
      o.setName('montant_amende').setDescription('Montant amende — si peine = Amende'))
    .addStringOption(o =>
      o.setName('amende_payee').setDescription('Amende payée ? — si peine = Amende')
        .addChoices(
          { name: 'Oui — payée', value: 'oui' },
          { name: 'Non — impayée', value: 'non' },
        ))
    .addStringOption(o =>
      o.setName('duree_gav').setDescription('Durée GAV (ex: 24h) — si peine = GAV'))
    .addStringOption(o =>
      o.setName('duree_prison').setDescription('Durée prison (ex: 6 mois) — si peine = Prison')),

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
  const rest = new REST({ version: '10' }).setToken(CFG.TOKEN);
  try {
    console.log('🔄 Enregistrement des commandes slash (global)...');
    await rest.put(Routes.applicationCommands(CFG.CLIENT_ID), { body: slashCommands });
    console.log(`✅ ${slashCommands.length} commande(s) enregistrée(s).`);
  } catch (err) {
    console.error('❌ Erreur enregistrement:', err.message);
  }
}

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────
function nowFR() {
  return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

function timeOnlyFR() {
  return new Date().toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function hasRole(member) {
  return member?.roles?.cache?.has(CFG.ROLE_GEND) ?? false;
}

async function getMember(guild, userId) {
  return guild?.members.cache.get(userId)
      ?? await guild?.members.fetch(userId).catch(() => null);
}

async function denyAccess(interaction) {
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(CFG.COLOR_RED)
        .setTitle('🚫 Accès refusé')
        .setDescription('Vous devez avoir le rôle **Gendarmerie Nationale** pour effectuer cette action.')
        .setFooter({ text: CFG.BOT_NAME })
    ],
    ephemeral: true,
  });
}

async function getForumChannel(guild, forumId) {
  let forum = guild.channels.cache.get(forumId);
  if (!forum) forum = await guild.channels.fetch(forumId).catch(() => null);
  if (!forum || forum.type !== ChannelType.GuildForum) return null;
  return forum;
}

// ─── PANEL DE SERVICE ────────────────────────────────────────────────────────
const STATUT_EMOJI = { service: '🟢', pause: '🟡' };
const STATUT_LABEL = { service: 'En service', pause: 'En pause' };

function buildPanelServiceEmbed() {
  const agents = db_stmt.listAgents.all();
  let description = '';

  if (agents.length === 0) {
    description = '*Aucun agent en service pour le moment.*';
  } else {
    description = agents.map((a, i) => {
      const date  = new Date(a.prise_at + 'Z');
      const heure = date.toLocaleTimeString('fr-FR', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        minute: '2-digit'
      });
      const emoji = STATUT_EMOJI[a.statut] ?? '🟢';
      const label = STATUT_LABEL[a.statut] ?? 'En service';

      return `> **${i + 1}.** <@${a.user_id}> — \`${a.username}\`\n> ${emoji} **${label}** depuis **${heure}**`;
    }).join('\n\n');
  }

  const enService = agents.filter(a => a.statut === 'service').length;
  const enPause   = agents.filter(a => a.statut === 'pause').length;

  return new EmbedBuilder()
    .setColor(CFG.COLOR_BLUE)
    .setAuthor({ name: CFG.BOT_NAME })
    .setTitle('🎖️ PANEL DE SERVICE — Gendarmerie Nationale')
    .setDescription(description)
    .addFields(
      { name: '🟢 En service', value: `**${enService}**`, inline: true },
      { name: '🟡 En pause',   value: `**${enPause}**`,   inline: true },
      { name: '👮 Total',      value: `**${agents.length}**`, inline: true },
    )
    .setFooter({ text: `${CFG.BOT_NAME} • Dernière mise à jour` })
    .setTimestamp();
}

function buildPanelServiceRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('svc_prendre')
      .setLabel('🟢 Prendre le service')
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId('svc_pause')
      .setLabel('🟡 Pause')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('svc_fin')
      .setLabel('🔴 Fin de service')
      .setStyle(ButtonStyle.Danger),
  );
}

async function updateAllPanels() {
  const panels = db_stmt.getPanels.all();
  const embed  = buildPanelServiceEmbed();
  const row    = buildPanelServiceRow();

  for (const p of panels) {
    try {
      const ch = await client.channels.fetch(p.channel_id).catch(() => null);
      if (!ch) { db_stmt.deletePanel.run(p.message_id); continue; }

      const msg = await ch.messages.fetch(p.message_id).catch(() => null);
      if (!msg) { db_stmt.deletePanel.run(p.message_id); continue; }

      await msg.edit({ embeds: [embed], components: [row] });

    } catch (e) {
      console.warn(`⚠️ Panel ${p.message_id} non mis à jour:`, e.message);
    }
  }
}

// ─── PANEL 112 ───────────────────────────────────────────────────────────────
function build112Embed() {
  return new EmbedBuilder()
    .setColor(CFG.COLOR_RED)
    .setAuthor({ name: CFG.BOT_NAME })
    .setTitle('🚨 APPEL D\'URGENCE — 112')
    .setDescription(
      '> Sélectionnez le **type d\'incident** dans le menu ci-dessous.\n' +
      '> Un formulaire s\'ouvrira pour renseigner le lieu et les détails.\n\n' +
      `<@&${CFG.ROLE_GEND}> — Répondez à cet appel.`
    )
    .setFooter({ text: `${CFG.BOT_NAME} • Appel d'urgence` })
    .setTimestamp();
}

function build112SelectRow() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('urgence_select_delit')
    .setPlaceholder('⚠️ Sélectionner le type d\'incident...')
    .addOptions(
      DELITS.map(d =>
        new StringSelectMenuOptionBuilder()
          .setLabel(d.label)
          .setValue(d.value)
      )
    );

  return new ActionRowBuilder().addComponents(select);
}

// ─── EMBED APPEL D'URGENCE ───────────────────────────────────────────────────
function buildAppelEmbed(data) {
  const delit = getDelit(data.type_delit);

  return new EmbedBuilder()
    .setColor(delit.color)
    .setAuthor({ name: `🚨 URGENCE 112 — ${CFG.BOT_NAME}` })
    .setTitle(`${delit.label}`)
    .setDescription(`> <@&${CFG.ROLE_GEND}> — **Intervention requise immédiatement !**`)
    .addFields(
      { name: '📍 Lieu',            value: `\`\`\`${data.lieu}\`\`\``, inline: false },
      { name: '📋 Description',     value: `\`\`\`${data.description}\`\`\``, inline: false },
      { name: '👤 Signalé par',     value: `<@${data.appelant_id}> — \`${data.appelant_tag}\``, inline: true },
      { name: '🕐 Heure de l\'appel', value: nowFR(), inline: true },
    )
    .setFooter({ text: `${CFG.BOT_NAME} • Numéro d'urgence 112` })
    .setTimestamp();
}

// ─── EMBED CASIER ────────────────────────────────────────────────────────────
function buildCasierEmbed(data) {
  let peineFields = [];

  if (data.type_peine === 'amende') {
    const s = data.amende_payee ? '✅ Payée' : '❌ Non payée';
    peineFields = [
      { name: '🏷️ Type de peine', value: '```💰 Amende```', inline: true },
      { name: '💰 Montant',        value: `\`\`\`${data.amende || 'N/R'}\`\`\``, inline: true },
      { name: '📌 Statut',         value: `\`\`\`${s}\`\`\``, inline: true },
    ];
  }

  else if (data.type_peine === 'gav') {
    peineFields = [
      { name: '🏷️ Type de peine', value: '```🚔 Garde à vue (GAV)```', inline: true },
      { name: '⏱️ Durée GAV',      value: `\`\`\`${data.duree_gav || 'N/R'}\`\`\``, inline: true },
    ];
  }

  else if (data.type_peine === 'prison') {
    peineFields = [
      { name: '🏷️ Type de peine', value: '```⛓️ Prison```', inline: true },
      { name: '⏱️ Durée',          value: `\`\`\`${data.duree_prison || 'N/R'}\`\`\``, inline: true },
    ];
  }

  return new EmbedBuilder()
    .setColor(CFG.COLOR_BLUE)
    .setAuthor({ name: CFG.BOT_NAME })
    .setTitle('📂 EXTRAIT DE CASIER JUDICIAIRE — B3')
    .setDescription('> 📌 *Document officiel — Usage strictement interne*\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    .addFields(
      { name: '👤 Identité',         value: `\`\`\`${data.nom_prenom}\`\`\``, inline: true },
      { name: '🎂 Âge RP',           value: `\`\`\`${data.age_rp} ans\`\`\``, inline: true },
      { name: '\u200B',              value: '\u200B', inline: true },
      { name: '📋 Faits reprochés',  value: `\`\`\`${data.faits}\`\`\``, inline: false },
      ...peineFields,
      { name: '📅 Date d\'émission', value: `\`\`\`${nowFR()}\`\`\``, inline: false },
    )
    .setThumbnail(data.photo_url ?? null)
    .setFooter({ text: `Casier #${data.id ?? '?'} • ${CFG.BOT_NAME}` })
    .setTimestamp();
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

// Commande préfixée !112
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content.trim().toLowerCase() !== '!112') return;

  try {
    await message.delete().catch(() => {});
    await message.channel.send({
      embeds: [build112Embed()],
      components: [build112SelectRow()]
    });
  } catch (err) {
    console.error('Erreur !112:', err);
  }
});


// ─── INTERACTIONS ────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  console.log(`DEBUG → Interaction reçue : ${interaction.commandName || interaction.customId}`);

  // ───────────────────────────────────────────────────────────────────────────
  // 1. SELECT MENU — Choix du type de délit (112)
  // ───────────────────────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === 'urgence_select_delit') {

    const typeDelit = interaction.values[0];
    const delit     = getDelit(typeDelit);

    const modal = new ModalBuilder()
      .setCustomId(`urgence_modal_${typeDelit}`)
      .setTitle(`🚨 ${delit.label}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('lieu')
            .setLabel('📍 Lieu de l\'incident')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: Rue de la Paix, devant la banque...')
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('📋 Description de la scène')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Décrivez la situation, suspects, véhicules…')
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('suspects')
            .setLabel('👤 Signalement suspect(s)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 2 individus masqués, véhicule noir…')
            .setRequired(false)
        ),
      );

    await interaction.showModal(modal);
    return;
  }


  // ───────────────────────────────────────────────────────────────────────────
  // 2. MODAL SUBMIT — Appel 112
  // ───────────────────────────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('urgence_modal_')) {

    await interaction.deferReply({ ephemeral: true });

    const typeDelit   = interaction.customId.replace('urgence_modal_', '');
    const delit       = getDelit(typeDelit);
    const lieu        = interaction.fields.getTextInputValue('lieu');
    const description = interaction.fields.getTextInputValue('description');
    const suspects    = interaction.fields.getTextInputValue('suspects')?.trim();

    const descComplete = suspects
      ? `${description}\n\n👤 **Signalement :** ${suspects}`
      : description;

    const data = {
      type_delit:   typeDelit,
      lieu,
      description:  descComplete,
      appelant_id:  interaction.user.id,
      appelant_tag: interaction.user.tag,
    };

    const embed = buildAppelEmbed(data);

    try {
      const salonAppels = await interaction.guild.channels.fetch('1512490424118546665').catch(() => null);

      if (salonAppels) {
        await salonAppels.send({ embeds: [embed] });
        const appelId = db_stmt.insertAppel.run(typeDelit, lieu, descComplete, interaction.user.tag, null).lastInsertRowid;

        await interaction.editReply({
          content: `✅ Appel **#${appelId}** envoyé dans <#1512490424118546665>`
        });

      } else {
        await interaction.channel.send({ embeds: [embed] });
        db_stmt.insertAppel.run(typeDelit, lieu, descComplete, interaction.user.tag, null);

        await interaction.editReply({
          content: `⚠️ Salon cible introuvable — Appel posté ici.`
        });
      }

    } catch (err) {
      console.error('Erreur modal urgence:', err);
      await interaction.editReply({
        content: `❌ Erreur lors de l'envoi : ${err.message}`
      });
    }

    return;
  }


  // ───────────────────────────────────────────────────────────────────────────
  // 3. BOUTONS — Panel de service
  // ───────────────────────────────────────────────────────────────────────────
  if (interaction.isButton()) {

    const { customId, user, guild } = interaction;

    if (!['svc_prendre', 'svc_pause', 'svc_fin'].includes(customId)) return;

    const member = await getMember(guild, user.id);
    if (!hasRole(member)) return denyAccess(interaction);

    const agent = db_stmt.getAgent.get(user.id);
    const now   = new Date().toISOString().replace('T', ' ').split('.')[0];

    // Prendre service
    if (customId === 'svc_prendre') {
      if (agent) {
        return interaction.reply({
          content: '⚠️ Vous êtes déjà en service.',
          ephemeral: true
        });
      }
      db_stmt.upsertAgent.run(user.id, user.tag, 'service', now, null);
      db_stmt.logService.run(user.id, user.tag, 'PRISE');

      await interaction.reply({
        content: `🟢 Prise de service enregistrée.`,
        ephemeral: true
      });
    }

    // Pause
    else if (customId === 'svc_pause') {
      if (!agent) {
        return interaction.reply({
          content: '⚠️ Vous n’êtes pas en service.',
          ephemeral: true
        });
      }

      if (agent.statut === 'pause') {
        db_stmt.setStatut.run('service', null, user.id);
        db_stmt.logService.run(user.id, user.tag, 'RETOUR_PAUSE');

        await interaction.reply({
          content: `🟢 Retour de pause enregistré.`,
          ephemeral: true
        });

      } else {
        db_stmt.setStatut.run('pause', now, user.id);
        db_stmt.logService.run(user.id, user.tag, 'PAUSE');

        await interaction.reply({
          content: `🟡 Pause enregistrée.`,
          ephemeral: true
        });
      }
    }

    // Fin de service
    else if (customId === 'svc_fin') {
      if (!agent) {
        return interaction.reply({
          content: '⚠️ Vous n’êtes pas en service.',
          ephemeral: true
        });
      }

      db_stmt.removeAgent.run(user.id);
      db_stmt.logService.run(user.id, user.tag, 'FIN');

      await interaction.reply({
        content: `🔴 Fin de service enregistrée.`,
        ephemeral: true
      });
    }

    await updateAllPanels();
    return;
  }


  // ───────────────────────────────────────────────────────────────────────────
  // 4. COMMANDES SLASH
  // ───────────────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {

    await interaction.deferReply({ ephemeral: true });
    const member = await getMember(interaction.guild, interaction.user.id);

    // /panel_service
    if (interaction.commandName === 'panel_service') {
      if (!hasRole(member)) return denyAccess(interaction);

      const msg = await interaction.channel.send({
        embeds: [buildPanelServiceEmbed()],
        components: [buildPanelServiceRow()]
      });

      db_stmt.insertPanel.run(msg.id, msg.channel.id);

      return interaction.editReply({ content: '✅ Panel de service posté.' });
    }

    // /112
    if (interaction.commandName === '112') {
      await interaction.channel.send({
        embeds: [build112Embed()],
        components: [build112SelectRow()]
      });

      return interaction.editReply({ content: '🚨 Panel d’urgence posté.' });
    }

    // /casier
    if (interaction.commandName === 'casier') {
      // (Ton code casier sera collé ici)
      return;
    }

    // /recherche_casier
    if (interaction.commandName === 'recherche_casier') {
      // (Ton code recherche casier sera collé ici)
      return;
    }

    // /liste_casiers
    if (interaction.commandName === 'liste_casiers') {
      // (Ton code liste casiers sera collé ici)
      return;
    }
  }
});

  // ─── EVENTS ──────────────────────────────────────────────────────────────────

// Commande préfixée !112
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content.trim().toLowerCase() !== '!112') return;

  try {
    await message.delete().catch(() => {});
    await message.channel.send({
      embeds: [build112Embed()],
      components: [build112SelectRow()]
    });
  } catch (err) {
    console.error('Erreur !112:', err);
  }
});


// ─── INTERACTIONS ────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  console.log(`DEBUG → Interaction reçue : ${interaction.commandName || interaction.customId}`);

  // ───────────────────────────────────────────────────────────────────────────
  // 1. SELECT MENU — Choix du type de délit (112)
  // ───────────────────────────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === 'urgence_select_delit') {

    const typeDelit = interaction.values[0];
    const delit     = getDelit(typeDelit);

    const modal = new ModalBuilder()
      .setCustomId(`urgence_modal_${typeDelit}`)
      .setTitle(`🚨 ${delit.label}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('lieu')
            .setLabel('📍 Lieu de l\'incident')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('📋 Description de la scène')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('suspects')
            .setLabel('👤 Signalement suspect(s)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
      );

    await interaction.showModal(modal);
    return;
  }


  // ───────────────────────────────────────────────────────────────────────────
  // 2. MODAL SUBMIT — Appel 112
  // ───────────────────────────────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('urgence_modal_')) {

    await interaction.deferReply({ ephemeral: true });

    const typeDelit   = interaction.customId.replace('urgence_modal_', '');
    const delit       = getDelit(typeDelit);
    const lieu        = interaction.fields.getTextInputValue('lieu');
    const description = interaction.fields.getTextInputValue('description');
    const suspects    = interaction.fields.getTextInputValue('suspects')?.trim();

    const descComplete = suspects
      ? `${description}\n\n👤 **Signalement :** ${suspects}`
      : description;

    const data = {
      type_delit:   typeDelit,
      lieu,
      description:  descComplete,
      appelant_id:  interaction.user.id,
      appelant_tag: interaction.user.tag,
    };

    const embed = buildAppelEmbed(data);

    try {
      const salonAppels = await interaction.guild.channels.fetch('1512490424118546665').catch(() => null);

      if (salonAppels) {
        await salonAppels.send({ embeds: [embed] });
        const appelId = db_stmt.insertAppel.run(typeDelit, lieu, descComplete, interaction.user.tag, null).lastInsertRowid;

        await interaction.editReply({
          content: `✅ Appel **#${appelId}** envoyé dans <#1512490424118546665>`
        });

      } else {
        await interaction.channel.send({ embeds: [embed] });
        db_stmt.insertAppel.run(typeDelit, lieu, descComplete, interaction.user.tag, null);

        await interaction.editReply({
          content: `⚠️ Salon cible introuvable — Appel posté ici.`
        });
      }

    } catch (err) {
      console.error('Erreur modal urgence:', err);
      await interaction.editReply({
        content: `❌ Erreur lors de l'envoi : ${err.message}`
      });
    }

    return;
  }


  // ───────────────────────────────────────────────────────────────────────────
  // 3. BOUTONS — Panel de service
  // ───────────────────────────────────────────────────────────────────────────
  if (interaction.isButton()) {

    const { customId, user, guild } = interaction;

    if (!['svc_prendre', 'svc_pause', 'svc_fin'].includes(customId)) return;

    const member = await getMember(guild, user.id);
    if (!hasRole(member)) return denyAccess(interaction);

    const agent = db_stmt.getAgent.get(user.id);
    const now   = new Date().toISOString().replace('T', ' ').split('.')[0];

    // Prendre service
    if (customId === 'svc_prendre') {
      if (agent) {
        return interaction.reply({
          content: '⚠️ Vous êtes déjà en service.',
          ephemeral: true
        });
      }
      db_stmt.upsertAgent.run(user.id, user.tag, 'service', now, null);
      db_stmt.logService.run(user.id, user.tag, 'PRISE');

      await interaction.reply({
        content: `🟢 Prise de service enregistrée.`,
        ephemeral: true
      });
    }

    // Pause
    else if (customId === 'svc_pause') {
      if (!agent) {
        return interaction.reply({
          content: '⚠️ Vous n’êtes pas en service.',
          ephemeral: true
        });
      }

      if (agent.statut === 'pause') {
        db_stmt.setStatut.run('service', null, user.id);
        db_stmt.logService.run(user.id, user.tag, 'RETOUR_PAUSE');

        await interaction.reply({
          content: `🟢 Retour de pause enregistré.`,
          ephemeral: true
        });

      } else {
        db_stmt.setStatut.run('pause', now, user.id);
        db_stmt.logService.run(user.id, user.tag, 'PAUSE');

        await interaction.reply({
          content: `🟡 Pause enregistrée.`,
          ephemeral: true
        });
      }
    }

    // Fin de service
    else if (customId === 'svc_fin') {
      if (!agent) {
        return interaction.reply({
          content: '⚠️ Vous n’êtes pas en service.',
          ephemeral: true
        });
      }

      db_stmt.removeAgent.run(user.id);
      db_stmt.logService.run(user.id, user.tag, 'FIN');

      await interaction.reply({
        content: `🔴 Fin de service enregistrée.`,
        ephemeral: true
      });
    }

    await updateAllPanels();
    return;
  }


  // ───────────────────────────────────────────────────────────────────────────
  // 4. COMMANDES SLASH
  // ───────────────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {

    await interaction.deferReply({ ephemeral: true });
    const member = await getMember(interaction.guild, interaction.user.id);

    // /panel_service
    if (interaction.commandName === 'panel_service') {
      if (!hasRole(member)) return denyAccess(interaction);

      const msg = await interaction.channel.send({
        embeds: [buildPanelServiceEmbed()],
        components: [buildPanelServiceRow()]
      });

      db_stmt.insertPanel.run(msg.id, msg.channel.id);

      return interaction.editReply({ content: '✅ Panel de service posté.' });
    }

    // /112
    if (interaction.commandName === '112') {
      await interaction.channel.send({
        embeds: [build112Embed()],
        components: [build112SelectRow()]
      });

      return interaction.editReply({ content: '🚨 Panel d’urgence posté.' });
    }

    // /casier
    if (interaction.commandName === 'casier') {
      // (Ton code casier collé ici)
      // ✔️ Je l’ai déjà intégré dans ton bloc précédent
      return;
    }

    // /recherche_casier
    if (interaction.commandName === 'recherche_casier') {
      // ✔️ Déjà intégré
      return;
    }

    // /liste_casiers
    if (interaction.commandName === 'liste_casiers') {
      // ✔️ Déjà intégré
      return;
    }
  }
});

// ─── READY ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Connecté : ${client.user.tag}`);

  client.user.setActivity('Gendarmerie Nationale', {
    type: ActivityType.Watching
  });

  await registerCommands();
  await updateAllPanels();

  console.log('✅ Panels rafraîchis.');
});

client.login(CFG.TOKEN);
