// ═══════════════════════════════════════════════════════════════════════════════
//  BOT DISCORD — Administration Générale de la Gendarmerie
//  Casiers Judiciaires B3 + Appels d'Urgence 112
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

  // ID du salon Forum pour les casiers judiciaires
  FORUM_CASIER: process.env.FORUM_CASIER_ID || '1511843116066279444',

  // ID du salon Forum pour les appels d'urgence 112
  FORUM_APPELS: process.env.FORUM_APPELS_ID || '1512763381226930196',

  // ID du rôle Gendarmerie Nationale (requis pour /casier)
  ROLE_GEND:    process.env.ROLE_GEND_ID    || '1508283902672896055',

  BOT_NAME:     'Administration Générale de la Gendarmerie',
  COLOR_BLUE:   0x003189,
  COLOR_RED:    0xc0392b,
  COLOR_ORANGE: 0xe67e22,
};

if (!CFG.TOKEN)     { console.error('❌ DISCORD_TOKEN manquant'); process.exit(1); }
if (!CFG.CLIENT_ID) { console.error('❌ CLIENT_ID manquant');     process.exit(1); }

// ─── BASE DE DONNÉES ─────────────────────────────────────────────────────────
const db = new Database('./bot_data.db');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS casiers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nom_prenom   TEXT    NOT NULL,
    age_rp       INTEGER NOT NULL,
    faits        TEXT    NOT NULL,
    type_peine   TEXT    NOT NULL,
    amende       TEXT,
    amende_payee INTEGER DEFAULT 0,
    duree_gav    TEXT,
    duree_prison TEXT,
    photo_url    TEXT,
    thread_id    TEXT,
    created_by   TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appels_urgence (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type_delit   TEXT NOT NULL,
    lieu         TEXT NOT NULL,
    description  TEXT NOT NULL,
    suspects     TEXT,
    appelant_id  TEXT NOT NULL,
    appelant_tag TEXT NOT NULL,
    thread_id    TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );
