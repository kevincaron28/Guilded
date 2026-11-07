# Raid readiness upgrade

Owner list of 7 November 2026, last item (P3): "readiness check update/upgrade". Status: part 1 built in one PR (this plan travels with it).

## What exists today (audit)

- **Addon → companion → bot.** `Ready.lua` builds a gear digest per character: item level, items, enchants,
  durability, bag consumables, and findings (`NO_FLASK`, `NO_FOOD`, `MISSING_ENCHANTS`, `LOW_DURABILITY`,
  `MISSING_OFFHAND`, `MISSING_<slot>`, `EMPTY_SLOTS_LOW_LEVEL`). Stored as `InspectedCharacterSnapshot` +
  `ReadinessFinding` + `CharacterConsumable` (`addon-import.ts`).
- **Group consumable scan.** `Consumables.lua` reads flask/elixir/food buffs of the raid group; stored as
  `ConsumableCheck` (one row per character, newest scan wins, stale after 3 hours).
- **Attunements.** Self- or officer-reported `CharacterAttunement` rows; only checked when an officer passes
  `/lead readiness-raid attunement:<name>`.
- **Rules** (`readiness.ts`): level 60 required; a gear check is only trusted for 24 hours; READY / PARTIAL /
  NOT_READY / LEVELLING / UNKNOWN.
- **Posts** (`readiness-board.ts`): one text post per server day in `#raid-readiness` / `#preparation-raid`
  (officers and raid leaders), triggered by an upload with gear checks. It lists **every active member**, not
  the raid's signups, in English only, with no off switch.
- **Commands:** `/readiness me`, `/lead readiness-member`, `/lead readiness-raid` (private text, chunked).

**Gaps for raid night:** the post is not about the raid (who signed up), says nothing about role gaps against the
raid's limits, doesn't show who hasn't been seen in game, isn't localized, isn't a card, and arrives whenever
someone happens to upload instead of before the raid.

## Recommendations

### Part 1 — built now: the raid night check

One card per planned raid, posted once to the readiness channel **about four hours before the raid starts**
(hourly check; a raid created later than that gets it on the next tick before the pull).

- **Roles against the raid's limits:** tanks, healers, DPS (and melee/ranged when the raid sets them), with the
  gap called out ("1 healer short").
- **Who signed up and how ready they are:** gear status from the latest check of the signed-up character (the
  24-hour rule still applies), consumable gaps from the check or the fresh group scan, Late flags.
- **Not seen in game:** signed-up characters whose last sighting is older than 3 days (or never).
- **Maybes and waitlist** counted, not listed.
- Card in the recap layout of `score-card.ts` (painted scene, stats strip, three panels) plus a short embed with
  the names, in the server's language (English/French).
- **On by default** (rule 5); officers switch both readiness posts (this card and the daily list) off with
  `/lead readiness-raid posts:false` or `server.readinessPosts` in the companion. Nothing posts before the
  readiness channel exists. Test raids are skipped.
- `/lead readiness-raid` also shows the next raid's card privately.

### Part 2 — later

- **Attunement per raid:** let a raid (or core) name its required attunement, then flag signed-up characters
  without it automatically (today it is a command option only).
- **Resistances:** the addon does not export resistance totals yet. Add them to the gear digest (character
  sheet values), then a per-raid minimum (e.g. fire resistance for Molten Core).
- **Professions/consumable stock:** bag counts already arrive in `CharacterConsumable`; a "has fewer than N
  flasks" rule needs agreed thresholds per raid.
- **Ping the people concerned** (opt-in per member) instead of only telling officers.
- Translate the daily list (`readiness-board.ts`) and turn it into a card too, or retire it once the raid
  night check has been seen working.

## Files (part 1)

- `prisma/migrations/20270109000000_readiness_posts/` — `GuildSettings.readinessPostsEnabled`.
- `src/services/raid-night-check.ts` — data, card, embed and the hourly queue.
- `readiness-board.ts` (off switch), `discord-jobs.ts` (`raidCheck` route), `commands/readiness.ts`,
  `companion-hub.ts`, `main.ts`.

## Still needs a real client

Seeing the card in kevmister28's Discord before a test raid (never in Québec Gold).
