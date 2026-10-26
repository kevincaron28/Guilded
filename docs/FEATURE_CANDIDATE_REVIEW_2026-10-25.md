# Feature candidate review — 25 October 2026

Current implementation and Claude integration:
[integrated local candidate](LOCAL_FEATURE_COMPLETION_2026-10-25.md).

Status: the owner authorized implementation, kept local for review, after the
initial read-only review. The first roster dashboard and the subsequent
[local feature bundle](LOCAL_FEATURE_BUNDLE_2026-10-25.md) are implemented locally.
The bundle is the current status and validation record; the first-dashboard
results and proposed order below describe the earlier stage. Remaining candidates
are not release commitments. Review is required before any publication.
The original reference provenance and all ten candidates remain in
[the roadmap](../ROADMAP.md#requested-candidates--25-october-2026).

## Existing capabilities to extend

| Area | Code evidence | Consequence |
| --- | --- | --- |
| Crafter lookup | `addon/Guilded/Modules/Recipes.lua` has `whoText`, item-link/name matching and classic/modern profession scan paths; `src/services/recipes.ts` has `findCrafters` | Search and profession scanning are already implemented. An additional native profession-window interface is a separate candidate; this review does not certify any client API. |
| Export | `src/services/exports.ts` exports roster, attendance, ledger, loot and standings for one guild; `companion/sheet-export.mjs` provides local spreadsheet exports | Reuse existing export boundaries and escaping. A dashboard export should match its filtered rows, rather than introduce another full export system. |
| Identity and roster | `Character` stores guild, edition, realm, display name, main flag, race, level and professions; `src/services/roster-discovery.ts` separately stores unclaimed characters | Keep linked and unclaimed records distinguishable. Character count is not member count; unclaimed characters cannot safely be deduplicated into people. |
| Recency | `applyDiscoveredCharacters` sets `lastSeenAt` to import time for roster digest entries | This timestamp proves data refresh, not that the character was online. Do not use it for Active 30d, active-this-week cards, inactivity or a heatmap. |
| Teams | `src/services/raid-roster.ts` selects role-specific backups, core characters and main fallbacks; local cores have main/bench spots in `addon/Guilded/Modules/LocalGuild.lua` | Compare Trial status, attribution rules and buff coverage against existing core/sign-up/attendance behavior before designing additions. Core slot labels and character main/alt identity are different concepts. |
| Edition isolation | `companion/game-edition.mjs` and `src/services/game-edition.ts` validate edition identity and reject mixed uploads | New views and filters must preserve these boundaries and must not infer client support merely from recognized edition metadata. |

## First local addition: roster dashboard and search

The first delivery surface is the signed-in website, `/me/roster`, linked from
My page. It follows the existing officer-export permission boundary: an active
Guilded member with a fresh Discord officer permission check in the selected
guild's role scope. It uses already available data, with no migration, new
tracking, game API dependency or automatic refresh loop.

Implemented locally: name/realm search; class, race, profession, main/alt/unclaimed
and level-range filters; separate character/represented-member/unclaimed counts;
class/race/profession breakdowns; 50-row pagination; filtered CSV; English/French
labels and language switching that preserves guild and filters. Missing fields
stay unknown. Import timestamps are explicitly data freshness, not activity.
Queries are capped; partial snapshots are labelled and cannot be exported as if
complete. No max-level preset or activity/vitality metric is claimed.

Implementation: `src/services/roster-dashboard.ts` (page/filter/export),
`src/services/roster-dashboard-store.ts` (authorization and scoped data), and
`src/companion-api.ts` (route registration). Page language context uses optional
parameters in the existing web layout. Regression coverage is in
`tests/roster-dashboard.test.ts`. The local fixture preview uses only invented
records and does not log a bot in or query production.

### Local validation

- `npx tsc --noEmit -p .` and `npx eslint .`: passed.
- Guilded and Guilded Dungeons static addon validators: passed.
- Full suite: `npx vitest run --pool=threads --maxWorkers=2 --testTimeout=20000`
  passed all 282 files / 2,387 tests, including 12 dashboard tests. The earlier
  default fork-pool attempt encountered two existing score-card image-test
  timeouts and was interrupted; the complete rerun passed with the alternate
  pool and longer timeout. No test assertions or production image code were
  weakened to obtain that result. Log: `backups/roster-dashboard-vitest-threads.log`.
- Local browser fixture: full-name search without accents found Élodie Dawn;
  switching to French preserved the guild and filter; clearing filters restored
  all six invented characters. The page fit the 718-pixel review pane, with the
  table contained in its horizontal scrolling wrapper.
- Preview: `http://127.0.0.1:8803/me/roster?guild=demo-forever&lang=fr` while the
  local fixture server is running. Saved fixture HTML is in
  `backups/roster-dashboard-preview-en.html` and `backups/roster-dashboard-preview-fr.html`.
- This is not a production acceptance result or a real-client game check. Changes
  remain local and uncommitted; no CI run, deployment or release was initiated.

Proposed acceptance criteria:

- Show the selected guild and edition. Switching guild/profile clears prior
  results; a Discord server with multiple editions never gets a combined roster
  by accident. Test two guilds sharing a server and identically named characters.
- Search character display name and realm. Preserve Forever first/last names and
  distinguish Blizzard characters on different realms. Reuse canonical identity
  helpers; display text is not a replacement ledger or account key.
- Filter by known class, level range, profession and main status. Represent
  unknown values explicitly. A max-level filter needs a verified, edition-aware
  level-cap source; do not hard-code Forever's cap for every edition.
- Label separate counts for characters, linked members and unclaimed characters.
  Race/class/profession summaries must describe their actual denominator and
  must not count an unknown field as zero. Profession totals may overlap.
- Keep missing or stale information visible. Label refresh timestamps as data
  freshness, never player activity. Leave Active 30d, activity cards and vitality
  out until their evidence and definition are agreed.
- Reuse existing export formatting, permissions and CSV protections. If filtered
  export is offered, exported identities and counts must match visible results.
- English/French labels, bounded results, usable empty/error states and no
  private officer notes in member-facing views or exports.
- Automated cases cover filtering, unknown data, duplicate names, main/alt
  distinction, scope changes and access denial. Real-client acceptance remains
  separate from fixture/test success.

## Proposed order after the first addition

1. Improve discoverability of existing crafter lookup and core/attendance flows;
   establish exact UI gaps before adding more storage or commands.
2. Design activity/availability evidence: client observation versus self-report,
   consent, expiry, offline/unknown states, sampling cost, timezone and retention.
   Then consider Who's Free and the hour-by-weekday heatmap. Do not manufacture
   historical activity from upload timestamps.
3. Research edition-specific native finder, keys, raid buffs and profession UI
   APIs and combat restrictions. Keep availability UNKNOWN until researched and
   tested; resolve the removed-finder and retired-raid-tools scope first.
4. Design GRM import and officer bulk-action previews separately, with permission,
   provenance, conflict, audit and recovery rules. No guild changes are authorized
   by this review.

The order after this first addition is a proposal. Current Discord
acceptance testing, production stability and pending game checks remain in the
[release gap audit](RELEASE_GAPS_2026-10-25.md). No public release assets, versions,
deployments or live test fixtures were changed during this local implementation.