`);

// Prepared statements
const Q = {
  insertCasier:      db.prepare(`
    INSERT INTO casiers
      (nom_prenom, age_rp, faits, type_peine, amende, amende_payee, duree_gav, duree_prison, photo_url, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateCasierThread: db.prepare(`UPDATE casiers SET thread_id=? WHERE id=?`),
  searchCasier:       db.prepare(`SELECT * FROM casiers WHERE nom_prenom LIKE ? ORDER BY created_at DESC`),
  listCasiers:        db.prepare(`SELECT * FROM casiers ORDER BY created_at DESC LIMIT 20`),
  getCasier:          db.prepare(`SELECT * FROM casiers WHERE id=?`),

  insertAppel:       db.prepare(`
    INSERT INTO appels_urgence
      (type_delit, lieu, description, suspects, appelant_id, appelant_tag, thread_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
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

// ─── DÉLITS 112 ──────────────────────────────────────────────────────────────
const DELITS = [
  { value: 'prise_otage',   label: '🔫 Prise d\'Otage',       color: 0x6c0000 },
  { value: 'agression',     label: '👊 Agression',             color: 0xc0392b },
  { value: 'vol_arme',      label: '🔫 Vol à main armée',      color: 0x8e1a1a },
  { value: 'braquage',      label: '🏦 Braquage',              color: 0x6c0000 },
  { value: 'vol_etalage',   label: '🛒 Vol à l\'étalage',       color: 0xe67e22 },
  { value: 'delit_routier', label: '🚗 Délit routier',          color: 0xf39c12 },
  { value: 'homicide',      label: '☠️ Homicide / Meurtre',     color: 0x4a0000 },
  { value: 'trafic_stup',   label: '💊 Trafic de stupéfiants',  color: 0x8e44ad },
  { value: 'fugitif',       label: '🏃 Fugitif / Fuite',        color: 0x2980b9 },
  { value: 'incendie',      label: '🔥 Incendie criminel',       color: 0xe67e22 },
  { value: 'violences_dom', label: '🏠 Violences domestiques',  color: 0xc0392b },
  { value: 'accident',      label: '🚑 Accident grave',          color: 0xe74c3c },
  { value: 'intrusion',     label: '🚪 Intrusion / Cambriolage', color: 0x7f8c8d },
  { value: 'menace_arme',   label: '🗡️ Menace avec arme',        color: 0x8e1a1a },
  { value: 'autre',         label: '📋 Autre / Divers',          color: 0x7f8c8d },
];

function getDelit(value) {
  return DELITS.find(d => d.value === value) ?? DELITS[DELITS.length - 1];
}

// ─── COMMANDES SLASH ─────────────────────────────────────────────────────────
const SLASH_COMMANDS = [

  // ── Casiers ──────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('casier_creer')
    .setDescription('📁 Créer un extrait de casier judiciaire B3')
    .addStringOption(o =>
      o.setName('nom_prenom').setDescription('Nom et prénom RP du suspect').setRequired(true))
    .addIntegerOption(o =>
      o.setName('age_rp').setDescription('Âge RP du suspect').setRequired(true).setMinValue(1).setMaxValue(120))
    .addStringOption(o =>
      o.setName('faits').setDescription('Faits reprochés / infractions commises').setRequired(true))
    .addStringOption(o =>
      o.setName('type_peine').setDescription('Type de peine prononcée').setRequired(true)
        .addChoices(
          { name: '💰 Amende',             value: 'amende'  },
          { name: '🚔 Garde à vue (GAV)',   value: 'gav'     },
          { name: '⛓️ Prison',              value: 'prison'  },
        ))
    .addAttachmentOption(o =>
      o.setName('photo').setDescription('Photo du suspect de face sur fond blanc').setRequired(true))
    .addStringOption(o =>
      o.setName('montant_amende').setDescription('💰 Montant amende ex: 5000$ — requis si peine = Amende').setRequired(false))
    .addStringOption(o =>
      o.setName('amende_payee').setDescription('💰 Amende déjà payée ? — requis si peine = Amende').setRequired(false)
        .addChoices(
          { name: '✅ Oui — payée',    value: 'oui' },
          { name: '❌ Non — impayée',  value: 'non' },
        ))
    .addStringOption(o =>
      o.setName('duree_gav').setDescription('🚔 Durée GAV ex: 24h, 48h — requis si peine = GAV').setRequired(false))
    .addStringOption(o =>
      o.setName('duree_prison').setDescription('⛓️ Durée prison ex: 6 mois — requis si peine = Prison').setRequired(false)),

  new SlashCommandBuilder()
    .setName('casier_rechercher')
    .setDescription('🔍 Rechercher un casier judiciaire par nom/prénom')
    .addStringOption(o =>
      o.setName('nom_prenom').setDescription('Nom et prénom RP à rechercher').setRequired(true)),

  new SlashCommandBuilder()
    .setName('casier_liste')
    .setDescription('📋 Lister les 20 derniers casiers enregistrés'),

  new SlashCommandBuilder()
    .setName('casier_voir')
    .setDescription('🔎 Afficher un casier par son numéro')
    .addIntegerOption(o =>
      o.setName('id').setDescription('Numéro du casier (ex: 5)').setRequired(true)),

  // ── 112 ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('112')
    .setDescription('🚨 Poster un panel d\'appel d\'urgence dans ce salon'),

].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(CFG.TOKEN);
  try {
    console.log('🔄 Enregistrement des commandes slash...');
    await rest.put(Routes.applicationCommands(CFG.CLIENT_ID), { body: SLASH_COMMANDS });
    console.log(`✅ ${SLASH_COMMANDS.length} commandes enregistrées.`);
  } catch (err) {
    console.error('❌ Erreur enregistrement:', err.message);
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function nowFR() {
  return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}
function timeOnlyFR() {
  return new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
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
    embeds: [new EmbedBuilder()
      .setColor(CFG.COLOR_RED)
      .setTitle('🚫 Accès refusé')
      .setDescription('Vous devez avoir le rôle **Gendarmerie Nationale** pour effectuer cette action.')
      .setFooter({ text: CFG.BOT_NAME })],
    ephemeral: true,
  });
}
async function getForumChannel(guild, forumId) {
  if (!forumId) return null;
  let ch = guild.channels.cache.get(forumId);
  if (!ch) ch = await guild.channels.fetch(forumId).catch(() => null);
  return (ch?.type === ChannelType.GuildForum) ? ch : null;
}

// ─── EMBEDS ───────────────────────────────────────────────────────────────────

/** Embed casier judiciaire B3 */
function buildCasierEmbed(data) {
  let peineFields = [];

  if (data.type_peine === 'amende') {
    const s = Number(data.amende_payee) ? '✅ Payée' : '❌ Non payée';
    peineFields = [
      { name: '🏷️ Type de peine', value: '```💰 Amende```',                      inline: true },
      { name: '💰 Montant',        value: `\`\`\`${data.amende || 'N/R'}\`\`\``, inline: true },
      { name: '📌 Statut',         value: `\`\`\`${s}\`\`\``,                     inline: true },
    ];
  } else if (data.type_peine === 'gav') {
    peineFields = [
      { name: '🏷️ Type de peine', value: '```🚔 Garde à vue (GAV)```',                inline: true },
      { name: '⏱️ Durée GAV',      value: `\`\`\`${data.duree_gav || 'N/R'}\`\`\``,  inline: true },
    ];
  } else if (data.type_peine === 'prison') {
    peineFields = [
      { name: '🏷️ Type de peine', value: '```⛓️ Prison```',                              inline: true },
      { name: '⏱️ Durée',          value: `\`\`\`${data.duree_prison || 'N/R'}\`\`\``,  inline: true },
    ];
  }

  return new EmbedBuilder()
    .setColor(CFG.COLOR_BLUE)
    .setAuthor({ name: CFG.BOT_NAME })
    .setTitle('📂 EXTRAIT DE CASIER JUDICIAIRE — B3')
    .setDescription(
      '> 📌 *Document officiel — Usage strictement interne*\n' +
      '> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    )
    .addFields(
      { name: '👤 Identité',        value: `\`\`\`${data.nom_prenom}\`\`\``, inline: true  },
      { name: '🎂 Âge RP',          value: `\`\`\`${data.age_rp} ans\`\`\``, inline: true  },
      { name: '\u200B',             value: '\u200B',                          inline: true  },
      { name: '📋 Faits reprochés', value: `\`\`\`${data.faits}\`\`\``,      inline: false },
      ...peineFields,
      { name: '📅 Date d\'émission', value: `\`\`\`${nowFR()}\`\`\``,        inline: false },
    )
    .setThumbnail(data.photo_url ?? null)
    .setFooter({ text: `Casier #${data.id ?? '?'} • ${CFG.BOT_NAME}` })
    .setTimestamp();
}

