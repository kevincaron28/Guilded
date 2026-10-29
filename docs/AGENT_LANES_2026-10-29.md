# Agent lanes for launch — 29 October 2026

Purpose: three agents (Copilot, Codex, Claude) ship before 4 November without touching the same files.
Rule: one owner per area; rebase on main before starting; open a small PR per feature; no version bump.

| Lane | Owner | Files (do not edit from other lanes) | Status |
| --- | --- | --- | --- |
| Website (landing, hubs, status, countdown, sample board) | Copilot | `site/**`, `docs/SYSTEM_AUDIT_AND_UPGRADE_PLAN_2026-10-29.md` | PR from `copilot/site-redesign-launch` |
| Battle.net sync, companion, Worker | Codex | `src/services/battlenet*`, `companion*/**`, `worker/**` | in progress (#271-#274) |
| Raid signup, roster card, specs | Claude | `src/services/raid*.ts`, `src/commands/raid*.ts`, raid addon modules | in progress (#269, #272) |

## Feature queue for the bot/addon lanes (not started by Copilot)

1. **First-guild setup checklist** (Codex): `/setup` shows a live checklist (addon installed, first upload,
   first raid core, first signup) so an officer sees what is left. Touches `src/services/setup-status.ts`;
   French keys are required in `src/i18n-fr.ts`.
2. **Raid-Helper signup import** (Claude, after the melee/ranged work lands): preview-only first,
   explicit name mapping, idempotent, no code execution on input. Reuse the loot-history import pattern
   in `docs/LOOT_HISTORY_IMPORT.md`.
3. **Public guild page share card** (Codex): per-guild Open Graph image for `/g/<slug>/` so shared links
   look good in Discord.
4. **Health detail for `/status`** (Codex): `/health` may add `{ db: "ok" }` style fields; the status page
   only reads `version` today and tolerates extra fields.

Handoff: when a lane merges, add one line to this table. Do not edit another lane's files; ask in the PR.
