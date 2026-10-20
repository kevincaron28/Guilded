# Codex coordination notes — 19 October 2026 (archived)

Historical. Codex left these as uncommitted local notes in the primary checkout and a Claude
worktree on 19 October 2026: an untracked `docs/LOCAL_RELEASE_COORDINATION_2026_10_19.md` and
three sections appended to `CLAUDE.md`. They were archived here on 20 October 2026 when that
checkout was brought up to date with main. Everything they describe is merged and deployed:
PR156 (public redesign), PR164 (new-guild public sharing default, migration
`20261120100000_new_guild_public_sharing`), PR165 (shared menu, its apostrophe fix included) and
PR151 (error origins, in 7.2.1). They authorize nothing.

## Sections appended to CLAUDE.md

### Published public redesign — Claude coordination

Kevin requested this project handoff. Read docs/LOCAL_RELEASE_COORDINATION_2026_10_19.md before the next deployment.
PR156 is merged (8ca20bc68df74ec94036d63ee1d0dd0d72e02e98); both public sites and the EN/FR 6.7.0 install guide are live.
Integrate current main before building from this older checkout so the published redesign is not reverted.
Preserve the active Worker/private owner behavior, approved ribbon KC and sanitized screenshot states.
Companion presentation still requires the coordinated runtime/Windows release and real-client acceptance;
PR151 error-origin reporting remains separate. No product version bump, installer launch/publication,
bot restart, database change or branch/source overwrite was performed by this handoff.


### PR164 public-sharing default — release coordination

Kevin requested the new-guild default and this append-only Claude handoff. PR164 is ready for review (draft hold removed), mergeable, head `b56486de7ac80afd711f755b7a7346d5e5867f8d`, based on current main `7246080f4012e782b27bee691e13d196c6ae96f7`.

https://github.com/kevincaron28/Guilded/pull/164 — 231 local test files / 1,962 tests passed; both final Guilded quality jobs passed, including PostgreSQL migration/integration/restore and Windows artifact verification: https://github.com/kevincaron28/Guilded/actions/runs/39325106211 . No outstanding review threads or enforced branch protection were found; repository instructions still require both quality jobs.

Read the exact rollout/rollback handoff before acting:
`C:\Users\Kev\Documents\Codex\2026-10-17\task-2\claude-new-guild-sharing-handoff-2026-10-19\CLAUDE.md`.

The new behavior affects only genuinely new full/approved Guild records: sharing true with a start-time cutoff, old imports excluded, bilingual setup disclosure and opt-out. Existing true/false/missing settings, Lite admission records, resets and history stay unchanged. Public scope includes all recorded party characters, including non-guild players, with character names/realms, class, role, level, times, deaths and scores. No new credentials, grants, DNS, legal terms or addon transport are introduced.

Production preflight is read-only and complete: `/opt/guilded` is `244e70ed30da1367384492f4f98cd67467f95cd7` (7.1.0), the one service is active/running, last applied migration is `20261120090000_public_run_route`, and the new cutoff column is absent. The only new migration is `20261120100000_new_guild_public_sharing`: add one nullable timestamp column, no Boolean-default change, UPDATE, backfill or publication. The service runs `npm run db:update` before starting; an authorized coordinated bot update/restart would therefore apply it before the new code runs. Do not run deploy/update.sh blindly: it pulls moving main and can include unrelated work. Integrate reviewed Git history; never overwrite this older checkout or SavedVariables.

A main merge DOES trigger the existing Cloudflare website build/deploy (confirmed by successful Workers Builds on current main). PR164 leaves Worker/config/public asset inputs unchanged; its changed dungeon-leaderboard document is not in the website guide allowlist. No Oracle deployment, schema change or service restart is triggered by the merge itself. Coordinate the merge with the separately reported production migration/default-on rollout; this notice does not execute or expand that rollout. Do not treat the former draft flag as a technical blocker.

Québec Gold's separate, explicitly approved live flag is already true; four guild-attributed runs are ACCEPTED and its public leaderboard returns HTTP 200. Preserve that setting. No other live guild was changed. This notice only appends coordination text; it switches no branch, stages no file, deploys no code and restarts no service.


