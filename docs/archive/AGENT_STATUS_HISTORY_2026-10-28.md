# Historical agent status checkpoints

Archived October 28, 2026. These records describe their dates, not current deployment state.

> 7.5.1 (27 October 2026): Claude finished Codex's dungeon-current-v2 work (Codex out of capacity) and
> released it with PR #241's loot/site fixes at Kevin's request; Season 1 stays current-v1. See
> docs/V7_5_1_RELEASE_NOTES.md. PUBLISHED from 7f2b3d9: Oracle healthy on 7.5.1 (three migrations,
> backups first), GitHub v7.5.1 with all 21 assets hash-verified, all ten CurseForge files uploaded
> (CDN hashes match; approval pending when recorded). Evidence: backups/release-7.5.1/.
>
> PREVIOUS — 7.5.0 published 26 October 2026 from bda3382. Oracle healthy, protocol 2,
> commands accepted, four migrations applied, all 21 GitHub assets hash-verified.
> All ten CurseForge edition files approved and CDN hashes reverified 26 October.
> Microsoft Store Submission 1 is IN CERTIFICATION, with automatic publication
> after approval. Restricted synthetic reviewer credentials saved with owner consent.
> Read docs/SESSION_HANDOFF_2026-10-26.md for current provider status and pending tests.
> Claude's live Discord/web walkthrough and limits are recorded in
> docs/POST_RELEASE_REVIEW_2026-10-26.md. His text fixes merged in #236.
> Earlier checkpoints below are historical and their draft/local-only holds superseded.
>
> 7.5.0 (26 October 2026): combined release candidate; Claude PRs #226–#228, #230 and #231
> (launch-week addon tools) integrated; main 490d6db. With Store review polish: 311 files / 2,654 tests, TypeScript/lint/addon checks and disposable
> PostgreSQL migration/backup/restore pass. Store upload validated; preview installed,
> captured and removed with its temporary certificate. WACK completed with WARNING,
> not a clean pass. See docs/store-submission/LOCAL_VALIDATION_2026-10-26.md.
> Version chosen by Kevin via the shared coordination notes. Public/live remains 7.4.0.
> Read docs/V7_5_0_RELEASE_NOTES.md and docs/STORE_HANDOFF_2026-10-26.md.
>
> Local release-gap work (26 October): read docs/RELEASE_GAP_WORK_2026-10-26.md.
> Branch codex/release-gap-completion adds audited main/alt apply, participation,
> opt-in availability, edition events and optional Classic buffs. Not deployed.
> Owner retained the license and then authorized progressing toward Store submission;
> see docs/MICROSOFT_STORE_MSIX.md. Guilded Companion is reserved in Partner Center
> as 9N680XX3QFL9; Store-identity build verified, Submission 1 remains a draft.
> See docs/STORE_HANDOFF_2026-10-26.md for upload/certification blockers.
> Claude owns edition raid presets in qgb-claude-gaps; coordinate through
> backups/CODEX_CLAUDE_COORDINATION_2026-10-25.md before integration or restart.
>
> 7.4.0 (25 October 2026): published on GitHub and deployed to Oracle at 8837fd9.
> Both clean-main CI jobs and 2,548 local tests passed; all 21 public assets verified.
> This supersedes the earlier local-only holds below. Read docs/SESSION_HANDOFF_2026-10-25.md
> for release execution and every unfinished acceptance check. Protocol remains 2.
> Claude 816c7af and b9fd62c are included; preserve his separate checkout.

> Latest local bundle review (25 October): docs/LOCAL_BUNDLE_REVIEW_2026-10-25.md.
> 295 files / 2,548 tests passed. Added current core-interaction authorization,
> isolated forms, paginated/exact character picks, atomic backup pages and GRM edge fixes.
> Earlier fixes cover stale roster previews/scope, GRM privacy and
> import validation, availability retry privacy, report scrolling and core response timing.
> Local-only hold continues; core.ts/core-editor.ts/core-planning.ts extend Claude 816c7af.
>
> Local review continuation (25 October): native roster action plans, desktop/CLI GRM
> history migration and edition buff coverage are implemented but uncommitted. See
> docs/LOCAL_ROSTER_GRM_BUFFS_2026-10-25.md (292 files / 2,491 tests passed).
> The owner explicitly keeps this feature bundle local: no publication or version bump.
> Real-client acceptance and Forever custom spell confirmation remain pending.
> Claude 816c7af and b9fd62c changes are integrated unstaged; preserve them before any pull.

