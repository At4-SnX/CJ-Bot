═══════════════════════════════════════════════════════════════════════════
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

// Migration silencieuse — ajout colonnes si base existante ancienne version
const existingCols = db.pragma('table_info(casiers)').map(c => c.name);
if (!existingCols.includes('age_rp'))       db.exec(`ALTER TABLE casiers ADD COLUMN age_rp INTEGER NOT NULL DEFAULT 0`);
if (!existingCols.includes('type_peine'))   db.exec(`ALTER TABLE casiers ADD COLUMN type_peine TEXT NOT NULL DEFAULT 'amende'`);
if (!existingCols.includes('duree_gav'))    db.exec(`ALTER TABLE casiers ADD COLUMN duree_gav TEXT`);
if (!existingCols.includes('duree_prison')) db.exec(`ALTER TABLE casiers ADD COLUMN duree_prison TEXT`);

const stmt = {
  insertCasier:  db.prepare(`
    INSERT INTO casiers (nom_prenom, age_rp, faits, type_peine, amende, amende_payee, duree_gav, duree_prison, photo_url, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateThread:  db.prepare(`UPDATE casiers SET thread_id = ? WHERE id = ?`),
  searchCasier:  db.prepare(`SELECT * FROM casiers WHERE nom_prenom LIKE ? ORDER BY created_at DESC`),
  listCasiers:   db.prepare(`SELECT * FROM casiers ORDER BY created_at DESC LIMIT 20`),

  getService:    db.prepare(`SELECT * FROM en_service WHERE user_id = ?`),
  addService:    db.prepare(`INSERT OR REPLACE INTO en_service (user_id, username, prise_at) VALUES (?, ?, datetime('now'))`),
  removeService: db.prepare(`DELETE FROM en_service WHERE user_id = ?`),
  listService:   db.prepare(`SELECT * FROM en_service ORDER BY prise_at ASC`),
  logAction:     db.prepare(`INSERT INTO historique_service (user_id, username, action) VALUES (?, ?, ?)`),

  insertPanel:   db.prepare(`INSERT INTO panels (message_id, channel_id) VALUES (?, ?)`),
  getPanels:     db.prepare(`SELECT * FROM panels`),
  deletePanel:   db.prepare(`DELETE FROM panels WHERE message_id = ?`),
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

  // Panel de service
  new SlashCommandBuilder()
    .setName('panel_service')
    .setDescription('📋 Poster le panel de gestion des services (persistant)'),

  // Casier judiciaire
  new SlashCommandBuilder()
    .setName('casier')
    .setDescription('📁 Créer un extrait de casier judiciaire B3')
    .addStringOption(o =>
      o.setName('nom_prenom')
        .setDescription('Nom et prénom RP du suspect')
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName('age_rp')
        .setDescription('Âge RP du suspect')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(120))
    .addStringOption(o =>
      o.setName('faits')
        .setDescription('Faits reprochés / infractions')
        .setRequired(true))
    .addStringOption(o =>
      o.setName('type_peine')
        .setDescription('Type de peine prononcée')
        .setRequired(true)
        .addChoices(
          { name: '💰 Amende',             value: 'amende'  },
          { name: '🚔 Garde à vue (GAV)',   value: 'gav'     },
          { name: '⛓️ Prison',              value: 'prison'  },
        ))
    // Options conditionnelles selon le type de peine
    .addStringOption(o =>
      o.setName('montant_amende')
        .setDescription('💰 Montant de l\'amende (ex: 5000$) — requis si peine = Amende')
        .setRequired(false))
    .addStringOption(o =>
      o.setName('amende_payee')
        .setDescription('💰 Amende déjà payée ? — requis si peine = Amende')
        .setRequired(false)
        .addChoices(
          { name: '✅ Oui — payée',   value: 'oui' },
          { name: '❌ Non — impayée', value: 'non' },
        ))
    .addStringOption(o =>
      o.setName('duree_gav')
        .setDescription('🚔 Durée de la GAV (ex: 24h, 48h) — requis si peine = GAV')
        .setRequired(false))
    .addStringOption(o =>
      o.setName('duree_prison')
        .setDescription('⛓️ Durée de la peine de prison (ex: 6 mois) — requis si peine = Prison')
        .setRequired(false))
    .addAttachmentOption(o =>
      o.setName('photo')
        .setDescription('Photo du suspect de face, fond blanc')
        .setRequired(true)),

  // Recherche
  new SlashCommandBuilder()
    .setName('recherche_casier')
    .setDescription('🔍 Rechercher un casier judiciaire par nom/prénom')
    .addStringOption(o =>
      o.setName('nom_prenom')
        .setDescription('Nom et prénom RP à rechercher')
        .setRequired(true)),

  // Liste
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

// ─── EMBED CASIER ────────────────────────────────────────────────────────────
function buildEmbedCasier(data) {

  // Bloc peine selon le type
  let peineFields = [];

  if (data.type_peine === 'amende') {
    const payeeStr = data.amende_payee ? '✅ Payée' : '❌ Non payée';
    peineFields = [
      { name: '🏷️ Type de peine',  value: '```💰 Amende```',                         inline: true  },
      { name: '💰 Montant',         value: `\`\`\`${data.amende || 'N/R'}\`\`\``,     inline: true  },
      { name: '📌 Statut',          value: `\`\`\`${payeeStr}\`\`\``,                  inline: true  },
    ];
  } else if (data.type_peine === 'gav') {
    peineFields = [
      { name: '🏷️ Type de peine',  value: '```🚔 Garde à vue (GAV)```',               inline: true  },
      { name: '⏱️ Durée GAV',       value: `\`\`\`${data.duree_gav || 'N/R'}\`\`\``,  inline: true  },
    ];
  } else if (data.type_peine === 'prison') {
    peineFields = [
      { name: '🏷️ Type de peine',  value: '```⛓️ Prison```',                              inline: true  },
      { name: '⏱️ Durée',           value: `\`\`\`${data.duree_prison || 'N/R'}\`\`\``,   inline: true  },
    ];
  }

  return new EmbedBuilder()
    .setColor(CONFIG.BOT_COLOR)
    .setAuthor({ name: CONFIG.BOT_NAME })
    .setTitle('📂 EXTRAIT DE CASIER JUDICIAIRE — B3')
    .setDescription(
      '> 📌 *Document officiel — Usage strictement interne*\n' +
      '> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    )
    .addFields(
      { name: '👤 Identité',        value: `\`\`\`${data.nom_prenom}\`\`\``,   inline: true  },
      { name: '🎂 Âge RP',          value: `\`\`\`${data.age_rp} ans\`\`\``,   inline: true  },
      { name: '\u200B',             value: '\u200B',                            inline: true  }, // séparateur invisible
      { name: '📋 Faits reprochés', value: `\`\`\`${data.faits}\`\`\``,        inline: false },
      ...peineFields,
      { name: '📅 Date d\'émission', value: `\`\`\`${nowFR()}\`\`\``,          inline: false },
    )
    .setThumbnail(data.photo_url ?? null)  // Photo UNE SEULE FOIS — coin supérieur droit
    .setFooter({ text: `Casier #${data.id ?? '?'} • ${CONFIG.BOT_NAME}` })
    .setTimestamp();
}

