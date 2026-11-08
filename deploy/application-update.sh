#!/usr/bin/env bash
# Shared filesystem operations for update/recovery. The caller owns service control.
# Never applies migrations or starts a bot. Keep recovery directories private.

# Thresholds for starting a fresh npm ci on the 1 GB server (kB). Below them the install would swap and
# thrash the running bot, so the update stops first. Tunable here; a version-only bump never needs them.
MIN_AVAILABLE_KB=393216        # 384 MB MemAvailable
MIN_AVAILABLE_PLUS_SWAP_KB=786432  # 768 MB MemAvailable + SwapFree
MEMINFO_FILE="${MEMINFO_FILE:-/proc/meminfo}"

prepare_application() {
  local source="$1" app="$2" owner="$3" reuse=0
  [ -d "$source" ] && [ -d "$app" ] && [ ! -L "$app" ] || return 1
  # Decide before anything is created: a fresh npm ci needs memory headroom, or the update stops here.
  if can_reuse_dependencies "$source" "$app"; then reuse=1; else memory_ok_for_install || return 1; fi
  STAGED_APP="$(mktemp -d "${app}.stage.XXXXXXXX")" || return 1
  chmod 700 "$STAGED_APP"
  # Build exclusively from source; do not copy a live dependency tree or stale output.
  rsync -a --exclude /.git --exclude /node_modules --exclude /src/generated \
    --exclude /.env --exclude /.env.local --exclude /backups --exclude /dist \
    "$source"/ "$STAGED_APP"/ || return 1
  for name in .env .env.local; do
    if [ -f "$app/$name" ]; then cp -p "$app/$name" "$STAGED_APP/$name" || return 1; fi
  done
  chown -R "$owner:$owner" "$STAGED_APP" || return 1
  # Arguments, not interpolated shell text: paths may contain spaces.
  # The live bot still serves Discord's short interaction deadline while staging.
  # Prefer its CPU work over npm extraction/Prisma generation on the small VM.
  if [ "$reuse" = 1 ]; then
    # Same dependencies as the running application (a version-only bump still counts): copy its node_modules
    # rather than running npm ci, the step that drove the 1 GB server into swap. A real copy, not links, so
    # nothing written in staging can reach the live tree. Prisma's client is regenerated; npm ci would have done that too.
    cp -a "$app/node_modules" "$STAGED_APP/node_modules" || return 1
    chown -R "$owner:$owner" "$STAGED_APP/node_modules" || return 1
    sudo -u "$owner" nice -n 10 bash -c 'cd "$1" && NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/prisma generate' _ "$STAGED_APP" || return 1
  else
    # A genuine dependency change: prefer the npm cache and cap the heap so npm cannot push the box into swap.
    sudo -u "$owner" nice -n 10 bash -c 'cd "$1" && NODE_OPTIONS=--max-old-space-size=512 npm ci --prefer-offline --no-audit --no-fund' _ "$STAGED_APP" || return 1
  fi
  # The bundle build gets a heap cap so it cannot take the memory the running bot needs.
  sudo -u "$owner" nice -n 10 bash -c 'cd "$1" && NODE_OPTIONS=--max-old-space-size=384 npm run companion:build' _ "$STAGED_APP"
}

# Prints a hash of the dependency content of a source tree: the dependency fields of package.json and the
# whole lockfile, with only the version fields removed (the package's own version, and the lockfile's root
# version). A version-only bump therefore keeps the same hash; any dependency change alters it.
dependency_fingerprint() {
  node -e '
const fs = require("fs"), crypto = require("crypto");
const dir = process.argv[1];
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {})
  : v;
const pkg = JSON.parse(fs.readFileSync(dir + "/package.json", "utf8"));
const manifest = {};
for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides"]) {
  if (k in pkg) manifest[k] = pkg[k];
}
const lock = JSON.parse(fs.readFileSync(dir + "/package-lock.json", "utf8"));
delete lock.version;
if (lock.packages && lock.packages[""]) delete lock.packages[""].version;
const text = JSON.stringify({ manifest: canon(manifest), lock: canon(lock) });
process.stdout.write(crypto.createHash("sha256").update(text).digest("hex") + "\n");
' "$1"
}

# True when the running application has a node_modules tree built from the same dependencies as the source.
# Any unreadable file, or a dependency difference, means a fresh npm ci.
can_reuse_dependencies() {
  local source="$1" app="$2" want have
  [ -d "$app/node_modules" ] && [ ! -L "$app/node_modules" ] || return 1
  want="$(dependency_fingerprint "$source" 2>/dev/null)" || return 1
  have="$(dependency_fingerprint "$app" 2>/dev/null)" || return 1
  [ -n "$want" ] && [ "$want" = "$have" ]
}

# Refuses a fresh npm ci unless the box has memory headroom now. Unknown or low values stop the update
# before anything is created, instead of thrashing the running bot. Prints the reason.
memory_ok_for_install() {
  local available swap
  available="$(awk '/^MemAvailable:/{print $2}' "$MEMINFO_FILE" 2>/dev/null || true)"
  swap="$(awk '/^SwapFree:/{print $2}' "$MEMINFO_FILE" 2>/dev/null || true)"
  case "$available" in ''|*[!0-9]*) echo "Could not read available memory; not starting npm ci."; return 1 ;; esac
  case "$swap" in ''|*[!0-9]*) swap=0 ;; esac
  if [ "$available" -lt "$MIN_AVAILABLE_KB" ] || [ $((available + swap)) -lt "$MIN_AVAILABLE_PLUS_SWAP_KB" ]; then
    echo "Not enough memory to install new dependencies: $((available / 1024)) MB available, $((swap / 1024)) MB swap free."
    echo "A fresh npm ci needs about 384 MB available (768 MB with swap). Nothing was changed; the bot is still running."
    echo "Retry when the server is quieter, or free memory first."
    return 1
  fi
}