### PR164 rollout completed — do not repeat the migration or restart

Kevin approved the scoped rollout at 22:56 UTC. PR164 merged as `d4531c34e921d90e8d343b6e23540c2356dec4c3`, and that exact commit is live on Oracle. The merged tree equals tested head `b56486d`. Both merge CI jobs and Cloudflare's website build/publication passed.

Ledger preflight passed. Protected PostgreSQL custom-format, source, configuration and sharing snapshots are in `/home/ubuntu/guilded-recovery/pr164-20261019T2300Z`; `pg_restore --list` verified the database archive. Exactly `20261120100000_new_guild_public_sharing` applied. The single controlled bot restart completed at 23:06:15 UTC; MainPID 129641, automatic restarts 0, no startup error matches. Public health is Discord-ready, version 7.1.0/protocol 2. Eight public website, companion, Québec Gold and leaderboard/health routes returned HTTP 200.

All six existing guild sharing choices stayed unchanged and all existing cutoff values remain null. Québec Gold stays enabled with four ACCEPTED public runs. Database fallback remains false; only genuinely new full/approved Guild creation sets true with the setup-time cutoff. Environment and service files were preserved. No addon/companion release, version bump, account grant, DNS change or other guild opt-in occurred.

The primary Windows checkout and Claude worktrees were not switched or overwritten. `/home/ubuntu/guilded` and `/opt/guilded` are fast-forwarded to the exact reviewed merge. Preserve this deployed descendant in later work. The previous pending-release notes above are historical and superseded by this completion record.

PR165 is independent navigation/Companion wording, not required for PR164's already deployed bilingual sharing disclosure/opt-out. It was not merged here. At inspected head `a375b18`, `node --check` fails `companion-app/renderer/app.js:80` because the apostrophe in "don't" is unescaped inside a single-quoted string; correct and review it separately before any rollout.

Evidence: `C:\Users\Kev\Documents\Codex\2026-10-17\task-2\evidence\pr164-rollout-completion.json` and `pr164-rollout-final-http.json`. No PR164 blocker remains. This notice appends facts only and authorizes no further changes.

## docs/LOCAL_RELEASE_COORDINATION_2026_10_19.md

### Local Claude release coordination — 19 October 2026

PR156 merged as 8ca20bc68df74ec94036d63ee1d0dd0d72e02e98. Published deployment e8eb9790-22f2-49f2-803e-5d8e1061a805 contains source 769608a4ef6524316406c8c0af574805aebaff1e, including the English/French 6.7.0 install-guide correction. The exact preserved Worker hash remains 4c64ee9194a6d3682a89c8d6014bc0f31df219a27eaa1927021a9d450cc1da01.

No installer, addon or bot runtime release was performed by source sync. PR151 remains separate and unmerged. Your existing branch/source has not been switched or overwritten. Before the next build/deploy, integrate current main including PR156; complete the real-client gates for the companion release. This checkout can still be older than remote main.

Canonical repository handoff: https://github.com/kevincaron28/Guilded/blob/main/docs/WEBSITE_AND_COMPANION_HANDOFF_2026_10_19.md

---

### Website publication and companion release handoff — 19 October 2026

This is the durable source record for Claude and later release agents. Kevin approved publishing the public redesign to both domains while preserving the completed private owner area. The public sites are already published. The companion presentation is source-ready; this handoff is not acceptance of an installer, bot or database release.

#### Published revision and preservation requirement

