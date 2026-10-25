#!/usr/bin/env bash
# Shared filesystem operations for update/recovery. The caller owns service control.
# Never applies migrations or starts a bot. Keep recovery directories private.

prepare_application() {
  local source="$1" app="$2" owner="$3"
  [ -d "$source" ] && [ -d "$app" ] && [ ! -L "$app" ] || return 1
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
  sudo -u "$owner" nice -n 10 bash -c 'cd "$1" && npm ci --no-audit --no-fund && npm run companion:build' _ "$STAGED_APP"
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
