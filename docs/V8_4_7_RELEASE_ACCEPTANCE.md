# 8.4.7 acceptance: 6 November 2026

Status: prepared 6 November 2026 from main (includes #383, #384). The bot code for #384 is already deployed; the
8.4.7 bump posts a one-time update notice to every guild when it deploys. Client artifacts
(GitHub, CurseForge, Microsoft Store) are published only after the bump and the batched
addon UI fixes are on main.

## Checklist

- [ ] Final-commit CI green on the release commit on main.
- [ ] `npm run addon:editions` then `npm run addon:verify-editions` pass on that commit.
- [ ] Unsigned Store package 8.4.7.0 built from that commit; identity checked
  (Kcaron.GuildedCompanion, runFullTrust, x64); packaged renderer started with no errors.
- [ ] GitHub release v8.4.7 published, Forever packages plus the usual companion and installer assets including the fixed-name installer (see docs/FOREVER_ONLY_FOCUS.md), hashes verified.
- [ ] CurseForge: the Forever files uploaded (Guilded 1712677 and Guilded Dungeons 1754138, Forever only; other editions untouched).
- [ ] Partner Center submission with publish-on-pass; certification result recorded.
- [ ] `site/releases.json` points at the new files (separate small PR, after the files exist).
- [ ] Fixed-name asset `Guilded.Companion.Setup.exe` present on the release (same bytes as the versioned installer) and `site/releases.json` `guilded.companionDirect` updated (version + sha256).
- [ ] Real-client check (Forever): a dungeon run to its final boss completes, and a saved abandoned run with a final-boss kill is recovered at login (not run).
- [ ] Companion rebuilt: the silent auto-update (#383) is a companion change, so the Store and installer need 8.4.7.

## Publish runbook (Claude, in order)

Prerequisites: C: has more than 5.4 GB free; the bump PR and the UI fix PR are merged; the
control session has deployed the bot and said "go".

1. **Clean source.** Worktree on the exact `origin/main` commit. For every build command set
   `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=false`, after an LF
   re-checkout (`git rm --cached -r -q . && git reset -q --hard`), so `git status` is empty
   (otherwise the manifest records `sourceDirty`). `npm ci` at the root and in `companion-app`,
   then `npx prisma generate`.
2. **Addon editions.** `npm run addon:editions`, then `npm run addon:verify-editions`
   (ten zips plus `dist/editions/manifest.json`).
3. **Other artifacts.** `npm run addon:zip`, `npm run dungeons:zip`,
   `npm run dist --prefix companion-app` (NSIS `dist/companion/Guilded Companion Setup 8.4.7.exe`),
   `node scripts/verify-release-artifacts.mjs` (writes the Artifact-Verification json, notes and
   SHA-256 sums) and `npx tsx scripts/export-edition-rules.ts` with placeholder
   `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` and `DATABASE_URL` set in the shell
   (five `dist/edition-rules/<edition>.json` plus `manifest.json`, which v8.4.0 published as
   `Guilded-v8.4.0-Timing-Manifest.json`). The full gate is `npm run release:prepare`.
4. **GitHub release.** Copy `backups/release-7.5.1/publish-release.mjs` to
   `backups/release-8.4.7/` and change `version`, `root` and the notes path. Include the
   `forever` rules file and the Timing-Manifest and installer asset names so the set equals
   v8.4.0's 23 assets (10 edition zips, 2 combined zips, installer, notes, SHA256SUMS, Artifact
   Verification, Edition Manifest, Timing Manifest, 5 rules files). Run it from the clean
   checkout: first without flags (draft, uploads, checks every digest), then with `--publish`.
   It refuses a dirty tree, a commit that is not current main, or no green push CI run on main.
   Verify by downloading each asset and comparing SHA-256 with the sums file.
5. **CurseForge** (Claude in Chrome, owner signed in; never type a password). Per project
   (Guilded 1712677, Guilded Dungeons 1754138) upload five files: forever, classic-era,
   classic-tbc, classic-mists, retail. On the upload page patch
   `HTMLInputElement.prototype.click` so "Choose File" exposes its input, then use
   `file_upload`. Set the game version per edition, release type Release, and paste the
   changelog from the release notes. Check each file shows Approved (approval can lag).
6. **Store package.** From `companion-app`, run
   `npm run msix:store -- --identity <relative path to backups/store-identity.json>` (use a
   relative path: npm on Windows mangles absolute paths with spaces). The output is
   `dist/msix-store/Guilded.Companion.8.4.7.x64.STORE-SUBMISSION.msix` (about 165 MB). Copy it
   to `C:\Users\Kev\Desktop\guilded-store-8.4.7`. Before submitting, run the packaged renderer
   once: start `dist/msix-store/win-unpacked/Guilded Companion.exe` with
   `--user-data-dir=<scratch dir> --remote-debugging-port=9333` (ELECTRON_RUN_AS_NODE unset; the
   scratch profile leaves the owner's real companion untouched), read the page title and console
   errors over the debugging port, then stop only that process. Record the SHA-256.
7. **Partner Center** (Chrome, owner signed in). Create the next submission and upload the
   MSIX. Chrome's upload tool caps at 10 MB, so serve the file from a temporary 127.0.0.1 node
   server with CORS and `Access-Control-Allow-Private-Network: true`, fetch it in the Partner
   Center page, set the file input through `DataTransfer`, then stop the server. Keep the
   listing text unchanged, choose publish on certification pass, submit.
8. **Website pointers.** After the files are public, edit `site/releases.json` (GitHub 8.4.7,
   CurseForge 8.4.7 once approved) in a small PR.
9. **Record.** Fill this checklist with the real results, the package SHA-256, the Store
   submission number and what is not yet live.

8.4.5 records ([8.4.5](V8_4_5_RELEASE_ACCEPTANCE.md)) are unchanged.
