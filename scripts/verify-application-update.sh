#!/usr/bin/env bash
# Real Linux filesystem/npm rehearsal, synthetic packages only. No service or DB access.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Run in an isolated Linux test environment as root.'; exit 1; }
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/guilded-update-test.XXXXXXXX")"
chmod 700 "$ROOT"
source "$(dirname "$0")/../deploy/application-update.sh"
APP="$ROOT/application"
SRC="$ROOT/source"
mkdir -p "$APP/backups" "$APP/node_modules/fixture" "$SRC/fixture" "$SRC/deploy"
printf 'old-code' > "$APP/version"
printf 'old-dependency' > "$APP/node_modules/fixture/index.js"
printf 'private-fixture' > "$APP/.env.local"
chmod 600 "$APP/.env.local"
printf 'old-backup' > "$APP/backups/before.json"
printf 'new-code' > "$SRC/version"
printf '{"name":"fixture-app","version":"1.0.0","private":true,"scripts":{"companion:build":"node build.cjs"},"dependencies":{"fixture":"file:fixture"}}' > "$SRC/package.json"
printf '{"name":"fixture","version":"1.0.0","main":"index.js"}' > "$SRC/fixture/package.json"
printf 'module.exports="new-dependency"' > "$SRC/fixture/index.js"
printf 'const fs=require("fs");if(fs.existsSync("fail-build"))process.exit(42);fs.mkdirSync("dist",{recursive:true});fs.writeFileSync("dist/result",require("fixture"));' > "$SRC/build.cjs"
(cd "$SRC" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund --offline >/dev/null)
before="$(sha256sum "$APP/version" "$APP/node_modules/fixture/index.js" "$APP/.env.local")"
# An inconsistent lockfile must fail before the live dependency tree is touched.
cp "$SRC/package-lock.json" "$ROOT/lock.saved"
printf '{}' > "$SRC/package-lock.json"
if prepare_application "$SRC" "$APP" root > "$ROOT/install-failure.log" 2>&1; then echo 'Expected install failure'; exit 1; fi
[ "$before" = "$(sha256sum "$APP/version" "$APP/node_modules/fixture/index.js" "$APP/.env.local")" ]
cp "$ROOT/lock.saved" "$SRC/package-lock.json"
touch "$SRC/fail-build"
if prepare_application "$SRC" "$APP" root > "$ROOT/build-failure.log" 2>&1; then echo 'Expected build failure'; exit 1; fi
[ "$before" = "$(sha256sum "$APP/version" "$APP/node_modules/fixture/index.js" "$APP/.env.local")" ]
rm "$SRC/fail-build"
prepare_application "$SRC" "$APP" root > "$ROOT/success.log" 2>&1
[ "$(cat "$STAGED_APP/dist/result")" = new-dependency ]
[ "$before" = "$(sha256sum "$APP/version" "$APP/node_modules/fixture/index.js" "$APP/.env.local")" ]
# A last write between preparation and shutdown must survive activation.
printf 'late-backup' > "$APP/backups/late.json"
printf 'latest-config' > "$APP/.env.local"
activate_application "$APP" "$STAGED_APP"
chmod 700 "$PREVIOUS_APP"
[ "$(cat "$APP/version")" = new-code ]
[ "$(cat "$APP/.env.local")" = latest-config ]
[ "$(cat "$APP/backups/late.json")" = late-backup ]
[ "$(cat "$PREVIOUS_APP/node_modules/fixture/index.js")" = old-dependency ]
# Code recovery must retain writes made after the failed candidate started.
printf 'post-update-backup' > "$APP/backups/after.json"
printf 'post-update-config' > "$APP/.env.local"
restore_application "$APP" "$PREVIOUS_APP"
[ "$(cat "$APP/version")" = old-code ]
[ "$(cat "$APP/node_modules/fixture/index.js")" = old-dependency ]
[ "$(cat "$APP/.env.local")" = post-update-config ]
[ "$(cat "$APP/backups/after.json")" = post-update-backup ]
[ "$(cat "$APP/backups/before.json")" = old-backup ]
[ "$(cat "$FAILED_APP/version")" = new-code ]
[ "$(stat -c %a "$APP/.env.local")" = 600 ]
if restore_application "$APP" "$ROOT/source"; then echo 'Accepted unrelated recovery path'; exit 1; fi
echo "PASS: failed install/build preserve live files; activation preserves late writes; recovery preserves current config/backups and restores dependencies."
echo "Synthetic evidence: $ROOT"
