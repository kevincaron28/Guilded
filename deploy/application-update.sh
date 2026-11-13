#!/usr/bin/env bash
# Shared filesystem operations for update/recovery. The caller owns service control.
# Never applies migrations or starts a bot. Keep recovery directories private.

# Thresholds for starting a fresh npm ci on the 1 GB server (kB). Below them the install would swap and
# thrash the running bot, so the update stops first. Tunable here; a version-only bump never needs them.
MIN_AVAILABLE_KB=393216        # 384 MB MemAvailable
MIN_AVAILABLE_PLUS_SWAP_KB=786432  # 768 MB MemAvailable + SwapFree
# The incremental path (npm install on a copy of the live node_modules) peaked far lower than a fresh npm ci,
# which is OOM-killed inside the 450 MB scope. It is capped by that scope anyway, so this is only a sanity floor
# (256 MB MemAvailable) against starting while the box is already short, not a model of the install's needs.
MIN_INCREMENTAL_AVAILABLE_KB=262144
MEMINFO_FILE="${MEMINFO_FILE:-/proc/meminfo}"

# The heavy preparation steps (copying node_modules, npm install/ci, prisma generate, the bundle build) run in a
# systemd scope, so the kernel throttles and then kills them rather than letting them push the running bot into swap.
#  - MemoryHigh (360M) throttles and reclaims the scope's memory, including the page cache the copy and the install
#    fill, before MemoryMax (450M, below the bot's own 700M) kills it. Cache charged to the scope is reclaimed from
#    the scope, not from the bot's working set.
#  - CPUQuota is a hard cap (CPUWeight only matters under contention); IOWeight needs the io controller and may do
#    nothing on this box, so every step also runs under ionice (the copy in the idle class) and nice.
# If systemd-run cannot set all of these here, it falls back to the memory limits alone, and then to no scope at all
# (the heap caps and nice/ionice still apply).
HEAVY_PROPS_FULL=(MemoryMax=450M MemoryHigh=360M MemorySwapMax=200M CPUWeight=20 IOWeight=20 CPUQuota=50%)
HEAVY_PROPS_MEMORY=(MemoryMax=450M MemorySwapMax=200M)
HEAVY_PROPS=()

heavy_probe() {
  local args=() prop
  for prop in "$@"; do args+=(-p "$prop"); done
  command -v systemd-run >/dev/null 2>&1 || return 1
  systemd-run --quiet --scope "${args[@]}" -- true >/dev/null 2>&1
}

# Decided once per run, before the first heavy step.
decide_heavy_cap() {
  HEAVY_CAPPED=0
  HEAVY_PROPS=()
  if heavy_probe "${HEAVY_PROPS_FULL[@]}"; then
    HEAVY_CAPPED=1; HEAVY_PROPS=("${HEAVY_PROPS_FULL[@]}")
  elif heavy_probe "${HEAVY_PROPS_MEMORY[@]}"; then
    HEAVY_CAPPED=1; HEAVY_PROPS=("${HEAVY_PROPS_MEMORY[@]}")
    echo "systemd-run cannot set the CPU and I/O limits here; the steps run with the memory limits only."
  else
    echo "systemd-run cannot set a memory ceiling here; the install runs without one (heap caps still apply)."
  fi
}

# Runs one heavy command at low I/O priority ($1: ionice arguments), inside the limits when this box supports them.
run_heavy_io() {
  local io="$1"; shift
  local args=() prop
  local cmd=("$@")
  # shellcheck disable=SC2206
  if command -v ionice >/dev/null 2>&1; then cmd=(ionice $io "$@"); fi
  if [ "${HEAVY_CAPPED:-0}" = 1 ]; then
    for prop in "${HEAVY_PROPS[@]}"; do args+=(-p "$prop"); done
    systemd-run --quiet --scope "${args[@]}" -- "${cmd[@]}"
  else
    "${cmd[@]}"
  fi
}
run_heavy() { run_heavy_io "-c2 -n7" "$@"; }
# The big file copies: idle I/O class, so the bot's own disk reads always go first.
run_heavy_idle() { run_heavy_io "-c3" "$@"; }

# Runs a step and prints how long it took, so a deploy's output shows where the time goes.
# Keeps the step's exit status.
timed_step() {
  local label="$1" started rc
  shift
  started="$(date +%s)"
  "$@"
  rc=$?
  echo "[prepare] $label: $(( $(date +%s) - started ))s$([ "$rc" -eq 0 ] || echo " (failed, exit $rc)")"
  return "$rc"
}

# Copies a tree as the application's owner (so nothing needs a recursive chown afterwards), at idle I/O priority,
# inside the scope (its page cache is charged there). --reflink=auto shares blocks copy-on-write where the
# filesystem supports it (a write to either copy never reaches the other) and is a plain copy elsewhere. Never a
# hard link: npm install rewrites files in place, which would reach the live tree.
copy_tree() {
  local from="$1" to="$2" owner="$3"
  run_heavy_idle sudo -u "$owner" cp -a --reflink=auto "$from" "$to"
}

