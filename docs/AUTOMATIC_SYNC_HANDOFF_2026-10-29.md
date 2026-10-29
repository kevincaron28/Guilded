# Automatic sync and linked accounts — implementation handoff

Scope: the owner's requested items 1–4. Source branch:
`codex/automatic-sync-battlenet`, based on main `53b0901`.

## Delivered behavior

1. Discord sign-in asks for a device name and issues an independent credential.
   Pairing codes also preserve other credentials. `/me/connections` lists active
   connections and supports rename, individual revocation and confirmed revoke-all.
   Officer unlink still revokes every affected member credential. Existing rows
   migrate with the label “Paired companion” and can be renamed.
2. The desktop retains enabled profiles across selections. Previously unselected
   legacy profiles remain off until selected/enabled. Up to 20 profiles are
   supported. Sleep/resume and network recovery restart enabled engines; failed
   startup folders retry every 30 seconds. Overview distinguishes waiting for a
   game save, upload, retry, officer review and application errors.
3. A selected profile has priority when multiple enabled profiles share output
   files; other profiles upload and fetch acknowledgements without overwriting
   those files. GuildedData and personal Accepted.lua are covered. Filesystem
   aliases resolve to the same ownership key. Switching waits for old engines
   and their writes to drain. Shared input across guild scopes requires exact
   guild filters; unidentified/mismatched saves are not uploaded to those scopes.
4. Optional Battle.net OAuth attaches to the existing Discord WebAccount.
   Discovery is private and session-bound. Explicit selection and main choice
   are required before persisting characters. Unique provider and character
   identities refuse transfers between accounts. This private account main is
   separate from officer-managed guild mains and public character records.

WoW must still save its addon data through `/reload` or logout. Downloaded addon
standings load in game on `/reload`. Browser companion sync remains manual.
Battle.net does not expose addon ledger/loot/attendance data; changing login
providers would not remove these limits.

## Coordination and release order

The release chat owns PR #266, `codex/nov4-release-candidate`, targeting the next
coordinated version. Claude owns edition routing/navigation in PR #268 and the
separate melee/ranged raid work. This branch does not modify their site, Worker,
navigation, raid or web-auth implementation. Schema additions are independent;
this branch reserves migration `20261127000000`, after Claude's `20261126000000`.

Review and merge the feature PR, then refresh the release candidate against the
combined source and rerun its exact-commit checks and packaging. Apply migration
and backend routes before distributing clients. Do not publish a second 8.0.2,
modify existing release assets, or bump this feature branch's version separately.
PR #268 has a coordination comment documenting the protected route and file scope.

The owner has no Blizzard application yet. Follow [BATTLENET_SETUP.md](BATTLENET_SETUP.md).
No production database, live bot or public release was modified by this work.

## Validation

Focused coverage includes OAuth cancellation/replay/session isolation, forged
selection, private storage, conflict refusal, multi-device retention/revocation,
shared output protection, startup retry and drained profile switching. The
disposable PostgreSQL rehearsal checks real unique constraints, transaction
rollback, cascade deletion and device ownership. CI also builds the Windows
package and unsigned MSIX preview; these are not Store publication.

Real Blizzard consent, real sleep/network transitions on an installed Windows
package, and in-game acceptance require follow-up. The existing manual-testing
waiver is retained as a waiver, not counted as a passed test.
