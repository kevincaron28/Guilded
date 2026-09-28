# Release checklist: Guilded 4.5.0

4.0.0 was never published; 4.5.0 is the first public release of all of it. What 4.5 changed, file by file: `docs/V4_5_HANDOFF.md`.

`[x]` done, `[ ]` left. Anything that fails: send a screenshot or the `/guilded diag` output.

## Done

- [x] Renamed to **Guilded**: addon folder, `/guilded` (short `/gd`), saved data (old data is adopted once), channels `guilded-*`.
- [x] License **PolyForm Noncommercial 1.0.0**; CurseForge project created; copy-paste text in `docs/CURSEFORGE_COPYPASTE.md`.
- [x] Addon in game: login, window and Home page, officer pages, sim raid and solo bidding, backup and restore, sync and diagnostics, modules on/off.
- [x] Discord: `/setup`, `/core setup` and `/core edit`, test raid, weekly raid, craft board, signup post (names, FULL, core and bench).
- [x] Companion tray app connects and uploads; characters link automatically.
- [x] Tests (550+), lint, type check and the addon validator pass; a test loads the whole addon in `.toc` order and runs a command from every part. `dist/Guilded-v4.0.0.zip` is built with `npm run addon:zip`.
- [x] Addon audit: 11 fixes and 6 upgrades (see "Addon audit" below and the 4.0.0 changelog). Tests (600+), lint, type check and the validator pass. What only the real game can show is listed under "Addon audit: to check in game".

## To publish (about 30 minutes)

- [x] **3 to 5 screenshots** in game: Home page, Raid or Loot page, Me page (and a Discord signup post with the core roster).
- [x] **Logo:** regenerated with the u; ready to upload to CurseForge.
- [x] **Discord developer portal:** bot's name set to Guilded and its avatar set to the logo.
- [ ] **Rebuild for 4.5.0:** `npm run addon:zip` (makes `dist/Guilded-v4.5.0.zip`; the 4.0.0 zip is out of date), and rebuild the companion installer (4.5.0: it sends alts, in-game prices and dungeon reporters). Then `npm run db:update` (two new columns) and redeploy the bot (`redeploy-oracle.bat`). The bot posts a one-time "updated to v4.5.0" notice in each guild's bot-guide channel on its first start.
- [ ] **CurseForge:** upload `dist/Guilded-v4.5.0.zip` as **Beta**, paste the changelog from `docs/CURSEFORGE_COPYPASTE.md`. Coming from 3.x, the bot needs `npm run db:update` once (say so in the description).
- [x] **GitHub** stays private (no source URL on the listing). Repository is already named `Guilded`.
- [ ] **Companion installer** rebuilt: `dist\companion\Guilded Companion Setup 4.5.0.exe`.
- [ ] After a day with no bug reports: switch the file from Beta to **Release**.

## Still to test with a second player or a party

Say "untested" on the listing until these pass.

- [ ] Bid popup on a second character, then a bid by whisper (`/w Officer 30`); the officer sees both in the list and awards one.
- [ ] **Guild calendar** (needs a client where `/guilded calendar check` says the API is there; otherwise skip and say "calendar sync needs client support" on the listing): an officer creates a guild event in the game calendar at the time of a planned Discord raid, a second character answers Accepted, `/guilded calendar sync`, `/reload`, and after the companion uploads the second character is signed up on the Discord raid (only if they had not answered there). In the Calendar tab, "Create next raid" makes an in-game event for a Discord raid and does not make a second one.
- [ ] Recipes and cooldowns: open each profession window (Alchemy, Enchanting, a gathering skill); the chat line says how many recipes were read and `/guilded recipes mine` lists them. Check that collapsed groups were read and are collapsed again, and that filters ("have materials") did not hide recipes. On a second character, `/guilded recipes who <item link>` finds the first one's recipe; `/guilded cooldowns` shows a transmute as one line.
- [ ] Loot systems per core: make one core per system (`/core setup`), give the priority core two item prices; `/guilded core <name>` and `/guilded drop <item>` start the right flow each time. For EPGP priority: a second character answers "I want it", the highest PR wins by itself and is charged the set price (check the ledger); an item with no price is refused.
- [ ] Soft reserves with a second character: officer `/guilded reserve open`, the other reserves an item (link and Reserves tab), the list appears on both; a whisper `res [link]` from a third; lock; `/guilded reserve roll` between two reservers; award. Check the tooltip line.
- [ ] Loot council on a second character: open an item in the Council tab, answer from the popup, then a whisper answer (`bis`); the officer sees both ranked and awards one.
- [ ] `/guilded games duel <player>` with a friend (and `/guilded casino` only says it was removed).
- [ ] `/guilded invite missing` and `/guilded invite raid` as officer in a party, after creating a raid you and a friend signed up for.
- [ ] A non-officer alt sees fewer pages (no Raid, EPGP, Loot).
- [ ] A second officer's companion uploads and the guild digest carries other online players.

