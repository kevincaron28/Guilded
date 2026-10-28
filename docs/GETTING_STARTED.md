# Get started with Guilded

Guilded connects a WoW Forever addon, your guild's Discord bot, and a companion
that transfers saved game data. The addon also works without Discord.

Start with the [quick setup checklist](QUICK_START.md).
Use matching downloads from an actually
published release or the test build your officer provides. Current release
status and 8.0 preparation are recorded in [launch readiness](V8_0_LAUNCH_READINESS.md).
For automatic Windows syncing, use [Guilded Companion on Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9)
or the [standalone installer](https://github.com/kevincaron28/Guilded/releases/latest).
Store installations update through Microsoft Store; each channel may publish at a different time.

| What you want to do | Start here |
| --- | --- |
| Join a guild already using Guilded | [Member installation](MEMBER_INSTALL.md) — addon first, optional one-line character linking or companion, and quick fixes |
| Use only the in-game addon | [Install the addon](MEMBER_INSTALL.md#1-install-the-addon), then stop; no bot or companion required |
| Add the hosted bot to your guild | [Add the free hosted bot](HOSTED_PILOT.md) — Guilded Lite right away, KCaron's approval unlocks the rest; no personal server or database needed |
| Run a bot for your own guild | [Guild owner setup](GUILD_OWNER_SETUP.md) — application, hosting, database, Discord wizard and member rollout |
| Ask an AI to walk you through setup or a problem | [Copyable AI help prompts](AI_SETUP_HELP.md), including French |
| Update an existing installation | [Release handoff](V5_0_RELEASE_HANDOFF.md) — CI, backups, migration and client updates |

Members start with the addon download. The default is **In-game only**; Discord
character linking and companion sync are optional. To link without a companion,
`/character pair` (or the welcome character button) shows one line,
`/guilded verify ABCD-EFGH`, to paste in WoW chat once: every character on that
WoW account then links on the next upload from an officer's companion, and the
member gets a DM. So at least one officer should run the companion. The manual
`/guilded character` → `/character import` way still works for one character.
The companion connects with **Sign in with Discord**: nothing to type.
Members do not need the host's bot token or database credentials. Only a guild
with its own bot needs its address, entered in the companion under **Older
companions or your guild's own bot**.

## What a working connection looks like

1. Guilded opens in your actual WoW client: the folder beside the game executable you launch.
   The beta used `_classic_beta_`; check the live folder from 4 November rather than assuming its name.
2. `/reload` or logout saves addon data. Click Sync now on the webpage; the optional Windows app detects changes automatically.
3. A successful upload appears in Activity and your character is linked to your
   Discord account. Zero new characters or ledger entries can be normal.
4. The companion downloads standings. Another `/reload` loads those into the addon.

Open professions normally to collect recipes automatically. Personal uploads
apply automatically; an officer's guild data may require `/import apply` if
automatic import is disabled. Start with the online companion. The optional Windows
app provides background syncing, especially useful for leaders and officers.

The [command reference](../COMMANDS.md), [addon README](../addon/Guilded/README.md)
and [release checklist](../RELEASE_CHECKLIST.md) cover the next steps after setup.
