# Guilded website and feature review — 24 October 2026

Later continuation: the French companion source and mobile follow-up are now
implemented and tested; see `COMPANION_FRENCH_2026-10-24.md`. Earlier findings
below describe the reviewed baseline. The public site has not been promoted.

The core product is implemented, but it is not fully accepted for launch. Website
polish does not substitute for the remaining game, two-PC or Discord checks.
Public release remains on hold. This review made no production deployment.

## Feature status

| Area | Implemented | Still needed |
| --- | --- | --- |
| Addon | EP/GP, loot, attendance, recipes, guild map, readiness, dungeon history, backups and optional games | Required launch-client, French, standalone and two-PC acceptance; verified launch route/encounter data and representative calibration |
| Discord | Setup/Lite onboarding, cores/signups, recruitment, crafting and community tools | Ordinary-member and fresh-guild walkthrough; remaining promotion, character picker, closure and mirror checks on the candidate |
| Companion | Browser/Windows upload, personal mode, exports, Discord sign-in and updates; quieter package installed on Kevin's PC | Game-generated data and second-PC acceptance; complete French companion localization remains unfinished |
| Public site | Guild pages, recruitment, player profiles and public dungeon leaderboards | Reviewed candidate deployment, authenticated workflow acceptance and external share-card unfurl verification |
| Latest draft | Raid presets, new signup Components V2, PNG score cards and locked shared dungeon settings | Candidate interaction acceptance and exact-commit CI/package verification before controlled deployment |
| Raid/localization/distribution | Existing loot and localization systems | Verified loot/GP tables, two-officer raid rehearsal, native German/Spanish review and verified signing identity |

See `LAUNCH_READINESS_2026-10-24.md` and `AI_HANDOFF_2026-10-24.md` for the
authoritative release gates. Older roadmap sections contain historical plans;
their unchecked wording is not proof that a currently implemented feature is missing.

## Live review findings and draft corrections

| Finding | Impact | Correction / status |
| --- | --- | --- |
| Install guide still advertises 6.7.0 and the old pairing/approval path | High: a new user receives conflicting setup instructions | Current guide corrections already exist in the stacked preparation branch; require reviewed publication |
| French navigation falls back to English; Features is English-only | Medium: inconsistent onboarding | Shared language-aware URLs, complete French Features content, translated home footer/title/labels and guide links to French sections |
| Switching language on an explicit `?lang=fr` page reverts after reload | Medium: preference appears broken | Update the same-page language query when a language button is selected; preserve other query parameters and anchors |
| Skip links do not reliably transfer focus; public-page focus/touch targets need improvement | Medium: keyboard/touch friction | Focusable content targets, translated skip link on shared public layouts, visible focus styles and larger navigation/language targets |
| French self-hosted companion-address helper reports English messages | Low: mixed language in setup | Localized validation and continuation messages |
| Guides carry a stale universal review date | Low: misleading freshness | Removed the blanket date; retained provider-version guidance |
| Static preview serves fonts/modules incorrectly and lacks canonical guide paths | Development verification gap | Correct module/font MIME types and extensionless HTML preview routes |

The dark/gold design, typography and primary install action are coherent. Keep
the present design; the useful improvements were language continuity, setup
accuracy and keyboard behavior. The empty recruitment/leaderboard states are
valid beta states, not broken pages. Public versions remain visibly distinct
from the candidate (GitHub 7.3.1; CurseForge 7.3.0).

## Evidence

- Reviewed live home, Features, public leaderboards, recruitment, players,
  companion, install guidance and signed-out account page in the browser.
- HTTP checks: 15 public routes/resources returned 200. `/me/` returned its
  expected signed-out 401 and rendered the French Discord sign-in explanation.
- Audited 15 built HTML pages / 366 internal references: no missing local
  assets/targets or broken fragments, accounting for canonical extensionless URLs.
  Private result: `backups/site-polish-link-audit.json`.
- Checked local mobile layout at 390px and 320px, desktop at 1280px. Home and
  Features fit without horizontal page scrolling. Loaded images have no errors;
  below-the-fold lazy images were distinguished from failed image loads.
- Verified EN/FR page text, page title, navigation and persistence after reload;
  mobile-menu Escape behavior and keyboard skip-link focus. No console errors
  were reported on the final local Features page.
- Shared token contrast calculations: body/background 16.24:1, muted/panel 7.87:1,
  button text/gold 9.57:1 and focus/panel 9.30:1. This is a token check, not a
  blanket WCAG certification or a complete rendered-element audit.
- Local preview screenshot: `output/site-polish-2026-10-24.png` (private,
  gitignored). Static preview starts with `npm run site:build` then
  `npm run site:preview`; it starts no bot or database.

## Validation and remaining limits

Local validation: 267 files / 2,250 tests, TypeScript, ESLint, both addon validators,
site build and Worker dry-run. Logs: `backups/site-polish-final-*.log`.

During this review, scoring-lock head `c46c10b` CI exposed an outdated PostgreSQL
fixture: it expected a guild override to create a 1,200-second season target,
which the new shared-rules policy correctly ignores. The fixture now asserts
new seasons use shared rules even with saved overrides, then supplies explicit
historical presets for its existing 235-point, wing, archive and restore checks.
It keeps those expected scores; it does not weaken production scoring or reset
live data. The updated exact-head CI result must be checked separately.

The previous head's Windows package job passed; its Linux database test failed.
Its external Cloudflare build check also failed without diagnostic annotations.
Local Worker dry-run passed; that does not establish a successful remote build.

Not claimed: exhaustive browser/device coverage, a screen-reader audit, measured
Core Web Vitals, real-game correctness, authenticated site acceptance or deployed
site fixes. Guide headers remain English on bilingual documents; the French
section anchor is preserved. The companion remains primarily English. No
notifications, pairing changes, downloads promotion or main merge were made by
this review. Finish these remaining checks before calling the product complete.
