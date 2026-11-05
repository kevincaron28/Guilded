# 8.4.4 acceptance: 5 November 2026

Status: prepared 5 November 2026 from main. The bot already runs 8.4.3 code (31b8e5d); the
8.4.4 bump posts a one-time update notice to every guild when it deploys. Client artifacts
(GitHub, CurseForge, Microsoft Store) are published only after the bump and the batched
addon UI fixes are on main.

## Checklist

- [ ] Final-commit CI green on the release commit on main.
- [ ] `npm run addon:editions` then `npm run addon:verify-editions` pass on that commit.
- [ ] Unsigned Store package 8.4.4.0 built from that commit; identity checked
  (Kcaron.GuildedCompanion, runFullTrust, x64); packaged renderer started with no errors.
- [ ] GitHub release v8.4.4 published, asset set matches v8.4.0 (23 assets), hashes verified.
- [ ] CurseForge: all ten edition files uploaded (Guilded 1712677, Guilded Dungeons 1754138).
- [ ] Partner Center submission with publish-on-pass; certification result recorded.
- [ ] `site/releases.json` points at the new files (separate small PR, after the files exist).
- [ ] Real-client check (Forever): automatic linking, Find my saved data, UI corner fixes (not run).

## Publish runbook (Claude, in order)

Prerequisites: C: has more than 5.4 GB free (the MSIX build needs room); the bump PR and the
UI fix PR are merged; the control session has deployed the bot and said "go".

1. **Clean source.** In a worktree on the exact `origin/main` commit:
   `git checkout --detach origin/main`, then `git rm --cached -r -q . && git reset --hard`
   if line endings are dirty, and set
   `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=false` for every
   build command so `git status` stays clean (otherwise the artifact manifest records
   `sourceDirty`). `npm ci` at the root and in `companion-app`.
2. **Addon editions.** `npm run addon:editions`, then `npm run addon:verify-editions`. Expect
   ten edition zips under `dist/editions/` and `dist/edition-rules/`.
3. **Release artifacts.** `npm run release:prepare` builds the combined addon zips, the
   Dungeons zip, the NSIS installer (`dist/companion/Guilded Companion Setup 8.4.4.exe`) and
   runs `scripts/verify-release-artifacts.mjs`, which writes
   `dist/Guilded-v8.4.4-Artifact-Verification.json` and the release notes copy.
4. **GitHub release.** Copy `backups/release-7.5.1/publish-release.mjs` to
   `backups/release-8.4.4/`, change `version` and `root` (and the notes path) and run it from
   the clean checkout: first without flags (creates a draft, uploads and checks every asset
   digest), then with `--publish`. It refuses a dirty tree, a commit that is not current main
   or main without a green push CI run. Expect 23 assets like v8.4.0. Verify by downloading
   and comparing SHA-256 against `SHA256SUMS-v8.4.4.txt`.
5. **CurseForge** (Claude in Chrome, owner signed in; never type a password). Per project
   (Guilded 1712677, Guilded Dungeons 1754138) upload five files: forever, classic-era,
   classic-tbc, classic-mists, retail. On the upload page patch
   `HTMLInputElement.prototype.click` so "Choose File" exposes its input, then use
   `file_upload`. Set the game version per edition, release type Release, and paste the
   changelog from the release notes. Check each file shows Approved (approval can lag).
6. **Store package.** In a folder with no repo dirt, `cd companion-app` and run
   `npm run msix:store -- --identity ../backups/store-identity.json`; the output lands in
   `dist/msix-store/` as `Guilded.Companion.8.4.4.x64.STORE-SUBMISSION.msix` (about 165 MB).
   Copy it to `C:\Users\Kev\Desktop\guilded-store-8.4.4`. Before submitting, run the packaged
   renderer once (extract or run the `win-unpacked` build with `npm run pack`) and confirm no
   startup error (8.4.1 shipped a crash). Record the SHA-256.
7. **Partner Center** (Chrome, owner signed in). Create the next submission, upload the MSIX.
   Chrome's upload tool caps at 10 MB, so serve the file from a temporary
   127.0.0.1 node server with CORS and `Access-Control-Allow-Private-Network: true`, fetch it in
   the Partner Center page, set the file input through `DataTransfer`, then stop the server.
   Keep the Store listing text unchanged, set publish on certification pass, submit.
8. **Website pointers.** After the files are public, edit `site/releases.json` (GitHub 8.4.4,
   CurseForge 8.4.4 once approved) in a small PR.
9. **Record.** Fill this checklist with the real results, the package SHA-256, the Store
   submission number and what is not yet live.

8.4.3 records ([8.4.3](V8_4_3_RELEASE_ACCEPTANCE.md)) are unchanged.
