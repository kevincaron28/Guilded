# Selected pre-launch community work — 30 October 2026

Kevin selected items 3, 4, 5, 6 and 7 from the seven-item discussion for today's
pre-launch roadmap. Items 1 (personal goals) and 2 (mentoring) are excluded.
Implementation is authorized on an isolated branch; launch is November 4, not
October 30. Completion and publication are separate decisions.

## Coordination

Base: main `930ae040e3a51ce916abe302015950156fe83738`, fetched October 30.
Branch: `codex/prelaunch-community-2026-10-30`. The saved cloud checkout was clean.
No AGENTS.md or `.agents/skills` exists in this checkout or its workspace parent;
`CLAUDE.md`, current roadmap, release checkpoint and sync/privacy handoffs were read.
The authorized local release session `01a181ce-30fa-7c60-b973-c385d45d3502`
owns release preparation and its unobservable PC work must not be overwritten.

Open PR #281 owns simpler linking in Companion engine, main process, renderer,
API and addon integration. Draft PR #277 owns Companion renderer/navigation and
French labels, with a certification hold. Their descriptions, comments and file
lists were inspected. Item 6's screen/report wiring overlaps both: reserve those
files and implement isolated helpers first. No open PR owns the alert/community
service files at this checkpoint. Recheck PR/main ownership before integration.

No merges, deployment, version bump, package publishing, Store action, credentials,
network/security changes or Discord content are part of this branch. Preserve
stable 8.0.2, v8.1.0-rc.1 and Submission 5 bytes and manual publication hold.

## Existing paths and acceptance

### 3 — Targeted group/vacancy alerts

Reuse `src/services/group-alerts.ts`, `src/commands/group-alerts.ts` and the
existing group board/queue. Existing matching covers opt-in kinds, character
levels, roles, leader exclusion and per-post mention limits. It does not yet
establish personal time/expiry limits or raid-vacancy subscriptions.

- [ ] Persist explicit subscription settings; show timezone, expiry and off control.
- [ ] Match role and group start time; suppress expired/closed/full groups.
- [ ] Quiet hours handle midnight and timezone/DST transitions.
- [ ] Strict per-member cooldown/daily cap and event dedup survive retries/concurrency.
- [ ] Revalidate membership/channel access before any delivery; no new DMs.
- [ ] Disabled-by-default new delivery; audience/channel/cadence approval required.

### 4 — Cooperative guild challenges

Audit `dungeon-import.ts`, `dungeon-observations.ts`, `dungeon-participation.ts`,
`dungeon-evidence-awards.ts`, guild dungeon transactions and `community.ts`.
Existing reviewed CHALLENGE activities award points; do not route a cosmetic
cooperative challenge through that award path. Existing guild weekly reports
read dungeon runs and point transactions; a report row alone is not new proof.

- [ ] Reuse canonical run identities and existing participation eligibility.
- [ ] Scope by guild, edition, approved rules and explicit half-open time window.
- [ ] Ignore invalid/incomplete runs and duplicate/relayed observations.
- [ ] Distinct dungeon/eligible participant progress remains read-only and cosmetic.
- [ ] No scoring-policy changes, balances, automatic points or legacy baseline rewrite.
- [ ] Moderator configuration/preview and approved display remain separate gates.

### 5 — Personal weekly recap

Reuse `weekly-report.ts`'s reset window and existing signups/earned achievements.
Never expose another member's private report or add a second guild report sender.

- [ ] Private member-scoped preview of known progress, earned badges and signups.
- [ ] Explicit opt-in/off and period dedup; missing data stays unknown.
- [ ] No unselected personal-goals feature or raw chat/audio collection.
- [ ] Recurring delivery remains disabled until audience/channel/cadence approval.

### 6 — Sync status and diagnostic handoff

Reuse enabled-profile status from `companion/profile-engine.mjs` and the existing
report preview contract in `docs/DIAGNOSTIC_PRIVACY_AND_CLIENT_ACCEPTANCE.md`.
Do not infer backend acceptance from an HTTP upload or a file modification time.

- [ ] Local screen identifies edition, character and folder, freshness and next action.
- [ ] Distinguish game save, attempted/successful upload and backend acceptance.
- [ ] Unknown stages remain unknown; old clients/servers remain usable.
- [ ] Diagnostic preview uses a bounded allowlist; excludes credentials, local paths,
      account identifiers, arbitrary logs, SavedVariables and raw error text.
- [ ] Existing bug-report consent/recipient rules apply; cancel/expiry sends nothing.
- [ ] Integrate UI/IPC/report handoff only after resolving PR #277/#281 ownership.

### 7 — Weekly community question/poll

Reuse existing moderator poll permissions and `src/services/poll.ts`; existing
polls use buttons, so native Discord poll support is a separately verified option.

- [ ] Moderator-only configuration, bounded question/options and private preview.
- [ ] Off by default, explicit target channel/timezone/cadence and stop control.
- [ ] One occurrence per week, no catch-up flood or automatic chat/participation XP.
- [ ] No scheduler or actual post is activated by this implementation pass.

## Validation and delivery gates

Record focused behavior tests, full TypeScript/Vitest/ESLint and addon validation
on final source. Tests using mocks are not Discord/game/Windows acceptance.
Any migrations must be additive and applied before a client needing new fields.
No production migration is authorized here. Exact combined-source CI, packaging,
Windows installation and live gameplay remain with coordinated release work.

Implementation and final test results will be appended below; unchecked items
are outstanding, not implied complete by adding them to the roadmap.