## 4.5: to check in game and on Discord

What changed and why: `docs/V4_5_HANDOFF.md`. Two players unless it says solo.

- [ ] **Send to Discord (solo, the reported bug).** Open the window, press **Send to Discord**: the UI reloads with **no** "action blocked" popup. Same with the officers' banner (make a change, wait 2 minutes out of combat). `/guilded sync` tells you to type `/reload`.
- [ ] **Price at the drop (officer).** Pick a core in EPGP priority mode (`/guilded core <name>`), `/guilded drop <item link>` for an item with no price: a box asks the price; type 120, Enter: the item starts at 120 GP. Drop it again: no box. `/guilded price <item> 90` changes it. After `/reload` and the companion upload, the price shows in `/core items action:list` on Discord.
- [ ] **Item prices list (Discord).** `/core edit <core>` > **Item prices**: the form is filled in with current prices and wishlisted/awarded items (`= ?` or a suggested number). Change one, save: `/core items action:list` shows it.
- [ ] **Rename a core.** `/core rename <core> <new name>`: the roster message updates; in game (after the next upload) `/guilded core` still shows the same core with its new name.
- [ ] **Application with a role and a trial.** Friend presses **Apply to <core>** on the roster: role buttons appear, pick Healer, fill the form. The card shows the role. Officer presses **Trial**: the roster shows Friend under "🧪 Trial (1)", and the card still has **Approve (end trial)** and **Reject**. Approve: Friend moves into the Healer column and gets the member role. (Try Reject on another trial: they leave the roster.)
- [ ] **Optional roles (solo, admin).** `/setup start`, step 1: **Create optional roles** creates Loot Leader and Class Leader; the class menu creates e.g. "Class Leader (Warrior)". Give it to someone: they can open the readiness board like a Class Leader.
- [ ] **Officer log.** A new account joins the Discord server: **no** line in the officer log. Give them the Member role: "Joined the guild: ... got the Member role." They leave: "Member left: ..., had ...". Someone without any guild role leaves: no line.
- [ ] **Alts.** A paired player (`/character pair`) logs in on a second character, `/reload`: after the upload, `/character who` (or their profile) lists both characters under their Discord account.
- [ ] **Recipes.** Friend (without the addon is fine) links their profession in chat; you open the link: chat says "Guilded saved Friend's <profession> recipes". `/guilded recipes who <item>` finds Friend. A character with a crafting profession never opened gets one reminder at login, not again the next day.

## Addon audit: to check in game (with a second player)

What changed and why, file by file: `docs/ADDON_AUDIT_HANDOFF.md`. Everything here is covered by automated tests against a mocked game; these steps check what only the real client can show. Two characters in a party or raid unless it says solo: **Officer** (you) and **Friend** (the second player). A third character outside the group, **Outsider**, helps for the first two items (any alt or a friend who is not grouped). If something fails, `/guilded diag` and a screenshot.

**Fixes**

