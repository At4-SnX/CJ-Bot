'use strict';

const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes } = require('discord.js');
const Database = require('better-sqlite3');

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const db = new Database('./casier.db');
db.exec(`CREATE TABLE IF NOT EXISTS casiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom_prenom TEXT,
    faits TEXT,
    peine TEXT,
    created_at TEXT DEFAULT (datetime('now'))
)`);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─── COMMANDES ──────────────────────────────────────────────────────────────
const commands = [
    new SlashCommandBuilder()
        .setName('casier')
        .setDescription('Ajouter un casier')
        .addStringOption(o => o.setName('nom').setDescription('Nom du suspect').setRequired(true))
        .addStringOption(o => o.setName('faits').setDescription('Faits reprochés').setRequired(true))
        .addStringOption(o => o.setName('peine').setDescription('Peine prononcée').setRequired(true)),
    new SlashCommandBuilder()
        .setName('recherche_casier')
        .setDescription('Rechercher un casier')
        .addStringOption(o => o.setName('nom').setDescription('Nom à chercher').setRequired(true)),
    new SlashCommandBuilder()
        .setName('liste_casiers')
        .setDescription('Voir les 5 derniers casiers')
];

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`✅ Bot opérationnel — ${client.user.tag}`);
});

// ─── LOGIQUE ────────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'casier') {
        const nom = interaction.options.getString('nom');
        const faits = interaction.options.getString('faits');
        const peine = interaction.options.getString('peine');
        
        db.prepare('INSERT INTO casiers (nom_prenom, faits, peine) VALUES (?, ?, ?)').run(nom, faits, peine);
        await interaction.reply({ content: `✅ Casier enregistré pour **${nom}**.`, ephemeral: true });
    }

    if (interaction.commandName === 'recherche_casier') {
        const nom = interaction.options.getString('nom');
        const res = db.prepare('SELECT * FROM casiers WHERE nom_prenom LIKE ?').get(`%${nom}%`);
        
        if (!res) return interaction.reply({ content: '❌ Aucun casier trouvé.', ephemeral: true });
        
        const embed = new EmbedBuilder()
            .setColor(0x003189)
            .setTitle(`📂 Casier de ${res.nom_prenom}`)
            .addFields({ name: 'Faits', value: res.faits }, { name: 'Peine', value: res.peine })
            .setFooter({ text: `Date: ${res.created_at}` });
        
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'liste_casiers') {
        const rows = db.prepare('SELECT * FROM casiers ORDER BY id DESC LIMIT 5').all();
        const msg = rows.map(r => `• **${r.nom_prenom}** : ${r.peine}`).join('\n');
        await interaction.reply({ content: `📋 **Derniers casiers :**\n${msg || 'Aucun casier.'}` });
    }
});

client.login(TOKEN);