# 🎖️ Bot Discord — Administration Générale de la Gendarmerie

## Commandes disponibles

| Commande | Description | Rôle requis |
|---|---|---|
| `!pds` | Prise de service (message prefix) | Gendarmerie Nationale |
| `/pds` | Prise de service (slash) | Gendarmerie Nationale |
| `/pds_panel` | Poster un panneau avec bouton de prise de service | Gendarmerie Nationale |
| `/casier` | Créer un casier judiciaire B3 | Gendarmerie Nationale |
| `/recherche_casier` | Rechercher un casier par nom/prénom | Gendarmerie Nationale |
| `/liste_casiers` | Lister les 20 derniers casiers | Gendarmerie Nationale |

---

## 🚀 Déploiement sur Railway

### 1. Créer le bot sur Discord Developer Portal
1. [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. Onglet **Bot** → **Reset Token** → copie le token
3. Activer les Privileged Intents :
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
4. **OAuth2 > URL Generator** :
   - Scopes : `bot` + `applications.commands`
   - Permissions : `Send Messages`, `Embed Links`, `Attach Files`, `Manage Messages`, `Read Message History`, `Create Public Threads`, `Manage Threads`
   - Inviter le bot sur le serveur

### 2. Variables d'environnement Railway

```
DISCORD_TOKEN=ton_token_bot
CLIENT_ID=ton_application_id
```

> Le `CLIENT_ID` = **Application ID** dans OAuth2 > General

### 3. Push sur GitHub → New Project sur Railway → Deploy

---

## 🏛️ Salon Forum pour les casiers

Le bot poste les casiers dans le salon Forum dont l'ID est `1511843116066279444`.

Chaque casier crée un **post** avec comme titre le **nom/prénom RP** de la personne.
Si le forum est introuvable, le casier est posté en message classique dans le salon courant.

---

## 🔒 Sécurité

Toutes les commandes sont restreintes au rôle **Gendarmerie Nationale** (ID: `1508283902672896055`).
Toute tentative sans ce rôle retourne un message d'erreur éphémère.

---

## 🗄️ Base de données

SQLite (`bot_data.db`) avec deux tables : `casiers` et `prises_service`.

> ⚠️ Sur Railway, le filesystem est éphémère. Pour une DB persistante, configure un **Volume Railway** monté sur `/app`.
