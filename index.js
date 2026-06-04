// ═══════════════════════════════════════════════════════════════════════════
//  BOT DISCORD — Administration Générale de la Gendarmerie
//  Prises de Service + Casiers Judiciaires B3
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
  TOKEN:           process.env.DISCORD_TOKEN,
  CLIENT_ID:       process.env.CLIENT_ID,
  FORUM_ID:        '1511843116066279444',   // Salon forum casiers judiciaires
  ROLE_GEND_ID:    '1508283902672896055',   // Rôle Gendarmerie Nationale
  BOT_NAME:        'Administration Générale de la Gendarmerie',
  BOT_COLOR:       0x003189,               // Bleu gendarmerie
  COLOR_SUCCESS:   0x2ecc71,
  COLOR_DANGER:    0xe74c3c,
  COLOR_INFO:      0x5865F2,
};

// Vérification variables d'environnement au démarrage
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

  CREATE TABLE IF NOT EXISTS prises_service (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    username   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Prepared statements réutilisables
const stmt = {
  insertCasier:  db.prepare(`INSERT INTO casiers (nom_prenom, faits, amende, amende_payee, photo_url, created_by) VALUES (?, ?, ?, ?, ?, ?)`),
  updateThread:  db.prepare(`UPDATE casiers SET thread_id = ? WHERE id = ?`),
  searchCasier:  db.prepare(`SELECT * FROM casiers WHERE nom_prenom LIKE ? ORDER BY created_at DESC`),
  listCasiers:   db.prepare(`SELECT * FROM casiers ORDER BY created_at DESC LIMIT 20`),
  insertPDS:     db.prepare(`INSERT INTO prises_service (user_id, username, channel_id) VALUES (?, ?, ?)`),
};

// ─── CLIENT DISCORD ──────────────────────────────────────────────────────────
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
  // Panel PDS avec bouton
  new SlashCommandBuilder()
    .setName('pds_panel')
    .setDescription('📋 Afficher le panneau de prise de service (bouton)'),

  // PDS direct
  new SlashCommandBuilder()
    .setName('pds')
    .setDescription('📋 Effectuer une prise de service immédiatement'),

  // Créer un casier
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
          { name: '✅ Oui — payée',    value: 'oui' },
          { name: '❌ Non — impayée',  value: 'non' },
        ))
    .addAttachmentOption(o =>
      o.setName('photo').setDescription('Photo du suspect de face, fond blanc').setRequired(true)),

  // Rechercher un casier
  new SlashCommandBuilder()
    .setName('recherche_casier')
    .setDescription('🔍 Rechercher un casier judiciaire par nom/prénom')
    .addStringOption(o =>
      o.setName('nom_prenom').setDescription('Nom et prénom RP à rechercher').setRequired(true)),

  // Lister les casiers
  new SlashCommandBuilder()
    .setName('liste_casiers')
    .setDescription('📋 Lister les 20 derniers casiers enregistrés'),
].map(c => c.toJSON());

// ─── ENREGISTREMENT GLOBAL DES COMMANDES ────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);
  try {
    console.log('🔄 Enregistrement des commandes slash (global)...');
    await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: slashCommands });
    console.log(`✅ ${slashCommands.length} commande(s) enregistrée(s) globalement.`);
  } catch (err) {
    console.error('❌ Erreur enregistrement commandes:', err.message);
  }
}

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

/** Date/heure française */
function nowFR() {
  return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

/** Vérifie si le membre a le rôle Gendarmerie Nationale */
function hasGendRole(member) {
  return member?.roles?.cache?.has(CONFIG.ROLE_GEND_ID) ?? false;
}

/** Réponse d'accès refusé (éphémère) */
async function denyAccess(interaction) {
  const embed = new EmbedBuilder()
    .setColor(CONFIG.COLOR_DANGER)
    .setTitle('🚫 Accès refusé')
    .setDescription('Vous devez avoir le rôle **Gendarmerie Nationale** pour utiliser cette commande.')
    .setFooter({ text: CONFIG.BOT_NAME });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/** Embed prise de service */
function buildEmbedPDS(user) {
  return new EmbedBuilder()
    .setColor(CONFIG.BOT_COLOR)
    .setAuthor({ name: CONFIG.BOT_NAME })
    .setTitle('📋 PRISE DE SERVICE')
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '👮 Agent',   value: `<@${user.id}>`,  inline: true },
      { name: '🏷️ Matricule', value: `\`${user.tag}\``, inline: true },
      { name: '🕐 Heure',   value: nowFR(),            inline: true },
      { name: '✅ Statut',  value: '**En service**',   inline: false },
    )
    .setFooter({ text: `${CONFIG.BOT_NAME} • Système de gestion des services` })
    .setTimestamp();
}

