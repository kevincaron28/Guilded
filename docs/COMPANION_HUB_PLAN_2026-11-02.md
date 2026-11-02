# Companion hub: plan and status (2 November 2026)

Goal: members and officers do from the Windows companion what they do on the website and in
Discord, with one place and one status line. The app calls the **same server-side logic**; it
never decides permissions itself. No version bump, no publication (Store/GitHub are separate gates).

## 1. Audit: what already existed

Authenticated companion endpoints (`src/companion-api.ts`). All but sign-in take the member's
personal credential; the bot re-checks the Discord role on every call (`companionAccess`,
`force: true` fetch), so a demoted member loses officer rights at once.

| Endpoint | Who | Purpose |
| --- | --- | --- |
| `POST /api/v1/companion/sign-in`, `/poll`, `/logout`, `POST /addon-pairings` | anyone | connect / disconnect |
| `POST /api/v1/addon-imports`, `GET /api/v1/standings` | member (own characters) / officer (guild) | sync |
| `GET/POST /api/v1/manage` | member: own wishlists. Raid Leader+: core prices, rules, rosters, pricing preset | `src/services/companion-manage.ts` |
| `GET/POST /api/v1/poe/*`, `/public-runs`, `/companion/personal-status` | member / personal account | PoE2, public dungeon runs |
| **`GET/POST /api/v1/hub` (new)** | member: read. Officer: server switches | `src/services/companion-hub.ts` |

Permission model: scope is one guild per credential (`CompanionCredential.member.guild`); a
request cannot name another guild. Levels: member, `raidLeader` (core edits), `officer`
(server settings, setup checklist). Editions: a guild has one `gameEdition`; characters carry
their own, and cores/prices are per guild.

Website `/me/` (web-app.ts) and Discord: `/raid`, `/core` (rosters, rules, reserves-per-player),
`/loot reserves`, `/wishlist`, `/setup` (checklist and one-click creation), `/config`
(achievements, language, welcome). Reuse found:

* Raid and core editing (items b-c of the wishes) **already existed** in `/api/v1/manage` and the
  renderer pages "Raid prices" / "Roster & loot settings", with permission tests.
* The setup checklist is `setupChecks()` over `gatherFacts()` (now exported from
  `src/commands/setup.ts`, no behaviour change).
* Toggles mirror `/config achievements`, `/setup` (language, reminders, weekly report,
  auto-apply) and `/mod leaderboard`.

## 2. Soft reserves: the finding that shaped scope

The reserve list lives in the **game addon** (`/guilded reserve`) and each officer upload
replaces it wholesale (`applyReserves` in `src/services/reserves.ts`: newest export wins,
`deleteMany` then `createMany`). A reserve written by the app to the database would be erased
by the next upload, and the addon would never see it. So member reserve **writing is not
safe before 4 November** and is deliberately not built. The app shows the list, the member's
own reserves, the per-core rules (loot mode, reserves per player) and says where to reserve.
The post-launch design is a `ReserveRequest` table that the officer's standings feed hands to
the addon (needs a Lua change and real-client testing), with limits/deadline checked on the server.

## 3. Navigation

Home (one status line: connected, last refresh, next step) · **My characters** (guild and
core per character) · **Reserves** · Sync & setup · Leaderboards · World of Warcraft · More
tools (PoE2, Wishlist, Raid prices, Roster & loot settings) · **Server** (officers only; the
button stays hidden for members) · Activity · Help.

## 4. Delivery

1. Done in this branch: `/api/v1/hub`, My characters (read-only, across the member's servers,
   this server first), Reserves (read-only), Server page (checklist + switches), Home status
   line, offline cache of the last answer (`hub-cache.json` in the app data folder, removed
   by "Remove all data"), EN/FR strings, permission tests (`tests/companion-hub.test.ts`).
2. Server switches (officer only, audited as `CONFIG_UPDATED via companion`): language,
   achievement announcements (needs the channel chosen in Discord; baselines earned
   achievements first), reminders, weekly report, auto-apply, public sharing **off**.
   Public sharing **on** is not offered: it needs the Discord consent screen.
3. Not built, after launch: one-click creation of channels/roles from the app (the logic is
   private to `setup.ts` and creates things on Discord; it should be extracted and tested on
   its own), welcome-flow edits, member reserve writes (section 2), creating or deleting a
   core (stays `/core`).