/** Embed principal du panel 112 */
function build112PanelEmbed() {
  return new EmbedBuilder()
    .setColor(CFG.COLOR_RED)
    .setAuthor({ name: CFG.BOT_NAME })
    .setTitle('🚨 APPEL D\'URGENCE — 112')
    .setDescription(
      '> ⚠️ **Sélectionnez le type d\'incident** dans le menu déroulant.\n' +
      '> Un formulaire s\'ouvrira pour renseigner le lieu et les détails.\n\n' +
      `> <@&${CFG.ROLE_GEND}> sera automatiquement notifiée.`
    )
    .setFooter({ text: `${CFG.BOT_NAME} • Numéro d'urgence 112` })
    .setTimestamp();
}

/** Menu déroulant des types de délits */
function build112SelectRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('urgence_type_delit')
    .setPlaceholder('⚠️ Sélectionner le type d\'incident...')
    .addOptions(DELITS.map(d =>
      new StringSelectMenuOptionBuilder().setLabel(d.label).setValue(d.value)
    ));
  return new ActionRowBuilder().addComponents(menu);
}

/** Embed d'appel d'urgence posté dans le forum */
function buildAppelEmbed(data) {
  const delit = getDelit(data.type_delit);
  const fields = [
    { name: '📍 Lieu de l\'incident', value: `\`\`\`${data.lieu}\`\`\``,        inline: false },
    { name: '📋 Description',         value: `\`\`\`${data.description}\`\`\``, inline: false },
  ];
  if (data.suspects && data.suspects.trim()) {
    fields.push({ name: '👤 Signalement suspect(s)', value: `\`\`\`${data.suspects}\`\`\``, inline: false });
  }
  fields.push(
    { name: '📞 Signalé par',          value: `<@${data.appelant_id}>`, inline: true },
    { name: '🕐 Heure de l\'appel',    value: `\`\`\`${nowFR()}\`\`\``, inline: true },
  );

  return new EmbedBuilder()
    .setColor(delit.color)
    .setAuthor({ name: `🚨 URGENCE 112 — ${CFG.BOT_NAME}` })
    .setTitle(`${delit.label}`)
    .setDescription(`> <@&${CFG.ROLE_GEND}> — **Intervention requise immédiatement !**\n> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    .addFields(...fields)
    .setFooter({ text: `${CFG.BOT_NAME} • Appel d'urgence 112` })
    .setTimestamp();
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

// Commande prefix !112
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content.trim().toLowerCase() !== '!112') return;
  try {
    await message.delete().catch(() => {});
    await message.channel.send({
      embeds: [build112PanelEmbed()],
      components: [build112SelectRow()],
    });
  } catch (err) {
    console.error('Erreur !112:', err.message);
  }
});