// ─── PANEL DE SERVICE ────────────────────────────────────────────────────────
function buildPanelEmbed() {
  const agents = stmt.listService.all();

  let description;
  if (agents.length === 0) {
    description = '*Aucun agent en service pour le moment.*';
  } else {
    description = agents.map((a, i) => {
      const date  = new Date(a.prise_at + 'Z');
      const heure = date.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
      return `> **${i + 1}.** <@${a.user_id}> — \`${a.username}\`\n> 🕐 En service depuis **${heure}**`;
    }).join('\n\n');
  }

  return new EmbedBuilder()
    .setColor(CONFIG.BOT_COLOR)
    .setAuthor({ name: CONFIG.BOT_NAME })
    .setTitle('🎖️ PANEL DE SERVICE — Gendarmerie Nationale')
    .setDescription(description)
    .addFields({ name: '📊 Effectif', value: `**${agents.length}** agent(s) en service`, inline: false })
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
      console.warn(`⚠️ Panel ${panel.message_id} non mis à jour:`, err.message);
    }
  }
}

// ─── FORUM ───────────────────────────────────────────────────────────────────
async function postCasierForum(guild, casierID, nomPrenom, embed) {
  let forum = guild.channels.cache.get(CONFIG.FORUM_ID);
  if (!forum) {
    try { forum = await guild.channels.fetch(CONFIG.FORUM_ID); } catch { forum = null; }
  }
  if (!forum || forum.type !== ChannelType.GuildForum) {
    throw new Error(`Forum introuvable (ID: ${CONFIG.FORUM_ID})`);
  }
  const thread = await forum.threads.create({
    name: nomPrenom,
    message: { embeds: [embed] },
  });
  stmt.updateThread.run(thread.id, casierID);
  return thread;
}

