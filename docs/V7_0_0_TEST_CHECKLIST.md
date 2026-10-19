# Guilded 7.0.0 — test checklist (19 October 2026)

There is no separate test bot, so the order is: **deploy 7.0.0 to the bot** (after a backup) →
**run these tests** → **publish** the GitHub release, CurseForge files and the Guilded Dungeons
project. If a test fails badly, the backup and the previous release (6.7.0) are the way back.

Before testing sign-in, recruitment applications or personal codes, do the owner setup in
[V7_0_0_RELEASE_NOTES.md](V7_0_0_RELEASE_NOTES.md#owner-setup-for-website-sign-in). Install the 7.0.0
addon zip and companion installer from the build on at least one PC.

Mark each line ✅ / ❌ with a note.

## A. Discord after the deploy (5 minutes)

- [ ] `/help` shows the Ko-fi line at the top.
- [ ] As an officer: `/officer`, `/mod` and `/organize` are visible; as a plain member they are not.
- [ ] `/mod recruit status` and `/mod leaderboard` appear under `/mod`; `/officer export` under `/officer`.
- [ ] `/setup` checklist: no new warnings you didn't expect.

## B. Spreadsheet export (10 minutes)

- [ ] `/officer export table:standings`: a CSV only you see; it opens in Excel with accents right
      and the same EP/GP/PR as `/epgp leaderboard`.
- [ ] `/officer export` with `ledger`, `loot`, `attendance`, `roster`: each opens.
- [ ] A member without the Officer role can't run it.
- [ ] Companion (desktop), World of Warcraft page → **Export to spreadsheet** → choose a folder: five
      `guilded-…csv` files appear and open in Excel.
- [ ] In game: `/guilded sheet loot` still opens the copy box.

## C. All-level dungeon season (decide first)

Starting the provisional season **archives the season running now** in that server. Do steps 3+
only if you want the all-level season live today; otherwise stop after step 2.

1. [ ] `/officer dungeon bracket-preview`: brackets marked provisional, and the routes still
       waiting for launch data listed.
2. [ ] `/officer dungeon bracket-start name:… starts_at:… ends_at:…` without `rotate`: refused while a
       season is active; nothing changes.
3. [ ] Same with `rotate:true`: the old season is archived (`/dungeon archive`) and the new one shows
       "provisional".
4. [ ] `/dungeon season`, `/dungeon leaderboard bracket:15-29` and `/dungeon rules` show the
       provisional labels (French guild: "provisoire").
5. [ ] A low-level group (17–26) clears The Deadmines or Wailing Caverns: the run lands in 15-29,
       and the addon's score panel shows the target with `*`.
6. [ ] `/officer dungeon recalibrate route:<route>` with too few clears explains that 3 are needed.

Full script: PR #147 and [DUNGEON_SEASON_BRACKETS.md](DUNGEON_SEASON_BRACKETS.md).

## D. Website recruitment (15 minutes, needs the owner setup)

1. [ ] https://guilded.kcaron.top/recruitment/ loads.
2. [ ] In Quebec Gold: `/mod recruit set open:true classes:Priest, Mage roles:healer days:wed, sun
       times:20:00-23:00 ET language:Français faction:Alliance realm:Doomhowl` → the listing shows.
3. [ ] Filters work (class Rogue hides it), and `?lang=fr` is French.
4. [ ] **Sign in with Discord** asks only for "identify" and brings you back signed in.
5. [ ] Apply from a second account: the card arrives with Accept / Decline / Spam; a non-officer
       can't click them; Accept sends a DM and `/me/` shows "Accepted".
6. [ ] `/me/` → "Looking for a guild" card → it shows on the page.
7. [ ] Sign out → `/me/` asks to sign in again.

Full script: [WEB_SIGNIN_AND_RECRUITMENT.md](WEB_SIGNIN_AND_RECRUITMENT.md#test-script).

## E. Guilded Dungeons and public leaderboards (30 minutes, a dungeon run)

1. [ ] With **only** Guilded Dungeons installed (`GuildedDungeons-v7.0.0.zip`): `/gdg check`, run a
       dungeon, `/gdg status` shows the timer and `/gdg results` the result.
2. [ ] `/me/` → **Get a companion code** → paste in the companion, pick `GuildedDungeons.lua`, Save:
       Activity says "Public leaderboards: 1 new…".
3. [ ] https://guilded.kcaron.top/leaderboards/ lists the dungeon; your character ranks; filters work.
4. [ ] With Guilded and Guilded Dungeons both installed, `/gdg status` says Guilded records the run.
5. [ ] In Quebec Gold: `/mod leaderboard share:true`; within 15 minutes guild runs appear.

Full script: [PUBLIC_DUNGEON_LEADERBOARDS.md](PUBLIC_DUNGEON_LEADERBOARDS.md#test-script).

## F. Upgrade (5 minutes)

- [ ] The 7.0.0 companion installer upgrades 6.7.0 in place; settings and the Discord link are kept.
- [ ] The 6.7.0 companion shows the **Download update** banner once 7.0.0 is published.
- [ ] The addon loads with the old SavedVariables; standings and history are intact.
