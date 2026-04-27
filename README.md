# lexpert — Gestion des Crédits Clients

Application web complète de gestion des crédits clients.

---

## Stack technique
- **Frontend** : HTML5 + CSS3 + JavaScript vanilla (fichier unique)
- **Backend**  : Node.js + Express.js
- **Base de données** : MySQL / MariaDB
- **Auth** : JWT (jsonwebtoken) + bcrypt

---

## Démarrage rapide avec Laragon

### 1. Prérequis
- [Laragon](https://laragon.org/) installé (Full ou Lite)
- Node.js 18+ (inclus dans Laragon Full)

### 2. Base de données
1. Ouvrir **Laragon** → cliquer **Start All**
2. Ouvrir **phpMyAdmin** (Menu > phpMyAdmin)
3. Créer une base de données nommée `lexpert_db`
4. La sélectionner, puis importer `backend/sql/lexpert_database.sql`

### 3. Configuration
```bash
cd backend
cp .env.example .env
```
Ouvrir `.env` et vérifier (Laragon par défaut) :
```
DB_HOST=127.0.0.1
DB_NAME=lexpert_db
DB_USER=root
DB_PASSWORD=          # vide par défaut sur Laragon
```

### 4. Installer les dépendances et démarrer
```bash
cd backend
npm install
npm start
```

### 5. Accéder à l'application
Ouvrir **http://localhost:3000** dans votre navigateur.

---

## Mode standalone (sans backend)

Le fichier `public/index.html` fonctionne aussi **seul** — ouvrez-le
directement dans un navigateur. Les données sont stockées dans
`localStorage`. Idéal pour tester sans serveur.

**Comptes de démo :**
| Email | Mot de passe | Rôle |
|---|---|---|
| admin@lexpert.ma | admin123 | Administrateur |
| manager@lexpert.ma | manager123 | Gestionnaire |
| caissier@lexpert.ma | caissier123 | Caissier |
| viewer@lexpert.ma | viewer123 | Lecteur |

---

## Déploiement sur Hostinger

1. Dans `.env`, remplacer les variables DB par celles de Hostinger :
```
DB_HOST=localhost
DB_NAME=u304101058_lexpert
DB_USER=u304101058_lxuser
DB_PASSWORD=VotreMotDePasse
NODE_ENV=production
```
2. Uploader le dossier `backend/` dans `public_html/api/`
3. Uploader `public/index.html` dans `public_html/`
4. Dans hPanel → Node.js → Créer application → fichier : `server.js`
5. Exécuter `npm install --production`
6. Importer le SQL via phpMyAdmin Hostinger

---

## Structure du projet
```
lexpert-app/
├── public/
│   └── index.html          ← Application frontend (standalone + SPA)
└── backend/
    ├── server.js            ← Point d'entrée Node.js + Express
    ├── package.json
    ├── .env.example         ← Modèle de configuration
    ├── .gitignore
    ├── config/
    │   └── db.js            ← Pool de connexions MySQL
    ├── routes/
    │   └── auth.routes.js   ← Routes authentification JWT
    ├── controllers/
    │   └── crud_examples.js ← Exemples CRUD complets
    ├── middleware/
    │   └── auth.js          ← Vérification JWT
    ├── sql/
    │   └── lexpert_database.sql ← Script BDD complet (13 tables)
    ├── uploads/             ← Fichiers uploadés
    └── logs/                ← Journaux applicatifs
```

---

## API Endpoints principaux

| Méthode | Route | Description |
|---|---|---|
| POST | /api/auth/login | Connexion |
| POST | /api/auth/register | Inscription |
| GET | /api/clients | Liste des clients |
| POST | /api/clients | Créer un client |
| GET | /api/credits | Historique crédits |
| POST | /api/credits | Ajouter un crédit |
| GET | /api/stats | Statistiques globales |
| GET | /api/settings | Paramètres app |
| PUT | /api/settings | Modifier paramètres |
| GET | /api/health | Vérification serveur |

---

## Sécurité
- Mots de passe hashés avec **bcrypt** (cost 12)
- Authentification **JWT** (expiration 8h)
- **Helmet** pour les headers HTTP sécurisés
- **Rate limiting** : 200 req/15min
- Requêtes SQL paramétrées (anti injection)
- Variables sensibles dans `.env` (jamais dans le code)