- [ ] **1. Whispered bids only from the group.** Officer: `/guilded bid start 10 <item>`. Outsider whispers the officer `30`: no bid appears and Outsider gets no "Bid received" whisper. Friend whispers `25`: the bid is listed and confirmed. Friend's popup bid is also listed.
- [ ] **1b. Loot answers only from the group.** Officer: `/guilded council priority 30 <item>`. Outsider whispers `yes`: not listed. Friend whispers `+` (or `need`): listed as "wants it". Let the timer run out: Friend gets it and is charged 30 GP (check `/guilded standings` after sync, or the EPGP tab).
- [ ] **2. Dungeon run trust.** Officer and Friend (both with the addon) enter a dungeon and pull; `/guilded dungeon status` names the same recorder on both. The group leader (or the recorder) runs `/guilded dungeon complete`: both clients show the run COMPLETED. Then do a second run where the other player (not leader, not recorder) runs `/guilded dungeon complete`: only their own client ends it; the leader's run stays ACTIVE until the leader completes it. After the companion uploads, both runs reach Discord and are valid.
- [ ] **3. Future dates refused (solo is fine).** Normal use is the check: standings arrive after `/reload` and `/guilded standings` shows them; `/guilded modules guild off games` from the officer reaches Friend. Nothing should say "refused". (The refusal itself is only testable with a wrong clock; tests cover it.)
- [ ] **4. Paced messages.** In a raid of 5+ (or party of 5), officer: `/guilded start Test`, `/guilded attendance group`, `/guilded award group 10 Test`. Friend's client receives no errors and the officer's `/guilded diag` has no "gave up" line. With 20+ reserves (`/guilded reserve add <name> <link>` a few times from the officer), `/guilded reserve share`: Friend's Reserves tab shows the whole list.
- [ ] **5. Recipes are yours only.** Friend links a profession in chat (shift-click their profession button or the link from the profession window); Officer clicks it and it opens. Officer: `/guilded recipes mine` does not list Friend's profession. Officer opens their own Enchanting (if they have it): Friend's `/guilded recipes who <enchant link>` finds the officer.
- [ ] **6. Guild roster.** Invite a pug (not in the guild) to the group, `/guilded start Test`, then `/guilded roster`: the pug is **not** listed as a guild member; `/guilded end`, `/guilded attendance seen` still counted them. `/guilded autoinvite on`; the pug whispers `ginv`: they get a guild invite (before, having raided with you blocked it).
- [ ] **7. Journal (solo is fine).** Friend runs a few EPGP commands; Officer `/guilded diag` says "N addon message(s) from other players were ignored", and the Send to Discord banner does not come back just from Friend's messages.
- [ ] **8. Reserve stamp.** Officer opens reserves and Friend reserves an item. Friend `/reload`; after the companion uploads from the **officer's** PC, Discord `/loot reserves` shows the officer's list (the keeper's copy wins).
- [ ] **9. Backup undo (solo).** `/guilded backup`, copy; `/guilded restore`, paste, Restore twice, `/reload`: the message says the undo copy is kept for 7 days. `/guilded restore forget` removes it; `/guilded restore undo` then says there is nothing to undo. Also check the backup code is noticeably shorter than before for a character with recipes.
- [ ] **10. Tooltips.** Hover an item with Guilded lines, then shift-hover to compare with your equipped item: the Guilded lines are there every time (hover away and back several times, and on the comparison tooltip).
- [ ] **11. Diagnostics and ids (solo).** `/guilded start Test` then `/guilded end`: no error lines in chat and `/guilded diag` shows nothing new. The raid still reaches Discord after upload (its id now uses the server clock).

**Upgrades**

- [ ] **U1. Send queue (with 11 above).** A raid-wide `/guilded award group` with 10+ players: every player's EP arrives in Discord after upload (none missing).
- [ ] **U2. Shared helpers (solo, regression check).** `/guilded drop <item link>` in each loot mode, the item tooltip, `/guilded calendar list`, and the Ready tab still work as before.
- [ ] **U3. Addon Compartment (solo).** Click the addon list button under the minimap: Guilded is there with its tooltip; left-click opens the window, right-click runs the gear check. `/guilded minimap hide`: the compartment entry still works.
- [ ] **U4. Bidding and council survive /reload.** Officer opens bidding (60 s), Friend bids, Officer `/reload`: chat says "Bidding on ... was restored (N s left)", Friend's bid is still listed and the item closes on time; Award works. Same with `/guilded council start <item> 60`.
- [ ] **U5. Options page (solo).** Esc > Options > AddOns > Guilded (or `/guilded options`): the page opens, each switch matches the current state, turning "Show the minimap button" off hides it, and a module switch turned off shows "off (your choice)". French client: the labels are in French.
- [ ] **U6. Tests.** Nothing to do in game: `npx vitest run` covers the audit fixes (`tests/lua/audit-fixes.test.ts` and the added cases in the reserve, recipes, tooltip, full-addon and dungeon-rules tests).

## Optional

- [ ] **Ready page with other people** (officers and group leaders only): in a party or raid open the window, Ready tab (or `/guilded ready`). A plain member does not see the tab. Make a friend group leader or assistant: they should see it too. Each player appears with a colour and a reason. Press Ask everyone to check: guildmates with the addon update within seconds. Someone with no addon shows their flask and food from buffs and "no addon data" otherwise. Officers try Post to group chat.
- [ ] **Chat tab in the real game:** `/guilded chat tab` should open a tab called Guilded and show a first line there; then `/guilded sim start` prints its lines in that tab; `/guilded chat off` sends them back to the main chat.
- [ ] **Item tooltips in the real game:** in Discord `/wishlist add` an item for a linked character, wait for the companion (or `/reload`), then hover that item in your bags or the loot window: three gold "Guilded:" lines. If nothing shows, `/guilded diag` and tell me. Also try `/guilded modules off tooltip`.
- [ ] **Warcraft Logs automation:** `/config wcl-guild guild:<your guild's page link on warcraftlogs.com>`, run a raid through the bot (or use the sim raid) and upload a log; within 10 minutes of it ending the report card appears in the raid logs channel and the officer check in the officer log. Try `/wcl check raid:<id>` by hand first.
- [x] (works 2026-09-26: `/wcl report` posted a report card) Warcraft Logs: put `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` in `.env.local`, restart, `/wcl report`.
- [x] Oracle Cloud move when you want the bot online without your PC ([docs/DEPLOY_ORACLE.md](docs/DEPLOY_ORACLE.md)).
