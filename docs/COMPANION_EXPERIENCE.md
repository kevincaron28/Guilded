# Guilded companion: the Windows app

The companion is one branded interface for the Windows app. It is **Windows only**:
there is no Mac, Linux or browser version (the online companion was removed in
November 2026; its old `/companion/` addresses now lead to the download page).

It is optional if you only use the addon, which works in game on its own. It is
needed to share data with Discord and the website (achievements, leaderboards,
standings synced with your guild).

## Install

1. **Microsoft Store (recommended):** <https://apps.microsoft.com/detail/9N680XX3QFL9>.
   Store-signed, updates itself.
2. **Direct download (fallback):** the Windows installer on the latest
   [GitHub release](https://github.com/kevincaron28/Guilded/releases/latest). It is
   unsigned, so Windows may warn before running it.

## What it does

Overview shows actual sync state, never sample statistics. WoW has saved-data
and standings actions. PoE2 has the declared profile, upload queue and the
member's 15 most recent server observations. Activity supports search and
severity filters. Light/dark appearance is saved locally. Support summaries
exclude credentials, account IDs, paths and raw logs. Desktop tracking can be
paused and resumed without deleting settings.

| Capability | Windows companion |
| --- | --- |
| WoW character/profession/readiness sync | Watches Guilded.lua after /reload |
| WoW standings | Writes Standings.lua automatically |
| PoE2 observations | Watches new Client.txt entries |
| Existing PoE2 history | Skipped when first enabled |
| Background capture | Works in the tray |
| Unsent PoE2 visits | Durable device journal |
| Personal map history | Authenticated server view |

WoW still needs the Guilded addon to produce saved data. Visits are
observations, including portal reentry and possible failed loads; they prove no
clears, deaths, loot, XP or party participation and award no automatic points.

## Sign-in and privacy

Choose **Sign in with Discord** in Connection & setup: your browser opens the
website, you pick your server (or public leaderboards only) and press Connect. The
app listens on 127.0.0.1 and receives a one-time proof, so there is nothing to type.
Older companions can still use the one-time `/character pair` code.

Uploads use the personal credential header; no third-party scripts, broad CORS
policy or global token bypass is added. The bot freshly verifies Discord membership
and officer status, restricts personal WoW uploads to owned characters and always
binds PoE2 records to the authenticated member, including officers. Private API
responses are not cached.

```mermaid
flowchart LR
  W[WoW addon saved data] --> D[Windows companion]
  P[PoE2 client log] --> D
  D -->|Structured data + personal credential| A[Companion API]
  A --> M[Fresh Discord membership check]
  A --> DB[(Guild-scoped data)]
  A -->|Standings| D
```

## Build

`npm run companion:build` copies the shared design tokens and fonts and bundles the
interface helpers (`companion-app/renderer/ui-entry.js` into `ui-bundle.js`, which is
gitignored). `npm run dist --prefix companion-app` builds the per-user Windows
installer; the Microsoft Store package uses `npm run msix:store --prefix companion-app`.
All shared Node parser modules are included in packaged resources.

Never start a live bot to try the interface. Follow `V5_0_RELEASE_HANDOFF.md` and the
current release evidence for deployment gates.
