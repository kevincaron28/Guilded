# Guilded

Raid and guild management for **WoW Forever** guilds: an in-game addon, a Discord bot and a small
web companion that connects the two. An optional Windows app adds automatic syncing.
Free for noncommercial use ([license](LICENSE)).

| Part | What it does | Where |
| --- | --- | --- |
| **Addon** | Raids, attendance, EPGP, four loot systems (GP bids, loot council, soft reserves, EPGP priority), recipes and cooldowns, the guild calendar, gear and consumable checks, a live Ready page, roll games, a friendly window (gold coin on the minimap). Works alone, no Discord needed. | `addon/Guilded/` |
| **Discord bot** (optional, approval-required hosted pilot or independent hosting) | Raid signups with roles and waitlist, raid cores with a bench and their own loot system and item prices, weekly raids, EPGP standings, loot log, soft reserves, who can craft what, guild calendar sync, dungeon challenge, craft board, readiness board, polls, Warcraft Logs, applications, moderation helpers. | `src/` |
| **Online companion** (default for Discord sync) | Webpage that remembers your pairing/folders and uploads data and returns standings when you click Sync now. | `companion/`, `companion-app/renderer/` |
| **Windows companion** (optional, useful for leaders/officers) | Tray app that sends the addon's saved data to the bot after each `/reload` or logout and writes standings back into the game. | `companion-app/`, `companion/` |

Every in-game and Discord command, and who can run it, is in [COMMANDS.md](COMMANDS.md).
What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## Quick start

- **Guildmates or addon-only players:** follow [the member install guide](docs/MEMBER_INSTALL.md).
  Install into the client you actually play: the folder beside the game's .exe (the beta used
  `_classic_beta_`; check again on 4 November). To connect the companion, choose Sign in with Discord
  (a `/character pair` code still works).
