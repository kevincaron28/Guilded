# Post-release review — 26 October 2026

## Provider checks

All ten 7.5.0 CurseForge files are **Approved**: Guilded and Guilded Dungeons,
each for Forever, Classic Era, TBC, Mists and Retail. All ten anonymous downloads
were fetched again and match the release ZIP hashes. File IDs and evidence remain
in the ignored `backups/release-7.5.0/` folder. Both website provider labels can
now show 7.5.0.

Microsoft Partner Center still shows **In certification**. Pre-processing has
finished and certification is in progress; publishing has not started. Automatic
publication after approval remains enabled. No resubmission or package replacement
is needed while Microsoft reviews the submitted build.

## Claude's observed live checks

Source: both Claude walkthrough entries in the shared coordination file,
26 October, on the test Discord server with WoW Forever selected. These are
reported observations by Claude, not additional checks performed by Codex.

- Test raid start/finish acknowledged promptly; canceling the EP proposal recorded
  no award. Late mark/undo, waitlist signup and edition raid presets worked.
- Past signup deadlines were refused, a live deadline closed buttons, and editing
  the deadline reopened signup. Voice attendance respected the planned-raid guard
  and marked members on an active raid.
- World-buff add/list/remove, do-not-invite add/list/remove, edit logging and
  character-signup configuration worked. Temporary logging/signup settings were
  restored. Member lottery commands showed only list/show.
- Application trial controls worked. The web teams page displayed the trial end,
  sponsor and attendance column. The test application was subsequently rejected;
  TEST Core returned to zero rostered members and trials.
- The Forever event board posted/pinned and could be disabled. English/French
  public profile previews displayed the fallback when no scored runs existed.
- Web participation summaries and filters showed expected counts; the CSV link
  retained filters (the CSV was not downloaded). Main/alt review displayed its
  preview without applying changes. Availability guarded unlinked members and
  displayed the sharing form.

Two text fixes merged in **PR #236**: the linked-character signup refusal now
includes English/French, and newly created application-channel topics reference
`/mod application`. Existing channel topics are intentionally retained; an admin
can replace a stale `/application` reference in the channel settings without
changing custom text.

## Additional no-game polish

The availability form's consent checkbox inherited the full-width text-input
style. The shared layout now sizes checkbox/radio controls correctly, and the
consent label wraps beside its checkbox. The stop-sharing action is separated
from the primary share button. Consent stays required and unchecked; authorization,
expiry and the POST handler are unchanged.

Review uses a read-only local synthetic fixture, with English/French desktop and
390px-width inspection. Existing availability authorization/consent tests, signup
tests and site navigation tests pass (15 tests); full CI remains the merge/deploy
gate. This server-only follow-up does not replace the published 7.5.0 addon,
companion installer or submitted Microsoft Store package. Deployment evidence is
recorded separately under `backups/post-release-2026-10-26/` after the gates pass.

## Still not verified

- Microsoft approval and actual Store-signed installation/upgrade/startup/tray.
- Starboard repost and outbid DMs with a second account; Retail key filters with
  a Retail guild; message-delete logging.
- Posting personal availability (owner consent was not checked for them), actual
  main/alt apply with real concurrent officer sessions, real GRM archive behavior.
- In-game buffs, APIs, launch tools, two-PC synchronization, dungeon benchmarks
  and all carried-forward game acceptance.

Test leftovers reported by Claude: completed and planned `[TEST] Simulated raid`
entries, an edited test message, a world-buff announcement and the disabled event
board. The owner can use `/setup testraid cleanup` for the test raids. No cleanup
of user messages or personal availability was performed by this follow-up.

The older visual style of bot-served pages is a design follow-up, not a functional
failure. A full redesign is not required for these release corrections.
