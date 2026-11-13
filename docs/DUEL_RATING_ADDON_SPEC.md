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