- Public sites: https://kcaron.top/ and https://guilded.kcaron.top/ ; the www alias was also verified.
- Initially published redesign/assets revision: `be58843bed2646f8fd7c58069c2d1037c008e734`, on PR156, including main through PR157. The final PR156 head also corrects the member-install guide below; its main merge automatically republishes that correction. Canonical release/deployment metadata identifies the resulting exact revision.
- Initial assets-only production deployment: `50b209a0-f520-42ad-9bc6-9c70d15ccdea`, replacing `0b072162-eb97-405a-b237-d2e5fa3f2f96`.
- Preserved Worker module SHA256: `4c64ee9194a6d3682a89c8d6014bc0f31df219a27eaa1927021a9d450cc1da01` (17,936 bytes). A normal repository Wrangler dry-run from the same combined source produces that exact module hash too. No unrelated Worker change is needed to retain the new sites.
- Keep the current owner KV binding, existing secret bindings, `keep_vars: true`, custom-domain routes and `run_worker_first` behavior. Do not copy an older Worker/config or assets directory over this deployment. Any intentional Worker change requires a reviewed diff from the preserved baseline.
- Anonymous owner boundaries were unchanged: portfolio `/owner`, `/owner/`, `/owner/api/resources` redirect to Cloudflare Access; the same product-host paths return 404. Portfolio `/support` still redirects to the optional donation destination; product `/support` retains its existing 404 behavior.
- Preserve the approved gold ribbon KC asset (SHA256 `b2f3bedb68a981468169c9b3d03cf062500faf366006fe73d115f69800902f39`). The earlier block KC proposal was rejected.

The redesign is source in PR156: https://github.com/kevincaron28/Guilded/pull/156 . Use its merged descendant for subsequent site builds. Do not deploy the stale primary local checkout or Claude's earlier `polish2` checkout without integrating PR156 first: both predate these frontend changes.

#### Why PR156 was draft, and what a merge does

The draft designation was a coordination hold created by the design task, not a failing check or unresolved code conflict. It kept a source-ready companion presentation distinct from a released Windows/runtime product.

Read-only inspection of Cloudflare's actual production Settings on 19 October 2026, approximately 11:14 UTC, confirmed:

- Repository `kevincaron28/Guilded`, production branch `main`, builds enabled.
- Build command `npm run site:build`; deploy command `npx wrangler deploy`; root `/`; included watch path `*`; no excluded paths or deploy hooks.
- No build variables/secrets configured in the build settings. Existing encrypted runtime owner secrets remain configured.

Therefore a merge to main automatically republishes the website Worker/assets, including a documentation-only merge. With the reviewed PR156 source, normal compilation preserves the exact active Worker hash above and publishes the accepted redesigned assets. It does not release the bot, migrate its database, publish an addon or launch/publish a Windows installer. The repository's quality workflow runs checks and produces artifacts; Windows packaging explicitly uses `--publish never`. Uptime monitoring is separate and scheduled.

The existing Wrangler token could not read Workers Builds settings through the API (403 Authentication error). The already authenticated dashboard supplied the actual settings without changing them or expanding access. This is not a remaining blocker after that dashboard verification.

Merge only the reviewed final PR156 head after both Guilded quality jobs pass. Keep PR151 separate. A source merge does not satisfy the real-client release gates below, and no version bump belongs in this visual refresh.

#### Companion dependency and acceptance gate

PR156 preserves main through PR157, including PR154's online personal mode, file handling and pairing guidance. The presentation touches `companion-app/renderer/`, `companion/overview.mjs`, shared tokens/fonts, `scripts/build-companion-web.mjs`, and the explicit public asset allowlist in `src/services/companion-web.ts`.

The browser companion comes from the running bot through the preserved Worker proxy. Website asset publication alone cannot update it. Its release must build/copy the new renderer assets and deploy the matching `companion-web.ts` allowlist. Build the Windows installer from that same accepted combined source so the generated token/font files and web bundle are present. Preserve existing permissions, pairing APIs, opt-in game tracking, controls, error paths, light mode and PR154 behavior. Do not turn on unconfigured OAuth/backend features merely to ship styling.

Before publishing the installer or deploying a new bot/frontend runtime, Claude must follow `docs/V5_0_RELEASE_HANDOFF.md` in order, preserving all local changes, existing credentials, SavedVariables and the single running Oracle bot. Complete the approved release version decision, ledger/migration preflight and backup as applicable, fresh combined-source CI, Windows install/launch/update checks, pairing and real sync/file behavior, browser/mobile/error/light-mode checks and the required real WoW/raid checks. Fixture screenshots and successful packaging are not substitutes. Full companion translation remains follow-up work.

#### PR151 belongs to the next bot release

https://github.com/kevincaron28/Guilded/pull/151 — Preserve origin context in developer error reports — is a separate draft/unmerged change, head `79e48795cc69d07898aa5d7dc84445710b8dac0e` at inspection. It is not required for the public redesign or companion styling.

