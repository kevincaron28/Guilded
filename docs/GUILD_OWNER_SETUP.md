# Guilded: set up your own guild

One owner hosts the Discord bot and database; members install the addon and,
for automatic sync, the Windows companion. Guilded 6.0 is being prepared: use a
published release's matching downloads and source, and read its known limitations.
Fresh-guild and non-developer-PC acceptance tests are still pending for 6.0.

Already running Guilded? Follow the backup and update gates in
[V5_0_RELEASE_HANDOFF.md](V5_0_RELEASE_HANDOFF.md). This guide is for a new guild.

## Before you begin

You need permission to manage your Discord server, your own Discord application,
a PostgreSQL database, and one machine to keep the bot running. Members on other
PCs need a reachable HTTPS bot address. The packaged addon/companion do not include
hosting or a shared public bot service.

Record these non-secret details as you go:

| Detail | Your value |
| --- | --- |
| Release version and source commit | |
| Discord application ID | |
| Discord server ID | |
| Bot host / service owner | |
| Companion bot address (`https://your-host/api/v1/addon-imports`) | |
| Online companion (`https://your-host/companion/`) | |
| Addon and Windows companion download links | |
| Officer responsible for support / backups | |

Keep the Discord bot token and database connection string in `.env.local` on the
bot host. Members use their own pairing codes; they never need those host secrets.

## 1. Create and invite your Discord application

