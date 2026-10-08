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
configuration instead of running this installer. Certificates require working
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
the app to `/opt/guilded`; builds the online companion; installs/enables the
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
- `https://guild.example.org/companion/`: expect the online companion setup page.
- In your Discord server, `/report ping` must respond. Health alone does not
  prove Discord login or command registration succeeded.

Then run `/setup start` and continue at step 3 of [Guild owner setup](GUILD_OWNER_SETUP.md).
If the service fails, inspect its logs locally; do not paste secrets into chat.
A database connection failure needs the provider URL/SSL/network fixed. A
"disallowed intents" login needs Server Members Intent enabled in the portal.

## 6. Give members the right address

Your member bot address is `https://guild.example.org/api/v1/addon-imports`.
Your manual browser companion is `https://guild.example.org/companion/`.
Replace the hostname, then fill the handout in [Guild owner setup](GUILD_OWNER_SETUP.md#5-give-members-one-pinned-message).
Each member uses their own `/character pair` code. Desktop companions stay on
players' PCs because they read game files; they do not move to the bot host.

## Updates and recovery

Keep the selected source commit, original packages and a verified database
backup. Read the [release handoff](V5_0_RELEASE_HANDOFF.md) before migration or
updates. `redeploy-oracle.bat` targets the maintainer's machine and is **not an
installer or updater for other guilds**. Follow your host's deployment procedure
for the reviewed release. Do not use `prisma migrate reset` to fix an error.

Personal pairing controls uploads and standings; the old shared upload token is
retired. Officer access is checked per request. Configure host security updates
and monitor the public health endpoint using your preferred hosting tools.