> 7.3.2 (25 October 2026): owner authorized full release before the unavailable Forever
> two-PC tests. The prior publication hold is superseded by docs/RELEASE_DECISION_2026-10-25.md.
> Game checks remain pending follow-up; benchmarks remain provisional.
> Current release gaps and operational fixes: docs/RELEASE_GAPS_2026-10-25.md.
> All ten CurseForge edition files are approved. The candidate entries below are
> historical; their publication holds are superseded by the owner's release decision.
> 25 October continuation: multi-edition connected candidate on codex/game-editions,
> PR #216 (stacked on #215/#214). Forever, Era, TBC, Mists and Retail have separate
> guild contexts in one Discord, role IDs, companion profiles, realm identities,
> public seasons and packages. Forever first/last display names retain ledger keys.
> Retail native key/affix/timer evidence and separate keystone leaderboards are implemented.
> Source-reviewed Classic/Retail routes, provisional benchmarks and Raider.IO-inspired
> seasonal Guilded scoring are prepared; see docs/DUNGEON_CATALOG_2026-10-25.md.
> Real-client acceptance and benchmark calibration remain release gates.
> Setup, validation and remaining work: docs/RELEASE_SCOPE_2026-10-25.md.
> 7.3.2 (23 October 2026): deployment candidate for UTC sessions, dungeon evidence/guidance,
> staged recovery and companion startup fixes. Real game/two-PC acceptance remains pending.
> Deployed for testing on 23 October; public release is explicitly held. Current preparation,
> completed operational checks and remaining gates: docs/LAUNCH_READINESS_2026-10-24.md.
> Claude review handoff for the 24 October Codex session: docs/AI_HANDOFF_2026-10-24.md.
> Includes companion installation, Discord evidence/cleanup, fixed shared dungeon scoring,
> exact validation state and the continuing public-release hold. Read it before continuing.
> 7.3.1 (22 October 2026): raid readiness requires level 60 and flags old checks; companion Update now
> repair (a companion on 7.2.0/7.3.0 needs one manual install). Live on the bot and GitHub; CurseForge
> has 7.3.0. Pre-release audit and recommendations: docs/PRE_RELEASE_AUDIT_2026-10-22.md.
> 7.3.0 (20 October 2026): safe-exit dungeon result card in both addons, optional cross-guild raid vacancies and companion browser, public player profiles and dungeon setup guide. See docs/V7_3_0_RELEASE_NOTES.md for deployment and pending real-client acceptance.
> 7.2.1 (20 October 2026): leaderboards-only companions read GuildedDungeons.lua AND Guilded.lua
> (companion/personal-runs.mjs); pool of 8 DB connections (src/database.ts); /health "commands" and
> deploy/update.sh stops when Discord refuses them; error reports carry their origin; official
> seasons (/guilded-season) (docs/V7_2_1_RELEASE_NOTES.md).
> 7.2.0 (19 October 2026): companion Sign in with Discord (/me/companion, src/services/companion-signin.ts),
> one-click Update now (companion-app/update-check.cjs), one site menu in site/nav.mjs (docs/V7_2_0_RELEASE_NOTES.md).
> 7.1.0 (19 October 2026): monthly dungeon seasons (/organize dungeon-seasons), weekly/monthly boards,
> Raider.IO-style leaderboards; weekly reset Tuesday 15:00 UTC (docs/V7_1_0_RELEASE_NOTES.md).
> 7.0.0 (19 October 2026): web sign-in and recruitment (/mod recruit), public dungeon leaderboards
> (/mod leaderboard), standalone Guilded Dungeons addon (addon/GuildedDungeons; after editing Guilded's
> shared dungeon Lua run `npm run dungeons:sync`), companion personal mode and CSV export, /officer export,
> startable provisional all-level season. /officer is the largest command: 3,431 of Discord's 4,000
> characters on 21 October 2026 (/character 3,346; the size test fails above 3,900). Put new
> officer subcommands elsewhere (docs/V7_0_0_RELEASE_NOTES.md).
> 6.7.0 (18 October 2026): members see only their commands; leader and officer tools under /lead,
> /officer, /organize; Integrations-visibility warning in /setup (docs/V6_7_0_RELEASE_NOTES.md).
> 6.6.0 (18 October 2026): Guilded Lite for unapproved hosted servers, dungeon rules v6 with level
> brackets (not active), `/guilded sheet` spreadsheet copy, Ko-fi links (docs/V6_6_0_RELEASE_NOTES.md).
> 6.5.2 (18 October 2026): update prompts (companion banner, self-hosted bot notice; migration
> 20261118090000_update_notice), pairing code shown first (docs/V6_5_2_RELEASE_NOTES.md).
> 6.5.1 (17 October 2026): companions connect with the pairing code alone (docs/V6_5_1_RELEASE_NOTES.md).
> 6.5.0 (17 October 2026): raid-night tools, member EP/GP history, core planning (bot; migration
> 20261117090000_core_planning) (docs/V6_5_0_RELEASE_NOTES.md).
> 6.4.0 (17 October 2026): guided guild setup, raid summary, level-aware gear check; party games only
> in Guilded Games (docs/V6_4_0_RELEASE_NOTES.md). G9 with Games passed on two PCs; companion 6.3.1->6.3.2 upgrade passed.
> 6.3.2 (17 October 2026): in-game polish pass, guided Local guild page, quieter readiness sync
> (docs/V6_3_2_RELEASE_NOTES.md). Two-PC: chat tab, member SR+ and the rest of G1 pass.
> Not run in game: G6-G8 (dungeon runs), G10 (French client), the 6.1.2 parts of G2/G12.
> 6.3.1 (16 October 2026): Forever whisper fix; G9 and the guild map pass (docs/V6_3_1_RELEASE_NOTES.md).
> G1 and G2 pass (night run).
> On WoW Forever never whisper a bare first name: use the sender text or `ns.util.address(name)`.
> 6.3.0 (16 October 2026): guild-wide sync and the fixes from the first two-PC in-game check
> (docs/V6_3_0_RELEASE_NOTES.md; results in docs/V6_2_GAME_ACCEPTANCE.md).
> 6.2.1 (16 October 2026) patches 6.2.0: guild pages, bug inbox, sync fixes (docs/V6_2_1_RELEASE_NOTES.md).
> 6.2.0 Release (16 October 2026): the owner released 6.2.0 (standalone guilds, November
> scoring preparation, companion sync from PR #84) before its real-client checks. Those
> checks in `docs/V6_2_GAME_ACCEPTANCE.md` are post-release follow-up. Release record:
> `docs/archive/V6_2_RELEASE_HANDOFF.md`.
>
> **5.0 delivery note:** The stabilization bundle (Guilded-5.0-Stabilization.zip) was merged as
> PR #4; ignore the offline bundle import section in docs/V5_0_RELEASE_HANDOFF.md. Work now goes
> through pull requests on GitHub: both `Guilded quality` jobs must pass before a merge.
> Real-client gates remain required.