prepare_application() {
  local source="$1" app="$2" owner="$3" mode=full total_started
  total_started="$(date +%s)"
  [ -d "$source" ] && [ -d "$app" ] && [ ! -L "$app" ] || return 1
  # Decide before anything is created. Same dependencies: reuse. Changed dependencies and a live node_modules:
  # update a copy of it (needs little memory). Otherwise a full npm ci, which needs memory headroom or the update stops here.
  if can_reuse_dependencies "$source" "$app"; then
    mode=reuse
  elif [ -d "$app/node_modules" ] && [ ! -L "$app/node_modules" ] && incremental_memory_ok; then
    mode=incremental
  else
    memory_ok_for_install || return 1
  fi
  decide_heavy_cap
  echo "[prepare] mode: $mode"
  STAGED_APP="$(mktemp -d "${app}.stage.XXXXXXXX")" || return 1
  chmod 700 "$STAGED_APP"
  # Build exclusively from source; do not copy a live dependency tree or stale output.
  timed_step "copy source" rsync -a --exclude /.git --exclude /node_modules --exclude /src/generated \
    --exclude /.env --exclude /.env.local --exclude /backups --exclude /dist \
    "$source"/ "$STAGED_APP"/ || return 1
  for name in .env .env.local; do
    if [ -f "$app/$name" ]; then cp -p "$app/$name" "$STAGED_APP/$name" || return 1; fi
  done
  chown -R "$owner:$owner" "$STAGED_APP" || return 1
  # Arguments, not interpolated shell text: paths may contain spaces.
  # The live bot still serves Discord's short interaction deadline while staging.
  # Prefer its CPU work over npm extraction/Prisma generation on the small VM.
  if [ "$mode" = incremental ]; then
    echo "Updating changed dependencies on a copy of the live ones."
    if ! install_dependencies_incrementally "$source" "$app" "$owner"; then
      echo "The incremental update did not verify; falling back to a full install."
      rm -rf -- "$STAGED_APP/node_modules" || return 1
      memory_ok_for_install || return 1
      mode=full
    fi
  fi
  if [ "$mode" = reuse ]; then
    # Same dependencies as the running application (a version-only bump still counts): copy its node_modules
    # rather than running npm ci, the step that drove the 1 GB server into swap. A copy, never links, so
    # nothing written in staging can reach the live tree.
    timed_step "copy node_modules" copy_tree "$app/node_modules" "$STAGED_APP/node_modules" "$owner" || return 1
    prepare_prisma_client "$source" "$app" "$owner" || return 1
  elif [ "$mode" = full ]; then
    # No usable live tree: prefer the npm cache and cap the heap so npm cannot push the box into swap.
    echo "Installing all dependencies with a full npm ci."
    timed_step "npm ci" run_heavy sudo -u "$owner" nice -n 10 bash -c 'cd "$1" && NODE_OPTIONS=--max-old-space-size=512 npm ci --prefer-offline --no-audit --no-fund' _ "$STAGED_APP" || return 1
  fi
  prepare_companion_bundle "$source" "$app" "$owner" || return 1
  echo "[prepare] total: $(( $(date +%s) - total_started ))s"
}

# The Prisma client for the staged application (reuse mode: the dependencies, so the Prisma version, are the live
# ones). Unchanged schema and generator config: copy the live app's generated client instead of regenerating it
# (18-35 s of CPU and memory). Anything else, or no live client: generate, as before.
prepare_prisma_client() {
  local source="$1" app="$2" owner="$3"
  if [ -f "$app/src/generated/prisma/client.ts" ] && [ ! -L "$app/src/generated" ] \
    && cmp -s "$source/prisma/schema.prisma" "$app/prisma/schema.prisma" \
    && { [ ! -e "$source/prisma.config.ts" ] || cmp -s "$source/prisma.config.ts" "$app/prisma.config.ts"; }; then
    echo "The Prisma schema is unchanged: copying the live generated client."
    rm -rf -- "$STAGED_APP/src/generated" || return 1
    timed_step "copy prisma client" copy_tree "$app/src/generated" "$STAGED_APP/src/generated" "$owner" && return 0
    echo "Copying the client failed; generating it instead."
    rm -rf -- "$STAGED_APP/src/generated" || return 1
  fi
  timed_step "prisma generate" run_heavy sudo -u "$owner" nice -n 10 bash -c 'cd "$1" && NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/prisma generate' _ "$STAGED_APP"
}