/** Embed casier judiciaire */
function buildEmbedCasier(data) {
  const payeeStr = data.amende_payee ? '✅ Payée' : '❌ Non payée';
  return new EmbedBuilder()
    .setColor(data.amende_payee ? CONFIG.COLOR_SUCCESS : CONFIG.COLOR_DANGER)
    .setAuthor({ name: CONFIG.BOT_NAME })
    .setTitle('📂 EXTRAIT DE CASIER JUDICIAIRE — B3')
    .setDescription('*Document officiel — Usage interne uniquement*')
    .addFields(
      { name: '👤 Identité',        value: `\`\`\`${data.nom_prenom}\`\`\``, inline: false },
      { name: '📋 Faits reprochés', value: `\`\`\`${data.faits}\`\`\``,      inline: false },
      { name: '💰 Amende',          value: `**${data.amende}**`,              inline: true  },
      { name: '📌 Statut amende',   value: payeeStr,                          inline: true  },
      { name: '📅 Date d\'émission',value: nowFR(),                           inline: true  },
    )
    .setImage(data.photo_url ?? null)
    .setFooter({ text: `Casier #${data.id ?? '?'} • ${CONFIG.BOT_NAME}` })
    .setTimestamp();
}

/** Bouton PDS */
function buildRowPDS() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_prise_service')
      .setLabel('📋 Prendre mon service')
      .setStyle(ButtonStyle.Primary),
  );
}

/** Poster le casier dans le salon forum (ID fixe) */
async function postCasierForum(guild, casierID, nomPrenom, embed, photoUrl) {
  // 1. Récupérer le forum par son ID fixe
  let forum = guild.channels.cache.get(CONFIG.FORUM_ID);

  // 2. Si pas en cache, fetch
  if (!forum) {
    try { forum = await guild.channels.fetch(CONFIG.FORUM_ID); } catch { forum = null; }
  }

  if (!forum || forum.type !== ChannelType.GuildForum) {
    throw new Error(`Le salon forum (ID: ${CONFIG.FORUM_ID}) est introuvable ou n'est pas un Forum.`);
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

// ─── ÉVÉNEMENT : messageCreate — commande !pds ───────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content.trim().toLowerCase() !== '!pds') return;

  // Vérification rôle
  const member = message.guild?.members.cache.get(message.author.id)
               ?? await message.guild?.members.fetch(message.author.id).catch(() => null);

  if (!hasGendRole(member)) {
    return message.reply({ content: '🚫 Vous devez avoir le rôle **Gendarmerie Nationale** pour utiliser cette commande.' }).catch(() => {});
  }

  try {
    const embed = buildEmbedPDS(message.author);
    await message.channel.send({ embeds: [embed] });
    stmt.insertPDS.run(message.author.id, message.author.tag, message.channel.id);

    // Suppression du message déclencheur si permissions OK
    const me = message.guild?.members.me;
    if (me?.permissionsIn(message.channel).has(PermissionsBitField.Flags.ManageMessages)) {
      await message.delete().catch(() => {});
    }
  } catch (err) {
    console.error('Erreur !pds:', err);
    message.reply('❌ Erreur lors de la prise de service.').catch(() => {});
  }
});