activate_application() {
  local app="$1" stage="$2"
  [ -d "$app" ] && [ ! -L "$app" ] && [ -d "$stage" ] && [ ! -L "$stage" ] || return 1
  # Call only after the service has stopped. Capture the final backup/config writes.
  for name in .env .env.local backups; do
    if [ -e "$app/$name" ]; then cp -a "$app/$name" "$stage/" || return 1; fi
  done
  PREVIOUS_APP="$(mktemp -d "${app}.previous.XXXXXXXX")" || return 1
  rmdir "$PREVIOUS_APP" || return 1
  mv "$app" "$PREVIOUS_APP" || return 1
  if ! mv "$stage" "$app"; then
    mv "$PREVIOUS_APP" "$app" || return 1
    return 1
  fi
}

restore_application() {
  local app="$1" previous="$2"
  [ -d "$app" ] && [ ! -L "$app" ] && [ -d "$previous" ] && [ ! -L "$previous" ] || return 1
  # The saved directory must be a sibling made by activate_application.
  case "$previous" in "${app}.previous."*) ;; *) return 1 ;; esac
  [ "$(dirname "$previous")" = "$(dirname "$app")" ] || return 1
  # Keep current configuration/backups, including writes since the attempted update.
  for name in .env .env.local backups; do
    if [ -e "$app/$name" ]; then cp -a "$app/$name" "$previous/" || return 1; fi
  done
  FAILED_APP="$(mktemp -d "${app}.failed.XXXXXXXX")" || return 1
  rmdir "$FAILED_APP" || return 1
  mv "$app" "$FAILED_APP" || return 1
  if ! mv "$previous" "$app"; then mv "$FAILED_APP" "$app" || return 1; return 1; fi
}

# Disk housekeeping. Every helper takes the application path (/opt/guilded) and touches only sibling
# directories named exactly "<app>.previous.<8 random chars>" or "<app>.stage.<8 random chars>" (the
# shape mktemp XXXXXXXX produces). The app itself and "<app>.update.lock" never match those patterns.
application_siblings_base() { dirname -- "$1"; }

# Keep the newest $2 saved applications; delete the rest. Newest by modification time.
prune_previous_applications() {
  local app="$1" keep="$2" base name line dir index=0
  case "$keep" in ''|*[!0-9]*) return 1 ;; esac
  [ -n "$app" ] || return 1
  base="$(application_siblings_base "$app")"; name="$(basename -- "$app")"
  while IFS= read -r -d '' line; do
    dir="${line#*$'\t'}"
    index=$((index + 1))
    [ "$index" -le "$keep" ] && continue
    case "$dir" in "$base/$name.previous."????????) ;; *) continue ;; esac
    [ -d "$dir" ] && [ ! -L "$dir" ] || continue
    if rm -rf -- "$dir"; then echo "Removed old saved application: $dir"; else echo "Could not remove $dir"; fi
  done < <(find "$base" -mindepth 1 -maxdepth 1 -type d -name "$name.previous.????????" \
    -printf '%T@\t%p\0' | sort -z -t $'\t' -k1,1 -rn)
}

# Remove staging directories a crashed or interrupted run left behind (older than one day).
# Call only while holding the update lock, so no other run is still preparing one.
remove_stale_staging() {
  local app="$1" base name
  [ -n "$app" ] || return 1
  base="$(application_siblings_base "$app")"; name="$(basename -- "$app")"
  find "$base" -mindepth 1 -maxdepth 1 -type d -name "$name.stage.????????" -mmin +1440 \
    -exec rm -rf -- {} + || echo "Could not remove some old staging directories."
}

# Remove the staging directory of this run after a failed preparation. Refuses anything else.
discard_own_staging() {
  local dir="${1:-}"
  [ -n "$dir" ] || return 0
  case "$dir" in *.stage.????????) ;; *) return 1 ;; esac
  [ -d "$dir" ] && [ ! -L "$dir" ] || return 0
  rm -rf -- "$dir"
}

free_kb_under() { df -Pk -- "$1" 2>/dev/null | awk 'NR==2{print $4}'; }

# Succeeds when at least $2 KB are free next to the application. Below that it prunes old saved
# applications (keeping the newest 3) and checks again. Returns 1 without any further change if still low.
ensure_free_disk() {
  local app="$1" min_kb="$2" base avail
  base="$(application_siblings_base "$app")"
  avail="$(free_kb_under "$base" || true)"
  case "$avail" in ''|*[!0-9]*) echo "Could not read free disk space under $base."; return 1 ;; esac
  [ "$avail" -ge "$min_kb" ] && return 0
  echo "Only $((avail / 1024)) MB free under $base: removing old saved applications first."
  prune_previous_applications "$app" 3 || true
  avail="$(free_kb_under "$base" || true)"
  case "$avail" in ''|*[!0-9]*) echo "Could not read free disk space under $base."; return 1 ;; esac
  [ "$avail" -ge "$min_kb" ] && return 0
  echo "Still only $((avail / 1024)) MB free under $base (need $((min_kb / 1024 / 1024)) GB)."
  return 1
}
