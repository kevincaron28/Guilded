# Communauté: clickable activities and readable seasons

Research and proposal, 2 October 2026. The core upgrades are now implemented locally;
no live changes were made. See [COMMUNITY_EXPERIENCE.md](COMMUNITY_EXPERIENCE.md)
for delivered behavior, validation and the gated rollout, and
[POE2_DISCORD_INTEGRATION.md](POE2_DISCORD_INTEGRATION.md) for the requested PoE2 analysis.

## Recommendation

Keep the three existing channels and give each a clear job. Make `activites` the
member entry point with a persistent clickable panel and upcoming activity cards.
Keep `🏆・leaderboard` for the podium, with shortcuts to personal points and dice.
Keep `chat-communaute` for conversation, suggestions and finding teammates.
Show **Saison 1 — Octobre 2026** instead of asking members to copy a database ID.
Launch this navigation improvement before adding more games or increasing rewards.

## Evidence from the live server

The existing REST-only inventory and a temporary read-only audit inspected channels,
Guilded-authored panels, installed commands and aggregate database records. Neither
opened a bot gateway session, sent a message nor changed data. Observations are a
snapshot, not a measurement of long-term engagement.

| Area | Observed state | Consequence |
| --- | --- | --- |
| Category | `Communauté`, containing `activites`, `🏆・leaderboard`, `chat-communaute` | A compact structure already exists; more channels are unnecessary initially. |
| Activities | Pinned “Activités communautaires” guide, no action buttons | It explains what to do without letting members start. |
| Podium | Pinned podium with links to activities/chat; dice, wallet and rankings require commands containing a long internal ID | The member must leave the panel and copy technical text. |
| Season | One active unrestricted DISCORD season, named `Season 1`, hosted in `leaderboard` | A name exists already, but commands require its database ID. |
| Activity records | One CLOSED DICE round; one award of 5 points; one member with a point record | No gaming night, quiz, lottery or challenge was configured in these season records. CLOSED is normal for the internal daily dice round. |
| Participation | No participation configuration for that season | Automatic chat, reaction and voice rewards are unconfigured; the UI must not imply they are active. |
| Installed commands | Community and participation season fields require strings without autocomplete | The friction is present in the registered server commands as well as local source. |

Source review found an additional structural issue: `CommunitySeason.channelId`
determines both where activities must be created and where their cards are posted.
The podium publishes only unrestricted Discord seasons hosted in its own channel.
Starting a second DISCORD season in `activites` fails while the current one is active;
moving the existing season without adapting podium selection can hide its leaderboard.
Separate announcement routing from ranking presentation as part of this upgrade.

## Member experience

### Activities panel

Pinned heading: **À toi de jouer · Saison 1 — Octobre 2026**.

First row: **🎲 Lancer le dé**, **🎮 Activités en cours**, **📊 Mes points**.

Second row: **🤝 Remercier un membre**, **🏆 Classement**.

- Dice calls the existing daily dice service, returns the roll and points privately,
  and displays the next reset using a Discord timestamp. A repeated click returns
  the original result with “Déjà joué aujourd’hui”; it never awards twice.
- The public dice button stays usable for everyone. Only the clicking member's
  private response can show their personal “already played” state.
- Activities opens a private, permission-filtered list of current cards, sorted
  by start time/deadline, with direct links to the original public posts.
- Points shows earned score, spendable balance and recent awards. These must be
  distinguished because buying tickets changes balance without reducing rank.
- Thanks opens a member selector and a short explanation form, reusing reviewed
  helper nominations. Show that points require officer approval. If participation
  is unconfigured, explain this instead of implying the action already earns points.
- Ranking shows the current board privately or links to the public podium.
- With no active season, explain the state and retain navigation to accessible
  archives. With no activities, show a useful empty state rather than a broken list.

Private answers keep daily rolls and wallet checks from flooding the channel.
No member needs a slash command for these routine actions; commands remain a fallback.

### Existing activity cards

| Activity | Existing member action | Upgrade |
| --- | --- | --- |
| Dice | Slash command | Add the persistent daily button, available from hub and podium. |
| Quiz | A/B/C/D buttons | Put the question, deadline, point value and single-attempt rule first; feature the current quiz from the hub. |
| Gaming night | Present / Maybe / Absent buttons and waitlist | Prefer “Je participe” for the signup label; show available places and add the linked Discord event. Signup and verified attendance remain separate. |
| Challenge | Evidence-link form | Surface deadline, objective, points and the member's pending/approved/rejected status; provide a link to the submission. |
| Lottery | Ticket-quantity form for every mode | Free lottery: one direct click for its one free ticket. Points lottery: show quantity and total before explicit confirmation. In-game currency retains organizer payment review. |
| Helper recognition | Participation command | Add member selection and explanation to the hub. Retain limits and independent officer review. |
| Poll | Existing `/poll` button voting | Use it for choosing the next game/night; add a featured poll link. Voting need not award points. |

