#!/usr/bin/env bash
# Restore application files only. Never restores a database or starts a service.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Run recovery with sudo."; exit 1; fi
APP=/opt/guilded
PREVIOUS="${1:-}"
if [ "$#" -ne 1 ] || [ ! -d "$PREVIOUS" ] || [ -L "$PREVIOUS" ]; then
  echo "Usage: sudo bash deploy/recover-application.sh /opt/guilded.previous.<saved-id>"
  exit 1
fi
case "$PREVIOUS" in "$APP.previous."*) ;; *) echo "Not an updater recovery directory."; exit 1 ;; esac
[ "$(dirname "$PREVIOUS")" = "$(dirname "$APP")" ] || exit 1
exec 9>"${APP}.update.lock"
flock -n 9 || { echo "Another update or recovery is in progress."; exit 1; }
STATE="$(systemctl show guilded -p ActiveState --value)"
MAIN_PID="$(systemctl show guilded -p MainPID --value)"
if { [ "$STATE" != inactive ] && [ "$STATE" != failed ]; } || [ "$MAIN_PID" != 0 ]; then
  echo "Stop guilded deliberately before restoring application files."
  exit 1
fi
source "$(dirname "$0")/application-update.sh"
restore_application "$APP" "$PREVIOUS"
if [ -f "$APP/.recovery-service" ]; then
  cp -p "$APP/.recovery-service" /etc/systemd/system/guilded.service
  systemctl daemon-reload
fi
echo "Application restored. Failed candidate retained at $FAILED_APP."
echo "Current configuration and backups retained; database untouched; service remains stopped."
echo "Verify schema compatibility before separately authorizing a start (which runs db:update)."
