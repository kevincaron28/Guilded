# Duel rating: what the addon must do (spec for `addon/Guilded/Modules/Duels.lua`)

Owner decision, 13 November 2026: duels are scored by a rating ("rating with caution", rule set C of
[DUEL_SCORING_RESEARCH.md](DUEL_SCORING_RESEARCH.md)) from **1 December 2026 00:00 UTC**. The bot side is in
`src/services/duel-rating.ts` (constants and pure functions), `duel-rules.ts` (member-facing text) and `duels.ts` (`duelLadder`).
This file is the contract for the addon. The addon is NOT changed by the bot PR; it needs a release before 1 December. Until members
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
shrinkGames 10, rankedDuels 8, rankedOpponents 4
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
3. `ranked = rated >= 8 and distinctOpponents >= 4`. Ranked players sort first by shown score (then wins, then name); the others follow
   by rated duels and show **"placement 3/8"** (their rated-duel count, capped at 8) instead of a rank.

Shown to the member: the shown score rounded to a whole number; the change of one duel is the difference of the shown score before and
after, rounded, written `+12` / `-12` (`0` when the duel was not rated). Same text as the bot's per-duel card.

## 4. Seasons and the old points

* A season is a calendar month in UTC (`2026-12`, `2027-01`, ...). Everyone starts at 1000 each season. The first season runs from
  `startsAt`. Duels that ended before `startsAt` are **Season 0 (points)**: keep the current `duels.points` for them, shown as a
  frozen, read-only board. Duels are assigned by their end time only; the day a result is reported does not matter.
* The in-game board shows the current season by default; a season selector (or `/guilded duels 2026-12`, `/guilded duels s0`) may show others.
* Read the start date from a constant (`RATING_START_AT = 1796083200`, 2026-12-01T00:00:00Z) and, when the bot starts to send it, from
  the guild settings (`duelRatingStartsAt`, ISO text); the constant is the fallback. A server may move its own start date (testing).

## 5. Caps and dedupe (unchanged, but make the addon equal to the bot)

* At most **5 counted duels per pair per day** (UTC day) and **25 counted duels per reporter per day** (the bot enforces both when a result
  is imported; the addon only had the first). The addon cannot know the reporter of a result it received by sync, so it applies the 25 per day
  to the player's own reports and relies on the bot's `counted` flag when it is present in synced data.
* **Dedupe window 120 seconds** (the addon used 60): the same winner and loser within 120 s is one duel, whoever reported it.
* Unknown levels: no handicap and no level-gap rule (the duel still rates).
* No points, awards or rewards anywhere; the card and board say so.

## 6. What changes on screen

* `/guilded duels` and the Duels window: rating column (shown score), "placement n/8" for unranked players, season name, rules since date.
* The end-of-duel card: "Rating +12" for the winner and "-12" for the opponent, and the placement progress when unranked; no more "+N points".
* `Locale.lua` needs French for every new string (accents as `\195\169` escapes; the validator rejects non-ASCII).
* Older addons keep showing the old points: that is why `ADDON_SHOWS_RATING` stays false until the new addon is released.

## 7. Late reports

Ratings are recomputed from the stored duels of the season in date order. A duel that reaches a client late (a companion was offline) is
placed at its end time, so it can move ratings that were already shown, including older rows of the same pair and later K values. The
addon must recompute the whole season when a duel is added, never add a delta to the shown number. A card already displayed is not edited.

## 8. Duels outside the guild: the global ladder (bot side built, addon not yet)

The bot keeps a global duel ladder (`/leaderboards/duels`, JSON `/leaderboards/duels.json`, from 1 December 2026 UTC) over every counted
duel a Guilded addon reported, whatever guild the players are in. It uses the same rating (section 3) per calendar month. Guild
duels already reach it through the guild import. For a duel against a player outside the guild, the addon sends a record in a new
optional array **`externalDuels`** of the upload, next to `duelResults` (the bot accepts the field and ignores records until an addon
sends them). Record fields (exact names; see `externalDuelSchema` in `src/services/duel-global.ts`):

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

### Tamper-evident encoding

* Each install creates a random secret once (kept in SavedVariables, never uploaded, never printed) and a counter `seq`.
* `sig` = the first 16 hex characters of SHA-256 over `secret|seq|winner|winnerRealm|loser|loserRealm|at|reason` (`duelSig` in `duel-global.ts`
  is the reference; the Lua test uses the same vectors). The addon checks it when it reads its own log back, so a record edited by hand in
  the saved-variables file is dropped before upload.
* The server never knows the secret, so it checks only the shape of `sig` and the sequence: a `seq` already used by a different record of the
  same device is refused (replay), and gaps or repeats per device are visible in `sequenceProblems`. **This does not stop a modified addon**
  (anything the addon can sign, a modified addon can sign). It stops casual file editing and makes copy-paste replays visible. The public
  page says so plainly.

### What the bot checks (so the addon need not)

* Plausible: not in the future (5 minutes of slack), not older than 30 days, duration bounds above, winner and loser are different
  characters, levels 1-60, text cleaned and clipped.
* The caps of section 5 (5 per pair per day, 25 per reporter per day), the 120 s dedupe across all reporters, and the weekly pair weight in the rating.
* One reporter's single witness counts in full. When the other player's addon reports the same duel (same winner and loser within 120 s) the
  duel shows **confirmed by both**; it is information only, it does not change the rating.
* A device can be excluded by the owner (`PublicDuelExclusion`): its reports stop counting and every rating is recomputed without them.
* `duelAnomalies` lists, for a human to look at (never hidden or down-weighted automatically): one-sided pairs, rapid repeats, a reporter with
  very few opponents, long streaks.

### On screen (addon, later)

* The Duels window keeps the guild ladder; the end-of-duel card shows both ratings when both players have one (the opponent's rating comes from
  the next sync; show nothing rather than a guess).
* Players who reported a duel are ranked after 8 duels against 4 different opponents; a player who never reported only appears as an opponent.

### Privacy

A duel against an outsider publishes that outsider's character name, realm, class, level and guild text on the public ladder (owner decision,
13 November 2026). The conservative alternative, "a player outside the listed guilds", is the switch `SHOW_OUTSIDER_NAMES` in `duel-global.ts`
(not built). A guild server that has public pages off does not appear on the global ladder, and members hidden from public boards never do.
