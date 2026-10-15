# Guilded 6.2.0 release candidate handoff

October 15 follow-up: [Cloudflare preview repair](CLOUDFLARE_PREVIEW_REPAIR_2026-10-15.md)
and [Forever dungeon catalog audit](WOW_FOREVER_DUNGEON_AUDIT_2026-10-15.md).
The latter corrects the guide's missing participation-only display without
changing frozen beta rules. The existing installed candidate has no addon changes
from this follow-up; final publication still requires a final-commit rebuild.

Prepared October 15, 2026 at the owner's request. This is release preparation,
not authorization to bypass the pending [in-game acceptance](V6_2_GAME_ACCEPTANCE.md).

The Deadmines final-boss fallback from local commit `9c36cff` is integrated through
its own PR. The 6.2 candidate intentionally aligns bot/addon/companion versions,
retains protocol 2 and adds no database migration. Main/production must not be
described as 6.2 until the candidate is promoted and deployed. Starting the 6.2
bot triggers the existing version announcement; do not deploy merely to test a ZIP.

## Candidate contents

Read [release notes](V6_2_RELEASE_NOTES.md). The source includes standalone local
cores and accounting handover, independent loot rolls, the separate Games path,
Best 8 display support, hidden boss overlay and Deadmines completion fallback.
The existing Best 8 beta is already active; release preparation must not rotate
it, edit its rules, recalculate points or modify archives.

`release.json` identifies the exact version, candidate channel and documents.
Packaging validates the metadata and matching note title instead of silently
copying 6.1 notes. It does not publish. Stable public links continue to identify
the actually published 6.1.2 release until promotion.

## Build and handoff

1. Use the clean candidate commit and Node 24. Install both dependency trees
   with `npm ci` / `npm ci --prefix companion-app`.
2. Run `npm run release:prepare`, explicit `npx tsc --noEmit -p .`, and
   `node scripts/build-games-addon.mjs`. Require current-commit quality CI,
   PostgreSQL integration/restore and Windows packaging. Do not start a local bot.
3. Hand testers the exact `dist/Guilded-v6.2.0.zip`, matching optional Windows
   installer, release notes, artifact manifest and SHA-256 sums. Use a dedicated
   candidate folder so old 6.1.2 builds cannot be uploaded accidentally.
4. Record G1–G10 plus desktop results against those hashes. Earlier passes and
   automation do not substitute for unobserved client behavior.

## Promotion after acceptance

1. Review the acceptance record; fix remaining failures and retest affected paths.
2. Mark `release.json` channel `release`, finalize notes, update the website's
   current-version wording and member instructions, and merge the reviewed release
   PR. Require final-commit CI and rebuild matching artifacts/checksums.
3. Follow the normal Oracle ledger preflight/backup/offsite/deployment gates.
   Verify the one live service and version/protocol health. Preserve season data.
4. Publish matching GitHub addon/companion/source/notes assets and upload only the
   addon ZIP to the existing CurseForge Guilded project. Use the prepared
   [6.2 upload text](V6_2_CURSEFORGE.md), with only client compatibility actually
   accepted in game. Guilded Games is a separate project/package.
5. Download public assets and compare hashes; record actual publication/moderation
   status. A successful file submission is not proof of public availability.

Do not replace older release assets. Do not include local recovery files, guild
data, pairing credentials or generated Standings in public packages. Preserve
SavedVariables and companion setup when upgrading either PC.
