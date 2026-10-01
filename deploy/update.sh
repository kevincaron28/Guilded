#!/usr/bin/env bash
# Update the Guilded bot on the server. Run it from inside the git clone you set the server up from:
#   cd ~/guilded && sudo bash deploy/update.sh
# What it does: pull the new code (with YOUR git login, so a private repository just works), copy it to
# /opt/guilded, install dependencies only if they changed, restart the bot, and check that it came back.
# Database changes apply by themselves when the bot starts (the service runs npm run db:update first).
# Safe to run again. If the new version does not start it tells you how to go back.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo:  sudo bash deploy/update.sh"; exit 1; fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/guilded
WHO="${SUDO_USER:-root}"
say() { printf '\n== %s\n' "$1"; }

if [ ! -d "$APP" ]; then echo "$APP does not exist. Run deploy/setup-server.sh first."; exit 1; fi

say "Checking the server checkout"
git config --global --add safe.directory "$SRC" >/dev/null 2>&1 || true
BRANCH="$(sudo -u "$WHO" git -C "$SRC" branch --show-current)"
if [ "$BRANCH" != "main" ]; then
  echo "The server checkout is on '$BRANCH', not 'main'. Switch it to main before deploying."
  exit 1
fi
STATUS="$(sudo -u "$WHO" git -C "$SRC" status --porcelain)"
if [ -n "$STATUS" ]; then
  echo "The server checkout has local changes; refusing to overwrite them."
  sudo -u "$WHO" git -C "$SRC" status --short
  exit 1
fi

say "Fetching GitHub main"
BEFORE="$(sudo -u "$WHO" git -C "$SRC" rev-parse --short HEAD)"
sudo -u "$WHO" git -C "$SRC" fetch origin main:refs/remotes/origin/main
sudo -u "$WHO" git -C "$SRC" merge --ff-only origin/main
AFTER="$(sudo -u "$WHO" git -C "$SRC" rev-parse --short HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then echo "Already on the newest code ($AFTER)."; else echo "Updated $BEFORE -> $AFTER"; sudo -u "$WHO" git -C "$SRC" log --oneline "$BEFORE..$AFTER" | head -10; fi

say "Copying to $APP"
OLD_LOCK="$(sha256sum "$APP/package-lock.json" 2>/dev/null | cut -d' ' -f1 || true)"
if [ "$SRC" != "$APP" ]; then
  command -v rsync >/dev/null || apt-get install -y rsync
  rsync -a --delete --exclude node_modules --exclude .env.local --exclude backups --exclude dist "$SRC"/ "$APP"/
fi
chown -R guilded:guilded "$APP"
NEW_LOCK="$(sha256sum "$APP/package-lock.json" | cut -d' ' -f1)"

if [ "$OLD_LOCK" != "$NEW_LOCK" ] || [ ! -d "$APP/node_modules" ]; then
  say "Dependencies changed: npm ci"
  sudo -u guilded bash -c "cd $APP && npm ci --no-audit --no-fund"
else
  echo "Dependencies unchanged."
fi

# A changed service file needs systemd to reload it. (The Caddy config is host specific: left alone.)
say "Building the online companion"
sudo -u guilded bash -c "cd $APP && npm run companion:build"

if ! cmp -s "$APP/deploy/guilded.service" /etc/systemd/system/guilded.service; then
  say "Service file changed"
  cp "$APP/deploy/guilded.service" /etc/systemd/system/guilded.service
  systemctl daemon-reload
fi

say "Restarting the bot"
systemctl restart guilded

PORT="$(grep -E '^COMPANION_API_PORT=' "$APP/.env.local" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' || true)"
PORT="${PORT:-8787}"
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    VERSION="$(node -p "require('$APP/package.json').version" 2>/dev/null || echo '?')"
    say "The bot is back (version $VERSION, $AFTER)"
    echo "Check it in Discord with /report ping. Logs: sudo journalctl -u guilded -n 50"
    exit 0
  fi
  sleep 1
done

say "The bot did not answer within 40 seconds"
journalctl -u guilded -n 30 --no-pager || true
echo
echo "The last lines above usually say why (a missing setting in .env.local, a database error)."
echo "To go back to the previous version:  cd $SRC && sudo -u $WHO git checkout $BEFORE && sudo bash deploy/update.sh"
exit 1
