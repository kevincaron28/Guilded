# Get started with Guilded

Guilded connects a WoW Forever addon, your guild's Discord bot, and a companion
that transfers saved game data. The addon also works without Discord.

**6.0.0 is the full Release.** Start with the [quick setup checklist](QUICK_START.md).
Use matching downloads from an actually
published release or the test build your officer provides. Current release
evidence is recorded in [V6_0_RELEASE_TESTING.md](V6_0_RELEASE_TESTING.md).

| What you want to do | Start here |
| --- | --- |
| Join a guild already using Guilded | [Member installation](MEMBER_INSTALL.md) — addon, Windows companion, personal pairing and quick fixes |
| Use only the in-game addon | [Install the addon](MEMBER_INSTALL.md#1-install-the-addon), then stop; no bot or companion required |
| Run a bot for your own guild | [Guild owner setup](GUILD_OWNER_SETUP.md) — application, hosting, database, Discord wizard and member rollout |
| Ask an AI to walk you through setup or a problem | [Copyable AI help prompts](AI_SETUP_HELP.md), including French |
| Update an existing installation | [Release handoff](V5_0_RELEASE_HANDOFF.md) — CI, backups, migration and client updates |

Members need their guild's addon/companion download links, Discord server ID and
bot address. They do not need the host's bot token or database credentials.
Enter **Your guild's bot address** in Connection & setup before pairing. Older
5.0 desktop builds put **Bot address** under **Advanced preferences** and may
prefill Quebec Gold's address; use the address your own guild owner supplied.

## What a working connection looks like

1. Guilded opens in your actual WoW client. Forever beta uses `_classic_beta_`
   in the tested installation; verify the folder rather than assuming its name.
2. `/reload` or logout saves addon data. The desktop companion notices the saved file.
3. A successful upload appears in Activity and your character is linked to your
   Discord account. Zero new characters or ledger entries can be normal.
4. The companion downloads standings. Another `/reload` loads those into the addon.

Open professions normally to collect recipes automatically. Personal uploads
apply automatically; an officer's guild data may require `/import apply` if
automatic import is disabled. See the member guide for the manual online option.

The [command reference](../COMMANDS.md), [addon README](../addon/Guilded/README.md)
and [release checklist](../RELEASE_CHECKLIST.md) cover the next steps after setup.