Hub shortcuts must lead to the actual activity message rather than reposting cards
with copied state. Existing handlers reject interactions outside the season channel,
so private discovery should initially use message links. Supporting forms directly
inside discovery requires deliberately adapting location checks.

## Season numbers and names

Use both: **Saison 1 — Octobre 2026**, followed by **Saison 2 — Novembre 2026**.
Optional themes can replace the subtitle, such as **Saison 2 — La gang en coop**.
Use separate numbering per server and game: **WoW · Saison 1 — Automne 2026**
and **PoE2 · Saison 1 — [ligue choisie]**. A bare “1” is ambiguous across games.

The current season can be renamed for display without closing it or resetting its
points. Its immutable database ID remains the internal reference for entries,
awards, old links and buttons. Member-facing messages should display the name.

P0, without a numbering migration:

- Add permission-filtered autocomplete to community and participation season
  options, showing name + game + active/archived state and returning the existing ID.
- Reuse this presentation for activity IDs: select a title, type and date instead
  of copying a code. Preserve raw-ID compatibility for old commands.
- Member dice/wallet/progress shortcuts resolve the active eligible DISCORD season.
  Optional command defaults can do the same when unambiguous; administration should
  still select a season explicitly. No match means a helpful explanation, never a guess.
- Archived seasons remain selectable for history; actions that award points filter
  to active seasons and relevant games. Duplicate names are disambiguated.
- Add an officer-only season rename action with an audit record and panel refresh.

P1, durable automatic numbering:

- Add an additive `number` field unique on `(guildId, game, number)`.
- Backfill existing seasons deterministically by creation date, then ID, per server
  and game; retain all names, IDs, points, activity records and final snapshots.
- Allocate numbers inside the existing per-guild transaction lock. Never derive a
  number from a count at display time; deletion and concurrent starts must not reuse it.
- Keep an explicit theme/name field; render the same season label across cards,
  autocomplete, archives, wallet and participation status.
- The default cadence is monthly for Discord. Organizer review closes outstanding
  activities, proofs and nominations before opening the next season. The existing
  system does not support unattended monthly rollover or a planned season end date.

## Delivery order

| Priority | Work | Relative effort | Dependency |
| --- | --- | --- | --- |
| P0 | Dice/points/ranking buttons; readable season autocomplete; public panel cleanup | Small–medium | Deployed interaction handlers must precede live panel buttons. |
| P0 | Separate activity announcement destination from podium; preserve existing messages | Medium | Additive routing data and permission checks. |
| P0 | Officer rename and safe current-season defaults | Small–medium | Shared season resolver and authorization. |
| P1 | Automatic season numbering and readable activity pickers | Medium | Migration/backfill and command registration. |
| P1 | One-click free tickets, explicit points spending confirmation, helper form | Medium | Reuse transactional activity/participation services. |
| P1 | Officer templates and a weekly schedule summary | Medium | Reuse quiz, challenge, poll and Discord event features. |
| P2 | Cosmetic achievements, themed season archive and optional reminder preferences | Larger | Evidence that members use the basic hub. |

These are comparative estimates from source review, not committed delivery dates.
No product version bump is needed for the proposed bot-only changes.

## Activities worth launching

Start with a manageable two-week pilot: daily dice, two short quizzes each week,
one weekly game-choice poll, one gaming night, and one reviewed cooperative challenge.
An occasional free draw can be added when an organizer has an actual prize ready.
Promote these through one weekly digest and the live hub; avoid daily role pings.

Feature the community goal and helpers alongside the competitive podium. Enable
participation rewards only for explicitly chosen chat/voice channels, with the
existing caps and visible earning rules. Avoid streak penalties and unverified
auto-completion rewards. Guilded currently has display badges at 50/150/300 points;
cosmetic Discord roles would be a separate feature, not a promise already fulfilled.

Do not increase rewards just to produce a busier leaderboard. Current dice averages
6.1 points/day (5 base + a 10-point bonus on 11 of 100 outcomes); configured shared
voice can award up to 32/day. Review how sources affect ranking after the pilot,
and celebrate helpers separately so the board does not only reward time online.

## Implementation constraints and acceptance

