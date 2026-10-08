# Guilded

Raid and guild management for **WoW Forever** guilds: an in-game addon, a Discord bot and a small
web companion that connects the two. An optional Windows app adds automatic syncing.
Free for noncommercial use ([license](LICENSE)).

| Part | What it does | Where |
| --- | --- | --- |
| **Addon** | Raids, attendance, EPGP, four loot systems (GP bids, loot council, soft reserves, EPGP priority), recipes and cooldowns, the guild calendar, gear and consumable checks, a live Ready page, roll games, a friendly window (gold coin on the minimap). Works alone, no Discord needed. | `addon/Guilded/` |
| **Discord bot** (optional, self-hosted, free) | Raid signups with roles and waitlist, raid cores with a bench and their own loot system and item prices, weekly raids, EPGP standings, loot log, soft reserves, who can craft what, guild calendar sync, dungeon challenge, craft board, readiness board, polls, Warcraft Logs, applications, moderation helpers. | `src/` |
| **Online companion** (default for Discord sync) | Webpage that remembers your pairing/folders and uploads data and returns standings when you click Sync now. | `companion/`, `companion-app/renderer/` |
| **Windows companion** (optional, useful for leaders/officers) | Tray app that sends the addon's saved data to the bot after each `/reload` or logout and writes standings back into the game. | `companion-app/`, `companion/` |

Every in-game and Discord command, and who can run it, is in [COMMANDS.md](COMMANDS.md).
What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## Quick start

- **Guildmates or addon-only players:** follow [the member install guide](docs/MEMBER_INSTALL.md).
  Install into the client you actually play (Forever beta uses `_classic_beta_` in the tested
  installation), then connect with your guild's bot address and your own pairing code if needed.
- **Run your own guild's bot:** follow [the illustrated beginner walkthrough](docs/OWNER_WALKTHROUGH.md), with Discord and Oracle account links, screenshots and success checks.
- **Plan a quick installation:** use the [30-minute setup checklist](docs/QUICK_START.md), including what must be ready first.
- **Want an AI to guide you:** copy a [setup or troubleshooting prompt](docs/AI_SETUP_HELP.md).

**6.0.0 is the full Release. The next planned version is 6.1.0.** Use matching addon and bot source, plus the optional Windows companion if needed, from the
[6.0.0 release](https://github.com/kevincaron28/Guilded/releases/tag/v6.0.0). Remaining unverified checks are tracked as follow-up work. [Current test record](docs/V6_0_RELEASE_TESTING.md).

For the 5.0 update, read [the local Claude handoff](docs/V5_0_RELEASE_HANDOFF.md).

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
| [docs/DEPLOY_ORACLE.md](docs/DEPLOY_ORACLE.md) | Running the bot 24/7 in the cloud (free) |
| [docs/RELEASE_CURSEFORGE.md](docs/RELEASE_CURSEFORGE.md), [docs/CURSEFORGE_COPYPASTE.md](docs/CURSEFORGE_COPYPASTE.md) | Publishing the addon |
| [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | What is done and left before a release |
| [ROADMAP.md](ROADMAP.md) | Where the project stands and what could come next |
| [SECURITY.md](SECURITY.md) | Reporting a problem, what the bot stores |
| [docs/archive/](docs/archive/) | Old development notes, the full idea backlog and reviews |

## Requirements (bot)

- Node.js 24 (tested release/build baseline) and its included npm
- PostgreSQL 16+ (a free [Neon](https://neon.tech) database works well)
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

## License

[PolyForm Noncommercial 1.0.0](LICENSE): free to use, study and modify for noncommercial purposes;
no commercial use or resale. Not affiliated with or endorsed by Blizzard Entertainment.
