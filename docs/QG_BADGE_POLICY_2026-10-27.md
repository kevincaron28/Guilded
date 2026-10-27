# Québec Gold member badge shelves

Local candidate on `codex/qg-badge-visibility`, based on deployed `900c561`.
This is separate from the unfinished current-v2 dungeon candidate. No version
bump, migration, role deletion, message deletion, deployment or publication.

## Owner-requested behavior

For Discord `1323321076478119967` only, all seasonal community badge shelves are
visible to eligible current members. Both Discord and signed-in web views keep
their existing guild, season-channel and audience-role checks. The web endpoint
still refuses anonymous access; public character profiles gain no fields. Only
badge labels and dates are rendered, never proof links or review notes.

Per-guild command registration removes `community badges share` for Québec Gold.
Cached requests explain the policy without changing saved preferences. Existing
sharing rows remain intact; other Discord servers keep opt-in sharing and its
command. This policy applies to past and future accessible community seasons,
with no announcement backfill or new reward/role/point grants.

## Trial Member / Raider investigation — clarification needed

Read-only Discord inventory at 11:25–11:31 UTC found 238 members and no roles named
Trial Member, Raider or a direct French equivalent. Reading up to 100 recent
messages in each of ten relevant welcome/guide/announcement/officer/community
channels found no such announcement. This bounded search does not establish that
older messages or messages in another channel never existed.

Read-only production configuration at 11:29 UTC:

- `memberRoleId` is null. All 16 tracked members are ACTIVE; no trial core members.
- `applicantRoleId` is **Exilé**, `1326368244587560991`, held by 219 Discord members.
  It has substantial ordinary chat/voice permissions and five zero-bit channel
  overwrites. The join/rules-acceptance path can assign it; approving an application
  can remove it. It must not be mistaken for an unused trial role.
- **Les Aggros Anonyme**, `1558022545087664289`, and **Les Pulliticiens**,
  `1558027863809331232`, are separate raid-core roles with no members. Each has
  chat/voice access overrides on its core channels. These are not generic Raider
  roles and are outside the identified removal scope.
- **Recrue du mois**, `1558066162401808527`, is a monthly community honor with no
  permissions, members or overrides. Its descriptive posts are not trial notices.

The source contains officer-log notices for joining/leaving configured guild
roles, a trial-ended reminder for raid-core applications, and reviewed application
decisions. None identifies a distinct Trial Member/Raider automatic rank system.
No suppression or role changes have been made on an inferred target. Ask for one
message link or exact role name before selecting that system for removal. Any
actual role deletion needs an exact impact review and action-time confirmation.

Private role/member/permission and configuration snapshots are under ignored
`backups/` in this worktree and the dungeon worktree. They are not release files.
Deleted Discord roles cannot be recreated with the same ID.

## Validation and rollout

Validation passed: TypeScript, ESLint, 316 Vitest files / 2,681 tests, and both
addon static validators. Tests cover
both visibility policies, preserved sharing rows, stale sharing requests, scoped
command registration, anonymous/nonmember/restricted-season denial and proof
redaction. Existing delivery tests protect the achievement congratulations flow.

Publication, protected-main merge and deployment remain pending explicit release
approval. After deployment verify registered command options in Québec Gold and
an unrelated server, authenticated own/member shelves, denied anonymous access,
and no new historical announcements. No live test achievements should be created.