// ─── ÉVÉNEMENT : interactionCreate ───────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ══════════════════════════════════════════════════════════════
  //  BOUTON — Prise de service
  // ══════════════════════════════════════════════════════════════
  if (interaction.isButton() && interaction.customId === 'btn_prise_service') {
    const member = interaction.guild?.members.cache.get(interaction.user.id)
                 ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);

    if (!hasGendRole(member)) {
      return denyAccess(interaction);
    }

    try {
      const embed = buildEmbedPDS(interaction.user);
      await interaction.reply({ embeds: [embed] });
      stmt.insertPDS.run(interaction.user.id, interaction.user.tag, interaction.channelId);
    } catch (err) {
      console.error('Erreur bouton PDS:', err);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Erreur lors de la prise de service.', ephemeral: true }).catch(() => {});
      }
    }
    return;
  }

  // ══════════════════════════════════════════════════════════════
  //  COMMANDES SLASH
  // ══════════════════════════════════════════════════════════════
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.guild?.members.cache.get(interaction.user.id)
               ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);

  // ── /pds_panel ────────────────────────────────────────────────
  if (interaction.commandName === 'pds_panel') {
    if (!hasGendRole(member)) return denyAccess(interaction);

    const embed = new EmbedBuilder()
      .setColor(CONFIG.BOT_COLOR)
      .setAuthor({ name: CONFIG.BOT_NAME })
      .setTitle('📋 PANNEAU DE PRISE DE SERVICE')
      .setDescription('Cliquez sur le bouton ci-dessous pour effectuer votre prise de service.')
      .setFooter({ text: CONFIG.BOT_NAME })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], components: [buildRowPDS()] });
    return;
  }

  // ── /pds ──────────────────────────────────────────────────────
  if (interaction.commandName === 'pds') {
    if (!hasGendRole(member)) return denyAccess(interaction);

    try {
      const embed = buildEmbedPDS(interaction.user);
      await interaction.reply({ embeds: [embed] });
      stmt.insertPDS.run(interaction.user.id, interaction.user.tag, interaction.channelId);
    } catch (err) {
      console.error('Erreur /pds:', err);
      if (!interaction.replied) {
        await interaction.reply({ content: '❌ Erreur lors de la prise de service.', ephemeral: true }).catch(() => {});
      }
    }
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

    // Validation image
    if (!photo?.contentType?.startsWith('image/')) {
      return interaction.editReply({ content: '❌ Le fichier fourni n\'est pas une image valide. Veuillez joindre une photo JPG/PNG.' });
    }

    try {
      // Insertion en base
      const result  = stmt.insertCasier.run(nomPrenom, faits, amende, amendePayee, photo.url, interaction.user.tag);
      const casierID = Number(result.lastInsertRowid);

      const data  = { id: casierID, nom_prenom: nomPrenom, faits, amende, amende_payee: amendePayee, photo_url: photo.url };
      const embed = buildEmbedCasier(data);

      // Post dans le salon Forum
      try {
        const thread = await postCasierForum(interaction.guild, casierID, nomPrenom, embed, photo.url);
        await interaction.editReply({
          content: `✅ Casier **#${casierID}** créé pour **${nomPrenom}**.\n🔗 Post : <#${thread.id}>`,
        });
      } catch (forumErr) {
        // Fallback : poster en message classique dans le salon courant
        console.warn('⚠️ Forum introuvable, fallback message classique:', forumErr.message);
        await interaction.channel.send({
          embeds: [embed],
          files: [{ attachment: photo.url, name: `casier_${casierID}.png` }],
        });
        await interaction.editReply({
          content: `✅ Casier **#${casierID}** créé pour **${nomPrenom}**.\n⚠️ Salon forum introuvable (ID: \`${CONFIG.FORUM_ID}\`) — posté en message classique.`,
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
      return interaction.editReply({ content: `🔍 Aucun casier trouvé pour \`${query}\`.` });
    }

    const embeds = rows.slice(0, 5).map(row => {
      const e = buildEmbedCasier(row);
      if (row.thread_id) {
        e.addFields({ name: '🔗 Post Forum', value: `<#${row.thread_id}>`, inline: true });
      }
      return e;
    });

    await interaction.editReply({
      content: `🔍 **${rows.length}** casier(s) pour \`${query}\` (5 max affichés) :`,
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

    const embed = new EmbedBuilder()
      .setColor(CONFIG.COLOR_INFO)
      .setAuthor({ name: CONFIG.BOT_NAME })
      .setTitle('📋 Liste des Casiers Judiciaires')
      .setDescription(list)
      .setFooter({ text: `${rows.length} casier(s) — 20 derniers • ${CONFIG.BOT_NAME}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }
});

// ─── PRÊT ────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Connecté : ${client.user.tag}`);
  client.user.setActivity('Gendarmerie Nationale', { type: ActivityType.Watching });
  await registerCommands();
});

// ─── CONNEXION ───────────────────────────────────────────────────────────────
client.login(CONFIG.TOKEN).catch(err => {
  console.error('❌ Connexion échouée :', err.message);
  process.exit(1);
});
