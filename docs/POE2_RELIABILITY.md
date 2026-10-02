# PoE2 reader reliability and live view — 2 October 2026

Version remains 5.0.0. No database migration, protocol change or additional
uploaded fields. Both parser modules remain required: `poe-log.mjs` provides
Node hashing around `poe-events.mjs`, also used by the browser companion.

## Behavior

- Initial desktop opt-in still starts at EOF. Existing history is not imported.
- Replacement/truncation interrupts the active visit with unknown timing.
  Files at most 1 MiB, modified within five minutes, can recover events strictly
  newer than both the opt-in boundary and last recognized event. Recovered event
  timestamps must also be within five minutes of the computer clock. Older,
  large or unprovable replacements start at EOF with an explicit warning.
  Same-second boundary events are conservatively skipped because timestamps
  alone cannot prove they are new. This is limited recovery, not lossless replay.
- The saved prefix grows after an empty/short opt-in so a later rewrite that
  exceeds the cursor can still be detected. Recovery boundaries survive restart.
- Each poll reads at most 1 MiB in chunks no larger than 256 KiB, leaving time
  for uploads and cancellation. Capture stops at queue capacity without advancing
  over unread events. Partial lines are reread; raw text is never journaled.
- Complete and partial lines over 8 KiB are skipped. LF/CRLF are supported.
  UTF-16 BOMs and NUL-containing headers produce an actionable encoding error;
  original UTF-8 game logs are required. Browser manual import applies the same
  encoding check and waits for a complete final line.
- File access errors retry automatically and do not prevent pending uploads.
  The regression tests inject Windows-style EACCES/EPERM/EBUSY failures; a real
  Windows game-held file remains part of the pilot, not proven by those mocks.
- After five minutes following unrecognized new log activity, a conditional
  diagnostic advises checking path/format/language if the player changed areas.
  An untouched idle file alone does not trigger a wrong-path warning. A supported
  event clears the warning. The UI shows the last recognized event separately.
- `Abnormal disconnect` does not require punctuation or a particular hostname;
  chat quoting it remains ignored. English engine messages are still required;
  surrounding localized text is ignored without affecting the area-ID path.

## Desktop live view

The mapping page shows a readable current area, elapsed time since generation,
today's distinct observed instances, last recognized event and capture warnings.
Elapsed time includes loading and idle time; it is not a clear/combat timer.
Intervals over six hours or in the future display unknown. Focus changes do not
silently subtract play time.

Daily counts are scoped to this device's selected account/log/character/league/
mode journal and the computer's local calendar day. They include the open map,
deduplicate portal re-entries by instance reference, survive successful uploads
and restarts, and reset at midnight. They cover only activity captured since this
build's tracking was enabled, not historical or account-wide totals. Changing
pairing/profile changes the scope. These metrics are hidden for browser snapshots.
Stored daily instance references are capped at 10,000 per day. No raw seeds,
chat, character detection or new competition evidence is introduced.

Journal schema version 1 accepts optional recovery/activity/daily metadata;
existing journals without it remain readable. Older builds may refuse journals
containing these new fields: preserve the journal for recovery on rollback rather
than deleting it or dropping queued visits.

## Evidence and remaining gates

Local `npm run release:prepare` passed on Node 24.17.0: **1,104 tests across
138 files**, TypeScript, ESLint, addon validation and both dependency audits
(zero vulnerabilities). It built the 38-file addon ZIP, browser companion and
`dist/companion/Guilded Companion Setup 5.0.0.exe`. The focused PoE/browser suite
passed 52 tests. An isolated hidden Electron preview with synthetic data rendered
the real desktop page with no console errors, no horizontal overflow and correct
current-map, elapsed-time and daily-count text. This is a rendering check, not an
installed-companion upgrade or live game check. Unrelated working-tree changes
were present during this build; it is a local validation artifact, not a released
commit or proof of current-branch CI.
The three packaged PoE tracker modules and the renderer's HTML, JavaScript and
browser bundle were compared byte-for-byte with final source after packaging.

`tests/fixtures/poe2/lifecycle.txt` is explicitly synthetic. It is shared across
parser/browser/desktop tests, including CRLF, campaign/hideout transitions,
re-entry, disconnect and ignored localized/chat/death lines. Grammar cases cover
digits and underscores without claiming those IDs exist in today's patch.

No PoE2 log path was saved in the local companion configuration and no Client.txt
was found in the standard installation locations checked during this task.
No disposable TEST_DATABASE_URL or PostgreSQL tools were available on PATH.
GitHub CLI was also unavailable on PATH. These are missing evidence, not passed
release gates. The checkout includes unrelated audit work, which was preserved.

Before deploying/installing, follow `V5_0_RELEASE_HANDOFF.md` and require green
Windows/PostgreSQL CI plus preflight and verified backup. Current-patch English
and French captures, native Windows install/upgrade and a real game-held file
remain outstanding. The pilot must verify one map / two portal entries across
hideout re-entry, then a different seed for a different instance; also compare
timings, restart, offline recovery, profile changes and diagnostics. Never upload
or commit raw private logs. No current-patch/localized support or completed
installation/deployment is claimed by the synthetic tests or installer build.

Deaths, level-ups, automatic character detection and charts remain deferred until
their source events and attribution can be verified from that pilot.
