# Forever-only focus (5 November 2026)

While Guilded concentrates on WoW Forever, other WoW versions and Path of Exile 2 (PoE2) tracking are
hidden from members. **Nothing is deleted**: code, addon builds, database rows, saved uploads, Discord
channels and roles, and already-published downloads all stay. Two small switch files decide everything;
tests prove every surface follows them (`tests/forever-only-focus.test.ts`, `tests/active-editions.test.ts`).

## The switches

| Switch | File | Now | What it controls |
| --- | --- | --- | --- |
| `ACTIVE_EDITIONS` | `companion/active-editions.mjs` | `["forever"]` | Which WoW editions members are offered. |
| `ACTIVE_GAMES` | `companion/active-games.mjs` | `["wow", "poe2"]` | Which games exist as a Discord community: PoE2 event boards, community seasons and lottery choices, the Quebec Gold PoE2 page. |
| `ACTIVE_TRACKING` | `companion/active-games.mjs` | `[]` | PoE2 **tracking**: the companion's Client.txt log tracking and settings, `/poe`, the companion API routes `/api/v1/poe/*`, PoE2 achievements and the journal text. |

## What members no longer see

- **Other WoW editions** (Classic Era/Hardcore, TBC Anniversary, Mists, Retail): `/wow` and `/events` choices,
  the website edition chooser and switcher, edition hub and download pages (not built; the Worker redirects old
  addresses to Forever), web filters, companion folder detection, the owner season commands' edition choices.
- **PoE2 tracking**: `/poe` is not registered with Discord, `/help` and the FAQ stop mentioning it, the companion
  hides the PoE2 page, card and settings and never starts the log watcher, the bot answers old companions with
  "paused" (status says disabled; nothing is stored), PoE2 achievements disappear from the achievements page and cards.
- **Still there**: the PoE2 Discord community (channels, roles, event board reminders, seasons, lottery PoE currency)
  and the Quebec Gold PoE2 page.

## Turning things back on

1. **An edition**: add its id to `ACTIVE_EDITIONS` (e.g. `[...GAME_EDITIONS]`). Run the tests and release.
2. **PoE2 tracking**: set `ACTIVE_TRACKING = ["poe2"]`. The bot registers `/poe` on its next start; the companion
   needs a new release; members re-enable it in Settings (their saved choice was kept).
3. **PoE2 community off** (not requested): remove `"poe2"` from `ACTIVE_GAMES`.

## Discord channels and roles (kept)

The owner asked to keep channels and roles, and nothing here removes any. Channels created by `/setup` for other
editions or PoE2 are listed in `src/setup-names.ts`; if you ever want them gone, delete them by hand in
Discord (Server Settings), or archive them by hiding them from `@everyone`. No command deletes them.

## Releases

- `npm run addon:editions` now builds only the active editions (Forever); `-- --all-editions` builds every
  edition (use it for checks, or after turning editions back on). `addon:verify-editions` checks whatever is in `dist/editions`.
- Publish only the Forever `Guilded` and `GuildedDungeons` zips on CurseForge and GitHub. **Leave every file already
  published for other editions untouched** (do not delete or replace them).
- Bot deploy needed for: the Discord command list (`/poe` removed, choices narrowed), help/FAQ, the website data
  pages, the companion API routes. Website (Cloudflare) deploy: edition and PoE2 page redirects, nav. Companion
  release needed for: the hidden PoE2 UI and the stopped log watcher (the bot side already ignores old companions).
  The addon needs no change.
