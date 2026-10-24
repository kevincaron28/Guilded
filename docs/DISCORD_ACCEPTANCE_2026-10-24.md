# Discord acceptance — 24 October 2026

**Public release remains on hold.** These checks supplement the game and two-PC
checklist; they do not replace it. The deployed bot remains the 23 October
candidate. Source changes on the prelaunch feature branch are not yet deployed.

## Completed in Quebec Gold

The owner authorized tests without notifying anyone else. Test posts used the
existing restricted admin channel, suppressed notifications and no mentions.
Command and button replies were private to the owner.

- `/report ping`: the live bot answered; Discord showed “Only you can see this”.
- `/help`: French help rendered privately, including officer tools for the owner's
  account. This does not prove ordinary-member command visibility.
- Real signup-button interaction: linked character selected automatically when
  the owner had one character; French confirmation and roster update succeeded.
- Maybe: retained the selected role, moved the character out of confirmed seats,
  and persisted `MAYBE` in the database.
- Absent: private cancellation confirmation and removal from the visible roster.
- Full-role signup: persisted `WAITLISTED` when the DPS capacity was zero.
  Delivery job completed without error.
- Earlier REST checks accepted legacy and Components V2 messages in English and
  French, fixture roster edits and closure, and a 1200×630 score PNG attachment.
  Those were payload checks, not clicks through the new candidate workflow.

The isolated database raid was explicitly `isTest`, already past its start,
reminder-marked, non-repeating and non-public. It had no other real participants,
no awards and no attendance. The existing private post could be edited but the
delivery service could not create a public mirror. The temporary raid/core and
their signup records were removed afterward. Guild settings and the owner's
character links were checked unchanged. The post was replaced with a silent
TEST COMPLETE notice. Detailed private evidence remains in the local backup.

## Findings prepared in source

- Multi-character selection was hardcoded in French for English guilds. It now
  uses the guild's language for the prompt, selector, page buttons, confirmation
  and timeout. English/French regression cases cover both completion and expiry.
- Dungeon administration labels did not explain their scope. They now identify
  guild-local participation/ratings and explicitly distinguish public online
  scores, which use shared season-frozen rules from `OfficialSeason.rules`.
  No scoring values, earned points or live configuration were changed.

Local validation after these changes: 266 test files / 2,234 tests, TypeScript,
ESLint and both addon validators passed. Final-commit CI and deployment are
separate from these local results.

The owner subsequently requested locking dungeon scoring settings for **all** guilds.
The candidate now removes guild rule/target setters, makes configuration and evidence
read-only, and rejects cached editing commands. See
[DUNGEON_SCORING_LOCK_2026-10-24.md](DUNGEON_SCORING_LOCK_2026-10-24.md).
This is candidate source, not a claim that the production bot has been updated.

## Still pending

- Browser control initially worked, then two calls timed out. Promotion, role
  switching, closure through the live command, multi-character picker, ordinary
  member permissions, and fresh-guild onboarding are not recorded as passes.
- The new preset command, core preset modal, and full Components V2 interaction
  walkthrough need the candidate bot code deployed in a controlled environment.
- Discord link unfurling needs reachable candidate score pages. A PNG attachment
  does not establish OpenGraph behavior.
- Game, French game UI and second physical PC acceptance remain required.

Use the exact source/package hashes when continuing; the local installed companion
is the verified French `489664a` package. Changes made after that build do not
retroactively change its manifest or establish deployment acceptance.
