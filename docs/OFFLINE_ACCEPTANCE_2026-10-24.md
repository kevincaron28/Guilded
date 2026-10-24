# Offline acceptance continuation — 24 October 2026

**Public release remains on hold.** The live bot, public downloads and installed
companion (`489664a`) were not changed during these checks. Nobody was notified.

## Findings and fixes

- Refused management saves always reloaded the server view, destroying unsaved
  prices/rules/roster drafts. Reproduced in the actual renderer with a local fake
  bridge. Failed saves now retain the draft and original conflict-check base.
- Changing language while a save was pending rebuilt an enabled Save button.
  Management panels now remain inert for the entire save/refresh, with a separate
  in-flight guard preventing duplicate edits or manual reloads. Language selection
  remains available. Controls unlock on success, refusal and disconnected requests.
- Rejected bridge promises were unhandled. Load errors now offer Reload; an
  uncertain save result retains the draft and asks the user to reload before
  retrying, since a lost response does not prove the server rejected the edit.
- Paused native folder detail said "Watching". It now uses "Selected folder"
  whenever tracking is not running; active tracking retains "Watching".
- French site's main Companion link omitted `lang=fr`. Shared navigation now
  preserves English/French, existing query parameters and fragments for Companion,
  while leaving asset URLs alone. French error text matches the Actualiser button.

## Evidence

Actual browser interactions against the shipped `manage.js` and language bundle,
using **synthetic local data** (no credentials, bot, database writes or Discord):

- Edited rules, item price, role, bench checkbox and new member's character, then
  changed English → French. Every draft and underlying enum/name was retained.
- Refused rules save retained both the rules draft and the separate price draft.
- Disconnected save showed a translated recovery message and retained the draft.
- Held a save pending, changed French → English: both panels stayed inert, Reload
  stayed disabled, request count stayed at one for that save, and drafts survived
  refusal. The separate automated test attempts overlapping saves/reloads.
- Successful rules save refreshed the confirmed state and submitted the original
  base with only changed fields; user text was not translated.
- Member fixture in French and English: rule inputs disabled, price/roster editors
  hidden, no price/roster mutation buttons, zero write requests. Backend permission
  tests remain separate; this does not prove Discord ordinary-member acceptance.
- Screenshots: `output/offline-management-french-2026-10-24.png` and
  `output/offline-management-french-draft-2026-10-24.png` (synthetic fixture).

Repeat with `npm run companion:build`, then
`node scripts/preview-companion-management.mjs` and open
`http://127.0.0.1:8802/?tab=cores` (add `&member=1&lang=fr` for member French).
The helper binds loopback only, serves allowlisted asset types, handles GET only,
and installs the in-memory fixture before the shared language bundle, replacing
the normal app entry and avoiding browser credential-store initialization. No fixture file is
inside packaged renderer assets. Stop the helper when finished.

Automated validation passed: **269 test files / 2,262 tests**, TypeScript, ESLint,
Guilded and standalone addon validators, Worker/site build. The five new tests in
`tests/companion-manage-renderer.test.ts` execute the real submit handlers with a
minimal document; they cover refused/disconnected saves, overlap exclusion,
confirmed-success refresh and load retry. Site navigation tests cover language,
query/fragment preservation and asset exclusions. Local logs are in
`backups/offline-management-tests-2026-10-24.log` and
`backups/offline-management-worker-2026-10-24.log`.

Fresh read-only bug inbox: no open member reports. The single recorded bot error
remains the October 19 pool timeout from 6.7.0; no recurrence is recorded. It was
not deleted or marked fixed based on these UI tests.

Source `a42e3117ce766c07692c57a94cae96075ac78726` passed both GitHub quality
jobs in run `40135905863` and Cloudflare preview build
`748e8a53-fa14-440e-9de7-de6d30824e49`. Subsequent fixture-only refinements wrap
the synthetic request display and install the fake bridge before the language
bundle. They do not alter shipped assets. Check the latest documentation/fixture
head separately before merging or deploying.

The static site preview's French main navigation produced `/companion/?lang=fr`.
It cannot serve the actual bot-backed Companion endpoint; its local 404 is expected.
The hosted branch preview also proxies Companion to the older production bot, so
the new French browser companion still needs a controlled bot deployment before
that hosted end-to-end check. Do not claim the new browser bundle is already live.

## Remaining acceptance

Kevin restored the native Companion window when asked. Accessibility reads still
worked, but clicking failed with `coordinate input geometry is unavailable`;
Tab left focus unchanged and window capture timed out. Native French interaction
and authenticated editing remain unverified; no settings, pairing or language
preference were changed. This is a desktop-control limitation, not a passed test.

Real game/two-PC/French-client checks, fresh guild/member onboarding and remaining
private Discord candidate interactions remain pending. The production bot remains
the October 23 candidate; do not claim current feature-source interactions are
deployed. Route/calibration/loot evidence and signing/reviewer requirements retain
their existing gates. No public release until required acceptance passes.