# Prints a hash of everything the companion interface bundle is built from: the dependency content (esbuild and
# sharp versions), the companion and companion-app sources (minus their own outputs), the shared site modules the
# language picker imports and the logo. Same hash as the live build = same bundle.
companion_build_fingerprint() {
  local dir="$1" deps
  deps="$(dependency_fingerprint "$dir")" || return 1
  {
    echo "$deps"
    ( cd "$dir" && { find companion companion-app scripts/build-companion-renderer.mjs docs/branding/guilded-logo-400.png \
        -type f ! -path 'companion-app/assets/*' ! -path 'companion-app/build/*' ! -path 'companion-app/node_modules/*' \
        ! -name ui-bundle.js ! -name logo.png ! -name '.companion-build-stamp' -print0 2>/dev/null
      find site -maxdepth 1 -type f -name '*.mjs' -print0 2>/dev/null; } | LC_ALL=C sort -z | xargs -0 sha256sum 2>/dev/null )
  } | sha256sum | cut -d' ' -f1
}

# Builds the companion interface bundle, or copies the live one when nothing it is built from changed
# (and the live application recorded the hash it was built from). Failure to copy falls back to building.
prepare_companion_bundle() {
  local source="$1" app="$2" owner="$3" want have
  want="$(companion_build_fingerprint "$STAGED_APP" 2>/dev/null || true)"
  have="$(cat "$app/.companion-build-stamp" 2>/dev/null || true)"
  if [ -n "$want" ] && [ "$want" = "$have" ] && [ -f "$app/companion-app/renderer/ui-bundle.js" ] && [ -f "$app/companion-app/renderer/logo.png" ] && [ -d "$app/companion-app/assets" ]; then
    echo "The companion interface sources are unchanged: copying the live bundle."
    if timed_step "copy companion bundle" bash -c 'cp -a "$1/companion-app/renderer/ui-bundle.js" "$1/companion-app/renderer/logo.png" "$2/companion-app/renderer/" && rm -rf -- "$2/companion-app/assets" && cp -a "$1/companion-app/assets" "$2/companion-app/assets"' _ "$app" "$STAGED_APP"; then
      printf '%s\n' "$want" > "$STAGED_APP/.companion-build-stamp" && chown "$owner:$owner" "$STAGED_APP/.companion-build-stamp"
      return
    fi
    echo "Copying the bundle failed; building it instead."
  fi
  # The bundle build gets a heap cap so it cannot take the memory the running bot needs.
  timed_step "companion build" run_heavy sudo -u "$owner" nice -n 10 bash -c 'cd "$1" && NODE_OPTIONS=--max-old-space-size=384 npm run companion:build' _ "$STAGED_APP" || return 1
  if [ -n "$want" ]; then printf '%s\n' "$want" > "$STAGED_APP/.companion-build-stamp" && chown "$owner:$owner" "$STAGED_APP/.companion-build-stamp"; fi
}

# Sanity floor for the incremental path only (see MIN_INCREMENTAL_AVAILABLE_KB). Silent; on failure the caller
# tries the full-install gate, which prints the reason and stops the update if memory is short.
incremental_memory_ok() {
  local available
  available="$(awk '/^MemAvailable:/{print $2}' "$MEMINFO_FILE" 2>/dev/null || true)"
  case "$available" in ''|*[!0-9]*) return 1 ;; esac
  [ "$available" -ge "$MIN_INCREMENTAL_AVAILABLE_KB" ]
}

# Changed dependencies: copy the live node_modules into staging and let npm install bring it to the new
# lockfile. A fresh npm ci is OOM-killed inside the 450 MB scope; this measured 32 s under the same cap.
# Lifecycle scripts stay on, so the root postinstall ("prisma generate") produces the Prisma client here, once.
# npm install against a lockfile prunes packages the lockfile no longer lists (extraneous), and npm ls then
# confirms the tree matches. Both are checked below rather than assumed. Returns 1 on any failure; the caller
# removes the staged node_modules and falls back to npm ci. Nothing here touches the live tree.
install_dependencies_incrementally() {
  local source="$1" app="$2" owner="$3"
  timed_step "copy node_modules" copy_tree "$app/node_modules" "$STAGED_APP/node_modules" "$owner" || return 1
  timed_step "npm install" run_heavy sudo -u "$owner" nice -n 10 bash -c 'cd "$1" && NODE_OPTIONS=--max-old-space-size=384 npm install --prefer-offline --no-audit --no-fund' _ "$STAGED_APP" || return 1
  # (1) npm must not have rewritten the lockfile: the tree has to match exactly what was reviewed and committed.
  cmp -s "$STAGED_APP/package-lock.json" "$source/package-lock.json" || { echo "npm install changed package-lock.json."; return 1; }
  # (2) Nothing missing, invalid or extraneous against the lockfile (npm ls exits non-zero on all three).
  timed_step "npm ls" run_heavy sudo -u "$owner" nice -n 10 bash -c 'cd "$1" && NODE_OPTIONS=--max-old-space-size=384 npm ls --all >/dev/null' _ "$STAGED_APP" || { echo "npm ls found a problem in the updated tree."; return 1; }
  # (3) The Prisma client the build and the bot import must exist (written by the postinstall).
  [ -f "$STAGED_APP/src/generated/prisma/client.ts" ] || { echo "The Prisma client was not generated."; return 1; }
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
