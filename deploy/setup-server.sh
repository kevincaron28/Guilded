#!/usr/bin/env bash
# One-time setup of an Ubuntu server for the Guilded bot.
#   sudo bash deploy/setup-server.sh your-hostname.duckdns.org
# Run it from inside the cloned repository. Safe to run again.
set -euo pipefail

HOST="${1:-}"
if [ -z "$HOST" ]; then echo "Usage: sudo bash deploy/setup-server.sh <hostname>"; exit 1; fi
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo."; exit 1; fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/guilded

echo "== Packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "== Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "== Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== Swap (small machines)"
if [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 2000 ] && [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Application user and files"
id guilded >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin guilded
mkdir -p "$APP"
if [ "$SRC" != "$APP" ]; then
  rsync -a --delete --exclude node_modules --exclude .env.local --exclude backups --exclude dist "$SRC"/ "$APP"/ 2>/dev/null \
    || { apt-get install -y rsync && rsync -a --delete --exclude node_modules --exclude .env.local --exclude backups --exclude dist "$SRC"/ "$APP"/; }
fi
[ -f "$APP/.env.local" ] || { cp "$APP/.env.example" "$APP/.env.local"; echo "Created $APP/.env.local from the example."; }
chown -R guilded:guilded "$APP"
chmod 600 "$APP/.env.local"
sudo -u guilded bash -c "cd $APP && npm ci --no-audit --no-fund"
sudo -u guilded bash -c "cd $APP && npm run companion:build"

echo "== systemd"
cp "$APP/deploy/guilded.service" /etc/systemd/system/guilded.service
systemctl daemon-reload
systemctl enable guilded

echo "== Caddy (HTTPS for $HOST)"
sed "s/YOUR_HOSTNAME/$HOST/" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "== Firewall (Oracle Ubuntu images block everything but SSH by default)"
if command -v iptables >/dev/null; then
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
  command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
fi

cat <<EOF

Done. Next:
  1. sudo nano $APP/.env.local      (paste your secrets; COMPANION_API_HOST=127.0.0.1)
  2. sudo systemctl start guilded
  3. sudo journalctl -u guilded -f
  4. Open https://$HOST/health in a browser: it should say {"ok":true}
Remember to close the bot on your PC first: two copies with one token answer twice.
EOF
