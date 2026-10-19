# Approved visual refresh — 19 October 2026

The owner approved the Ribbon Atelier public-site direction and compact Precision Desk companion after reviewing the design research and mockups. Work is isolated on `codex/ribbon-atelier`, initially based on origin/main `be43608`, then rebased over the concurrent 7.0.0 release and PR154. The primary checkout and Claude’s companion worktree are untouched.

## Implementation scope

1. Share the approved charcoal `#111416`, gold `#D9B66F`, ivory `#F3F0E8` identity, type, focus and control rules. Preserve the ribbon KC and existing product icons.
2. Put all ten existing addons before product-specific guides, retain exact Release/Beta/Alpha stages, limitations, provider links and French content, and introduce broader verified projects.
3. Give Guilded a consistent publisher relationship, real screenshot stories and clear addon/browser/Windows choices. Keep donation optional and community links visible.
4. Replace the companion's recurring marketing hero with useful connection/file/refresh status; preserve every existing control, ID, API, pairing flow and permission rule. Add accessible adaptive navigation.
5. Validate static links, language controls, mobile layouts and companion readiness with offline tests and screenshot QA, plus all repository-required checks.

## Coordination and publication

Origin/main contains PRs 148/149/152/154/155. PR154 supersedes the earlier online-personal-mode exclusion; its browser client, file handling and pairing instructions are preserved. Recruitment and sharing commands are `/mod recruit` and `/mod leaderboard`. Their merge is not proof of production publication or runtime acceptance. This refresh does not change authentication, OAuth, migrations, bot APIs, private owner resources or feature enablement. It does not publish an installer or bump any product version. Companion packaging/release remains coordinated with Claude's active release work.

Website publication must not introduce unrelated new Worker/backend behavior. Compare the deployed baseline before publication and preserve the active Worker/private-owner route contracts. No database or real bot is started for local visual QA. Use only explicitly labelled fixtures for companion state previews, never production pairing credentials or game files.

## Evidence

Visual QA, checks, final source hashes and publication/coordination status will be recorded here when complete. Historical screenshot captions remain explicit; no UI image is evidence of an unobserved successful sync or current-release game acceptance.

### Completed local validation

The initial full suite passed 225 files / 1,928 tests. Checks are being repeated after rebasing on PR154. The 17 isolated browser scenarios cover desktop, 390px and 320px pages, English/French controls, all ten addons, stage filters, companion setup/connected/error/light states, and mobile keyboard navigation. No horizontal overflow or renderer exception was observed. Companion screenshots use visibly labelled local fixtures; no installed-app runtime or real sync is claimed.

The ribbon emblem hash is unchanged: `b2f3bedb68a981468169c9b3d03cf062500faf366006fe73d115f69800902f39`. Key contrast ratios: ivory/background 16.24:1, muted/surface 7.87:1, gold/surface 8.53:1, control outline/surface 4.05:1. Light-mode focus uses a separate dark blue. This is targeted verification, not a full accessibility certification.

Public download labels are curated in `site/releases.json`, independently of candidate package versions. A direct GitHub API check still returned v6.7.0; a fresh CurseForge primary-page check lists 6.7.0. Full companion translation and updated real-client workflow captures remain follow-ups. New public navigation/hero/catalog copy has EN/FR controls; existing bilingual disclosures and guides remain available.
