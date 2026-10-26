# Guilded 7.5.0 publication — 26 October 2026

## Published and deployed

Release source is `bda3382f769b669f249be634861f2fb160284c29` (PRs #233/#234
complete the Claude/Codex bundle). Protocol remains 2. The owner authorized
publication before unavailable game/two-PC acceptance. The launch tools are
included; the proposed guild-wide web heatmap was declined.

- Oracle runs 7.5.0. Public health is healthy and reports `commands: ok`.
  Discord command registration succeeded in every configured server.
- All four additive migrations applied: web availability, edition events,
  raid signup extras and officer tools. Post-deploy ledger references are unique.
- Read-only ledger preflight, verified database/application backups and encrypted
  off-server backup with authenticated decryption/checksums passed before restart.
- GitHub [v7.5.0](https://github.com/kevincaron28/Guilded/releases/tag/v7.5.0)
  is public. All 21 anonymous downloads match the expected size and SHA-256.
- All ten CurseForge edition files were uploaded as Release with automatic
  publication after approval. All ten CDN downloads match the exact release
  hashes. All ten files were subsequently confirmed **Approved** in the author
  portal and their download hashes reverified. Website metadata now targets 7.5.0
  on both providers; see the post-release review for deployment state.
- Local combined validation passed: 311 files / 2,654 tests, TypeScript, ESLint,
  both addon validators. Exact release-main CI run `40401478643` passed both
  checks and Windows packaging, including PostgreSQL migration/restore and MSIX.

Ignored evidence is in `backups/release-7.5.0/`: preflight and offsite-backup
records, deployment/migration logs, live health, asset verification, CurseForge
file IDs and download verification. Recovery locations and encryption-key paths
are retained privately there. Never commit credentials or backup contents.

## Microsoft Store

**Submitted and in certification**, not yet approved. Product `9N680XX3QFL9`,
submission `1152921505702234586`; publication is automatic after approval.
All six submission sections were Complete and the final package Validated.
English/French listings, seven genuine screenshots, IARC, capability explanation,
public privacy URL and private reviewer instructions are saved.

The owner explicitly approved storing the synthetic reviewer code in Microsoft's
private Credentials field; persistence was verified after reload. The isolated
review endpoint has no production database or Discord access, accepts only the
canonical synthetic fixture and expires 25 November 2026 at 23:59:59 UTC.
Ten real HTTPS checks through companion code passed, including duplicate handling,
modified-export/cross-guild rejection, re-pair revocation and API logout.
Native Remove all data clears ALL local profiles and quits; it does not perform
server logout. Reviewer instructions require a clean Windows user/VM.

Final Store package SHA-256:
`41492af383bc9364871ec30faf22402197192d0725bd5eb138ed3d87f594b8e9`
(165,360,608 bytes). WACK on the preceding preview completed with WARNING,
22 passes, optional blocked-executables failure and a DPI inspector warning;
this is not a clean WACK pass or Store certification. Temporary preview,
certificate trust and private key were removed. See
[Store handoff](STORE_HANDOFF_2026-10-26.md) and
[local validation](store-submission/LOCAL_VALIDATION_2026-10-26.md).

The standard GitHub installer remains unsigned. The project license is unchanged.

## Remaining checks for the next session

1. CurseForge approvals and matching public downloads are complete for all ten
   files. File IDs, approval screenshots and hashes are in the ignored release folder.
2. Check Microsoft certification outcome. Once available, test the Store-signed
   install, upgrade, tray lifecycle and Windows startup on a clean/second PC.
3. Claude's live Discord and web walkthrough results are now recorded in
   [post-release review](POST_RELEASE_REVIEW_2026-10-26.md), including specific
   passes, two text fixes (#236), untested second-account flows and test leftovers.
4. Complete [7.5 game acceptance](V7_5_0_GAME_CHECKLIST.md) and the
   [launch tools checklist](V7_5_0_LAUNCH_TOOLS_CHECKLIST.md), including carried
   forward two-PC, roster/ledger, addon sync and edition-specific client checks.
5. Confirm Forever custom buff/spell observations and calibrate dungeon baselines
   from real runs. Current benchmark values remain provisional.
6. Reconcile a real GRM archive and exercise large imports, local history privacy
   and restoration; verify real-member multi-edition permissions and concurrent
   officer edits. Automated fixtures do not cover real guild operational acceptance.
7. Keep earlier unresolved live reports open until reproduced and verified. Read
   the roadmap and previous release handoff for optional follow-ups; main/alt
   apply is now implemented with explicit confirmation and audit (the earlier
   7.4 preview-only status is superseded).

## Working state and coordination

Publication-record follow-up changes only docs, website provider metadata and
review-kit/smoke-test tooling. It does not alter the published runtime, tag or
asset bytes, and needs no Oracle restart. Never replace already published release
assets silently. Preserve Claude's `qgb-claude-gaps` checkout. Read `CLAUDE.md`
and the shared coordination file first; do not run a second production bot.
