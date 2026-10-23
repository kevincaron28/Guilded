#!/usr/bin/env bash
# Update the Guilded bot on the server. Run it from inside the git clone you set the server up from:
#   cd ~/guilded && sudo bash deploy/update.sh
# What it does: pull the new code (with YOUR git login, so a private repository just works), copy it to
# /opt/guilded after a separate install/build succeeds, restart it, and check that it came back.
# Database changes apply by themselves when the bot starts (the service runs npm run db:update first).
# Safe to run again. If the new version does not start it tells you how to go back.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo:  sudo bash deploy/update.sh"; exit 1; fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/guilded
WHO="${SUDO_USER:-root}"
say() { printf '\n== %s\n' "$1"; }

if [ ! -d "$APP" ]; then echo "$APP does not exist. Run deploy/setup-server.sh first."; exit 1; fi
if [ "$(readlink -f "$SRC")" = "$(readlink -f "$APP")" ]; then
  echo "Use a separate source checkout: fetching into the running application is unsafe."
  exit 1
fi
exec 9>"${APP}.update.lock"
flock -n 9 || { echo "Another update or recovery is in progress."; exit 1; }

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
if [ "$BEFORE" = "$AFTER" ]; then echo "Already on the newest code ($AFTER)."; else echo "Updated $BEFORE -> $AFTER"; sudo -u "$WHO" git -C "$SRC" log -10 --oneline "$BEFORE..$AFTER"; fi

say "Preparing dependencies and online companion outside the running application"
command -v rsync >/dev/null || apt-get install -y rsync
source "$SRC/deploy/application-update.sh"
if ! prepare_application "$SRC" "$APP" guilded; then
  echo "Preparation failed; the running application was not replaced or stopped."
  echo "Inspect the private staging directory: ${STAGED_APP:-not created}"
  exit 1
fi
say "Stopping the bot and activating the prepared application"
systemctl stop guilded
if ! activate_application "$APP" "$STAGED_APP"; then
  echo "Activation failed; service remains stopped. Inspect $APP and ${PREVIOUS_APP:-the staging directory}."
  exit 1
fi
chmod 700 "$PREVIOUS_APP"
cp -p /etc/systemd/system/guilded.service "$PREVIOUS_APP/.recovery-service"
echo "Saved application for code recovery: $PREVIOUS_APP"

# A changed service file needs systemd to reload it.

if ! cmp -s "$APP/deploy/guilded.service" /etc/systemd/system/guilded.service; then
  say "Service file changed"
  cp "$APP/deploy/guilded.service" /etc/systemd/system/guilded.service
  systemctl daemon-reload
fi

# The Caddy config is the repository's deploy/Caddyfile with this server's hostname filled in.
# Only a file setup-server.sh installed (it keeps that line) with a single site is replaced;
# anything else was edited by hand and is left alone. Validated first, the old one kept.
CADDY=/etc/caddy/Caddyfile
if command -v caddy >/dev/null && [ -f "$CADDY" ]; then
  if ! grep -q 'installed by deploy/setup-server.sh' "$CADDY"; then
    echo "$CADDY was edited by hand: left alone. Compare it with $APP/deploy/Caddyfile."
  else
    SITES="$(grep -cE '^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9.-]+ \{$' "$CADDY" || true)"
    HOST="$(grep -m1 -E '^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9.-]+ \{$' "$CADDY" | cut -d' ' -f1 || true)"
    if [ "$SITES" != "1" ] || [ -z "$HOST" ]; then
      echo "$CADDY does not have exactly one site: left alone. Compare it with $APP/deploy/Caddyfile."
    else
      NEW_CADDY="$(mktemp)"
      sed "s/YOUR_HOSTNAME/$HOST/" "$APP/deploy/Caddyfile" > "$NEW_CADDY"
      if ! cmp -s "$NEW_CADDY" "$CADDY"; then
        say "Caddy config changed ($HOST)"
        diff -u "$CADDY" "$NEW_CADDY" || true
        if caddy validate --adapter caddyfile --config "$NEW_CADDY" >/dev/null 2>&1; then
          BACKUP="$CADDY.before-$AFTER"
          cp -p "$CADDY" "$BACKUP"
          cp "$NEW_CADDY" "$CADDY"
          chmod 644 "$CADDY"
          if systemctl reload caddy; then
            echo "Caddy reloaded. The previous config is $BACKUP."
          else
            cp -p "$BACKUP" "$CADDY"
            systemctl reload caddy || true
            echo "Caddy refused the new config; the previous one is back. See: sudo journalctl -u caddy -n 30"
          fi
        else
          echo "The new Caddy config does not validate: left the current one. Details:"
          caddy validate --adapter caddyfile --config "$NEW_CADDY" 2>&1 | tail -5 || true
        fi
      fi
      rm -f "$NEW_CADDY"
    fi
  fi
fi

say "Restarting the bot"
systemctl restart guilded

PORT="$(grep -E '^COMPANION_API_PORT=' "$APP/.env.local" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' || true)"
PORT="${PORT:-8787}"
health_commands() {
  curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).commands??"unknown"))}catch{process.stdout.write("unknown")}})' \
    || echo unknown
}

for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    VERSION="$(node -p "require('$APP/package.json').version" 2>/dev/null || echo '?')"
    say "The bot is back (version $VERSION, $AFTER)"
    # Discord refuses a server's whole command list when one entry is invalid, and the bot keeps
    # running with the old commands. It says so on /health ("commands"); wait for its answer.
    COMMANDS=pending
    for j in $(seq 1 90); do
      COMMANDS="$(health_commands)"
      [ "$COMMANDS" = "pending" ] || break
      sleep 1
    done
    case "$COMMANDS" in
      ok) echo "Discord accepted the slash commands in every server." ;;
      failed)
        say "Discord refused the new slash commands"
        echo "The bot is running, but members still see the previous commands."
        journalctl -u guilded -n 300 --no-pager | grep -A4 'Command registration failed' | tail -20 || true
        echo "Fix the command definition (the error above names it), then deploy again."
        exit 2 ;;
      pending)
        say "Command registration did not finish within 90 seconds"
        echo "Check: sudo journalctl -u guilded -n 200 | grep 'Command registration'"
        exit 2 ;;
      *) echo "This bot version does not report command registration on /health." ;;
    esac
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
