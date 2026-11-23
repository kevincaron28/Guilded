#!/usr/bin/env bash
# Packages the bot as a ready-to-run release tarball (run by .github/workflows/bot-build.yml, not on the server).
#   bash deploy/package-release.sh <full commit sha> <output directory>
# Expects a tree where `npm ci`, `npx prisma generate` and `npm run companion:build` already ran. The tarball is
# what deploy/update.sh would otherwise build on the 1 GB server: source, node_modules (the same full tree `npm ci`
# makes, so the server's own fallback build and its dependency checks keep working), the generated Prisma client and
# the companion interface bundle, with the stamps update.sh and the start step use to skip repeated work.
# Never packaged: .git, .env files, backups, dist, mobile (the phone app is built elsewhere).
set -euo pipefail

SHA="${1:-}"; OUT="${2:-}"
if ! [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || [ -z "$OUT" ]; then echo "Usage: bash deploy/package-release.sh <40-character commit sha> <output directory>"; exit 1; fi
for need in node_modules/.bin/tsx node_modules/.bin/prisma src/generated/prisma/client.ts companion-app/renderer/ui-bundle.js package.json; do
  [ -e "$need" ] || { echo "Missing $need: run npm ci, prisma generate and companion:build first."; exit 1; }
done
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
NAME="guilded-bot-$SHA.tar.gz"

printf '%s\n' "$SHA" > .build-sha
node scripts/db-update-start.mjs --stamp-client
# shellcheck source=deploy/application-update.sh
source deploy/application-update.sh
companion_build_fingerprint "$PWD" > .companion-build-stamp
[ -s .companion-build-stamp ] || { echo "Could not compute the companion build stamp."; exit 1; }

tar --exclude=./.git --exclude=./.env --exclude=./.env.local --exclude=./backups --exclude=./dist --exclude=./mobile \
  -czf "$OUT/$NAME" .
( cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256" )
ls -l "$OUT/$NAME" "$OUT/$NAME.sha256"
