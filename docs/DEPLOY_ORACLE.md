# Running the bot in the cloud (Oracle Cloud Always Free)

Goal: the Discord bot is online 24/7 without your PC. Your database is already
in the cloud (Neon), so the only thing that has to move is the bot process.

## Can the *companion* move too? No, and it doesn't need to

The companion reads the addon's saved file (`WTF\...\SavedVariables\Guilded.lua`)
on the computer where WoW runs. The game only writes that file when you log out
or `/reload`, so a server can never see it. What changes with a cloud bot:

- **Bot: always online** (cloud).
- **Companion: on any officer's PC that plays**, uploading over the internet
  to the cloud bot each time that player logs out. Put `start-companion.bat` in
  the Windows Startup folder (Win+R, `shell:startup`, drop a shortcut to it)
  and it runs whenever the PC is on.
- The addon already shares data guild-wide, so one officer's upload carries
  everyone who was online (characters, gear, consumables). With
  `/setup config auto-import enabled:true` the bot applies each upload by itself.

## Is Oracle's free tier a good fit? Honest assessment

What Oracle documents as **Always Free** (check the current terms when you
sign up, they change): Ampere A1 Arm instances (up to 4 cores and 24 GB RAM in
total), two small AMD "micro" instances (1 GB RAM each), 200 GB block storage,
about 10 TB/month outbound traffic. That is far more than this bot needs
(Node + discord.js + Prisma: roughly 300 MB RAM, almost no CPU).

Good:
- Genuinely free for this workload, with no time limit on Always Free resources.
- Static public IP, plenty of RAM, near your Neon database if you pick the
  US-East (Ashburn) home region (Neon is in US-East-2).
- You already have automatic restarts to handle (systemd does that).

Real risks (why I would still keep local as the fallback):
1. **Signup friction.** A credit card is required for verification, and the
   home region cannot be changed later. Some people are rejected or get
   suspended, with little recourse.
2. **A1 capacity.** New A1 instances often fail with "Out of host capacity" in
   busy regions; you retry for days or use a script. The AMD micro (1 GB) always
   works and is enough for this bot if you add 1 GB of swap.
3. **Idle reclamation.** Oracle can reclaim Always Free compute that stays
   idle (very low CPU, network and memory for about a week). A quiet Discord bot
   looks idle. The usual protection is upgrading the account to **Pay As You Go**
   (you are still charged nothing while inside the Always Free limits) and
   setting a budget alert at $1.
4. **Nothing on the VM is precious.** All data is in Neon and the code is in
   git, so if the VM disappears you rebuild it in 20 minutes with the steps below.

Alternatives if Oracle refuses you: a small VPS (Hetzner CX22 is about 4 euro a
month), a Raspberry Pi at home, or simply keeping the bot on your PC.

**Recommendation:** try Oracle with the AMD micro (or A1 if capacity exists),
upgrade to Pay As You Go, set the budget alert, use the files in `deploy/`, and
keep the desktop shortcut as your backup way to run the bot. Never run both at
the same time (two copies with one bot token answer every command twice).

## Steps

### 0. Before you start (on your PC)

- Push the project to a **private** GitHub repository (the server clones it).
  `.env.local`, `companion/companion.config.json` and `backups/` are ignored by git;
  they never go to GitHub.
- Write down: your Discord bot token, `DATABASE_URL`, `DISCORD_GUILD_ID`,
  `DISCORD_CLIENT_ID`, `COMPANION_UPLOAD_TOKEN`, and the optional `WCL_*` values.
  They are all in your `.env.local`.

### 1. Create the server

1. Sign up at cloud.oracle.com, choose the **US East (Ashburn)** home region.
2. Create an instance: image **Ubuntu 22.04 (or 24.04)**, shape either
   `VM.Standard.A1.Flex` (2 OCPU, 12 GB is plenty) or `VM.Standard.E2.1.Micro`.
   Add your SSH public key. Note the public IP.
3. In the instance's subnet **Security List**, add ingress rules for TCP **80**
   and **443** (source 0.0.0.0/0). Do **not** open 8787: Caddy talks to it locally.
4. Optional but recommended: upgrade to Pay As You Go, and create a budget
   alert of $1 (Billing, Budgets).

### 2. A free hostname (for HTTPS)

Make a free name at duckdns.org pointing at the server's public IP (for example
`qcgold.duckdns.org`). HTTPS matters: the upload carries your token.

### 3. Install

SSH in (`ssh ubuntu@<ip>`) and run:

```bash
git clone https://github.com/<you>/<repo>.git guilded
cd guilded
sudo bash deploy/setup-server.sh qcgold.duckdns.org
```

The script installs Node 22, Caddy, creates a `guilded` user, installs the
systemd service and the Caddy config, opens ports 80/443 in the Ubuntu firewall,
and adds 1 GB swap on small machines. It stops and tells you what to do next:

```bash
sudo nano /opt/guilded/.env.local     # paste your secrets (see .env.example)
sudo systemctl start guilded
sudo journalctl -u guilded -f         # watch it start
```

Set in `.env.local`: `COMPANION_API_HOST=127.0.0.1` (Caddy is the only thing
allowed to reach it) and the same `COMPANION_UPLOAD_TOKEN` as on your PC.

### 4. Switch over

1. **Close the bot on your PC** (and remove `start-bot.bat`'s companion line
   if you like; the companion stays on your PC).
2. Start the cloud bot; in Discord run `/report ping`.
3. On your PC edit `companion/companion.config.json`:
   `"uploadUrl": "https://qcgold.duckdns.org/api/v1/addon-imports"`.
   (`start-companion.bat` now only starts the companion; the bot is no longer
   started locally.) Restart the companion: it should print `Uploaded ...` and
   `Wrote EPGP standings ...`.
4. `https://qcgold.duckdns.org/health` should answer `{"ok":true}` in a browser.
   Add that URL to a free uptime monitor (UptimeRobot) to get an email if the
   bot is down.

### 5. Updates

Push your changes to GitHub from your PC, then on the server, inside the clone you installed from:

```bash
cd ~/guilded && sudo bash deploy/update.sh
```

It pulls the new code (with your own git login, so a private repository works), copies it to
`/opt/guilded`, runs `npm ci` only when the dependencies changed, restarts the bot and waits until
`/health` answers. If the new version does not start, it prints the last log lines and the command to
go back to the previous version. About 15 seconds of downtime.

The service runs `npm run db:update` before starting, so database changes apply
themselves. Logs: `journalctl -u guilded -n 100`. Only the bot lives on the server: the addon (CurseForge)
and the companion (officers' PCs) are updated where they run.

## Security notes

- The API only answers `/health` without a token; every other path needs the
  bearer token, compared in constant time.
- Ten wrong tokens from one address in ten minutes locks that address out.
- Keep `COMPANION_UPLOAD_TOKEN` at 32+ random characters and never commit it.
- Keep the Discord bot token only in `.env.local` on the one machine running the bot.
- `sudo apt install unattended-upgrades` keeps the server patched.
