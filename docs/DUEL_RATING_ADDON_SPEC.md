# Duel rating: what the addon must do (spec for `addon/Guilded/Modules/Duels.lua`)

Owner decision, 13 November 2026: duels are scored by a rating ("rating with caution", rule set C of
[DUEL_SCORING_RESEARCH.md](DUEL_SCORING_RESEARCH.md)) from **13 November 2026 00:00 UTC** (the first season runs to 31 December 2026, then calendar months). The bot side is in
`src/services/duel-rating.ts` (constants and pure functions), `duel-rules.ts` (member-facing text) and `duels.ts` (`duelLadder`).
This file is the contract for the addon. The addon is NOT changed by the bot PR; it needs a release as soon as possible. Until members
have that release the game shows the old points and the Discord board says so (`ADDON_SHOWS_RATING = false` in `duel-rules.ts`; set
it to `true` in the release that ships the addon).

## 1. The test vectors come first

`tests/fixtures/duel-rating-vectors.json` holds the rules (`rules`), 11 cases of duels with the expected ratings and per-duel changes, and
the season boundaries (`seasons`). The bot's `tests/duel-rating.test.ts` runs them. The addon's Lua tests (`tests/lua/`) must load the
same file and pass with the stated `tolerance` (0.001). Do not edit the vectors to make the Lua pass: if the two disagree, the
TypeScript is the reference (and the disagreement is a bug to find, usually `^` vs rounding or ordering).

## 2. Constants (copy from `rules` of the vector file, do not retype)

```
start 1000
K by rated duels already played: <10 -> 40, <30 -> 24, else 16
handicapPerLevel 20, handicapMaxLevels 5, maxLevelGap 10
pairWeights { 1, 1, 0.5, 0.5, 0.25, 0.25 }   -- the 7th and later duel of a pair in a window: 0
shrinkGames 10, rankedDuels 1, rankedOpponents 1
startsAt 2026-12-01T00:00:00Z
```

## 3. The rating loop, one season at a time

Input: the COUNTED duels of ONE season (see section 4), each with winner, loser, winner level, loser level (nil when unknown) and the
end time in epoch seconds. Everyone starts at 1000 with 0 rated duels.

1. Sort the duels by end time, then by lower-cased winner name, then by lower-cased loser name (the arrival order must not matter).
2. For each duel, count it for both players as a game (wins/losses/streak), then:
   * `pairKey` = the two names, lower-cased, sorted, joined; the window = the **weekly reset (Tuesday 15:00 UTC)** the duel falls in
     (the addon already has this: `weekStart` in the dungeon code; the bot uses `weekStart` of `dungeon-rules.ts`). `nth` = how many duels
     of this pair in this window came before this one (0 for the first).
   * `weight` = `pairWeights[nth+1]` (Lua 1-based) or 0 past the table. If both levels are known and differ by more than `maxLevelGap`, `weight` = 0.
   * `weight == 0`: nothing moves (the duel still counts in wins/losses/streak and "last duel"). Stop.
   * handicap = `handicapPerLevel * clamp(loserLevel - winnerLevel, -5, 5)`; 0 when either level is nil/0.
   * `expected = 1 / (1 + 10 ^ ((loserRating + handicap - winnerRating) / 400))`.
   * `gain = 1 - expected`; winner `+= K(winnerRated) * weight * gain`; loser `-= K(loserRated) * weight * gain`, where `K(n)` uses the number of
     rated duels the player had BEFORE this duel.
   * both players' `rated += 1`; each adds the other to a set of distinct opponents (rated duels only).
   * shown score = `1000 + (rating - 1000) * rated / (rated + 10)`.
3. Everyone with a counted duel is ranked (`ranked = games >= 1`), sorted by shown score, then wins, then name. There is no placement stage.

Shown to the member: the shown score rounded to a whole number; the change of one duel is the difference of the shown score before and
after, rounded, written `+12` / `-12` (`0` when the duel was not rated). Same text as the bot's per-duel card.

## 4. Seasons and the old points

* The first season runs from `startsAt` (13 November 2026 00:00 UTC) to 31 December 2026 23:59:59 UTC (id `2026-11`); after that a season is a
  calendar month in UTC (`2027-01`, ...). Everyone starts at 1000 each season. Duels that ended before `startsAt` were test data: they are archived
  on the bot and appear nowhere; the addon ignores them too (no "Season 0" screen). Duels are assigned by their end time only.
* The in-game board shows the current season by default; a season selector (or `/guilded duels 2027-01`) may show others.
* Read the start date from a constant (`RATING_START_AT = 1794528000`, 2026-11-13T00:00:00Z) and, when the bot starts to send it, from
  the guild settings (`duelRatingStartsAt`, ISO text); the constant is the fallback. A server may move its own start date (testing).

## 5. Caps and dedupe (unchanged, but make the addon equal to the bot)

* At most **5 counted duels per pair per day** (UTC day) and **25 counted duels per reporter per day** (the bot enforces both when a result
  is imported; the addon only had the first). The addon cannot know the reporter of a result it received by sync, so it applies the 25 per day
  to the player's own reports and relies on the bot's `counted` flag when it is present in synced data.
