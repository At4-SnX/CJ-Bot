'use strict';

const { 
    Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, 
    REST, Routes, ChannelType 
} = require('discord.js');
const Database = require('better-sqlite3');

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const FORUM_ID = '1511843116066279444';
const ROLE_GEND = '1508283902672896055';

const db = new Database('./casier_b3.db');
db.exec(`CREATE TABLE IF NOT EXISTS casiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom_prenom TEXT, age_rp INTEGER, faits TEXT, 
    type_peine TEXT, montant_ou_duree TEXT, 
    amende_payee TEXT, photo_url TEXT, agent_id TEXT, date TEXT
)`);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─── COMMANDE SLASH DÉTAILLÉE ───────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder()
        .setName('casier_b3')
        .setDescription('Enregistrer un casier judiciaire complet')
        .addStringOption(o => o.setName('nom_prenom').setDescription('Nom et prénom RP').setRequired(true))
        .addIntegerOption(o => o.setName('age').setDescription('Âge RP').setRequired(true))
        .addStringOption(o => o.setName('faits').setDescription('Détails des faits').setRequired(true))
        .addStringOption(o => o.setName('type_peine').setDescription('Nature de la sanction')
            .addChoices(
                { name: '💰 Amende', value: 'Amende' },
                { name: '🚔 Garde à vue', value: 'GAV' },
                { name: '⛓️ Prison', value: 'Prison' }
            ).setRequired(true))
        .addStringOption(o => o.setName('details_peine').setDescription('Montant de l\'amende ou durée de la peine').setRequired(true))
        .addStringOption(o => o.setName('amende_payee').setDescription('Statut du paiement').addChoices({name: 'Oui', value: 'Oui'}, {name: 'Non', value: 'Non'}, {name: 'N/A', value: 'N/A'}).setRequired(true))
        .addAttachmentOption(o => o.setName('photo').setDescription('Photo du suspect').setRequired(true))
];

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.member.roles.cache.has(ROLE_GEND)) return interaction.reply({ content: '🚫 Accès refusé.', ephemeral: true });

    if (interaction.commandName === 'casier_b3') {
        const data = {
            nom: interaction.options.getString('nom_prenom'),
            age: interaction.options.getInteger('age'),
            faits: interaction.options.getString('faits'),
            type: interaction.options.getString('type_peine'),
            peine: interaction.options.getString('details_peine'),
            paye: interaction.options.getString('amende_payee'),
            photo: interaction.options.getAttachment('photo')
        };

        const embed = new EmbedBuilder()
            .setColor(0x003189)
            .setTitle(`📂 Fiche B3 : ${data.nom}`)
            .setThumbnail(data.photo.url)
            .addFields(
                { name: '👤 Identité', value: `${data.nom} (${data.age} ans)`, inline: false },
                { name: '⚖️ Sanction', value: `**${data.type}** : ${data.peine}`, inline: true },
                { name: '💳 Paiement', value: data.paye, inline: true },
                { name: '📋 Faits reprochés', value: data.faits, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `Enregistré par ${interaction.user.username}` });

        const forum = await interaction.guild.channels.fetch(FORUM_ID);
        const thread = await forum.threads.create({
            name: `${data.nom} - B3`,
            message: { embeds: [embed] }
        });

        db.prepare('INSERT INTO casiers (nom_prenom, age_rp, faits, type_peine, montant_ou_duree, amende_payee, photo_url, agent_id, date) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(data.nom, data.age, data.faits, data.type, data.peine, data.paye, data.photo.url, interaction.user.id, new Date().toISOString());

        await interaction.reply({ content: `✅ Casier B3 créé : ${thread.url}`, ephemeral: true });
    }
});

client.login(TOKEN);