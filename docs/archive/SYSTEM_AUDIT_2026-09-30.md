# Guilded system audit — 2026-09-30

The live service is healthy. The guild needs setup and re-pairing after its destructive reset. Automated checks and read-only live inspection do not replace a two-player WoW test or a real raid night.

## Verified state

| Area | Result and limits |
| --- | --- |
| Oracle | HTTPS health 200, version 5.0.0/protocol 2. Managed service active, no automatic restarts since its last deployment. About 196 MB service memory, 40 GB disk free at inspection. |
| Database | All 52 migrations completed, none unfinished. Recent ledger uniqueness preflight passed. |
| Guild setup | Reset at 2026-09-30 13:50:54 UTC. All 16 channel settings unset; retained members, raids, imports and runs are empty. Pairings were revoked. Auto-apply is off, base GP zero. Expected reset outcome. |
| Installed addon | All 34 source Lua/TOC/XML files match after normalizing line endings. Generated Standings.lua excluded. |
| Companion | Running, correct HTTPS host, saved-data file exists. Old pairing is rejected; actual account must re-pair. No credentials recreated or printed. |
| Dependencies | Both npm scans report zero known vulnerabilities at inspection. This is not proof that all vulnerabilities are absent. |
| Public API | Health 200, anonymous standings 401, unrelated route 404. HTTPS-only credential requests and refused redirects reviewed. |
| Permissions | Bot currently has Administrator and channel/role management. Message Content Intent enabled; FAQ needs a configured channel. |
| Logs | Targeted last-24-hour scan found no matched backup failures, auto-import failures, calendar-fetch warnings, FAQ failures, missing permissions or unknown interactions. |

## Corrections made during the audit

- **High: role slots could overfill under concurrent clicks.** Raid signup/cancellation/cap edits and dungeon join/leave/close now use transaction-scoped PostgreSQL advisory locks. Real database integration tests exercise simultaneous contenders for one role slot.
- **High: dungeon starts and cleanup could overlap.** Per-group queues serialize clicks and cleanup in the single bot process. Starts check current state and reuse started groups' voice references. Queue failures do not block later operations.
- **Medium: voice access drifted from dungeon membership.** Current signups and the leader determine access after roster changes, including promoted waiting members. Departed members lose their explicit overwrite. Already connected users are not forcibly disconnected. Permission failures show a saved-signup warning.
- **Medium: daily backups could be incomplete and were readable by other local users.** Private directory/files (0700/0600), tighter old-copy permissions, a RepeatableRead database snapshot, flushed temporary writes and atomic publication now protect them. Corrupt daily copies are replaced. These JSON copies supplement native PostgreSQL recovery backups; they are not a complete native restore tool.

## Workflow review

- Setup/reset covers general signup, guide and FAQ, renamed configured channels and recognized survivors in Guilded categories. Administrator/server-name confirmation remains. Reset revokes pairings and excludes dated old ledger/loot/raid/run history from later imports.
- Complete profession self-reports remove dropped skills, recipes and cooldowns; timestamps prevent older reports restoring them. Addon-only members can relay through an online officer and paired companion. At least one officer bridge and a game save/reload/logout are still required.
- General/core raid posts use one raid and roster. Post writes are serialized and periodically repaired. Core channels and separate pools have automated coverage; reset erased the live fixtures, so real core behavior cannot currently be demonstrated from retained data.
- Public group creation exposes dungeons only. Closed posts expire after 48 hours. Database run and season archives are separate from message cleanup.
- Archived seasons persist until destructive reset. Discord offers the latest 25 in its selector; companion/addon snapshots show the latest 10 archived seasons. Officer relay limits past standings to 10 players. Display bounds do not erase database history.
- Calendar transfer depends on supported game APIs and the bridge. Game answers fill unanswered Discord signups; Discord choices win. Title/time fallback within 90 minutes can be ambiguous for concurrent core events.
- Raid markers, calendar creation and dungeon results are installed and tested against mocked Lua APIs. Actual combat restrictions, game API support and multiplayer behavior remain real-client gates.

## Review assessment

| Dimension | Assessment |
| --- | --- |
| Correctness | Improved concurrency and voice consistency; feature acceptance pending after setup. |
| Security | Revocable personal credentials, fresh role checks, upload allowlists, HTTPS, sandboxed Electron renderer and restricted public routes are strengths. Administrator is broader than needed for a polished release. |
| Performance | Adequate observed server headroom. Measure standings latency and size as the guild grows; requests aggregate guild datasets and fetch roles. Keep-awake polling can increase hosted database compute use. |
| Maintainability | Broad tests and cross-platform/database CI are strengths. Large command files and stale release-checklist status make readiness harder to assess. |

## Recommended priority order

1. **Restore setup and the officer bridge.** `/setup start`, create/reuse channels, choose point values/import policy, rebuild cores, then `/character pair` from the actual officer account. Link member identities for Discord attribution. Do not restore old credentials.
2. **One system/sync status screen.** Channel permissions, pairing/relay availability, last accepted upload, pending imports, last successful post and snapshot age, with a plain repair action. Separate game save, upload, database apply and Discord publication.
3. **Two-player acceptance, then a real raid night.** Signup from both posts, slot contention, core loot/pools, unlearned profession relay, calendar create/accept, dungeon completion/results and season standings. Also test Windows clean installation and upgrade on a non-developer PC.
4. **Explicit calendar identity.** Carry raid IDs through event metadata, prefer IDs over title/time matching and show ambiguity instead of guessing between cores.
5. **Persistent publication retries.** Failed Discord updates should survive restarts for profession, raid and season posts. Acceptance and successful publication should have separate status.
6. **Season archive/hall of fame.** Pagination beyond 25 seasons, immutable winner summaries and tie rules, separate all-time records and clear reset consequences.
7. **Minimum permissions and recovery operations.** Test without Administrator, check role hierarchy, confirm this account's Neon recovery retention, keep encrypted recovery copies away from the VM and rehearse restore periodically.
8. **Polished onboarding/UI.** Prominent post-reset pairing guidance, officer-relay availability, profession scan ages, opt-in eligible-crafter notifications and compact raid-marker polish before standalone release.

Platform sources: [Discord permissions](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Neon recovery principles](https://neon.com/blog/point-in-time-recovery-in-postgres). Provider retention was not assumed or verified from the account.

## Delivery evidence

Local validation: 826 tests across 113 files, TypeScript, ESLint and addon validation pass. Deployment also requires PostgreSQL concurrency/backup/restore checks and Windows packaging on GitHub, a verified native recovery backup, and post-deployment health/permission checks. Exact deployment evidence is saved locally in `backups/system-audit-completion.json`. This audit does not send guild messages, create live fixtures or perform another reset.
