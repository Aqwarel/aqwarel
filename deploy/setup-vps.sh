#!/usr/bin/env bash
# ============================================================
#  setup-vps.sh — Provisionnement initial VPS Hostinger Ubuntu 22.04
#  A executer UNE FOIS sur un VPS frais, en root :
#    bash setup-vps.sh
#
#  Installe : Node 20 LTS, MySQL, nginx, certbot, PM2, ufw, fail2ban
#  Crée    : utilisateur "deploy" avec sudo, dossier /var/www/lexpert
# ============================================================
set -euo pipefail

DEPLOY_USER="deploy"
APP_DIR="/var/www/lexpert"

if [ "$(id -u)" -ne 0 ]; then
  echo "Ce script doit être exécuté en root." >&2
  exit 1
fi

echo "=== 1/7  Mise à jour du système ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "=== 2/7  Paquets de base ==="
apt-get install -y curl git build-essential ufw fail2ban ca-certificates gnupg

echo "=== 3/7  Node.js 20 LTS ==="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "=== 4/7  PM2 (process manager) ==="
npm install -g pm2

echo "=== 5/7  MySQL ==="
apt-get install -y mysql-server
systemctl enable --now mysql

echo "=== 6/7  Nginx + Certbot ==="
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx

echo "=== 7/7  Firewall (ufw) ==="
ufw allow OpenSSH
ufw allow "Nginx Full"
ufw --force enable
ufw status

echo "=== Utilisateur de déploiement : $DEPLOY_USER ==="
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
  # Copie les clés SSH de root vers deploy (si root a une clé autorisée)
  if [ -f /root/.ssh/authorized_keys ]; then
    mkdir -p /home/$DEPLOY_USER/.ssh
    cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/
    chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
    chmod 700 /home/$DEPLOY_USER/.ssh
    chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
  fi
fi

echo "=== Dossier application : $APP_DIR ==="
mkdir -p "$APP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

echo ""
echo "============================================================"
echo "  ✅  VPS provisionné."
echo ""
echo "  Étapes suivantes (voir deploy/DEPLOY.md) :"
echo "  1. mysql_secure_installation       (sécurise root MySQL)"
echo "  2. Créer la base + user MySQL"
echo "  3. su - $DEPLOY_USER"
echo "  4. Cloner le repo dans $APP_DIR"
echo "  5. cp .env.example .env  &&  remplir les valeurs"
echo "  6. cd backend && npm ci --production"
echo "  7. pm2 start ecosystem.config.js --env production"
echo "  8. Configurer nginx + certbot"
echo "============================================================"