// ─── INTERACTIONS ────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── BOUTONS SERVICE ───────────────────────────────────────────────────────
  if (interaction.isButton()) {
    const { customId, user, guild } = interaction;
    if (customId !== 'btn_prendre_service' && customId !== 'btn_retirer_service') return;

    const member = guild?.members.cache.get(user.id)
                 ?? await guild?.members.fetch(user.id).catch(() => null);
    if (!hasGendRole(member)) return denyAccess(interaction);

    const dejaEnService = stmt.getService.get(user.id);

    if (customId === 'btn_prendre_service') {
      if (dejaEnService) {
        return interaction.reply({ content: '⚠️ Vous êtes **déjà en service**. Utilisez 🔴 pour retirer votre service.', ephemeral: true });
      }
      stmt.addService.run(user.id, user.tag);
      stmt.logAction.run(user.id, user.tag, 'PRISE');
      await interaction.reply({ content: `✅ **Prise de service enregistrée.** Bonne patrouille, ${user} !`, ephemeral: true });
    }

    if (customId === 'btn_retirer_service') {
      if (!dejaEnService) {
        return interaction.reply({ content: '⚠️ Vous n\'êtes **pas en service**. Utilisez ✅ pour prendre votre service.', ephemeral: true });
      }
      stmt.removeService.run(user.id);
      stmt.logAction.run(user.id, user.tag, 'FIN');
      await interaction.reply({ content: `🔴 **Service terminé.** Bonne fin de journée, ${user} !`, ephemeral: true });
    }

    await updateAllPanels();
    return;
  }

  // ── COMMANDES SLASH ───────────────────────────────────────────────────────
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.guild?.members.cache.get(interaction.user.id)
               ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);

  // /panel_service ────────────────────────────────────────────────────────
  if (interaction.commandName === 'panel_service') {
    if (!hasGendRole(member)) return denyAccess(interaction);
    await interaction.reply({ content: '✅ Panel posté.', ephemeral: true });
    const msg = await interaction.channel.send({ embeds: [buildPanelEmbed()], components: [buildPanelRow()] });
    stmt.insertPanel.run(msg.id, msg.channel.id);
    return;
  }

  // /casier ───────────────────────────────────────────────────────────────
  if (interaction.commandName === 'casier') {
    if (!hasGendRole(member)) return denyAccess(interaction);
    await interaction.deferReply({ ephemeral: true });

    const nomPrenom    = interaction.options.getString('nom_prenom');
    const ageRp        = interaction.options.getInteger('age_rp');
    const faits        = interaction.options.getString('faits');
    const typePeine    = interaction.options.getString('type_peine');
    const amende       = interaction.options.getString('montant_amende') ?? null;
    const amendePayee  = interaction.options.getString('amende_payee') === 'oui' ? 1 : 0;
    const dureeGav     = interaction.options.getString('duree_gav') ?? null;
    const dureePrison  = interaction.options.getString('duree_prison') ?? null;
    const photo        = interaction.options.getAttachment('photo');

    // Validations selon type de peine
    if (typePeine === 'amende' && !amende) {
      return interaction.editReply({ content: '❌ Vous devez renseigner le **montant de l\'amende** pour une peine de type Amende.' });
    }
    if (typePeine === 'gav' && !dureeGav) {
      return interaction.editReply({ content: '❌ Vous devez renseigner la **durée de la GAV**.' });
    }
    if (typePeine === 'prison' && !dureePrison) {
      return interaction.editReply({ content: '❌ Vous devez renseigner la **durée de la peine de prison**.' });
    }
    if (!photo?.contentType?.startsWith('image/')) {
      return interaction.editReply({ content: '❌ Fichier invalide. Joignez une image JPG/PNG.' });
    }

    try {
      const result   = stmt.insertCasier.run(
        nomPrenom, ageRp, faits, typePeine,
        amende, amendePayee, dureeGav, dureePrison,
        photo.url, interaction.user.tag
      );
      const casierID = Number(result.lastInsertRowid);
      const data = {
        id: casierID, nom_prenom: nomPrenom, age_rp: ageRp,
        faits, type_peine: typePeine,
        amende, amende_payee: amendePayee,
        duree_gav: dureeGav, duree_prison: dureePrison,
        photo_url: photo.url,
      };
      const embed = buildEmbedCasier(data);

      try {
        const thread = await postCasierForum(interaction.guild, casierID, nomPrenom, embed);
        await interaction.editReply({ content: `✅ Casier **#${casierID}** créé pour **${nomPrenom}** — <#${thread.id}>` });
      } catch (forumErr) {
        console.warn('⚠️ Fallback message classique:', forumErr.message);
        await interaction.channel.send({ embeds: [embed] });
        await interaction.editReply({ content: `✅ Casier **#${casierID}** créé.\n⚠️ Forum introuvable — posté en message classique.` });
      }
    } catch (err) {
      console.error('Erreur /casier:', err);
      await interaction.editReply({ content: `❌ Erreur : ${err.message}` });
    }
    return;
  }

  // /recherche_casier ─────────────────────────────────────────────────────
  if (interaction.commandName === 'recherche_casier') {
    if (!hasGendRole(member)) return denyAccess(interaction);
    await interaction.deferReply({ ephemeral: true });

    const query = interaction.options.getString('nom_prenom');
    const rows  = stmt.searchCasier.all(`%${query}%`);

    if (!rows.length) {
      return interaction.editReply({ content: `🔍 Aucun casier trouvé pour \`${query}\`.` });
    }

    const embeds = rows.slice(0, 5).map(row => {
      const e = buildEmbedCasier(row);
      if (row.thread_id) e.addFields({ name: '🔗 Post Forum', value: `<#${row.thread_id}>`, inline: true });
      return e;
    });

    await interaction.editReply({
      content: `🔍 **${rows.length}** casier(s) pour \`${query}\` (5 max affichés) :`,
      embeds,
    });
    return;
  }

  // /liste_casiers ────────────────────────────────────────────────────────
  if (interaction.commandName === 'liste_casiers') {
    if (!hasGendRole(member)) return denyAccess(interaction);
    await interaction.deferReply({ ephemeral: true });

    const rows = stmt.listCasiers.all();
    if (!rows.length) return interaction.editReply({ content: '📋 Aucun casier enregistré.' });

    const PEINE_EMOJI = { amende: '💰', gav: '🚔', prison: '⛓️' };
    const list = rows.map((r, i) => {
      const emoji = PEINE_EMOJI[r.type_peine] ?? '❓';
      const link  = r.thread_id ? ` → <#${r.thread_id}>` : '';
      let detail  = '';
      if (r.type_peine === 'amende')  detail = ` — ${r.amende} ${r.amende_payee ? '✅' : '❌'}`;
      if (r.type_peine === 'gav')     detail = ` — GAV ${r.duree_gav}`;
      if (r.type_peine === 'prison')  detail = ` — Prison ${r.duree_prison}`;
      return `**${i + 1}.** ${emoji} \`${r.nom_prenom}\` (${r.age_rp} ans)${detail}${link}`;
    }).join('\n');

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(CONFIG.BOT_COLOR)
          .setAuthor({ name: CONFIG.BOT_NAME })
          .setTitle('📋 Liste des Casiers Judiciaires')
          .setDescription(list)
          .setFooter({ text: `${rows.length} casier(s) — 20 derniers • ${CONFIG.BOT_NAME}` })
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
  await updateAllPanels();
  console.log('✅ Panels rafraîchis au démarrage.');
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
client.login(CONFIG.TOKEN).catch(err => {
  console.error('❌ Connexion échouée :', err.message);
  process.exit(1);
});