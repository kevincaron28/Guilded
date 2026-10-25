> **25 October release decision:** the owner explicitly authorized publication before
> the unavailable game/two-PC tests. Earlier hold instructions below are superseded.
> Tests remain pending follow-up, not passes; targets remain provisional. See
> [release decision](RELEASE_DECISION_2026-10-25.md) and [current notes](V7_3_2_RELEASE_NOTES.md).

# Publishing Guilded after acceptance

**7.3.2 is a candidate. Public release remains on hold until the game and two-PC
checks pass.** This procedure prepares publication; it is not approval to upload.
Current evidence and launch operations: [launch readiness](LAUNCH_READINESS_2026-10-24.md).
The earlier 6.x instructions are retained in Git history.

## Prepare the tested files

1. Use the reviewed source commit and matching `release.json`. Run
   `npm run release:prepare` on Windows and require both final-commit GitHub quality
   jobs, including PostgreSQL integration/restore and Windows packaging.
2. Verify `dist/Guilded-v<version>-Artifact-Verification.json`: correct source commit,
   `sourceDirty: false`, candidate channel and the current acceptance checklist.
   The checksum manifest must include both addons, the companion installer and notes.
3. Supply those exact files to both testers. Record each SHA-256 in
   [the game checklist](V7_3_2_GAME_CHECKLIST.md). Any changed gameplay/runtime package
   requires the affected checks again. Packaging and fixture tests do not close live gates.
4. Keep the test kit separate from public downloads and leave `site/releases.json`
   unchanged. Do not upload the whole `dist` directory: it contains older releases too.

## After the required checks pass

- Record acceptance for the exact artifact hashes and review the release decision.
  Use the approved product version; do not bump it incidentally. A bot version change
  sends a guild notice when that version starts.
- Publish a matching GitHub release: Guilded ZIP, Guilded Dungeons ZIP, Windows installer,
  release notes, checksums and exact source reference. Promote the tested binaries;
  do not silently substitute newly rebuilt binaries with different hashes.
- Upload only `Guilded-v<version>.zip` to the Guilded CurseForge project and
  `GuildedDungeons-v<version>.zip` to Guilded Dungeons. Each archive has its own single
  top-level addon folder. The companion and bot are not part of these addon uploads.
- Choose only the game build/flavor and Interface compatibility actually verified.
  If CurseForge has no matching supported option, wait rather than claiming another build.
- Use [the listing copy](CURSEFORGE_COPYPASTE.md), replacing its candidate status/date only
  after approval. Include known limitations and unrated routes. Set related-project links
  both ways. Preserve the logo and sanitized screenshots; no private player data.
- Use the existing Custom License, PolyForm Noncommercial 1.0.0, and repository `LICENSE`.
  Hosted Lite works before full approval; tips never buy access or priority.
- Review and merge the prepared sign-in/linking guides with publication. Merging main
  automatically republishes website assets/guides, so a merge is a public website change.

## Verify publication

Download the actual public assets and compare SHA-256 values with the accepted manifest.
Test links as a signed-out visitor. Update `site/releases.json` only with the versions and
URLs actually available on each provider; CurseForge approval may trail GitHub.
Check both addon listings, the website download buttons, the companion update lookup and
the install guide. Keep the previous release and private recovery records available.

Do not post launch announcements before acceptance. [LAUNCH_POSTS.md](LAUNCH_POSTS.md)
contains drafts for the owner, not scheduled or automatically sent messages.
