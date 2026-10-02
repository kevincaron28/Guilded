# Path of Exile 2 guild competition

Implementation update, 1 October 2026: the first mapping journal slice is in
`docs/POE2_MAPPING.md`. `/poe` provides personal observations and league/mode
activity summaries; the companion can capture filtered log events with consent.
The existing `/community` module handles reviewed challenges and game seasons.
The competition design below remains the roadmap for richer PoE-specific rules;
log observations do not automatically verify completions or award points.

Planning draft — 30 September 2026. Recommended direction: cooperative group achievements plus personal progression. This document proposes a new game module; the deployed WoW points, raid cores and loot rules stay separate.

## Problem and intended experience

Guild members want a reason to play PoE 2 together, form groups in Discord, earn understandable points and remember each league's winners. Reuse the dungeon model's signup cards, point ledger, officer corrections, seasons and archive. Do not assume PoE 2 exposes the same run telemetry as the WoW addon.

As a member, I can join a league, select my character, join a group, submit a completed challenge and see why I earned points. As an officer, I can approve evidence, reverse a mistaken award and close a season without losing its history. As a returning member, I can browse every previous league and its champions.

## Verified API constraints

GGG currently cannot process new application registrations. Phase 1 therefore works without OAuth; automatic tracking requires an existing approved application or registration reopening. Use documented endpoints, an identifiable User-Agent, dynamic rate-limit headers and Retry-After. Show the required independent third-party notice. No gameplay automation or undocumented endpoint scraping is proposed. GGG permits informed log reading by independent apps, but a local companion is outside this MVP. [GGG developer policies](https://www.pathofexile.com/developer/docs)

The documented PoE 2 character endpoints are `/character/poe2` and `/character/poe2/<name>`. They provide character identity, league, level and experience. League discovery uses `realm=poe2`. The PoE 2 public ladder only contains its top 1,000 characters, so it cannot supply ordinary guild standings. There is no documented per-map party completion, per-run deaths or boss-kill feed to treat as automatic proof. PoE 1 stash and account-league APIs cannot be assumed to work for PoE 2. [GGG API reference](https://www.pathofexile.com/developer/docs/reference)

Later account linking uses a backend confidential OAuth client on an owned HTTPS callback domain, with the minimum `account:profile` and `account:characters` scopes. Use state and PKCE, encrypted server-side tokens, revocation and refresh handling. Never request account passwords or session cookies. [GGG authorization](https://www.pathofexile.com/developer/docs/authorization)

## Phase 1 — Discord competition without an API dependency

Must have:

- `/poe season`, `join`, `group`, `submit`, `leaderboard`, `history`, `archive`, `hall-of-fame`; officer `approve`, `reject`, `adjust`, `end-season`.
- Separate PoE category: `poe-signups`, `poe-standings`, `poe-achievements` and a private review channel. Setup and reset own these channels through saved IDs and recognized aliases. The existing WoW dungeon channel remains dungeon-only.
- A signup card with join/leave/ready buttons. The leader records the activity and actual roster; a voice participant or signup alone earns no completion points.
- A season bound to an explicit PoE league and mode. Start with one trade-softcore competition; hardcore and SSF need separate ladders and adapted cooperation rules.
- A character declaration per Discord member, clearly marked unverified until officer evidence or OAuth confirms it. No API-verification badge in the manual phase.
- Evidence submission with screenshot attachment or allowlisted link, challenge, character, roster and completion time. Officer approval is a single transaction; replaying the button never grants points twice. A submitter cannot approve their own claim.
- Immutable points ledger, deduplicated awards, actor and evidence references, correction entries with reasons, season snapshots and all tied winners.

Proposed pilot scoring — suggestions, not deployed defaults:

| Award | Points | Bound |
| --- | ---: | --- |
| Verified personal level milestone | 10 | Each declared milestone once per member per season |
| Approved group challenge | 15 | One per named challenge tier per member per week |
| First season completion of a challenge | 10 | Once per challenge tier per member |
| Helping a member earn their first challenge completion | 5 | Three awards per helper per week; recipient must be independently eligible |

Publish the exact milestone and challenge list before the pilot starts, using the then-current game content. Freeze its scoring version. A late join starts at zero; a pre-existing character may claim eligible milestones once under the same verification policy. Alt characters cannot multiply milestone awards. Group points go only to eligible roster members confirmed by the reviewer. Do not score item prices, spending, voice time, raw farming volume or alleged deathless/speedrun records without reliable evidence.

Should have: personal progress card, weekly cooperation goals, report/appeal button, localized English/French messages, private reviewer notes and adjustable weekly caps. Could have: optional build links and a cosmetic Discord champion role. Defer real-time run capture, economy integrations and competitive speedrun scoring.

## Data and service boundaries

Reuse the guild/member identity and Discord delivery queue. Introduce game-specific models rather than putting PoE data into `DungeonRun`:

| Model | Purpose and integrity |
| --- | --- |
| CompetitionSeason | guild, game=POE2, league ID, mode, rules version, status, dates, final snapshot |
| PoEParticipant | guild/member/season; declared or API-linked character; verification state |
| CompetitionGroup | season, leader, activity, roster, lifecycle, Discord message/voice references |
| CompetitionClaim | immutable evidence reference, participants, activity, status, reviewer, timestamps |
| CompetitionPointEntry | signed amount, member, season, reason, actor; unique award key |
| PoEAccountLink | authorized account identity, encrypted tokens and consent state; added only in Phase 2 |
| PoECharacterSnapshot | stable character ID, league, level, XP, observation time and API provenance |

Use guild-scoped authorization in every button and query. Lock a claim and season during approval; prevent awards after season close. Group membership does not imply completed participation. Corrections append a reversing entry; published season finals require an explicit, audited revision if corrected. Guild reset deletes the selected guild's PoE records and jobs, not another guild's.

Claim → officer review → transactional ledger + Discord job → standings and achievement post. If Discord fails, the committed award remains in the database and publication retries. Each announcement includes its delivery identity. Season close → lock → archive standings/rules/winners → new-season confirmation. League discovery never automatically wipes or closes a competition.

## Phase 2 — official account tracking

Gate: a registered application with the required scopes, a working owned HTTPS callback and tested encrypted token storage. Members consent through `/poe link`. Poll only opted-in accounts with a shared rate budget and caching; use official character IDs rather than names as identity. Observe league/mode changes and character deletion without erasing past awards. Award configured level milestones once; retain officer review for group achievements the API cannot prove. A failed or revoked account link pauses tracking and shows the last successful observation, without awarding guessed progress. Never use the public top-1,000 ladder as a substitute for missing guild members.

## Validation and pilot success

Required checks: two guilds cannot see each other's claims; forged buttons fail; double approval grants one award; crash/retry publishes without new points; reversed awards retain history; alts cannot repeat awards; all tied winners archive; older seasons remain reachable after 25 seasons; league/mode changes pause unsupported tracking; reset removes owned PoE channels and data. Phase 2 adds consent, revocation, rate-limit and stale-snapshot tests.

Run a two-week pilot with a small volunteer group before general rollout. Targets: every awarded point has an evidence or API provenance trail; zero duplicate/cross-guild awards; at least half of enrolled members finish one guild group activity; median review time under 24 hours; officers spend under 15 minutes daily reviewing claims. Review fairness and reviewer effort before adding more challenge tiers.

## Decisions still needed

1. Confirm cooperative progression versus a primarily competitive format (recommended: cooperative).
2. Choose the pilot league/mode and define a short, reviewable challenge list when implementation starts.
3. Confirm whether the owner already has a registered GGG application. Without one, Phase 1 still works.
4. Choose eligible guild roles, reviewer roles, season duration and the roster evidence standard.

Next implementation slice: generic competition season/ledger + PoE setup section + manual group/claim approval + standalone PoE standings. Ship it behind a disabled-by-default PoE feature setting. No PoE channels or points are created by this planning change.
