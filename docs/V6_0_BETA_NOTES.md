# Guilded 6.0.0 Beta — 5 October 2026

This is a testing beta, not a stable release. Back up SavedVariables before upgrading.

- Loot responses show pending/confirmed feedback for raiders and visible responses for officers.
- Includes the tested off-spec pricing, GP import/reversal, personal pairing and standings workflows from the 5.0 beta stabilization work.
- Removes Raid tools entirely: target/floor markers, tank marking and boss plans will be developed later as an optional standalone addon. Saved plans and settings are preserved.
- Includes guild map diagnostics, automatic recipe sharing, and clearer member/owner setup guides.
- Bot, addon and companion source versions are aligned at 6.0.0; synchronization protocol remains 2.
- 5 October setup follow-up: fixes blank optional bot configuration fields, adds an offline owner setup check, refreshes the independent hosting/quick-start guides, and includes installation instructions in the addon ZIP. A clean local rehearsal is documented; live fresh-guild acceptance remains pending.
- Adds a published illustrated beginner owner walkthrough and setup website. Oracle now runs 6.0.0 / protocol 2. The online companion connection check distinguishes server availability from authenticated WoW/PoE access.
- Website, guides and Quebec Gold's browser companion now share https://guilded-wow.kcaron.workers.dev/ (companion at `/companion/`). A first session at this origin needs personal pairing; pairing replaces the previous companion credential, so finish queued uploads before switching.
- Enhanced browser build: supported browsers can remember selected WoW folders, reread current saved data on Sync now, and save standings directly into the addon folder. Other browsers keep manual file upload/download. Permission-dialog and real-game acceptance remain pending; the desktop companion stays available.

Remaining live acceptance includes fresh Alliance guild setup, Windows clean install/upgrade and recovery on a non-developer PC, competing/consecutive awards, concurrent officer uploads, permission revocation and a full real raid. Calendar and other game APIs depend on client support. Do not treat these pending checks as passes.

The Windows installer is unsigned. Packaging and CI do not establish a successful clean installation, upgrade or uninstall. Current evidence and the short remaining checklist are in `docs/V6_0_FINALIZATION_CHECKLIST.md`.

Install the complete Guilded folder, including Guilded.toc. Do not delete your saved data. For addon-only testing, keep WoW companion syncing paused. Discord integration needs the guild owner's configured bot and personal pairing; no database or Discord reset is part of this beta package.