It preserves guild/channel/message/operation context for new developer reports and scopes deduplication by origin. It does not recover missing origin from older reports. It adds no migration, privileged intent, permission change or message-body fetching. Before including it in the next bot release, integrate it onto the then-current main (including PR156), resolve overlaps, rerun final combined-source checks, review the private `ERROR_LOG_CHANNEL_ID` destination, then verify a new report/error arrives with its correct available origin context after deployment. Do not quietly merge/deploy it as part of this website source-sync work.

#### Version evidence — keep these distinct

- Latest published GitHub and CurseForge Guilded download labels verified for the public sites: **6.7.0**.
- Candidate source package/addon/companion version on main: **7.0.0**.
- Public browser companion observed unpaired on 19 October: **Version 7.0.0**, using its prior presentation. This does not establish an installed/published Windows 7.0.0 release, current Oracle bot version, configured OAuth/migrations or successful live sync.
- The parent's separate consistency audit subsequently verified the live bot and browser companion as **7.0.0**, while the GitHub 7.0 release remains a draft. Both guild command registries include `/mod recruit set`, `/mod recruit status`, `/mod leaderboard` and `/officer export`, with the corrected 91-character `/mod` description. Registration metadata does not establish end-to-end role or feature acceptance. Public `/recruitment/`, `/leaderboards/` and `/me/` returned 404 and must not be advertised as available pages until deliberately deployed and verified.
- Fresh game captures: loaded addon version/client build unknown. Separate disk metadata says 6.3.2; never label these images as a verified loaded 6.7.0/7.0.0 session.

Release labels live in `site/releases.json` and must reflect the actual provider publication, not simply `package.json`. Updating that file after a real release is part of release completion. An incidental package version bump triggers user-visible guild guide announcements.

The member-install guide's two dated EN/FR release snapshots were also corrected from 6.5.1 to the verified public 6.7.0, removing the obsolete CurseForge file ID without inventing a new one. Historical 6.5.1 pairing-behavior and old-client troubleshooting notes remain accurate and were retained. This correction is included in the same approved public-site scope; it does not announce the draft 7.0 download.

#### Completed verification and screenshot provenance

CI https://github.com/kevincaron28/Guilded/actions/runs/39240918571 passed on published assets revision `be58843`, including Linux/PostgreSQL restore checks and Windows packaging/checksums. Local validation passed 225 files / 1,929 tests, TypeScript, ESLint, addon validation, site and companion builds, and the Worker dry-run. Nineteen local UI scenarios, eight live desktop/mobile/narrow/French/unpaired companion views and 39 live HTTP/asset/download checks passed without observed overflow or renderer exceptions. This is targeted verification, not full accessibility or runtime certification.

The user supplied 14 genuine Guilded captures. Eight sanitized PNG derivatives were integrated byte-for-byte; their filtered manifest is `site/images/showcase/CAPTURE-MANIFEST-2026-10-19.json`. Preserve their honest setup/blank/idle/not-completed/redacted captions and EN/FR descriptions. No raw original or private source inventory was imported. No Catchkeeper/Trailmark captures were supplied. The private owner area was not redesigned.

#### Claude coordination route

Kevin previously requested that Claude receive the update through the project `CLAUDE.md` and handoff route. The source record links here from `CLAUDE.md`; an append-only local notice is also provided to the primary checkout and active companion worktree, preserving their original contents. Those local copies are coordination notes, not permission to overwrite concurrent source or fast-forward either checkout without checking status. Use the shared Git history for integration rather than copying whole folders from a stale checkout.


#### PR164 public-sharing default — release coordination

Kevin requested the new-guild default and this append-only Claude handoff. PR164 is ready for review (draft hold removed), mergeable, head `b56486de7ac80afd711f755b7a7346d5e5867f8d`, based on current main `7246080f4012e782b27bee691e13d196c6ae96f7`.

https://github.com/kevincaron28/Guilded/pull/164 — 231 local test files / 1,962 tests passed; both final Guilded quality jobs passed, including PostgreSQL migration/integration/restore and Windows artifact verification: https://github.com/kevincaron28/Guilded/actions/runs/39325106211 . No outstanding review threads or enforced branch protection were found; repository instructions still require both quality jobs.