client.on('interactionCreate', async (interaction) => {

  // ══════════════════════════════════════════════════════════════════════════
  //  SELECT MENU — Choix du type de délit → ouvrir le modal
  // ══════════════════════════════════════════════════════════════════════════
  if (interaction.isStringSelectMenu() && interaction.customId === 'urgence_type_delit') {
    const typeDelit = interaction.values[0];
    const delit     = getDelit(typeDelit);

    const modal = new ModalBuilder()
      .setCustomId(`urgence_modal__${typeDelit}`)
      .setTitle(`🚨 ${delit.label}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('lieu')
            .setLabel('📍 Lieu de l\'incident')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: Rue de la Paix, devant la banque nationale...')
            .setRequired(true)
            .setMaxLength(200)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('📋 Description de la scène')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Décrivez la situation : nombre de suspects, armes visibles, victimes...')
            .setRequired(true)
            .setMaxLength(1000)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('suspects')
            .setLabel('👤 Signalement suspect(s) — facultatif')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex: 2 individus masqués, 1 véhicule noir BM série 3...')
            .setRequired(false)
            .setMaxLength(300)
        ),
      );

    await interaction.showModal(modal);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MODAL SUBMIT — Envoi de l'appel d'urgence
  // ══════════════════════════════════════════════════════════════════════════
  if (interaction.isModalSubmit() && interaction.customId.startsWith('urgence_modal__')) {
    await interaction.deferReply({ ephemeral: true });

    const typeDelit   = interaction.customId.replace('urgence_modal__', '');
    const delit       = getDelit(typeDelit);
    const lieu        = interaction.fields.getTextInputValue('lieu').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const suspects    = interaction.fields.getTextInputValue('suspects').trim();

    const data = {
      type_delit:   typeDelit,
      lieu,
      description,
      suspects,
      appelant_id:  interaction.user.id,
      appelant_tag: interaction.user.tag,
    };

    const embed     = buildAppelEmbed(data);
    // Nom du post : "🚔 TYPE DE DÉLIT | 14:32"
    const postName  = `${delit.label} | ${timeOnlyFR()}`;

    try {
      const forum = await getForumChannel(interaction.guild, CFG.FORUM_APPELS);

      if (forum) {
        const thread = await forum.threads.create({
          name: postName,
          message: { embeds: [embed] },
        });
        const appelId = Number(Q.insertAppel.run(typeDelit, lieu, description, suspects || null, interaction.user.id, interaction.user.tag, thread.id).lastInsertRowid);
        Q.updateAppelThread.run(thread.id, appelId);
        await interaction.editReply({ content: `✅ Appel **#${appelId}** envoyé — <#${thread.id}>` });
      } else {
        // Fallback: poster dans le salon courant
        await interaction.channel.send({ embeds: [embed] });
        Q.insertAppel.run(typeDelit, lieu, description, suspects || null, interaction.user.id, interaction.user.tag, null);
        await interaction.editReply({
          content: `✅ Appel envoyé.\n⚠️ Aucun salon Forum configuré pour les appels — posté en message classique.\nConfigurez la variable d\'environnement \`FORUM_APPELS_ID\`.`,
        });
      }
    } catch (err) {
      console.error('Erreur modal urgence:', err);
      await interaction.editReply({ content: `❌ Erreur lors de l\'envoi : ${err.message}` });
    }
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  COMMANDES SLASH
  // ══════════════════════════════════════════════════════════════════════════
  if (!interaction.isChatInputCommand()) return;

  const member = await getMember(interaction.guild, interaction.user.id);

  // ── /112 ─────────────────────────────────────────────────────────────────
  if (interaction.commandName === '112') {
    await interaction.reply({ content: '🚨 Panel d\'urgence posté.', ephemeral: true });
    await interaction.channel.send({
      embeds: [build112PanelEmbed()],
      components: [build112SelectRow()],
    });
    return;
  }

  // ── /casier_creer ─────────────────────────────────────────────────────────
  if (interaction.commandName === 'casier_creer') {
    if (!hasRole(member)) return denyAccess(interaction);
    await interaction.deferReply({ ephemeral: true });

    const nomPrenom   = interaction.options.getString('nom_prenom');
    const ageRp       = interaction.options.getInteger('age_rp');
    const faits       = interaction.options.getString('faits');
    const typePeine   = interaction.options.getString('type_peine');
    const amende      = interaction.options.getString('montant_amende') ?? null;
    const amendePayee = interaction.options.getString('amende_payee') === 'oui' ? 1 : 0;
    const dureeGav    = interaction.options.getString('duree_gav') ?? null;
    const dureePrison = interaction.options.getString('duree_prison') ?? null;
    const photo       = interaction.options.getAttachment('photo');

    // Validations
    if (typePeine === 'amende' && !amende) {
      return interaction.editReply({ content: '❌ Renseignez le **montant de l\'amende** (option `montant_amende`).' });
    }
    if (typePeine === 'gav' && !dureeGav) {
      return interaction.editReply({ content: '❌ Renseignez la **durée de la GAV** (option `duree_gav`).' });
    }
    if (typePeine === 'prison' && !dureePrison) {
      return interaction.editReply({ content: '❌ Renseignez la **durée de prison** (option `duree_prison`).' });
    }
    if (!photo?.contentType?.startsWith('image/')) {
      return interaction.editReply({ content: '❌ Fichier invalide. Joignez une image JPG ou PNG.' });
    }

    try {
      const res      = Q.insertCasier.run(nomPrenom, ageRp, faits, typePeine, amende, amendePayee, dureeGav, dureePrison, photo.url, interaction.user.tag);
      const casierID = Number(res.lastInsertRowid);
      const data     = { id: casierID, nom_prenom: nomPrenom, age_rp: ageRp, faits, type_peine: typePeine, amende, amende_payee: amendePayee, duree_gav: dureeGav, duree_prison: dureePrison, photo_url: photo.url };
      const embed    = buildCasierEmbed(data);
      const forum    = await getForumChannel(interaction.guild, CFG.FORUM_CASIER);

      if (forum) {
        const thread = await forum.threads.create({ name: nomPrenom, message: { embeds: [embed] } });
        Q.updateCasierThread.run(thread.id, casierID);
        await interaction.editReply({ content: `✅ Casier **#${casierID}** créé pour **${nomPrenom}** → <#${thread.id}>` });
      } else {
        await interaction.channel.send({ embeds: [embed] });
        await interaction.editReply({
          content: `✅ Casier **#${casierID}** créé.\n⚠️ Aucun salon Forum configuré — posté en message classique.\nConfigurez la variable \`FORUM_CASIER_ID\`.`,
        });
      }
    } catch (err) {
      console.error('Erreur /casier_creer:', err);
      await interaction.editReply({ content: `❌ Erreur : ${err.message}` });
    }
    return;
  }

  // ── /casier_rechercher ────────────────────────────────────────────────────
  if (interaction.commandName === 'casier_rechercher') {
    if (!hasRole(member)) return denyAccess(interaction);
    await interaction.deferReply({ ephemeral: true });

    const query = interaction.options.getString('nom_prenom');
    const rows  = Q.searchCasier.all(`%${query}%`);

    if (!rows.length) {
      return interaction.editReply({ content: `🔍 Aucun casier trouvé pour \`${query}\`.` });
    }

    const embeds = rows.slice(0, 5).map(r => {
      const e = buildCasierEmbed(r);
      if (r.thread_id) e.addFields({ name: '🔗 Post Forum', value: `<#${r.thread_id}>`, inline: false });
      return e;
    });

    await interaction.editReply({
      content: `🔍 **${rows.length}** casier(s) trouvé(s) pour \`${query}\` — 5 premiers affichés :`,
      embeds,
    });
    return;
  }

  // ── /casier_liste ─────────────────────────────────────────────────────────
  if (interaction.commandName === 'casier_liste') {
    if (!hasRole(member)) return denyAccess(interaction);
    await interaction.deferReply({ ephemeral: true });

    const rows = Q.listCasiers.all();
    if (!rows.length) return interaction.editReply({ content: '📋 Aucun casier enregistré.' });

    const EMOJI = { amende: '💰', gav: '🚔', prison: '⛓️' };
    const list = rows.map((r, i) => {
      const emoji = EMOJI[r.type_peine] ?? '❓';
      const link  = r.thread_id ? ` → <#${r.thread_id}>` : '';
      const detail =
        r.type_peine === 'amende' ? ` — ${r.amende ?? '?'} ${Number(r.amende_payee) ? '✅' : '❌'}` :
        r.type_peine === 'gav'    ? ` — GAV: ${r.duree_gav ?? '?'}` :
        r.type_peine === 'prison' ? ` — Prison: ${r.duree_prison ?? '?'}` : '';
      return `**${i + 1}.** ${emoji} \`${r.nom_prenom}\` *(${r.age_rp} ans)*${detail}${link}`;
    }).join('\n');

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(CFG.COLOR_BLUE)
        .setAuthor({ name: CFG.BOT_NAME })
        .setTitle('📋 Liste des Casiers Judiciaires — 20 derniers')
        .setDescription(list)
        .setFooter({ text: `${rows.length} casier(s) • ${CFG.BOT_NAME}` })
        .setTimestamp()],
    });
    return;
  }

  // ── /casier_voir ──────────────────────────────────────────────────────────
  if (interaction.commandName === 'casier_voir') {
    if (!hasRole(member)) return denyAccess(interaction);
    await interaction.deferReply({ ephemeral: true });

    const id  = interaction.options.getInteger('id');
    const row = Q.getCasier.get(id);

    if (!row) {
      return interaction.editReply({ content: `❌ Aucun casier avec l'ID **#${id}**.` });
    }

    const e = buildCasierEmbed(row);
    if (row.thread_id) e.addFields({ name: '🔗 Post Forum', value: `<#${row.thread_id}>`, inline: false });

    await interaction.editReply({ embeds: [e] });
    return;
  }
});

// ─── READY ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Connecté : ${client.user.tag}`);
  client.user.setActivity('〃Gendarmerie EHRP - IS', { type: ActivityType.Watching });
  await registerCommands();
});

client.login(CFG.TOKEN).catch(err => {
  console.error('❌ Connexion échouée:', err.message);
  process.exit(1);
});
