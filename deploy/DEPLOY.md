# Déploiement lexpert sur VPS Hostinger

Guide pas-à-pas pour déployer l'app sur **aqwarel.com** (VPS Ubuntu 22.04).

- VPS IP : `82.112.253.197`
- Domaine : `aqwarel.com` (+ `www.aqwarel.com`)
- Stack : Node.js 20 LTS + MySQL 8 + nginx + PM2 + Let's Encrypt

---

## 0. Pointer le DNS sur le VPS

Sur Hostinger → **Domaines → aqwarel.com → DNS / Nameservers** :

| Type | Nom | Valeur                |
|------|-----|----------------------|
| A    | @   | `82.112.253.197`      |
| A    | www | `82.112.253.197`      |

Vérifier la propagation : `dig aqwarel.com +short` (peut prendre quelques minutes à quelques heures).

---

## 1. Provisionnement initial (une seule fois, en root)

```bash
ssh root@82.112.253.197
# Coller le contenu de deploy/setup-vps.sh, ou :
git clone https://github.com/<TON_USER>/lexpert-app.git /tmp/lexpert
bash /tmp/lexpert/deploy/setup-vps.sh
```

Le script installe Node 20, MySQL, nginx, PM2, ufw, fail2ban, certbot et crée l'utilisateur `deploy` + le dossier `/var/www/lexpert`.

---

## 2. Sécuriser MySQL (root)

```bash
mysql_secure_installation
```

Réponses recommandées : `Y` partout, choisir un mot de passe root MySQL fort.

---

## 3. Créer la base et l'utilisateur applicatif (root)

```bash
mysql -u root -p
```

```sql
CREATE DATABASE lexpert_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'lexpert'@'localhost' IDENTIFIED BY 'METTRE_UN_MOT_DE_PASSE_FORT_ICI';
GRANT ALL PRIVILEGES ON lexpert_db.* TO 'lexpert'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Note le mot de passe — tu le mettras dans le `.env` à l'étape 5.

---

## 4. Cloner le code (utilisateur deploy)

```bash
su - deploy
cd /var/www/lexpert
git clone https://github.com/<TON_USER>/lexpert-app.git .
# (ou rsync depuis ton poste si pas de repo distant)
```

---

## 5. Configurer l'environnement

```bash
cd /var/www/lexpert/backend
cp .env.example .env

# Générer 2 secrets aléatoires (64 chars hex chacun)
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "APP_SECRET=$(openssl rand -hex 32)"

nano .env
```

Renseigner :
- `JWT_SECRET` et `APP_SECRET` avec les valeurs générées ci-dessus
- `DB_PASSWORD` avec celui choisi à l'étape 3
- `APP_URL=https://aqwarel.com,https://www.aqwarel.com`
- `NODE_ENV=production`

Verrouiller les permissions :
```bash
chmod 600 .env
```

---

## 6. Installer les dépendances et importer le schéma

```bash
cd /var/www/lexpert/backend
npm ci --production

# Importer le schéma SQL
mysql -u lexpert -p lexpert_db < sql/lexpert_database.sql
```

---

## 7. Créer le compte admin

```bash
# Générer un hash bcrypt pour ton mot de passe admin
node -e "require('bcryptjs').hash('TON_MOT_DE_PASSE_ADMIN', 12).then(console.log)"
```

Puis :
```bash
mysql -u lexpert -p lexpert_db
```

```sql
INSERT INTO users (role_id, first_name, last_name, email, password_hash, is_active)
VALUES (1, 'Admin', 'Aqwarel', 'admin@aqwarel.com', '<COLLE_LE_HASH_ICI>', 1);
```

---

## 8. Démarrer l'app avec PM2

```bash
cd /var/www/lexpert/backend
mkdir -p logs
pm2 start ecosystem.config.js --env production
pm2 save

# Auto-start au reboot — copier la commande affichée et l'exécuter en sudo
pm2 startup
```

Vérifier :
```bash
pm2 status
pm2 logs lexpert --lines 30
curl http://127.0.0.1:3000/api/health
```

---

## 9. Configurer nginx (root)

```bash
sudo cp /var/www/lexpert/deploy/nginx-aqwarel.conf /etc/nginx/sites-available/aqwarel
sudo ln -s /etc/nginx/sites-available/aqwarel /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

À ce stade `http://aqwarel.com` doit répondre (page de login lexpert).

---

## 10. Activer HTTPS (Let's Encrypt)

```bash
sudo certbot --nginx -d aqwarel.com -d www.aqwarel.com
```

Suivre les prompts. Certbot modifie automatiquement la config nginx pour activer SSL.

Renouvellement auto : déjà installé via systemd timer (`systemctl status certbot.timer`).

---

## 11. Vérifications finales

```bash
curl -I https://aqwarel.com                    # 200 OK + headers HSTS
curl https://aqwarel.com/api/health            # {"success":true,"db":"connected"}
```

Ouvrir https://aqwarel.com dans un navigateur, se connecter avec les identifiants admin.

---

## Mises à jour ultérieures

Workflow standard pour pousser une nouvelle version :

```bash
# Sur ton poste
git push origin main

# Sur le VPS (utilisateur deploy)
cd /var/www/lexpert
git pull
cd backend
npm ci --production       # si package.json a changé
pm2 reload lexpert         # zero-downtime restart
```

---

## Backups MySQL (recommandé)

Cron quotidien pour dump la DB :

```bash
sudo crontab -e
```

Ajouter :
```
0 3 * * * mysqldump -u lexpert -p'MOT_DE_PASSE' lexpert_db | gzip > /var/backups/lexpert-$(date +\%F).sql.gz
0 4 * * * find /var/backups -name 'lexpert-*.sql.gz' -mtime +14 -delete
```

```bash
sudo mkdir -p /var/backups
sudo chmod 700 /var/backups
```

---

## Dépannage

| Symptôme | Cause probable | Action |
|---|---|---|
| 502 Bad Gateway | Node down | `pm2 logs lexpert`, `pm2 restart lexpert` |
| `ECONNREFUSED 127.0.0.1:3306` | MySQL stoppé | `systemctl status mysql && systemctl start mysql` |
| `ER_ACCESS_DENIED_ERROR` | mauvais `DB_PASSWORD` | vérifier `.env` |
| Login KO « Email ou mot de passe incorrect » | Compte admin pas créé en base | refaire étape 7 |
| Certbot refuse | DNS pas encore propagé | `dig aqwarel.com +short` doit retourner l'IP du VPS |