1. In the [Discord Developer Portal](https://discord.com/developers/applications),
   create your application. Record its application ID and obtain its bot token.
2. Under **Bot → Privileged Gateway Intents**, enable **Server Members Intent**.
   Guilded requires it. **Message Content Intent** is optional for the answer
   channel and can stay off during initial setup.
3. Configure **Guild Install** with scopes `bot` and `applications.commands`,
   then open the generated installation link and select your server.
   See [Discord's installation guide](https://github.com/discord/discord-api-docs/blob/main/developers/quick-start/getting-started.mdx).
4. Grant View Channels, Send Messages, Send Messages in Threads, Create Public
   Threads, Manage Threads, Embed Links, Attach Files, Read Message History,
   Manage Channels, Manage Roles and Create Events. Grant Manage Messages for
   message/pin maintenance and moderation; Connect for events in voice channels.
   Enable additional moderation permissions only for the actions you will use.
5. Place the bot's role above every role it needs to assign or manage, including
   member, applicant and game roles. Check channel-specific permission overrides.
6. Enable Discord **Settings → Advanced → Developer Mode**, then right-click your
   server and **Copy Server ID**.

**Checkpoint:** the correct bot appears in your server. It stays offline until
its service starts. Guilded uses a gateway connection; its setup does not require
an Interactions Endpoint URL or a user-account token.

## 2. Prepare the bot host

Use **Node.js 24 LTS**, the release build/CI baseline, from
[Node.js downloads](https://nodejs.org/en/download). Use PostgreSQL 16 or later;
the database must be reachable by the host. You may use an existing PostgreSQL
service or a provider such as Neon; check your provider's current limits and costs.

Get the source for your selected release from
[GitHub](https://github.com/kevincaron28/Guilded). Keep the source commit with your
installation record. Create `.env.local` from `.env.example` and fill these fields
locally; do not paste secrets into chat or an issue:

| Setting | Meaning |
| --- | --- |
| `DISCORD_TOKEN` | This application's bot token |
| `DISCORD_CLIENT_ID` | Its application ID |
| `DISCORD_GUILD_ID` | Your Discord server ID |
| `DATABASE_URL` | Your database connection string, including provider-required SSL options |
| `COMPANION_API_HOST` | Keep `127.0.0.1` when using the supplied reverse proxy |
| `COMPANION_API_PORT` | Keep `8787` unless you also adjust the proxy |
| `MESSAGE_CONTENT_INTENT` | Leave `false` for initial setup |

For a new source installation, `npm ci` installs the locked dependencies,
`npm run companion:build` builds the online companion, and `npm run db:update`
applies migrations and generates the database client. Existing databases need a
verified backup and ledger preflight before an update. Never reset a database to
get past a migration error.

### Hosting for the whole guild

The included Ubuntu/systemd/Caddy deployment is described in
[DEPLOY_ORACLE.md](DEPLOY_ORACLE.md). Use **your own** hostname, server, SSH access
and database. The setup script installs Node 24 when Node is missing or older;
older 5.0 source bundles may still default to Node 22. It writes `/etc/caddy/Caddyfile`, so use
a dedicated host or have the host administrator integrate the configuration.

Point your hostname to the server and allow HTTPS through its cloud and OS
firewalls. Caddy proxies the local API; members should not connect to port 8787
directly. The host's service is the single bot process. Stop any prior instance
before moving that bot token to another host.

**Do not run the repository's `redeploy-oracle.bat` unmodified for another guild:**
it targets the maintainer's existing server. Use the server-side update procedure
on your own host, after the release checks and backup gates.

**Checkpoint:** `https://your-host/health` returns `ok: true` with the intended
version/protocol, and `/report ping` responds in your Discord server. The online
companion opens at `https://your-host/companion/`. A working Discord bot alone
does not prove the HTTPS companion endpoint works from members' PCs.

## 3. Configure Discord with the wizard

As a server administrator, run **`/setup start`**. Select English or Français.
For each channel, select one you already have or use **Create the missing ones
for me**. Set member/leadership roles and the desired onboarding/rules options.
Use **Update bot messages**, then `/setup start status:true` to review anything
missing. Optional features can remain disabled.

Run **`/core setup`** for each raid roster. Select the loot method and decide
whether points use the guild pool or a separate core pool. Give a priority core
item prices before testing an award. `/core edit` changes the roster and rules.

Choose whether officers review uploads with `/import apply`, or enable automatic
guild import with `/setup config auto-import`. Personal member uploads remain
restricted to their own characters; do not give everyone officer access for sync.

**Checkpoint:** test with an ordinary member account: it sees the intended public
roster/signup channels and cannot see officer-only channels or use officer actions.

## 4. Connect one officer and one member

Follow [the member install guide](MEMBER_INSTALL.md) on both PCs. Give each person
your bot address and server ID; each obtains their own `/character pair` code.
New desktop installs ask for **Your guild's bot address** beside the pairing
fields. Older 5.0 builds have a prefilled Quebec Gold address: replace it in
**Advanced preferences** before pairing with a different guild's bot. Upgrades
preserve saved addresses and pairing credentials.

Confirm all of these before inviting the whole guild:

- The officer and member both upload successfully after `/reload` and see their
  own linked character. Only the officer can upload guild ledger changes.
- Fresh standings return through the companion and appear after another reload.
- A test raid signup uses the intended character/core, and its member can see it.
- Recipes appear after opening a crafting profession and syncing; members do not
  have to run a recipe command to enable collection.
- The companion recovers when the bot becomes reachable again after a planned
  interruption, without duplicating imported entries.

Use a test server/core and test data for award and permission experiments. Do not
alter live balances just to test the install. Keep meaningful backup/restore and
real-raid checks in your release record.

## 5. Give members one pinned message

Fill every placeholder before posting this in your own server:

```text
Install Guilded for our guild
Addon: <release download link>
Windows companion: <matching installer download link>
Setup guide: <link to MEMBER_INSTALL.md for this release>
Our Discord server ID: <copy exact ID>
Our bot address: <https://our-host/api/v1/addon-imports>
Online companion (manual sync): <https://our-host/companion/>
Install the addon in your actual WoW client, log in, then /reload.
In Companion setup, set our bot address before connecting.
Use /character pair here in Discord to get your own private code.
Need help? Contact <officer>; share the error or support summary, never your code.
```

## If a checkpoint fails

| Failure | Owner's next check |
| --- | --- |
| Bot offline / disallowed intents | Correct application's Server Members Intent, valid bot token, and service log. Message Content must be enabled in the portal before enabling it in the environment. |
| Slash commands missing | Application/server IDs, Guild Install scopes, bot membership, command registration logs and Discord integration permissions. |
| Bot cannot create channels or assign roles | Relevant permission and channel override, plus role hierarchy; retry the wizard after fixing access. |
| Ping works but companions cannot connect | Public HTTPS health URL from another PC, DNS, proxy paths, firewall and certificate. |
| Pairing or upload uses the wrong guild | Companion address and server ID, then a fresh code from the correct server. |
| Migration fails | Preserve the error and database; stop the update and inspect migration status. Follow the release handoff, never `migrate reset`. |
| Two replies to each command | Locate and stop the duplicate bot process using that token. |
| Everyone still reports the old version | Compare deployed commit and installed artifacts; rebuilding a ZIP does not install it on PCs. |

For guided help, copy an [AI setup prompt](AI_SETUP_HELP.md) and attach this guide
and the release README. Optional in-server AI answers are a separate feature;
they are not required to install Guilded.
