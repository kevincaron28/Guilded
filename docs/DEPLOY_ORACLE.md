# Host your guild's bot on Ubuntu

This is the fresh-install path for a **dedicated Ubuntu 22.04/24.04 server**,
including Oracle Cloud. Start with [Guild owner setup](GUILD_OWNER_SETUP.md) for
Discord permissions, and the [quick checklist](QUICK_START.md) for the time budget.
For an existing bot, follow [the release handoff](V5_0_RELEASE_HANDOFF.md) and its
backup/CI gates. Never run two processes with the same bot token.

## 1. Prepare your infrastructure

Create your own server with SSH/sudo access and a reachable PostgreSQL 16+
database. Use your provider's current pricing and availability; this project
does not guarantee free hosting. Oracle account approval and instance capacity
can delay setup. See [Oracle's Free Tier documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm).

Point a DNS hostname you control to your server's public IP. Allow inbound TCP
80 and 443 in the cloud firewall/security list and the OS firewall. Restrict SSH
to your administration needs. Do not expose port 8787: Caddy reaches it locally.
Allow outbound HTTPS and your database provider's connection port.

The installer writes `/etc/caddy/Caddyfile`; use a dedicated machine. On a
shared host, have its administrator integrate `deploy/Caddyfile` into the existing
configuration instead of running this installer (keep its global `log` block: it
stops Caddy writing companion credentials into the journal). `deploy/update.sh`
re-applies a changed `deploy/Caddyfile` to an installer-written copy, validating it
first and keeping the old one beside it. Certificates require working
DNS and public reachability; see [Caddy's HTTPS requirements](https://caddyserver.com/docs/automatic-https).

## 2. Get the matching source

Use the source archive for the same version as your addon and companion on
[GitHub Releases](https://github.com/kevincaron28/Guilded/releases), or the exact
beta source supplied by the maintainer. Upload and extract that source on the
server, then enter the extracted folder (the one containing `package.json`).
GitHub's generic **Code → Download ZIP** follows a branch and may differ from
your release. An addon ZIP contains only the addon, not the bot source.

If you prefer Git, clone the actual repository, then check out the exact release
tag or full commit shown in your release notes before installing:

```bash
git clone https://github.com/kevincaron28/Guilded.git guilded
cd guilded
# git checkout <the exact tag or commit supplied with your release>
```

A source archive works for initial installation. The existing `deploy/update.sh`
requires a clean Git checkout on `main` and deploys `origin/main`; it is not a
pinned-release updater. Do not use it to update a selected beta/tag blindly.

## 3. Install on your server

Replace `guild.example.org` below with **your own hostname**, without `https://`
or a path. From inside the selected source folder:

```bash
sudo bash deploy/setup-server.sh guild.example.org
```

The installer installs Node 24 if missing/older, Caddy and dependencies; copies
the app to `/opt/guilded`; builds the Windows app's interface bundle; installs/enables the
`guilded` systemd service; and configures HTTPS. It does **not** start the bot.
It refuses to install over an active Guilded service. It may add swap on a small
server. Check your cloud firewall separately; the script cannot configure it.

## 4. Configure and check

```bash
sudo nano /opt/guilded/.env.local
```

Fill only `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` and
`DATABASE_URL` to start. Keep `COMPANION_API_HOST=127.0.0.1`,
`COMPANION_API_PORT=8787` and `MESSAGE_CONTENT_INTENT=false`.
Optional Warcraft Logs, AI and error-report fields may stay blank.
Set `COMPANION_WEB_URL` to the companion download page (`https://guilded.kcaron.top/companion/`
is the hosted one) to include its button in Discord's private character setup and pinned guide. The
official hosted bot defaults to its hosted companion; independent bots without
this setting ask members for their officer's link.
If `DATABASE_URL` is a pooled connection (Neon: the host contains `-pooler`), also set
`DIRECT_URL` to the same string without `-pooler`. Database updates then use the direct
connection, so a failed update can never leave its lock on a pooled connection.
Use your own application's token and database, never another guild's settings.
The file is restricted to the service owner; do not share it in support requests.

```bash
cd /opt/guilded
sudo -u guilded npm run setup:check
```

Fix every FAIL before continuing. This checks configuration and the web build
without logging into Discord, changing the database, or printing secrets. It
cannot prove token validity, network connectivity or permissions.

## 5. Start once and verify

After the offline check passes, the owner starts the single service:

```bash
sudo systemctl start guilded
sudo systemctl status guilded --no-pager
sudo journalctl -u guilded -n 50 --no-pager
```

The service applies migrations and generates Prisma before starting the bot.
For a fresh database this creates its tables; for an existing database, stop
here and complete the release backup/preflight procedure first.

From another PC, open your own URLs:

- `https://guild.example.org/health`: expect `ok: true` and the intended version.
- `https://guild.example.org/companion/`: expect a redirect to the hosted companion download page.
- In your Discord server, `/report ping` must respond. Health alone does not
  prove Discord login or command registration succeeded.

Then run `/setup start` and continue at step 3 of [Guild owner setup](GUILD_OWNER_SETUP.md).
If the service fails, inspect its logs locally; do not paste secrets into chat.
A database connection failure needs the provider URL/SSL/network fixed. A
"disallowed intents" login needs Server Members Intent enabled in the portal.

## 6. Give members the right address

Your member bot address is `https://guild.example.org/api/v1/addon-imports`.
Members install the Windows companion from [Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) and set your bot address under Advanced.
Replace the hostname, then fill the handout in [Guild owner setup](GUILD_OWNER_SETUP.md#5-give-members-one-pinned-message).
Each member uses their own `/character pair` code. Desktop companions stay on
players' PCs because they read game files; they do not move to the bot host.

## Updates and recovery

Keep the selected source commit, original packages and a verified database
backup. Read the [release handoff](V5_0_RELEASE_HANDOFF.md) before migration or
updates. `redeploy-oracle.bat` targets the maintainer's machine and is **not an
installer or updater for other guilds**. Follow your host's deployment procedure
for the reviewed release. Do not use `prisma migrate reset` to fix an error.

**Update notices.** Once a day a self-hosted bot asks GitHub for the latest stable release.
When it is newer than the running bot, each server's officer log gets one notice per version
with the release link. Set `UPDATE_CHECK=false` to turn this off. The Windows companion does
the same on its own: it shows a **Download update** banner on Overview, a tray note and one
Windows notification when GitHub or its bot has a newer version. Nothing installs by itself.

Personal pairing controls uploads and standings; the old shared upload token is
retired. Officer access is checked per request. Configure host security updates
and monitor the public health endpoint using your preferred hosting tools.

## Deploy guards, the 7-8 November freeze and the uptime monitor

**The freeze.** On 7 November 2026 the 9.0.3 deploy hung the 1 GB Oracle server at about
21:55 UTC: the install drove the box into memory pressure and the bot's database queries timed out. Deploys
to that server were frozen for 7 and 8 November. The owner decides when the freeze ends.

**Guards in the updater** (`deploy/update.sh` and `deploy/application-update.sh`):

- The new version is prepared beside the running one. The bot is not stopped until a prepared
  copy exists, so a failed preparation leaves it running.
- The heavy steps (`npm ci`, `prisma generate`, the companion bundle build) run in a systemd
  scope capped at 450 MB of memory and 200 MB of swap, with low CPU and I/O weight. A step that
  exceeds the cap is killed and the deploy stops; the bot is untouched. If `systemd-run` cannot
  set the cap here, the steps run without it and the update says so.
- **Gentler on the running bot (14 November 2026).** On 13 November a deploy that changed dependencies made the
  bot's long polls take 43-60 s instead of 12-17 s and one upload hit a Prisma P2028. What changed:
  the `node_modules` copy now runs inside the scope, as the app's owner (no recursive `chown`), so the page cache it
  fills is charged to the scope and, under `MemoryHigh=360M` (copies only), reclaimed there instead of from the bot.
  `npm install`, `npm ls`, `prisma generate` and the bundle build keep the limits they were measured under (450M,
  200M swap); the scope adds `CPUQuota=50%` next to the weights. `ionice` (idle class for the copies, `-c2 -n7` for the
  rest) is probed once and skipped where it cannot be set; on a disk with the `none` scheduler it does nothing.
  If the box cannot set these properties the steps fall back to the memory limits alone, then to no scope.
  The copy uses `cp --reflink=auto` (copy-on-write where the filesystem has it, a plain copy elsewhere, never hard
  links: npm install rewrites files in place and must not reach the live tree). An unchanged `prisma/schema.prisma`
  and `prisma.config.ts` copy the live generated client instead of running `prisma generate`; an unchanged
  companion interface (hash of `companion/`, `companion-app/`, the shared `site/*.mjs`, the logo and the dependency
  fingerprint, stored in `.companion-build-stamp`) copies the live bundle instead of running `companion:build` (the
  first deploy after this change has no stamp and builds; a stamp that cannot be written only warns). A failed
  copy of either falls back to generating or building. Every step prints `[prepare] <step>: <n>s`, plus
  `[prepare] mode:` and `[prepare] total:`: read them in the next deploy output.
- A version-only bump reuses the running `node_modules`. A real dependency change cannot use a
  fresh `npm ci` here: measured on 13 November 2026, it is OOM-killed inside the 450 MB cap every
  time (about 388 MB resident at the kill, even with a 300 MB heap, 3 sockets and no scripts).
  So the updater first copies the running `node_modules` into the staging directory and runs
  `npm install --prefer-offline --no-audit --no-fund` there (heap cap 384 MB, lifecycle scripts
  on, so the `postinstall` regenerates the Prisma client once). By hand under the same cap this took
  32 s. It is accepted only if all of these hold: `package-lock.json` in staging is byte-identical
  to the source one, `npm ls --all` exits 0 (nothing missing, invalid or extraneous; `npm install`
  against a lockfile also prunes packages the lockfile no longer lists), and `src/generated/prisma/client.ts`
  exists. The output says "Updating changed dependencies on a copy of the live ones". If any step
  fails, the staged `node_modules` is removed, the output says "falling back to a full install", and
  a fresh `npm ci` runs, but only after a memory check (384 MB available, 768 MB with swap; otherwise
  the update refuses and the bot keeps running). The incremental path only needs 256 MB available
  as a sanity floor (the scope cap, not this number, is what protects the bot). With no running
  `node_modules` to copy, the fresh `npm ci` path is used directly. The live tree is never touched.
- The bot's unit (`deploy/guilded.service`) keeps `MemoryMax=700M`, adds `MemoryLow=256M` and
  `OOMScoreAdjust=-500` (the kernel prefers to kill the deploy's install over the bot), and
  keeps `Restart=always`. An updated unit is written beside the old one and moved into place; if
  systemd rejects it, the previous file is restored before the bot starts again.
- At least 3 GB must be free next to the application before preparing. Old saved applications
  are pruned first.

**The uptime monitor.** `.github/workflows/uptime.yml` runs every 10 minutes against
`https://guilded.kcaron.top/health` and several public pages, with retries. A failed run is
emailed to the repository owner by GitHub. No secrets are needed for the email.

**If the monitor emails you:**

1. Wait 10 minutes. A restart or a slow page often clears by itself.
2. Open `https://guilded.kcaron.top/health` in a browser. If it answers, no action is needed.
3. If it is still down after 10 minutes, in the Oracle Cloud console open the instance and choose
   **Reboot**. Wait about 5 minutes, then check `/health` again.
4. If it is still down after the reboot, contact the developer. Do not redeploy from the console.

## Craft forum: one thread per profession (13 November 2026)

A profession could have two threads in the craft forum, "📚 Cooking" and "📚 Cuisine". On every craft-board refresh the bot keeps one (the bot-made one, else an open one titled in the server language), renames it to the server language, and archives the other only when the bot made both, after posting a line that points to the kept thread. Nothing is deleted and a member-made thread is never touched. To preview first, set `PROFESSION_DUPLICATES_DRY_RUN=true`, restart, read the `Profession post duplicate ...` log lines, then unset it. No officer action is needed otherwise; a thread the bot cannot archive (missing Manage Threads) is left as it was and logged.