Primary files: `src/commands/community.ts`, `src/commands/participation.ts`,
`src/commands/autocomplete.ts`, `src/services/community.ts`,
`src/services/community-leaderboard.ts`, `src/setup-names.ts`, `src/main.ts`,
and, for persistent numbering/routing, `prisma/schema.prisma` and an additive migration.
The merged `/community` command also needs Discord command-size coverage.

A suitable routing design adds an optional season announcement channel and stores
each existing posted activity's original channel before changing its destination.
New posts use `activites`; previous messages remain editable at their actual location.
Keep `season.channelId` as the existing scope anchor until all selection/permission
uses are accounted for. Validate both the member's season access and the destination
channel; never expose a restricted game season in the public hub. This design needs
engineering validation during implementation, not a blind channel-ID replacement.

Acceptance criteria:

- An ordinary eligible member can roll and see personal points from the panel
  without copying an ID. Double clicks, concurrent clicks and restarts award once.
- Reset calculations use the server timezone, including midnight and DST changes.
  Archived buttons cannot award; they provide a route to the current season.
- Autocomplete and discovery reveal only visible, authorized seasons/activities,
  including after role changes. Authorization is checked again on execution.
- Personal click state never disables the shared public button for other members.
- Free lottery duplicates return the existing entry. Paid participation requires
  an explicit confirmation and uses the existing atomic balance and entry checks.
- Season rename/number backfill preserves the current 5-point award, ledger references,
  activity IDs and archived snapshots. Number allocation is concurrency-safe.
- Activity routing keeps the old message history; no duplicate seasons or cards.
- French and English text fit Discord limits and work on mobile. Persistent buttons
  still work after a bot restart; publish them only after matching handlers are live.
- Empty, paused, full, expired and unavailable states give readable feedback.
- Validate PostgreSQL migrations and Discord permissions before rollout, plus the
  repository's required TypeScript, tests, ESLint and addon validation checks.

## Measuring the pilot

There is only one point-bearing member in this snapshot, so there is no meaningful
historical engagement baseline. Capture a seven-day baseline or treat week one as
baseline, then compare the following week. Proposed targets are hypotheses:

- In a small member usability test, at least 4 of 5 complete a roll and find their
  points within 15 seconds without instructions or a copied code.
- Zero duplicate awards and zero unauthorized cross-season disclosures.
- At least 95% of eligible button attempts complete successfully during the pilot;
  record rejected/expired actions separately from system errors.
- Weekly unique activity participants and repeat participants increase over baseline.
  Report absolute counts as well as rates; a tiny initial sample makes percentages noisy.
- Organizer time to publish a gaming night or quiz decreases once templates ship.

Existing entries/awards can measure participation. Button-attempt/error rates and
task times need measurement added during implementation; they are not currently known.

## Research sources and remaining decisions

Discord supports buttons, select menus and forms, so this can use normal bot messages.
An action row allows five buttons or one select; selects allow 25 options, making
pagination important for archives. Keep the existing embed/button rendering initially:
Components V2 changes the message format and disallows the old content/embeds fields.
See [Component Reference](https://docs.discord.com/developers/components/reference).

Interactions need an initial response within three seconds and can reply privately.
Acknowledge before database/network work; form opening itself is the initial response.
See [Receiving and Responding](https://docs.discord.com/developers/interactions/receiving-and-responding)
and [Application Commands](https://docs.discord.com/developers/interactions/application-commands).

Reuse the existing native event integration: Discord's Interested button provides
event-start notifications, while Guilded's signup and attendance remain the source
of activity participation and awarded points. See
[Scheduled Events](https://support.discord.com/hc/en-us/articles/4409494125719-Scheduled-Events).

Community Onboarding can personalize channels and roles, but currently requires seven
default channels, including five where everyone can view and send. It is optional
later work: do not loosen this server's existing acceptance/role permissions just to
enable it. See [Community Onboarding FAQ](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ).

Non-blocking owner preferences: monthly versus themed Discord seasons; which games
to feature in the pilot; which channels should earn participation rewards. Defaults
above support implementation without changing live settings during this proposal.

Scope: bot/member experience only. Addon/companion redesign, public release publication,
real-currency rewards, and automatically removing Carl-bot are separate work.

## Initial research validation snapshot (superseded)

At the initial research stage, only this proposal changed. Required checks were run:
TypeScript, ESLint and addon static validation passed. The full suite reported
1,044 passed and five failed tests across the addon parsing, core loot policy and
raid import suites. Other work was changing these files during the research;
the failures are outside this proposal, which changes no executable product code.
These results do not authorize a deployment or establish a stable release baseline.
