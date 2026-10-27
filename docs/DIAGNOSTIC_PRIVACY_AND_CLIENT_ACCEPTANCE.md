# Diagnostic privacy and actual-client acceptance

Local candidate, 27 October 2026. No deployment, report transmission, client
installation or current-v2 activation is implied by these checks.

## Report behavior

`/report bug description:...` opens an ephemeral preview in EN/FR. It displays
the sanitized text and identifies the Guilded developer's private report inbox,
the reporter/server/channel/version metadata, and the optional private developer
notification channel. Send and Cancel are scoped to the invoking member, guild
and interaction, with a five-minute expiry. Cancellation/expiry stores nothing.
Membership is checked again before sending. Editing means cancel and resubmit.
The confirmation reports storage success, not guaranteed Discord delivery.

On 27 October Kevin restored the optional screenshot and the officer notice,
keeping the preview. The preview says the report also goes to the server's
officers and shows the screenshot. Only an image hosted on Discord's own CDN is
kept; any other file is named as not sent. After Send, the redacted text and the
screenshot go to the server's officer channel (`notifyEmbed`, kind `officer`,
no pings). Cancel, expiry or leaving the server posts nothing. The developer
inbox stores the screenshot link; the image is never downloaded or inspected.
Existing operator access through `npm run bugs` is unchanged; no public inbox is added.
The report service requires explicit submission consent for the member path.

Notification recipients are checked at preview and again at dispatch. The target
must be a guild text channel readable only by administrators and this bot, with
bot ViewChannel/SendMessages. Everyone/non-administrator role visibility,
non-administrator member grants, missing permissions, lookup errors, threads and
DMs are denied. A changed configured destination is never substituted after
confirmation. Reports can still be saved without a notification. No permissions
are changed to make delivery succeed. Administrators inherently retain access.

Automatic errors omit arbitrary exception text, request bodies, serialized
objects, user IDs and message IDs. They retain an approved error class/code,
fingerprint, up to twelve basename/line stack frames, source guild/channel,
operation and bot version. Optional structured diagnostics admit only bounded
edition/build/interface/route/encounter/version identifiers and enumerated
capability/event/reason values. Error/warning console strings become fingerprints
and objects are omitted. This deliberately reduces free-form troubleshooting
detail; operators use fingerprints, source locations and selected reproduction
steps instead of raw exception payloads.

Member text is redacted before truncation: configured credentials, common token
formats, authorization/cookies, session/credential assignments, URLs (including
encoded URLs), local paths, private keys, payload fields and mentions. Pattern
redaction cannot identify every sensitive fact in prose: the member must review
the visible text. No conversations, audio, files or SavedVariables are captured.
No third-party service, credential or ambient monitoring is added.

Existing reports are not rewritten or deleted. Existing retention is unchanged.
The operator inbox is bounded to 1,000 unresolved rows for its requested time
window, not an unrestricted log export. Selected-file diagnostics/export consent
and client-side log redaction are separate unfinished work; this patch does not
claim to sanitize every Companion log or historical file.

## Verification

- `tests/diagnostic-privacy.test.ts`: credential/URL/path/payload redaction,
  environment secrets, automatic data minimization, technical field whitelist,
  and console payload suppression.
- `tests/diagnostic-target.test.ts`: private recipient acceptance, changed/public
  role audience, member overwrites, missing permissions and lookup failures.
- `tests/bug-report-consent.test.ts`: EN/FR preview, exact actor/guild/interaction,
  cancel/expiry, membership loss, unavailable notification destination, the
  optional screenshot (Discord-hosted images only), the officer notice only
  after Send, and honest storage failure wording.
- `tests/report-source-context.test.ts`: confirmed-only storage, no unapproved
  destination, no send after failed storage, minimized metadata, origin and dedup.

All Discord clients and reports in these tests are mocks. No real report or DM
was sent, no attachment downloaded, and no channel permission changed.

## Read-only local observations and smallest game test

The limited PC check found no process named Wow, WowClassic, WowB or WowT.
The existing Companion configuration enables WoW and selects `Guilded.lua`, but
that watched file does not exist. At the configured client location both addon
manifests report 7.3.2 and interfaces 16001/20506. This is a stale configured
location, not proof of a functioning installed game or active edition. No game
executable/version was found at that selected root. Standard installation paths
checked did not establish an available live-edition client. The configuration's
credentials, account directory names and SavedVariables contents were not output.
No installed files were written or overwritten.

Smallest useful prerequisite: Kevin identifies one currently playable edition,
its real client/build and SavedVariables location, and consents to a reviewed
test build being installed while the game is closed. The existing selected
7.3.2 manifests cannot validate the new capture contract. Installation and real
report submission remain separate approvals; the agent has not performed them.

Then one consenting recorder and a normal party complete one supported dungeon:
start recording before the first timing/native boss event, capture the required
native encounter successes and final boss, retain unknown freshness honestly,
and flush SavedVariables by a normal logout/reload after completion. Review a
selected run export locally, then explicitly approve its submission to the
agreed test destination. Verify edition/build/catalog/difficulty, continuous
timeline and gaps, personal presence, role, completion checkpoints, Companion
acknowledgement, and identical backend/web/addon eligibility explanations.

That single run establishes only a positive capture path. Full acceptance still
requires two independently consenting observers: full Guilded on one client,
standalone Guilded Dungeons on the other, each with its own Companion upload.
Repeat with both addons installed on one client to check single capture (not a
second witness), plus late join, wipe, reload/disconnect, role change and retry.
Keep each edition/build/difficulty's samples separate. Repeat on Forever's actual
launch build when available; declarations and mocked API fixtures are not gameplay
evidence. Optional boss mods are not required. Do not claim untouched full-route
proof from provisional final-boss-only catalogs.
