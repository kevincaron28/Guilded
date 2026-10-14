# Combined 6.1 release handoff — 13 October 2026

The owner requests one compatible release after the separate dungeon chat is
finished: push and update all online components so this session can be closed.
The next planned product version is 6.1.0; this is an intentional release bump,
not a dependency housekeeping change. Do not bump while the dungeon work is
still in progress, and remember the version announcement side effect.

## Dependency and integration

- Completed dungeon chat: **Add guild-only dungeon scores**, local thread
  `01a13781-10b7-7343-90f8-44a0673d0147`.
- It is editing an isolated worktree at
  `C:\Users\Kev\.codex\worktrees\guild-dungeon-scores\Quebec Gold Bot`.
  Read its final result and exact committed branch/PR before integrating. Do
  not copy an in-progress tree or modify that worktree underneath the chat.
- Bridge PR: https://github.com/kevincaron28/Guilded/pull/64, branch
  `codex/bridge-default-on`. Runtime fixes are commits `752e05f` and `5aced94`.
  The latter fixes guild-home matching across Forever's PvP/PvP 2 labels.
- Preserve the shipped boss timer, saved visibility toggle, encounter timings,
  and daily readiness limit. Oracle currently runs `745be20`, version 6.0.0,
  protocol 2. The bridge follow-up is locally installed and provided to Naomine
  as a two-file patch; it has not yet been published as a full updated release.
- Dungeon scope approved in the other chat: guild-only rankings; a Dungeon
  Group Finder score tab; 200 points at target time, bounded to 50–400;
  current and archived per-dungeon breakdowns with frozen seasonal rules.
  Final commit `acfb6a2` was merged into `codex/release-6-1`. The owner approved
  provisional targets for 16 dungeons/wings through October 22; see
  DUNGEON_BETA_PRESET_2026-10.md. No live season reset has occurred.

## Evidence and remaining checks

The owner confirmed bridge reception from Highpriest on Naomine, retained sender
status and core data after reload while Highpriest was logged out, matching core
names/loot methods/EP/GP, and the requested calendar comparison. Both characters
are WoW officers. The owner chose to stop further bridge testing and report bugs
for the next version. Unobserved ordinary-member permissions, private-event
exclusion, changed/cancelled snapshots and other edge cases remain follow-ups;
do not silently mark them passed. See OFFICER_COMPANION_BRIDGE.md.

Bridge source passed TypeScript, ESLint, addon validation and 169 files / 1,392
tests before this documentation handoff. That does not validate the combined
release. Check new seasonal transfer authorization, guild-home/name handling,
packet pacing and size, TOC load order, preserved SavedVariables, new migration
ordering, old companions, old seasonal records and archived-score behavior.
Do not invent targets or rewrite earned scores when integrating the rating work.

## Delivery sequence

1. Wait for the dungeon chat's finished, reviewed candidate; resolve any stated
   required game check or owner decision before claiming the release is ready.
2. Reconcile committed branches, preserve all local work, align the shared
   addon/bot/companion versions and release notes at 6.1.0. Review protocol
   compatibility instead of bumping the protocol incidentally.
3. Follow AGENTS.md and V5_0_RELEASE_HANDOFF.md: release:prepare, required tests,
   final-commit PostgreSQL and Windows CI, production ledger preflight, verified
   production backup and encrypted offsite recovery before deployment.
4. Merge/push the combined release, deploy via the owner's authenticated setup,
   and verify the exact deployed commit, bot service and companion API health.
   Never start a second bot locally.
5. Rebuild and publish matching addon/companion artifacts and website/download
   metadata. Upload the authorized full release to CurseForge and verify its
   actual availability/status, not just successful submission. Preserve local
   companion pairing and WoW SavedVariables when installing updates.
6. Keep dist clear with one obvious current release to install. Record artifact
   checksums, GitHub/CurseForge links, deployed commits, verified checks and any
   remaining manual limitations. Only then report the session ready to close.

No authorization to message the other chat has been given; inspect it read-only.
The owner's explicit Discord permission covered sending the patch to claudyazes,
not general release announcements. Do not send extra announcements by DM.

## Combined candidate — 13 October 2026

Shared version is intentionally 6.1.0, protocol remains 2. Integration fixes
prevent seasonal-detail UI retries from restarting a paced transfer and preserve
the client-provided whisper address across server labels. Regression tests cover
more than 60 paced chunks and a server-suffixed recipient.

The new Dungeon Group Finder layout, seasonal-detail delivery to the second PC,
and real eligible/carry run evidence remain unverified. Existing bridge
acceptance above does not cover these new paths. Do not publish a stable release
or claim completion until the required real-client gates are resolved.
