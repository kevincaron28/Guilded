# Staged application update and code recovery

The updater previously copied source and ran `npm ci` inside the running bot's
application directory. An installation/build failure could leave a still-running
process with replaced source and a partially removed dependency tree.

`deploy/update.sh` now requires a separate source checkout, takes an update lock,
and prepares a private sibling directory with a clean dependency installation and
companion build. Preparation failure leaves the live files and service untouched.
After preparation, it stops the service, copies the latest configuration/backups,
retains the entire old application and activates the staged directory. It then
performs the existing unit/Caddy update and startup/health checks.

The printed `/opt/guilded.previous.<id>` contains the previous source, dependency
tree and saved service unit. Treat it and staging/failed directories as private:
they contain configuration. Retain sufficient disk space for the old and new
applications and copied backups. Remove obsolete copies only after acceptance.

## Code recovery after a separately authorized deployment

1. Inspect the failure and verify the previous application's compatibility with
   the current schema. Application recovery does not undo database changes.
2. Deliberately stop the service. Never run old and new bots together.
3. Run `sudo bash deploy/recover-application.sh /opt/guilded.previous.<id>` from
   the reviewed source checkout. Recovery refuses an active/transitioning service
   or a nonzero main PID, restores code/dependencies and the saved unit, and keeps
   the latest configuration and backups. It retains the failed candidate separately.
4. Inspect the recovered files. Recovery leaves the service stopped and does not
   run migrations. Starting it is a separate action: the installed unit normally
   runs `db:update` before bot startup.

No automatic database rollback or automatic restart after a failed health check
is attempted. Caddy's existing validated configuration backup/recovery path remains
separate; this helper restores the application and its systemd unit.

## Rehearsal scope

`scripts/verify-application-update.sh` exercises real Linux file operations and
offline npm installation/build using synthetic packages: failed installation,
failed build, preserved late writes, activation and code/dependency recovery.
It accepts no database connection and calls no service-control commands.

A separate rehearsal ran the complete updater and recovery commands in a Linux
mount/network/PID namespace and chroot. `/opt`, `/run` and systemd configuration
were private fixtures; service/health operations were explicit test doubles.
It covered build failure without any service call, successful activation, failed
health checks, recovery refusal while running, and restoration of the prior unit.
This validates script control flow and filesystem recovery, not a live systemd
cutover, Discord login or migration compatibility. No production restart, deployment
or migration was performed. Real startup remains subject to the deployment hold.