* **Dedupe window 120 seconds** (the addon used 60): the same winner and loser within 120 s is one duel, whoever reported it.
* Unknown levels: no handicap and no level-gap rule (the duel still rates).
* No points, awards or rewards anywhere; the card and board say so.

## 6. What changes on screen

* `/guilded duels` and the Duels window: rating column (shown score) and rank for everyone, season name, rules since date.
* The end-of-duel card: "+12 → 1039" for the winner and "-12 → 990" for the opponent (change and new rating); no more "+N points".
* `Locale.lua` needs French for every new string (accents as `\195\169` escapes; the validator rejects non-ASCII).
* Older addons keep showing the old points: that is why `ADDON_SHOWS_RATING` stays false until the new addon is released.

## 7. Late reports

Ratings are recomputed from the stored duels of the season in date order. A duel that reaches a client late (a companion was offline) is
placed at its end time, so it can move ratings that were already shown, including older rows of the same pair and later K values. The
addon must recompute the whole season when a duel is added, never add a delta to the shown number. A card already displayed is not edited.

## 8. Duels outside the guild: the global ladder (bot side built, addon not yet)

The bot keeps a global duel ladder (`/leaderboards/duels`, JSON `/leaderboards/duels.json`, from 13 November 2026 UTC) over every counted
duel a Guilded addon reported, whatever guild the players are in, with the same rating (section 3) per season. Everyone is ranked, including
players without the addon (from their opponents' reports). Guild duels already reach it through the guild import. For a duel against a
player outside the guild, the addon sends a record in the optional array **`externalDuels`** of the upload, next to `duelResults`
(the bot accepts the field today and uses records once an addon sends them). Fields (exact names; see `externalDuelSchema` in
`src/services/duel-global.ts`):

| Field | Type | Notes |
|---|---|---|
| `winner`, `loser` | string, 1-80 | Character names (a `Name-Realm` form is split at the first dash when the realm field is empty). |
| `winnerRealm`, `loserRealm` | string, up to 60 | The realm of each character. Characters are identified by lower-case name plus realm without spaces. |
| `winnerClass`, `loserClass` | string, up to 30, optional | English class names when the client shows them. |
| `winnerLevel`, `loserLevel` | integer 1-60, optional | Levels at the end of the duel. |
| `winnerGuild`, `loserGuild` | string, up to 80, optional | The guild text the client shows. Send the opponent's guild only if the client exposes it without a protected call. |
| `zone` | string, up to 80, optional | Where it happened. |
| `at` | integer, Unix seconds | End time of the duel. |
| `durationSec` | integer, optional | 3 to 1800 when given; a record outside that range is refused. |
| `reason` | `knockout` or `retreat` | |
| `side` | `winner` or `loser` | **Which side the reporting character was.** Only a participant can report; this is what makes a character "a reporter" (only reporters are ranked). |
| `seq` | integer >= 1, optional | The install's running number: +1 per recorded duel, never reused, never reset by a reload. |
| `sig` | 16 hex characters, optional | The keyed checksum below. |

### Challenge, chain and evidence (record fields, all optional on the wire)

Results are verified by the server. To let it do so the addon records, for every duel:

* `nonce`: the latest challenge the bot gave the companion. At each sync the companion receives a fresh value (`duelChallenge` in the
  upload answer) and writes it where the addon reads it; the addon puts the newest one on every record it makes.
* `prev` and `chain`: a hash chain per install. `chain` = the first 16 hex characters of SHA-256 over
  `prev|nonce|seq|winner|winnerRealm|loser|loserRealm|at|reason` (`chainHash` in `src/services/duel-integrity.ts`; Lua tests reuse its vectors).
  `prev` is the previous record's `chain` (sixteen zeros for the first record of an install).
* `seq`: the install's running number, +1 per record, never reused or reset.
* `sig`: a keyed check over the record. The key is derived by the companion from the device key and is not kept in plain SavedVariables; the
  companion signs what it uploads.
* `evidence`: the times (Unix seconds) the addon saw the duel countdown (`countdownAt`), the start (`startAt`) and the end (`endAt`) system
  messages, and the zone of each player (`zoneWinner`, `zoneLoser`) when known.

The bot's thresholds, which checks are required and what happens to a record that does not pass are server configuration and are not
described here. A record the server does not accept is not shown and the client is not told why.

### On screen (addon, later)

* The Duels window keeps the guild ladder; the end-of-duel card shows both ratings when both players have one (the opponent's rating comes from
  the next sync; show nothing rather than a guess).
* Everyone is ranked from their first counted duel; a player without the addon is marked "reported by opponents" on the web.

### Privacy

A duel against an outsider publishes that outsider's character name, realm, class, level and guild text on the public ladder (owner decision,
13 November 2026). The conservative alternative, "a player outside the listed guilds", is the switch `SHOW_OUTSIDER_NAMES` in `duel-global.ts`
(not built). A guild server that has public pages off does not appear on the global ladder, and members hidden from public boards never do.
