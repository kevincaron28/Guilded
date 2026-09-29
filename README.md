# Guilded

Raid and guild management for **WoW Forever** guilds: an in-game addon, a Discord bot and a small
Windows companion app that connect the two. Free for noncommercial use ([license](LICENSE)).

| Part | What it does | Where |
| --- | --- | --- |
| **Addon** | Raids, attendance, EPGP, four loot systems (GP bids, loot council, soft reserves, EPGP priority), recipes and cooldowns, the guild calendar, gear and consumable checks, a live Ready page, roll games, a friendly window (gold coin on the minimap). Works alone, no Discord needed. | `addon/Guilded/` |
| **Discord bot** (optional, self-hosted, free) | Raid signups with roles and waitlist, raid cores with a bench and their own loot system and item prices, weekly raids, EPGP standings, loot log, soft reserves, who can craft what, guild calendar sync, dungeon challenge, craft board, readiness board, polls, Warcraft Logs, applications, moderation helpers. | `src/` |
| **Companion app** (optional) | Tray app that sends the addon's saved data to the bot after each `/reload` or logout and writes standings back into the game. | `companion-app/`, `companion/` |

Every in-game and Discord command, and who can run it, is in [COMMANDS.md](COMMANDS.md).
What changed in each version: [CHANGELOG.md](CHANGELOG.md).

## Quick start

- **Just the addon:** download from [CurseForge](https://www.curseforge.com/wow/addons/guilded), unzip
  `Guilded-v<version>.zip` into `World of Warcraft\_forever_\Interface\AddOns\` (a folder named `Guilded`),
  restart the game, type `/guilded` or click the gold coin.
- **The whole system (bot, addon, companion):** follow [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

For the 5.0 update, read [the local Claude handoff](docs/V5_0_RELEASE_HANDOFF.md).

## Documentation

| Document | For |
| --- | --- |
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | Officers setting up the bot for a guild |
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

- Node.js 22+ and npm 10+
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
| `npm test` | Run the tests (bot and addon, 778+) |
| `npm run build` | Type-check |
| `npm run lint` | ESLint |
| `npm run db:update` | Apply migrations and regenerate the Prisma client |
| `npm run addon:zip` | Build `dist/Guilded-v<version>.zip` for release |
| `npm run companion:app` | Start the companion tray app |

Addon check before a release: `node addon/Guilded/validate-addon.mjs`.

## How the parts fit

```text
WoW addon --(saved file on logout or /reload)--> companion --(HTTP, local)--> bot --> Discord + database
                                                    ^                          |
                                                    +---- standings file <-----+
```

- The game only writes the addon's data file on `/reload` or logout, so a reload (or logging out) is what
  sends new data. Nothing reloads the game on its own unless a player opts in with `/guilded sync auto on`.
- Uploads wait as a preview until an officer runs `/import apply`, unless `/setup config auto-import` is on.
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