- **Add the hosted bot:** [add it to your server](docs/HOSTED_PILOT.md) and run `/setup start`; no hosting or database account needed. Guilded Lite (setup, help, bug reports, dungeon groups, basic signups) works right away; KCaron's approval unlocks addon sync, EP/GP, seasons and the guild page. Optional [support](docs/SUPPORT_GUILDED.md) never buys approval.
- **Run your own guild's bot:** follow [the illustrated beginner walkthrough](docs/OWNER_WALKTHROUGH.md), with Discord and Oracle account links, screenshots and success checks.
- **Plan a quick installation:** use the [30-minute setup checklist](docs/QUICK_START.md), including what must be ready first.
- **Optional Windows companion:** install [Guilded Companion from Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9), or use the standalone installer from [GitHub Releases](https://github.com/kevincaron28/Guilded/releases/latest). Store installations update through Microsoft Store. Check the version offered by each channel.
- **Want an AI to guide you:** copy a [setup or troubleshooting prompt](docs/AI_SETUP_HELP.md).

**Current version: 8.0.0 Release** (28 October 2026, protocol 2). [Release notes](docs/V8_0_0_RELEASE_NOTES.md). Publication status: [launch readiness](docs/V8_0_LAUNCH_READINESS.md).
Supports Forever, Classic Era/Hardcore, TBC Anniversary, Mists Classic and Retail
across the addon, Discord bot and companion, including several guilds in one Discord.
Use the edition-specific ZIP from [GitHub Releases](https://github.com/kevincaron28/Guilded/releases/latest).
The unsuffixed ZIP is the Forever build. [Release notes](docs/V7_5_0_RELEASE_NOTES.md).

The owner authorized release before the unavailable Forever two-PC tests.
[Game checks remain pending follow-up](docs/V7_5_0_GAME_CHECKLIST.md); benchmarks are provisional.
[Release decision](docs/RELEASE_DECISION_2026-10-25.md). WoW Forever launches 4 November 2026.

Also from this repository: **Guilded Dungeons** (`addon/GuildedDungeons/`), a standalone dungeon
timer and score tracker with no guild needed, and the website's
[public leaderboards](https://guilded.kcaron.top/leaderboards/), [player profiles](https://guilded.kcaron.top/players/)
and [recruitment board](https://guilded.kcaron.top/recruitment/).

## Documentation

| Document | For |
| --- | --- |
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | Choose the right setup path |
| [docs/MEMBER_INSTALL.md](docs/MEMBER_INSTALL.md) | Guildmates installing and connecting; includes French quick start |
| [docs/GUILD_OWNER_SETUP.md](docs/GUILD_OWNER_SETUP.md) | Owners hosting an independent bot for their guild |
| [docs/OWNER_WALKTHROUGH.md](docs/OWNER_WALKTHROUGH.md) | First-time owners: illustrated account-to-first-sync walkthrough |
| [site/README.md](site/README.md) | Build, preview and publish the download/setup website |
| [docs/ONLINE_COMPANION_CHECK.md](docs/ONLINE_COMPANION_CHECK.md) | Live companion findings and remaining sync acceptance |
| [docs/AI_SETUP_HELP.md](docs/AI_SETUP_HELP.md) | Copyable prompts for guided installation and troubleshooting |
| [COMMANDS.md](COMMANDS.md) | Every command and its permissions |
| [addon/Guilded/README.md](addon/Guilded/README.md) | The addon in detail |
| [companion/README.md](companion/README.md) | The command-line companion and the upload format |
| [docs/DEPLOY_ORACLE.md](docs/DEPLOY_ORACLE.md) | Running your own bot in the cloud (provider costs vary) |
| [docs/RELEASE_CURSEFORGE.md](docs/RELEASE_CURSEFORGE.md), [docs/CURSEFORGE_COPYPASTE.md](docs/CURSEFORGE_COPYPASTE.md) | Publishing the addon |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | What is done and left before a release |
| [ROADMAP.md](ROADMAP.md) | Where the project stands and what could come next |
| [SECURITY.md](SECURITY.md) | Reporting a problem, what the bot stores |
| [docs/archive/](docs/archive/) | Old development notes, the full idea backlog and reviews |

## Requirements (bot)

- Node.js 24 (tested release/build baseline) and its included npm
- PostgreSQL 16+ (check provider limits against an always-running bot; the hosted pilot uses Aiven Free)
- A Discord application with a bot token and the `applications.commands` scope
- **Server Members Intent** turned on for the bot (Developer Portal, Bot, Privileged Gateway Intents)
- The bot's own role must sit above your applicant and member roles, or role assignment silently fails

## Setup (development)

```powershell
npm install
Copy-Item .env.example .env.local      # then fill in the values
npm run prisma:generate
npm run db:update                      # applies the database migrations
npm run dev
```

`.env.local` needs `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DATABASE_URL`. Companions authenticate using `/character pair`. `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` are optional (they turn on `/raid wcl`).
On Windows, `start-bot.bat` does the database update, starts the companion app and restarts the bot if it
crashes. Never commit `.env*` or `companion/companion.config.json` (both are already gitignored).

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the bot with tsx |
| `npm test` | Run the bot and addon tests |
| `npm run setup:check` | Check owner configuration offline without starting the bot |
| `npm run build` | Type-check |
| `npm run lint` | ESLint |
| `npm run db:update` | Apply migrations and regenerate the Prisma client |
| `npm run addon:zip` | Build `dist/Guilded-v<version>.zip` for release |
| `npm run companion:app` | Start the companion tray app |

Addon check before a release: `node addon/Guilded/validate-addon.mjs`.

## How the parts fit

```text
WoW addon --(saved file on logout or /reload)--> companion --(HTTPS)--> bot --> Discord + database
                                                    ^                          |
                                                    +---- standings file <-----+
```

- The game only writes the addon's data file on `/reload` or logout, so a reload (or logging out) is what
  sends new data. Nothing reloads the game on its own unless a player opts in with `/guilded sync auto on`.
- Uploads wait as a preview until an officer runs `/import apply`, unless `/config auto-import` is on.
- The API defaults to `127.0.0.1`; use HTTPS behind a reverse proxy remotely. Uploads and standings require a guild-scoped personal pairing credential.
- Each WoW guild keeps its own saved data in the addon; a realm rename keeps the data.

## Project layout

```text
addon/Guilded/     the WoW addon (Lua), validated by validate-addon.mjs
src/               the Discord bot (TypeScript): commands/, services/, integrations/
prisma/            database schema and migrations
companion/         the upload engine and the command-line watcher
companion-app/     the Electron tray app around the engine
tests/             bot tests and addon tests (the real Lua runs against a mocked game)
deploy/, docs/     server files and documentation
```

## Support Guilded

Guilded is free. If it helps your guild, a coffee helps pay for the hosted bot, the database
and new features: [ko-fi.com/wowguilded](https://ko-fi.com/wowguilded). Nothing is behind a payment.

## License

[PolyForm Noncommercial 1.0.0](LICENSE): free to use, study and modify for noncommercial purposes;
no commercial use or resale. Not affiliated with or endorsed by Blizzard Entertainment.
