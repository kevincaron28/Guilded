# Guilded Dungeons and the public leaderboards (7.0)

Roadmap request 6 (`docs/ROADMAP_REQUESTS_PLAN_2026-10-18.md`). Builds on the website sign-in
(`docs/WEB_SIGNIN_AND_RECRUITMENT.md`).

## Guilded Dungeons (addon)

- `addon/GuildedDungeons/`: `Shim.lua` (what Guilded's Core.lua normally provides, with its own
  SavedVariables `GuildedDungeonsDB`), `Shared/*.lua` (exact copies of Guilded's Util, Compat,
  Locale, DungeonRoutes, Dungeon, RunResults and Scores), `Accepted.lua`, `Main.lua` (`/gdungeons`, `/gdg`).
- One source: edit the files in `addon/Guilded/`, then `npm run dungeons:sync`. The validator
  (`node addon/Guilded/validate-addon.mjs`, which also runs `addon/GuildedDungeons/validate-addon.mjs`)
  fails if a copy differs.
- With Guilded installed too (`## OptionalDeps: Guilded`, so it loads after), every shared module's
  `ns.moduleActive` check answers false: Guilded Dungeons records nothing and sends nothing, and
  Guilded counts the run. Both use the same addon-message protocol, so a party can mix them.
- `npm run dungeons:zip` builds `dist/GuildedDungeons-v<version>.zip` (also part of `release:prepare`).

## Personal accounts and uploads

- `/me/` → **Get a companion code**: a `P…` code (15 minutes, one use). The companion's usual
  Connect box takes it; the bot's pairing endpoint recognizes personal codes by their `P` and
  returns a personal credential (one active per account, only its SHA-256 stored).
- In personal mode the companion (desktop, command line or the online companion at /companion/)
  reads `GuildedDungeons.lua` (or `Guilded.lua`), sends up to 50
  finished, not-yet-synced runs to `POST /api/v1/public-runs`, and writes
  `AddOns/GuildedDungeons/Accepted.lua` so the addon marks them as sent. No standings, no guild.
- **Trust checks** (`src/services/public-runs.ts`): the guild rules' `validateRun` (3 min to 4 h,
  no future times, recorder/reporter in the run, nobody twice); completed only; at most 30 days old;
  the uploader's character must be in the run; at least 45 s per boss killed, boss kills inside the
  run and 10 s apart. Party members share the addon's run id: an agreeing upload (time within 30 s,
  end within 5 min, 60% same party) adds a confirmation; a disagreeing one marks the run DISPUTED
  and hides it. Same uploader again = duplicate. Limits: 50 runs per upload, 200 runs and 30
  uploads an hour per account.
- **Guild opt-in**: `/mod leaderboard share:true` copies the guild's valid completed runs (last
  30 days, then every 15 minutes) through the same checks as uploader `guild:<id>`.

## Leaderboards

- `/leaderboards/`: dungeons with their record; `?dungeon=<instanceId>` ranks each character's
  best run, filtered by season (calendar quarter, e.g. `2026-Q4`, default the current one),
  level bracket (rules v6 `DEFAULT_DUNGEON_BRACKETS`, by the party's highest level), class, role
  and "confirmed by the party". `/leaderboards/character/<Name-Realm>`: best per dungeon and recent runs.
- Migration `20261119110000_public_dungeons`: WebPairing, WebCompanionCredential, PublicRun,
  PublicRunPlayer, PublicRunUpload, `GuildSettings.publicDungeonRuns`.

## Owner setup

After the 7.0 sign-in setup: deploy the bot (migration) and `npm run worker:deploy` (new
`/api/v1/public-runs` route). Create a CurseForge project for Guilded Dungeons and upload the zip
when the real-client checks below pass.

## Test script

1. Install only Guilded Dungeons (unzip `dist/GuildedDungeons-v6.7.0.zip` into AddOns). `/gdg check`, then
   run a dungeon: `/gdg status` shows the timer; after the last boss `/gdg results`.
2. Sign in at https://guilded.kcaron.top/me/ → **Get a companion code** → in the companion paste it,
   choose `WTF\Account\<ACCOUNT>\SavedVariables\GuildedDungeons.lua`, Save and start. Activity says
   "Public leaderboards: 1 new…". `/reload`: the run shows as sent.
3. https://guilded.kcaron.top/leaderboards/ lists the dungeon; open it, your character ranks; filters work.
4. A second player in the same run uploads too: the row shows ✔ 2.
5. With Guilded and Guilded Dungeons both installed, `/gdg status` says Guilded records the run, and
   only Guilded's file gets the run.
6. In Quebec Gold: `/mod leaderboard share:true`; within 15 minutes recent guild runs appear.