Read the exact rollout/rollback handoff before acting:
`C:\Users\Kev\Documents\Codex\2026-10-17\task-2\claude-new-guild-sharing-handoff-2026-10-19\CLAUDE.md`.

The new behavior affects only genuinely new full/approved Guild records: sharing true with a start-time cutoff, old imports excluded, bilingual setup disclosure and opt-out. Existing true/false/missing settings, Lite admission records, resets and history stay unchanged. Public scope includes all recorded party characters, including non-guild players, with character names/realms, class, role, level, times, deaths and scores. No new credentials, grants, DNS, legal terms or addon transport are introduced.

Production preflight is read-only and complete: `/opt/guilded` is `244e70ed30da1367384492f4f98cd67467f95cd7` (7.1.0), the one service is active/running, last applied migration is `20261120090000_public_run_route`, and the new cutoff column is absent. The only new migration is `20261120100000_new_guild_public_sharing`: add one nullable timestamp column, no Boolean-default change, UPDATE, backfill or publication. The service runs `npm run db:update` before starting; an authorized coordinated bot update/restart would therefore apply it before the new code runs. Do not run deploy/update.sh blindly: it pulls moving main and can include unrelated work. Integrate reviewed Git history; never overwrite this older checkout or SavedVariables.

A main merge DOES trigger the existing Cloudflare website build/deploy (confirmed by successful Workers Builds on current main). PR164 leaves Worker/config/public asset inputs unchanged; its changed dungeon-leaderboard document is not in the website guide allowlist. No Oracle deployment, schema change or service restart is triggered by the merge itself. Coordinate the merge with the separately reported production migration/default-on rollout; this notice does not execute or expand that rollout. Do not treat the former draft flag as a technical blocker.

Québec Gold's separate, explicitly approved live flag is already true; four guild-attributed runs are ACCEPTED and its public leaderboard returns HTTP 200. Preserve that setting. No other live guild was changed. This notice only appends coordination text; it switches no branch, stages no file, deploys no code and restarts no service.


#### PR164 rollout completed — do not repeat the migration or restart

Kevin approved the scoped rollout at 22:56 UTC. PR164 merged as `d4531c34e921d90e8d343b6e23540c2356dec4c3`, and that exact commit is live on Oracle. The merged tree equals tested head `b56486d`. Both merge CI jobs and Cloudflare's website build/publication passed.

Ledger preflight passed. Protected PostgreSQL custom-format, source, configuration and sharing snapshots are in `/home/ubuntu/guilded-recovery/pr164-20261019T2300Z`; `pg_restore --list` verified the database archive. Exactly `20261120100000_new_guild_public_sharing` applied. The single controlled bot restart completed at 23:06:15 UTC; MainPID 129641, automatic restarts 0, no startup error matches. Public health is Discord-ready, version 7.1.0/protocol 2. Eight public website, companion, Québec Gold and leaderboard/health routes returned HTTP 200.

All six existing guild sharing choices stayed unchanged and all existing cutoff values remain null. Québec Gold stays enabled with four ACCEPTED public runs. Database fallback remains false; only genuinely new full/approved Guild creation sets true with the setup-time cutoff. Environment and service files were preserved. No addon/companion release, version bump, account grant, DNS change or other guild opt-in occurred.

The primary Windows checkout and Claude worktrees were not switched or overwritten. `/home/ubuntu/guilded` and `/opt/guilded` are fast-forwarded to the exact reviewed merge. Preserve this deployed descendant in later work. The previous pending-release notes above are historical and superseded by this completion record.

PR165 is independent navigation/Companion wording, not required for PR164's already deployed bilingual sharing disclosure/opt-out. It was not merged here. At inspected head `a375b18`, `node --check` fails `companion-app/renderer/app.js:80` because the apostrophe in "don't" is unescaped inside a single-quoted string; correct and review it separately before any rollout.

Evidence: `C:\Users\Kev\Documents\Codex\2026-10-17\task-2\evidence\pr164-rollout-completion.json` and `pr164-rollout-final-http.json`. No PR164 blocker remains. This notice appends facts only and authorizes no further changes.
