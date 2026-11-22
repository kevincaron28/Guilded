# Guilded roadmap

> **Work queue:** ideas, research and Claude-ready specs live in [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md).

## Current stage — 20 November 2026

Guilded **9.5.0** (prepared 22 November 2026: guild events feed in the addon, French in tu everywhere and a French command picker, Discord Linked Roles, raid sign-up from the phone, guild bank donor cards, the phone app's News tab; see CHANGELOG). Before it, Guilded **9.4.8** (prepared 21 November 2026: fixes from the in-game test: two-word names in /guilded score, your own bracket, the board after a guild repair, companion updates while WoW stays open, French addon lines; see CHANGELOG). Before it, Guilded **9.4.7** (prepared 21 November 2026: a ~93% smaller dungeon board in every member's game, plus the overnight bot fixes; see CHANGELOG). Before it, Guilded **9.4.6** (prepared 21 November 2026: World PvP kills counted and named, the guild data repair after the Forever 1.60.1 hotfix, a companion that reads large saved files, officer windows that stay apart, Québec voice in the addon; see CHANGELOG). Before it, Guilded **9.4.5** (prepared 20 November 2026: one help flow for layer swap and call for help, officer windows side by side, duel stats, the Forever 1.60.1 realm hotfix; see CHANGELOG). Before it, Guilded **9.4.4** (prepared 20 November 2026: first-time setup, alts in the promotion window, crafting polish, exact character ids; see CHANGELOG). Before it, Guilded **9.4.3** (prepared 20 November 2026: Season 2 final bosses, translations, companion rollback; see CHANGELOG). Before it, Guilded **9.4.2** (prepared 19 November 2026: the data-loss audit fixes; see CHANGELOG). Before it, Guilded **9.4.1** (prepared 19 November 2026: same-day fixes; see CHANGELOG). Before it, Guilded **9.4.0** (prepared 19 November 2026: the owner's 9.4 list, docs/plans/V9_4_PLAN.md; see CHANGELOG). Before it, Guilded **9.3.11** (prepared 18 November 2026: raid boss kills recorded for the raid progress board, ready for 9 December; see CHANGELOG). Before it, Guilded **9.3.10** (prepared 18 November 2026: direct party invites, layer auto-invite opt-in, Guild invites in the minimap menu; see CHANGELOG). Before it, Guilded **9.3.9** (prepared 17 November 2026: addon-only carried runs rank with a presence proof and hand over right after a dungeon, fewer login lines, smaller uploads, companion self-test; see CHANGELOG). Before it, Guilded **9.3.8** (prepared 17 November 2026: movable setup window, quiet login, milestone lines shared with a click; the card redesign and invite clean-up are already live on the bot; see CHANGELOG). Before it, Guilded **9.3.7** (published 16 November 2026 on GitHub and the website, CurseForge 9.3.7 approved 17 November 2026: companion log for the whole run, truthful restart and addon-update lines, a guild joined mid-session saved at once, card polish, French guides; see CHANGELOG). Before it, **9.3.6** (published 16 November 2026 on GitHub and the website, CurseForge 9.3.6 approved 16 November 2026; see CHANGELOG). Before it, **9.3.5** (published 15 November 2026 on GitHub and the website, CurseForge 9.3.5 approved 15 November 2026: new painted logo spelled GUILDED, in-game dungeon result card with each player's level, guild and score, brighter dungeon cards and Scarlet Monastery wing names, achievement-unlocked painting, community points rebalance, sync health alerts, a last-saved line and a reload reminder, a run digest before the login replay). Earlier, 9.3.4 (published 15 November 2026 on GitHub and the website, CurseForge 9.3.4 approved 15 November 2026: guild-only Discord, a simpler website with a small Discord sign-in and a basic My Guilded page, Delete my data, addon polish, a companion warning for a damaged parked-uploads record). Earlier, 9.3.3 (published 15 November 2026 on GitHub and the website, CurseForge 9.3.3 approved: duel card shows the dueled character, the companion tells the addon it is alive, clearer carried-record counts and receipts, waiting duels and invites cannot loop, a waiting addon update installs when WoW closes, a hardened companion self-update, the real Start with Windows entry). Earlier, 9.3.2 (published 14 November 2026 on GitHub and the website, CurseForge 9.3.2 approved: carried duel records for addon-only players, group relay across guilds, a result line after every duel, PvP map kill and death positions, Drowned City final boss, companion update fixes). Earlier, 9.3.1 (published 14 November 2026 on GitHub and the website, CurseForge approved 14 November 2026; fixes after 9.3.0: duel rating from 1000 with a season ladder, the 21 fixes from the 13 November real-client tour, the installer over a running companion, runs for another guild). Earlier, 9.3.0 (settings in tabs, dungeon paintings on the result card, the duel leaderboard, the Availability module removed, dungeon runs from a Dungeons-only PC and fewer lost runs, duel, weekly report and other Discord cards, the companion banner and installer fix, one name per profession, World PvP deaths, the To invite window, UI polish). Before that: 9.2.0. Branch and doc names keep "8.5".
WoW Forever (level cap 60) launched 4 November 2026; its first raids open 9 December.
Guilded supports WoW Forever only (the other editions were removed 7 November) and PoE2 is hidden ([WoW Forever only](docs/FOREVER_ONLY_FOCUS.md)).
Release history: [CHANGELOG.md](CHANGELOG.md). Older roadmap text, including every finished
request list: [roadmap history](docs/archive/ROADMAP-history.md).
Latest (21 November 2026): 9.4.7 is published on GitHub, the website, CurseForge and the bot. See "Start here — 21 November 2026" for the open lists.

## Start here — 21 November 2026

**State (21 November 2026, about 12:00 UTC):** 9.4.7 is published (GitHub latest, website and R2 installer, CurseForge 9727952/9727953 approved, bot live). Store: 9.4.6.0 live, 9.4.7.0 (Submission 23) in certification. Production database: self-hosted PostgreSQL 18 on the free Guilded-DB VM since 20 Nov 23:27 UTC (queries ~2 ms).

**Every owner request of 19–21 November is done on main**, checked against the transcript (about 110 messages): links and names (#1138–#1140, #1155, #1157), group levels (#1142, #1171), podium and weekly recap cards (#1143, #1144), data-loss fixes (9.4.2, #1147–#1151), promotion cards per rank (#1158, #1161, #1174), Krol'dok band 40–44 (#1173), Krol'dok/Alcaz recovery (nothing left), French voice: vous, Québécois, Québec voice in duels, race to 60 and the addon (#1170, #1172, #1180, #1206, #1211), first-time setup, dungeon names, crafting polish (#1175, #1176, #1185, #1187, #1188), alts (#1177), Armory roster (#1178), exact character ids always on (#1183, #1186, #1189, #1210), layer swap and call for help (#1194), duel card and stats (#1197, #1200), podium background (#1199), WoW portraits (#1192, #1198), record card (#1207), the 1.60.1 realm hotfix and guild data repair (#1202, #1219), world PvP kills with names and the kills/deaths map (#1216, #1220), standings speed (#1217, #1222), upload speed (#1209), board shrink on by default (#1225), bot fix round (#1226), Discord polish (#1212).

**Fixed 21 Nov:** the daily recap of 20 Nov went out as text because the card renderer was busy; every card post now retries before falling back to text (#1231). The uptime alarm was false since 19 Nov (leaderboards title changed, #1230).

**Still open, Claude can do:**
- Oracle A1 bot move: "keep retrying" (owner, 20 Nov) stopped after the database move; resume retries every 20–30 min or drop it (the database move already gave the speed).
- Character id coverage report (`scripts/character-id-coverage.ts`) now that uploads flow again.
- `GUILDED_ORIGIN_TOKEN` verification on the bot and the Worker (S1).
- Backup size check; R2.7 visual regression in CI (plan in `docs/plans/VISUAL_REGRESSION.md`); T2 delta updates.
- About 30 rarer English-only addon chat lines; the safe proposals in the Discord polish report; `site/pages/mobile.md` still says "Coming soon on Google Play".
- Item previews and crafter offers are still off by default, against the 21 Nov rule (features ON by default, no opt-in): turn them on.

**Owner or real-client only:**
- In game on 9.4.7: one "Guild data repaired" line, runs upload, officer windows after a drag, an open-world kill with a name, no blocked-action popup, the smaller Dungeons board (`docs/V9_4_7_RELEASE_ACCEPTANCE.md`).
- Two-player tests: On my way and layer join, duel stats, Layer help.
- Manage Nicknames for the bot in High Guard and The Beard; finish `/setup start` in K Caron Projects and The Beard.
- Season 2: `/guilded-season season2-review` then `season2-activate` on 5–7 Dec; one run each in Krol'dok, Alcaz, Blackmaw and Shaper's Terrace before 9 Dec.
- T2 release signing key custody; polish picks (OQLF spacing, embed palette, ™); A1 fallback if Oracle never has capacity (Pay As You Go or a small paid VM); Cloudflare analytics check; link-guide screenshots; Google Play closed-test steps.

## 9.4 — owner list of 19 November 2026

Plan, analysis and build order: [docs/plans/V9_4_PLAN.md](docs/plans/V9_4_PLAN.md). Twelve tracks: timeouts and sync health (T1), companion auto-update upgrades (T2), clear and short Discord messages (T3), the recap card and repeated information (T4), world PvP in Discord and on the website (T5), recipes by category (T6), the in-game crafting window (T7), character management on My Guilded (T8), an armory character card (T9), the do-not-invite blacklist (T10), ads (T11), and the Guilded and Guilded Dungeons sync review (T12). Owner decisions are listed in each track.

## Owner requests, 16 November 2026

Every request of 16 November, with its PR and status, is in "Start here — 16 November 2026" below. These two keep their real-client checks:

- **(a) Secret achievements** — hidden until earned (mystery entry "???" and "+N secret" in counts on Discord, website, app and addon; normal with a "Secret" tag once earned). First one: killed by the Son of Arugal (NPC 2529), this PR. More secrets later are one line in the addon's `KILLED_BY` table plus one catalogue row. Needs a companion release (new `secret` milestone kind) and the addon.
- **(b) Guild promotions rework (PR #1024).** Auto-promote follows the bot's rule only (`GuildedPromotion.ready`, matched by rank name); no timer: officers get a small "N ready to promote" alert, a Ready to promote panel and one click per member ("Promote next (N left)"); the Alt rank is never promoted into or out of; the bot announces promotions in the officer log only (when a roster upload shows a rank moving up). Real-client checks owed: one-click promote on Forever, no blocked-action popup, the officer-log line after the next upload.

## Historical: Start here — 19 November 2026 (superseded by 21 November above)

**State (19 November 2026, about 23:30 UTC, checked against `origin/main` 780a88bb):**
- **Published:** 9.4.0 (#1129), then 9.4.1 (#1145, published in #1146). GitHub v9.4.1 is latest, the website installer is swapped, CurseForge 9707178/9707179 is in review, the bot runs 9.4.1. Store: 9.4.0.0 is live (Submission 17); 9.4.1.0 is in certification (Submission 18). Check each provider live before claiming status.
- **9.4.2 (shipped, now superseded by 9.4.3):** the data-loss audit fixes (`docs/plans/DATA_LOSS_AUDIT_2026-11-19.md`). Merged: companion #1147. Open: bot #1149, addon #1148 and #1151. The bot part goes live on merge. Only the coordinator bumps the version.
- **Merged on 19 November and already live on the bot:** #1134 promotion panel, #1135 faction invites and site factions, #1136 do-not-invite wording and Undo, #1137 `/guilded verify` removed, #1138 DM link duplicate rows, #1139 run report merge (plus a 45-row backfill), #1140 doubled first names, #1141 and #1142 run summary fields, #1143 podium and weekly recap cards, #1144 painted emblems, #1150 Store line. The whole 9.4 list (#1114–#1133) is in the table below.
- **Phone app:** 0.5.0 is in Google review on the closed test track (Alpha); 0.4.1 is live there.
- **Goldline** (WoW Forever auction-house charts) is a separate project, `Desktop\wow-trading`, not tracked here.

### Owner request, 19 November 2026: "make sure we are finished everything, all items on the roadmap"

Every open item was checked against main. Result: nothing from the 9.4 list or the 16 November list is half-built on main except the items marked "open" below.

**Done on main (with PR):**
- 9.4 tracks T1–T10 and T12: see the table in [docs/plans/V9_4_PLAN.md](docs/plans/V9_4_PLAN.md) (status table at the top).
- Worker W1–W4 (#1031). SEO3 (#1071), SEO4 (#1072), S7 (#1069). R1.7: the Cloudflare beacon token is committed in `site/analytics.json` (#1040).
- Sync and upload speed work: #1070, #1079, #1080, #1081, #1082, #1083, #1116, #1122.
- Compatibility policy (#1025), single-witness run ranking (#872), Season 2 dates and routes (#1019, #1021).

**Still open, code (Claude can do these):**
- **In progress (claude/roadmap-open-items):** SEO3, SEO4, R2.6, R2.7, S7 follow-ups. Main already has the first pass of SEO3, SEO4 and S7 (PRs above); R2.6 (mobile app page) and R2.7 (visual regression in CI) are not on main yet.
- **T1.5 "answer first, work after":** built: the apply of an upload is answered after a 2.5 s grace as "received, applying", applies never overlap per guild, failures are logged, told and retried, and a PREVIEWED import left by a restart is applied again when the companion resends it.
- **T2 rollback and delta updates:** not built. Release signing waits for an owner decision (where the private key is kept).
- **T8C (move a character to another Discord server):** deliberately later, after Make main and Unlink have run in production.
- **T9 Blizzard character pictures:** blocked until Blizzard's Forever profile API opens (`scripts/probe-forever-profile-api.ts`); our own character card is live.
- **Item previews and crafter offers:** built, off by default, never accepted on a real server.
- **Backup size check** (15 MB on 9 November, before #679) and **monetization groundwork** ("Later: monetization"): not started, not a priority.

**Owner or real-client only:**
- Real-client checks for 9.4.1 and 9.4.2: the promote panel and `/guilded promote test`, dungeon card guilds and levels, the crafting window, the Layer button. Also the older carried checks: member ledger sync, duels with several clients, G6–G10 dungeon and French-client checks, Layer invite accept, crafter claim, call for help, combat behaviour.
- T11 ads: the AdSense script loads on the website, but Google is not filling the slots yet (Google side). App ads and the Play trader status are the owner's decision.
- Google Play: 0.5.0 in review; the 12-tester, 14-day closed test; Firebase and `EXPO_TOKEN` are the owner's.
- Store: 9.4.1.0 certification, then 9.4.2.0 (submit with every companion release).

### Owner to-dos (19 November 2026)

- **Season 2 activation, 5–7 December:** run `/guilded-season season2-review`, then `season2-activate`. Season 2 begins 9 December 15:00 Pacific.
- **In-game checks for 9.4.1 and 9.4.2:** the promote panel and `/guilded promote test`, dungeon card guilds and levels, the crafting window, the Layer button (`docs/V9_4_1_RELEASE_ACCEPTANCE.md`).
- **Season 2 map ids** before 9 December: one run each in Krol'dok, Alcaz, Blackmaw and Shaper's Terrace.
- **Cloudflare analytics token (R1.7):** a token is committed in `site/analytics.json` (#1040). Verify in the Cloudflare dashboard that visits arrive; if not, replace the token.
- **`GUILDED_ORIGIN_TOKEN`:** no document records that it was set on the bot and the Worker, or that the Caddyfile was copied. Verify; until then the real-client-IP protection (S1) is inactive.

Everything not listed above (Google Play steps, the CurseForge description paste, the Store submissions) is in the older to-do lists below and unchanged.

## Historical: Start here — 16 November 2026 (superseded by the section above)

**State:** 9.3.5 is released (GitHub, website, CurseForge). Everything below marked "merged" is on `main` and ships as **9.3.6**. Only the coordinator bumps the version. Check each provider live before claiming status.

### Owner requests, 16 November 2026, and where each one is

Merged (on main, ships in 9.3.6):
- **French dungeon names** from the Forever client, and the addon matches dungeons by instance id (#1016).
- **Discord audit of Québec Gold.** Done live: `#guilded-annonces` is read-only except for Maître de guilde and Officier; craft channels follow the WoW category; the rules panel role names are fixed; 82 stale bot messages were removed (a copy is saved); the raid pin's automatic-dates line is gone; a `#choix-de-jeu` reminder is posted. Code text fixes: #1017. Owner decisions: keep unused channels; FlaviBot, Chaman and Grand Templier admin is intended; members without a game role are those who have not picked one.
- **Security queue S1, S4, S5, S6, S8** (#1015). S1 only takes effect once `GUILDED_ORIGIN_TOKEN` is set on the bot and Worker W1 is deployed. The Caddyfile must be copied to the server on deploy.
- **Hide my profile** opt-out: `/character privacy` and a switch on `/me` (#1018).
- **Race to 60** shows only current guild members (#1020).
- **Season 2 starts 9 December 2026, 15:00 Pacific**, with the raid launch. Every season system follows it: duels, battleground ladder, world PvP totals, Clash, raid attendance (auto-season). Community podiums stay monthly and are labelled by month. The owner gets a reminder DM from 2 December (#1021). Raids: attendance only for now; raid scoring is declined for now.
- **Season 2 dungeon routes 45–60** with generous provisional targets (BRD 70, LBRS 70, UBRS 75, Scholo 60, Strat 50/45). LBRS/UBRS, Dire Maul and Stratholme wings are by last boss, with verified French boss names. Drowned City is added. Krol'dok, Alcaz, Blackmaw and Shaper's Terrace wait for map ids (#1019). Research: no Forever clear-time data exists; measured runs take over through the existing formula.
- **Secret achievements**: hidden until earned ("???" and "+N secret" in counts; a "Secret" tag once earned). First one: killed by the Son of Arugal (#1022). More secrets are one line in the addon's `KILLED_BY` table plus one catalogue row. Needs the companion release (new `secret` milestone kind) and the addon.
- **Promotions rework**: the bot's rule only (days and level, matched by rank name); officers get an "N ready to promote" alert and one click per member ("Promote next"); the Alt rank is never promoted; promotions are announced in the officer log only (#1024).
- **Officer member-trend graph** (`/officer stats trend`, a weekly officer-log post) and "community points" wording on dungeon surfaces (#1023).
- **Compatibility policy**: N-2 support window, version header, protocol range, replay fixtures and guard tests (#1025).
- **Linking**: sign-in shows only matching servers; one click claims the characters the companion reported (officer and member off switches) (#1026). Discord to Battle.net auto-link was investigated and declined: Discord only gives a self-declared BattleTag, and Blizzard's API does not expose Forever characters. A BattleTag addon probe was not chosen.

In progress:
- **Gold achievements** (100 / 500 / 1k / 5k "Gold Goblin", gold held, tier only, announcement off by default) and `/guilded probe auctions`: PR #1027, merging. Auction House achievements (sales and profit, no Flipper) wait for the in-game probe (plan: `docs/plans/AH_ACHIEVEMENTS.md`, arrives with #1027).
- **Art**: 25+ new painted images generated (`Desktop\Guilded-Art\2026-11-16`) and leaderboard polish with dungeon art: a worker is on it.
- **Edge-case sweep**: a worker is on it.

Housekeeping: old PRs #722, #984 and #345 were closed on 16 November (branches kept).

### Follow-ups (updated 16 November 2026)

Done on 16 November: stricter "confirmed" evidence (T8, #1032), Auction House achievements (#1034), companion upload of the probe results (#1033), Worker W1–W4 (#1031). Raid scoring: declined by the owner (raids count attendance only).

Still open, both need a real client:

1. **Verify in game:** the French boss names and Gandling.
2. **Season 2 maps:** Krol'dok, Alcaz, Blackmaw and Shaper's Terrace need one run each for their map ids before they get routes (before 9 December).

9.3.7 (16 November) shipped the fixes from the two-PC test (#1043); its real-client checks are in `docs/V9_3_7_RELEASE_ACCEPTANCE.md`.

### Owner to-dos

- **Season 2 activation, around 5–7 December:** run `/guilded-season season2-review`, then `season2-activate`. Season 2 begins 9 December 15:00 Pacific.
- **Two-PC test** and the in-game checks for the 9.3.6 work (one-click promote, officer-log line, French dungeon names, secret achievement, claim button).
- **Second-PC companion restart** confirmation.
- **Google Play:** app name, Play Console steps, Testers Community order (12 testers for 14 days). Firebase and `EXPO_TOKEN` are still the owner's.
- **Store:** submit 9.3.5 and 9.3.6 after 9.3.4 certifies (check the live status first).
- **Set `GUILDED_ORIGIN_TOKEN`** on the bot and the Worker, and copy the Caddyfile to the server, when deploying #1015.
- **Cloudflare Web Analytics token** in `site/analytics.json` (R1.7). The build supports it; the token is empty.
- **CurseForge description:** paste `docs/marketing/curseforge-description.md` into both projects by hand if not done.

### Audit of older open items (16 November 2026, checked against main)

Done or obsolete:
- 13 Nov "Syncing now." line staying on screen: done (#819).
- Season 2 start "~18 November": replaced by 9 December (#1021). Season 2 current-v2 rules decision: done (#1019, #1021).
- Dungeon unknown final bosses: done (#491 and the wing work in #1019).
- Download mirror (R2): done (#658, #680, #688).
- Website redesign R0.1–R0.7, P1, R1.1–R1.6, R2.1–R2.5: all merged (#737–#759); CF1 pointer kept current (#1007).
- Security S2 and S3: superseded by the owner decisions of 14 November (single-report runs are ranked; one witness is enough; #872, `docs/plans/SINGLE_WITNESS_2026-11-13.md`). Plausibility checks exist in `src/services/run-plausibility.ts`.
- SEO2 (kcaron.top as primary host): superseded by guildedwow.com as the main site (#776, `canonicalRedirect` in `worker/index.mjs`). SEO1 (French `?lang=fr`): superseded by R1.6 (French pages at `/fr/`, #756).
- Android PR #345: closed 16 November (branch kept).
- 8.4.7 distribution: obsolete (noted under "Carried over").

Still open (the coordinator keeps the sized list):
- Worker W1–W4, SEO3 (bot pages still use `?lang=fr` canonicals), SEO4 (`robots.txt` has no `Disallow` lines), R1.7 (token), R2.6 (mobile app page), R2.7 (visual regression in CI), S7 (mobile dependency advisories, not re-checked).
- Item previews and crafter offers: built, off by default, never accepted on a real server.
- Real-client checks: member ledger sync, duels and announcements with several clients, the 5 November UI batch, the G6–G10 dungeon and French client checks, Layer invite accept, crafter claim, call for help, combat behaviour.
- Monetization groundwork (see "Later: monetization"). Store status. Backup size check (15 MB on 9 November, before #679).

## Status records of 7–8 November 2026 (reference)

The lists below are history: each item is done, declined or tracked in the section above, unless it says otherwise. They stay here because the cross-checks name PR numbers.

### Status of every owner request (completeness audit, 7 Nov 2026, ~18:30 UTC)

Checked against `git log origin/main` (head `b21434d7`, #565), `docs/plans/`, the open PRs and the Control Board's roadmap rows.
Live view: the owner's **Control Board** (https://claude.ai/artifact/XWXbyp3yjpoWEjJt9Ch33N). The owner answers questions there and
pastes "Decisions for the coordinator:"; ideas wait in its "Your ideas" box (memory `control-board-artifact`).

**Where things are:** 9.0.1 (~10:00 UTC) and **9.0.2 (~17:50 UTC, #564)** are released: GitHub latest, bot `c886d746`, CurseForge in review
(Store skipped for 9.0.1 and 9.0.2). PRs #495-#565 are merged (#557 was replaced by #561 and #515 is superseded; both are still
open and should be closed). After 9.0.2 only #565 (world PvP board) is merged; its addon/companion parts and any deploy of it are the **9.0.3** candidate.
State words: **Released** = in a published client (members have it); **Live** = bot/site, running; **Merged** = on main, not yet in a client release;
**Plan** = written, owner has not picked; **Blocked** = waiting on a third party.

#### Owner requests 1-24 (7 Nov)

| # | Request | Status | PR / evidence |
| --- | --- | --- | --- |
| 1, 2, 18 | Battle.net message, companion link in game, map pins hidden in instances | Released 9.0.1 | #464 |
| 3, 4, 7, 9 | Officer client: professions in notes, Initiate to Member, EP/GP in notes, greeting | Released 9.0.1; real-client check owed | #474 |
| 5 | Linked-characters DM + button | Live | #473 |
| 6 | Monetization (plan only) | Plan: Lite and Plus tiers added | `docs/plans/MONETIZATION.md`, #462, #539 |
| 8 | Addon-message sync gaps | Released 9.0.1 (bot live) | #479 |
| 10 | Guild bank + Discord | Live: ledger, search, links, requests, minimum stock | #502 |
| 11, 19 | Roster admin window, native WoW fit | Released 9.0.1 | #478, #480 |
| 12 | Race to 60 redesign + reach-60 card | Live; top 50; no real level 60 seen yet | #471, #518 |
| 13 | Dungeon cards (one per run, heat map) | Live; traced maps under the heat map released 9.0.2 | #461, #483, #503, #559 |
| 14 | Remove availability module | Hidden in 9.0.1; the addon page, module, `/guilded free` and `GuildedFree` traffic removed after 9.2.0 (owner, 13 Nov). The website "Who's free?" page was retired too (#832): `/me/availability` answers a 301 to `/me/` from `src/services/retired-pages.ts`, the service and flag are gone, the `WebAvailability` rows stay until housekeeping purges them at expiry | #477 |
| 15 | One name standard | Live (guard test) | #476, #495, #513 |
| 16 | One #invitation-guilde, in the WoW category | Done | #477 |
| 17 | Guild overview panel | Released 9.0.2 | #501 |
| 20 | Screenshots + guides | Guides live; 14 screenshots owed (owner at the PC) | #506, `docs/SCREENSHOT_SHOTLIST.md` |
| 21 | Website refresh, Québec Gold pages | Live: QG pages, guild pages, ranking-site boards, reserves/wishlist | #470, #485, #522, #534 |
| 22 | Phone app + TCG | Bot side live: boards, guild, album, map, News feed; redesign slices 1-3 merged (News, UI kit, five-tab shell); slice 4 waits on Clash (on hold) and push (#345 + Firebase); Android closed-test build 0.3.0 | #489, #496, #507, #519, #614, #615, #925, `docs/plans/APP_REDESIGN.md`, `APP_TCG.md` |
| 23 | Every feature has a home in Discord | Live | #477 |
| 24 | Discord audit + fresh setup | Done, 4 bugs fixed; Québec Gold tidy-up needs the owner's OK | #504 |

#### Idea list 2 (7 Nov, prioritised)

| Pri | Idea | Status | PR |
| --- | --- | --- | --- |
| P0 | Window can't be closed | Released 9.0.2 | #514 |
| P1 | Companion version + Update now | Released 9.0.2 | #511 |
| P1 | Race to 60 top 50, ranking-site cards | Live; 24h arrows live | #518, #532 |
| P1 | Dungeon season window, fewer buttons | Released 9.0.2 | #520 |
| P1 | Remove "Qui est qui"; test servers apart | Live | #517 |
| P2 | Records, challenges, recap cards | Live | #523 |
| P2 | Item links in profession posts; item previews | Live | #516, #497 |
| P2 | Armory data | **Blocked**: Forever character API closed; re-check script | #524 |
| P2 | Companion audit + redesign (sync first) | Done 5/5, released 9.0.2 | #512, #525, #529, #530 |
| P2 | Phone app redesign + Wowhead news | Slices 1-3 merged (News tab, UI kit, five-tab shell); slice 4 waits on Clash and push | #519, #614, #615 |
| P2 | Profession link shows a recipe card | Live | #521 |
| P3 | Raid readiness upgrade | Live (raid night check card) | #531 |
| - | In-game guild board, rankings site, install guides | Live (board addon part released 9.0.2) | #508, #522, #506 |

#### Idea list 3 (7 Nov)

| Idea | Status | PR |
| --- | --- | --- |
| P0 Call for help firing without an attack; P1 location + real-attack check | Released 9.0.2 | #541 |
| P1 Installer removes Store/old versions, plug-and-play download page, automatic setup | Released 9.0.2 | #546, #560 |
| P1 Board channels read-only, reactions allowed; rookie of the week | Live; Québec Gold permission change needs the owner's OK | #550, #556 |
| P1 #invitation-guilde pre-links characters; WoW chat to Discord guide | Live | #544 |
| P1 Artisan channels split (orders, archive), crafter roles, opt-in pings | Live | #548 |
| P1 Dungeon UI: stats, guild comparison | Released 9.0.2 | #553 |
| P1 Duel scoring by level difference; PvP finder redesign | Live / released 9.0.2 | #545, #552 |
| P2 In-game crafting orders linked to Discord | Released 9.0.2 | #554 |
| P2 Better dungeon scoring from run analysis | Tool + inactive Season 2 model merged; activation after ~18 Nov (owner) | #542 |
| P2 World PvP: research, leaderboard, stats | Addon stats released 9.0.2; board merged, client parts 9.0.3 | #549, #565 |
| P2 Plan: character pictures on cards and website | Plan only | #539, `docs/plans/CHARACTER_VISUALS.md` |
| P2 Plan: Lite and paid bot versions | Plan only | #539, `docs/plans/MONETIZATION.md` |
| P2 Plan: several game accounts for one member | Plan only | #547, `docs/plans/MULTI_ACCOUNT.md` |
| P3 Remove other WoW editions from the code | Done: stages 1–6 merged (#567, #568, #571, #573, #577, #578, #580, #581) and docs (stage 8); stage 7 (delete other editions' stored rows) declined by the owner: the rows stay | #540, `docs/plans/FOREVER_ONLY_REMOVAL.md` |

#### Idea list 4 (7 Nov)

| Idea | Status | PR |
| --- | --- | --- |
| Craft history + crafter points | Live (Top crafters ladder); #557 superseded | #561 |
| Dungeon map + heat map | Released 9.0.2 | #559 |
| Profession achievements | Live / released 9.0.2 | #555 |
| Forever achievements analysis | Research done; in-game API probe not done | #555, `docs/plans/FOREVER_ACHIEVEMENTS.md` |
| Combined participation ladder | Live | #543 |
| Remove countdowns; Québec Gold channel audit | Countdowns removed (#558); audit done, tidy-up waits for the owner | #558 |

#### Also done since the last audit

Standings, craft board and public-runs timeouts (#527, #528, #563); deploys at low priority (#562); community honors refusal warning (#526);
dungeon board one row per player (#538); public rankings guild table, runs and guild pages (#522); records (#523).

Bug sweep 7 Nov 19:15 UTC: no member reports. Every bot error in the last two hours (about 30, P2028 and pg timeouts) fell inside
deploy windows: the build starved the 1 GB server. Fixed by #562 (low priority) and #572 (reuse node_modules when the lock is
unchanged, capped build heap); the 19:05 deploy logged no errors. 25 saved reports resolved. Also live since 9.0.2: correct roles on
dungeon cards (#569), online officers tagged for invite requests (#570), world PvP board (#565), Forever-only bot part 1 (#573).

**Owner decisions in chat, 7 Nov ~21:00-21:40 UTC:** Québec Gold tidy-up applied (📊 Classements, 🗄 Archives, nothing deleted);
Season 2 analysis run (8 runs, too thin, re-run ~18 Nov, #583); Forever-only stage 7 declined (old rows stay); invites tag any online
member and auto-detect joins (#586); release 9.0.3; **build character pictures** with the plan's recommended defaults (card-redesign
session); **build several accounts per member** with the proposed answers (track-f session); **paid tier stays off** (Lite/Plus kept
as a plan until Discord pays Canadian teams or costs grow).

**Night of 7-8 Nov (UTC):**
- **Outage 21:55-01:40:** the 9.0.3 deploy's full `npm ci` (a version bump changed the lock file bytes) froze the 1 GB server.
  The bot kept running but could not answer, so no greetings. It recovered by itself. Missed welcomes were re-sent (channel and
  DM) to the 3 joiners, and beame got @World of Warcraft.
- **Guards, all live:**
  - dependency fingerprints, so version-only bumps reuse node_modules (#598);
  - a memory ceiling on deploy installs, the bot unit at OOMScoreAdjust -500 with MemoryLow, and safe unit installs (#601);
  - an uptime check every 10 minutes that emails the owner;
  - a 15 s default for interactive transactions (#607).
- **Live:**
  - WoW role button (#596), with a backfill of 10 members;
  - invites tag any online member and auto-detect joins (#586);
  - character pictures (#589-#591, #599);
  - several accounts (#592, #593, #600);
  - record cards (#603);
  - Discord polish: card text fits, 2 cards that never drew, French boards and journal lines, names (#604);
  - item previews always link (#602);
  - addon-import failure reasons and retry (#605);
  - the pinned "Informations actuelles" rewritten for 9.0.3.
- **Releases:**
  - 9.0.3 on GitHub and CurseForge (in review); Store 9.0.3.0 in certification (9.0.0's was cancelled on the owner's word).
  - 9.0.4 (#606, the login taint fix plus several accounts) is on the bot and built in `Desktop\guilded-release-9.0.4` and
    `Desktop\guilded-store-9.0.4`. Publishing waits for the owner's "publish 9.0.4" in chat.
- **Bug sweeps:** no member reports. The freeze-time errors are resolved.

### Claude does these (owner, 7 Nov evening: "do the in game test yourself", "always do the store submissions")

- **Real-client checks, Claude in WoW on the owner's PC:** started 7 Nov ~22:20 UTC on 9.0.3. Guilded window, Guild overview
  (134 members, 49 online) and Crafting orders work. **Found:** an ADDON_ACTION_FORBIDDEN on every login, traced by module bisection to
  `Modules/RosterProfessions.lua` hooking `CommunitiesMemberListEntryMixin.OnEnter` (fix with the overview-panel session, for 9.0.4;
  the module is switched off on the owner's PC until then). Still to check: officer tools (3, 4, 7, 9), minimap spot, chat tab, French
  client, profession-link and item previews, raid night check card, guild board votes from two clients, companion update over a running
  app, call for help on two PCs, a real level 60 for Race to 60.
- **Screenshots in game (item 20):** Claude drives WoW.
- **Store submissions with every companion release.** 9.0.3.0 is built (`Desktop\guilded-store-9.0.3`); Submission 12 (9.0.0.0) is still
  in certification, so 9.0.3 goes in when it finishes (cancelling it needs the owner's word in chat).
- CurseForge uploads are automated (the API token is already in `.env.local`); 9.0.3 files 9501048/9501049 are in review.

### Waiting for owner

- *(16 Nov: the current owner to-do list is in "Start here — 16 November 2026". Season 2 now starts 9 December; the card art style was decided and the phone app redesign shipped, #614, #615.)*
- **Season 2 activation** (~18 Nov, re-run the analysis first) before `/guilded-season season2-activate`. Obsolete: now 5–7 December.
- **Card game:** pick the card art style (#613). Done.
- **Android / Google Play:** developer account paid (8 Nov). The owner finishes Play Console's 3 verifications (identity, trader status,
  Android device). Trader status: **"not a trader" for now** (owner, 8 Nov); switch to "trader" before the first monetized release.
  The listing kit is in #616; then Firebase, `EXPO_TOKEN`, #345 and 12 testers for 14 days.

### Later: monetization (direction set 8 Nov, not a priority yet)

The owner plans to monetize Guilded later: the bot with free and paid tiers (Lite/Plus in `docs/plans/MONETIZATION.md`), and probably
ads in the phone app and on the website (not certain). Nothing is built or switched on. Before the first monetized release:
1. **Google Play trader status:** switch to "trader" a few days before. Prepare a business address or mailbox service, a dedicated
   phone number and a business email (e.g. contact@kcaron.top), because Google shows them publicly in the EU.
2. **Ads, if chosen:** "Contains ads" on the Play listing, new data-safety answers (an ad SDK collects device IDs), an EU/UK consent
   prompt, and the same for the website (consent banner, privacy policy update).
3. **Paid bot tiers:** a payment route (Discord pays US/EU/UK teams only; Stripe or similar through the website), terms of sale,
   and a check on Canadian business registration and sales tax.
4. A short legal read of the PolyForm Noncommercial licence before charging (already listed in MONETIZATION.md).
- His own nickname in Québec Gold (Discord never lets a bot rename the server owner).

### Owner-message cross-check (7 Nov, all 129 messages since 5 Nov)

Every message in the owner's chat history (5-7 Nov, plus the 21-29 Oct linking and website messages) was read against this file, the Control Board export and `git log origin/main`.
Almost everything was already a row above or in the older tables. These are the gaps found, with their status:

| Owner message | Status | Evidence / next step |
| --- | --- | --- |
| "Two Guilded companions on my PC, keep just one" (6 Nov) | Released 9.0.2: the installer replaces a Store install and keeps its settings | #546 (was not in any table) |
| Auto-change the guild message of the day (5 Nov, idea 1) | Built as a reminder plus copy box, off by default: WoW does not let addons set the MOTD | `docs/GUILD_MOTD_AUTOMATION.md`, `GuildMotd.lua`; no roadmap row until now |
| Messaging lockdown (SendAddonMessage result 11) lost sync chunks (5 Nov) | Fixed and released (officer ledger transfers recover after lockdown) | #365; real two-player lockdown check still owed |
| Delete the pre-launch season and beta characters (6 Nov) | **Applied on production** (names and cleanup) | `b720467d`; the older rows saying "owner runs the preview/apply" are out of date |
| Crashin's Ragefire run did not credit Xaldin or El Pirata (6 Nov) | Fixed: guildmates are credited by character without the addon or a link | `21eeb537`, #513; the older "Track J is investigating" row is out of date |
| Make realms work the way Forever does (horde PvP ruleset, synced realms), 5 Nov | Done: synced-realm guilds recognised as one | `docs/V8_4_4_RELEASE_NOTES.md` |
| Research the Jeeves bot (it changed how it syncs characters and guilds), 5 Nov | **No write-up found** | Not started: a short comparison in `docs/` (see below) |
| "Create an API token for me" for CurseForge, "CurseForge freezes for me" (6 Nov) | Owner-side: the token has to be created by him in the CurseForge account page | Added to Waiting for owner |
| Five screenshots posted 7 Nov 00:13-03:01 (second PC and crashingbananas) | Contents are images and were not readable here; the bug sweeps after them are #475, #481, #488, #492, #505 | Owner to confirm none is still open |
| Clean the storage, delete old worktrees (6 Nov); close and archive sessions (6-7 Nov) | Process work, not product; done by the coordinator and deploy sessions | none |
| Oct 21-29 messages: `/guilded verify`, the `/setup` officer-sync warning, website update plan items 1-7, 9-11, 14, 16 | Merged long ago (`officerSyncAt` is in `src/commands/setup.ts`; site refresh #262-#268) | none |

Everything else in the file (arena ladder, Race to 60 and Hall of Fame, call for help, minimap shortcuts, fresh-PC test, advanced options, Kinfolk, bank, TCG, character names in Discord, in-game guild board, item previews, profession cards, companion decisions 1-4) is already a row above with a PR.

### Completeness audit, 8 November 2026 (every list re-read: start here, requests 1-24, idea lists 2-4, tracks A-M, carried over, later)

Everything not listed below is done (released, live or merged) per the tables above and `git log origin/main`. The old "Not started" list of 7 Nov was mostly finished overnight; its rows are resolved here.

| Item | Status | Where |
| --- | --- | --- |
| Character pictures (old not-started 2) | Replaced 20 Nov 2026: member uploads removed, cards use the WoW Armory picture | #589-#591, #599 |
| Several game accounts (4) | Released 9.0.4 | #592, #593, #600 |
| Forever-only removal (5) | Done; stage 7 declined | #567-#584 |
| Phone app restructure (6) | Slices 1-3 merged; Alerts/TCG tab need #345 + Firebase | #614, #615 |
| Jeeves research (11) | Written, plan only (owner has not asked to build the 3 ideas) | `docs/JEEVES_COMPARISON.md` |
| PoE2 leftovers + availability module (9) | Hidden behind reversible switches, data kept (by design, `docs/FOREVER_ONLY_FOCUS.md`); no deletion planned | #472, #477 |
| Hall of Fame edits, sharing always on (partial 1-2) | Live | #471, #498 |
| Login popup on Forever (officer guild-note writes) | **Released 9.0.5** (8 Nov: GitHub, CurseForge review, website, bot) | #618, #622, #628 |
| Items 3 and 7 (professions / EP-GP in guild notes) | **Not possible on Forever**: the game refuses addon note edits even on a click; Guilded stops trying | #618 |
| One group finder for dungeons and PvP (idea, 8 Nov) | Live | #619 |
| Card game: art style | Owner approved painted Magic-style art in frame A (8 Nov); 9 class champions painted, awaiting his OK (review page C9) | #613, #623 |
| Card game server stage 1 (catalogue, packs, daily, dust) | Merged (deploys with the next bot deploy) | #626 |
| Guilded Clash design | Approved in chat, merged | #629 |
| Guilded Clash engine (stage A) | Live | #631 |
| Guilded Clash stages B-E: AI + PvE gauntlet, match server, guild-only trading, balance (every target met on 4,320 games), player-vs-player (friendly, guild board, ranked) | Live on the bot (d853d1de) | #636, #638, #639, #642, #644 |
| Guilded Clash phone screens | Collection, packs, match, PvE merged (#640); **PvP screens in progress** (mobile-map session); members get them with the next APK (Google Play) | #640 |
| Later (owner idea): Québec Gold members as Clash cards, opt-in | Not started (after launch, as planned) | — |
| **Forever achievements beyond professions (8)** | Probe merged (#625); **Claude runs it in game** (results below when done) | `docs/plans/FOREVER_ACHIEVEMENTS.md` |
| Lite/Plus stage 1 (3) | Not building: paid tier stays off (owner, 7-8 Nov) | "Later: monetization" above |
| Armory enrichment (10) | Blocked on Blizzard (Forever profile API closed) | `scripts/forever-armory-probe.mjs` |
| Carried over: 8.4.7 distribution | Obsolete (9.0.x released everywhere) | — |
| Carried over: unknown Forever final bosses | Done | #491 |
| Website downloads independent of GitHub (owner wants the direct download first) | Live: zips and installer served by the site | #627, #628 |
| Companion updates and addon downloads from the website first | Merging; ships with the next companion release | #633 |
| Discord text audit (channel names in messages) | Fixed by PR + guard test; Québec Gold guide fixed (owner yes) | #630 |
| Board channels review (owner, 8 Nov) | 13 old messages deleted, 6 boards read-only (owner yes); footers, full names, French labels, plain PvP panels | #632 |
| Standings answers over 20 s (34 of 1,929 polls) | Fixed: 17 s answer deadline | #634 |
| Crafter offers / item previews in Québec Gold | ON (owner yes, 8 Nov) | — |

**Bug sweep 8 Nov ~11:30 UTC:** no member reports, no new saved bot errors; the journal only had the two routine hashed notices (readable once #620 deploys). GitHub release downloads timed out for hours (504) on 8 Nov: they block the `windows-package` CI job (merges retried by a loop) and broke the website downloads. #627 serves the addon zips from `site/downloads/` and the companion installer from Cloudflare KV, so the plug-and-play direct download (the owner's main path, not the Store) no longer depends on GitHub. Follow-up for the next companion release: its self-update and addon download should use the website too.

**Owner, 8 Nov: #wow-personnage removed from Québec Gold** (its job moved to #invitation-guilde; the bot no longer creates or names it). **Discord text audit (owner request, in progress, server-hygiene session):** every bot message, DM, pinned guide, channel topic, /help, /faq, site page and guide that names a channel is checked against what `/setup` creates today (removed or merged: #wow-personnage, #bot-faq, the PvP groups channel merged into the group finder #619). Stale texts are fixed by PR with a guard test. A read-only scan of Québec Gold and the test server lists out-of-date pinned and bot messages in `docs/DISCORD_TEXT_AUDIT_2026-11-08.md`; the coordinator applies the Québec Gold edits to bot-owned guide texts.

**Guilded Clash (card game, owner 8 Nov):** design `docs/plans/APP_TCG_GAME.md` (#629) approved in chat: core rules as written, AI + PvE gauntlet before ranked, guild-only trading v1, name "Guilded Clash". The owner approves every final card art (painted, Magic-style, made with his ChatGPT). Build stages A-D with track-d-gallery. **Later (owner idea):** Québec Gold members as cards: a guildmate's character (full name, class, picture, real achievements) as a collectible card, opt-in per member with an off switch that removes it, after the engine and AI stages.

**Bug sweep 8 Nov ~15:15 UTC:** no member reports, no new saved errors. Standings over 20 s: 6 of 934 in the last hour, all either before the #634 fix went live (14:21) or during a deploy build (14:45, 15:06), when the build starves the 1 GB server; one P2028 three minutes after a restart (known startup burst). Nothing new to fix; fewer deploys per hour is the remaining lever. **Guilded Clash on main and live (8 Nov):** collection (#626), engine (#631), AI + PvE (#636), match server (#638), guild-only trading (#639), phone screens (#640); balance pass in progress (first self-play run: first player 59.7%, classes 24-75%). Members get it with the next phone app build (needs Google Play) and the approved painted art.

**Bug sweep 8 Nov ~17:30 UTC:** quiet. No member reports, no new saved errors, no errors in the journal. Standings after #634: 1 of 1,884 answers over 20 s (20.2 s, around the one deploy that hour), p95 17.8 s. Guilded Clash balance pass #642 deployed (199915e3): every design target held on 4,320 games.

**Waiting for owner (cannot be done without him), updated 8 Nov evening:**
- Approve the 9 class champion paintings (review page, section C9), then each later card art.
- Google Play: the 3 verifications; then Firebase, `EXPO_TOKEN`, #345, 12 testers, the new APK.
- Turn on the second PC for the two-PC checks (duel, Defender banner, call for help, guild board votes, relink).
- Around 18 Nov: "run the Season 2 analysis" (production read), then activate Season 2.
- French names of the three new final bosses: a French client log is needed.
- Promotion (Initiate to Member) on Forever: testing changes a real member's rank.
- Next releases (9.0.6 with #625 probe, #633 companion web-first): his yes to publish.
Done today on his word: 9.0.5 published, painted art approved, guide fixed, #515 closed, board channels read-only,
crafter offers on, old board messages deleted.

**First priorities (owner, 7 Nov 01:45 UTC):**
1. **Dungeon cards (item 13) now, not later.** One `#donjons-terminés` post bundled three runs (two Wailing
   Caverns and one Ragefire Chasm) into one long embed. Post **one card per run** (rendered like the share cards in
   `src/services/score-card.ts`), with the dungeon image as the background, the party with full names, the time,
   and a death heat map when positions exist. Keep the boss chronology behind a button or in a thread. Also
   check the same post for: "HEALER"/"TANK" shown in English capitals for outsiders; "0 lié(s)" while members are
   tagged; and the "Score de vitesse … Sans cible : calibration" line repeated under every run.
2. **Nickname sync in Québec Gold still renames nobody.** The owner moved "Guilded bot permissions" above the
   member ranks (it is at position 44 now, and the bot also has Admin), but the 01:36 UTC run logged nothing for
   Québec Gold (1323321076478119967). That means it planned no changes: check the member query in
   `syncNicknames` (status ACTIVE, isTest false, characters with the guild row's `gameEdition`) and
   `forEachGuildScope` for Québec Gold, add a skipped/eligible count to the log line, and test with
   `/character nickname` preview if available. The other 3 servers report "I need the Manage Nicknames permission".
   Also add Manage Nicknames to the bot's invite permissions, and have `/setup` warn when the bot role is below
   member roles.
3. A recurring `UnknownError code=50035` (Discord "invalid form body") comes from an interaction handler
   (`main.ts` ~665). Find which command sends an invalid payload.
Record every new owner request in this file before working on it. Only you bump the version (next: 9.0.1 for
fixes, 9.1.0 for features).

**State at the end of 6 November (verified):**
- Bot: **9.0.0** live, main `debbad1` (includes #455, Season 1 leniency: 50% presence, 6 levels over / 3 under,
  final boss enough on single-route maps, full names on the best-runs and participation boards, quieter run
  posts). Backup before it: `/home/ubuntu/guilded-recovery/2026-11-07T00-38-15-048Z` + encrypted local copy.
- GitHub: **v9.0.0** is the latest release (companions auto-update to it). Pre-releases v9.0.0-test.1..4 can be deleted.
- CurseForge: 9.0.0 Forever files uploaded for both projects, waiting for CurseForge review (check they went live).
- Microsoft Store: 8.4.6.0 live; **9.0.0.0 in Submission 12**, submitted by the owner (check certification).
  Next Store update: `npm run store:package`, then `STORE-STEPS.txt` (docs/MICROSOFT_STORE_MSIX.md).
- Open PRs to merge first: **#454** (this roadmap + `store:package`) and **#456** (website 9.0 text, `/help` 9.0
  lines, bilingual `/officer dungeon audit`). Wait for green CI, merge, deploy (#456 touches bot help text).
- The server's `FEATURE_PREVIEW_GUILD_IDS` line in `/opt/guilded/.env.local` is unused now; delete it.
- Dependabot #407 and Android #345 are still open.

**Still to verify with real clients (9.0 is not "accepted" until these pass):**
- Companion settings survive an upgrade (fixes #449, #450, #452): on the second PC, upgrade from 8.4.7 or a test
  build to 9.0.0 and read `%APPDATA%\Guilded Companion\startup.log`. That PC's old settings are backed up in
  `D:\GuildedCompanionTest\`.
- In game (French Forever client): minimap button visible and `/guilded minimap show` feedback, Guilded chat tab
  at first login, French login line, panel layout (#451).
- After the leniency deploy: the dungeon board shows real scores (Chad Ho, Crashing Pally, El Pirata, Hulke Hogan,
  Mister were all 0). If not, run `/dungeon-admin audit why:true` for one of them.
- Guild bank link in Statistics (needs real bank data); welcome DM "Request a guild invite"; two-PC call for
  help and duel; relink of a second character.

**Partial items from the 6 November audit (do early):**
1. Race to 60 Hall of Fame: officers cannot edit entries; add add/remove/correct.
2. "Sharing and sync always on, only Delete my data": `/setup` still has "Turn public sharing off" and
   `/character nickname off` remains; "Delete my data" is only a web page. Add the button in the companion and
   member page; ask the owner whether to remove the public-sharing switch.
3. PoE2 leftovers: `achievement-badges.ts` and the companion's hidden PoE2 markup (meta text fixed in #456).
4. Officers can see why a run was not counted (`dungeon-explain.ts`): confirm with real data.

**Later phases:** screenshots, install/link guides and website (items 20-21), phone app and TCG plan (Track M,
item 22), Google Play, Discord audit and fresh-setup check (item 24).

### Owner ideas, 7 November 2026 (list 2, prioritised)

| Pri | Idea | Plan | Who |
| --- | --- | --- | --- |
| P0 | Guilded window can't be closed after opening from the minimap or the guild tab | Fix: close button, Escape and minimap toggle all close it | addon-ux |
| P1 | Companion: clear version, click-to-update; Store updates are tedious | Version panel and an Update now button; a direct Store link for Store installs | track-f-companion |
| P1 | Race to 60 top 50; leaderboard cards like a ranking site (D2 ladder, Raider.IO) | One ranking look for every leaderboard card | card-redesign |
| P1 | Dungeon season window in game: too many buttons | Regroup into sections, primary actions only, the rest in More | overview-panel |
| P1 | "Qui est qui" post not useful | Remove the post; mains and alts stay on the roster card and the profile | server-hygiene |
| P1 | Separate test servers from real guild servers | Test-server flag, kept out of public and cross-server features, grouped in the owner console | server-hygiene |
| P2 | Guild records and challenges (fastest boss and dungeon times) with notifications | Records board and record/challenge posts | records-recaps |
| P2 | Recaps: daily level gains, most levels, cards | One recap card per period; recommendation in `docs/plans/RECORDS_AND_RECAPS.md` | records-recaps |
| P2 | Item links in profession posts (study how Wowhead's bot does it) | Analysis, then richer item rows from Blizzard data | item-lookup |
| P2 | Armory: more character data from the API | Spike on Forever profile API, then read-only linking | item-lookup |
| P2 | Companion full audit and redesign (primary goal: sync) | Audit and proposal first (`docs/plans/COMPANION_REDESIGN.md`) | track-f-companion |
| P2 | Phone app redesign: roster + map, stats, profile, TCG and badges, notifications, Blue posts / Wowhead news | Plan, then a first slice (`docs/plans/APP_REDESIGN.md`) | research-plans |
| P2 | A profession link posted in #chat-guilde shows a small Discord card with that member's recipes | Extend item previews (now on in Québec Gold) to tradeskill links; synced recipes, gallery link | item-lookup (after item links, armory) |
| P3 | Raid readiness check upgrade | Next free session | — |

The owner also adds ideas on the Control Board ("Your ideas"); read them when he says "look at the board's ideas".

### Owner requests, 7 November 2026

- **Items 3, 4, 7, 9 built** (officer client, `addon/Guilded/Modules/OfficerNotes.lua`, one PR): professions in public notes, EP,GP in officer notes, linked lowest-rank members promoted one rank (once per player, never demoted; list from `GuildedPromotion.linked`), and a one-time guild-chat greeting. All ON by default; `/guilded officer auto status|professions|epgp|promote|greet|all on|off|lang en|fr` and the officer switches in Settings. One change per 12 s through the RosterTools engine. Needs real-client checks.

- (6 Nov, late) Make the dungeon season **a lot less strict** and start the timed-runs database: **DONE** in #455 (deployed debbad1). Follow-up: check the board shows real scores; routes without a speed target still cannot rank.
- (6 Nov, late, owner list for 7 Nov; none were quick enough to ship tonight)
  1. **Battle.net link message in the addon:** verify what it says now that the Battle.net link button/option
     was removed; it must not point to a step that no longer exists.
  2. **Companion download link in game:** a copyable link (or popup with the URL) in the addon panel.
  3. **Professions in guild public notes:** write each member's professions into their public note (officer
     permission needed; respect the note length and any existing note text, e.g. the main/alt marker).
  4. **Promote Initiate → Member in the game guild when the player is in the Discord** (officer client does
     it with the promotion queue; never demote).
  5. **First-link and "what's linked" DM:** list the linked characters in the Guilded DM when someone links or
     asks, and add a button on the original welcome DM to show them.
  6. **Monetization plan only (no build):** website, companion and app options; write the plan, change nothing.
  7. **EPGP in officer notes:** write EP/GP (or the standing) into guild officer notes, officer client only.
  8. **More addon-message sharing for sync:** use addon messages between guildmates to fill gaps (Track K follow-up).
  9. **In-game guild greeting** from an officer client (or relayed from the bot) when someone joins the guild;
     on by default with an officer off switch.
  10. **Guild bank + Discord:** analyse what other guild-bank addons offer and recommend what to add.
  11. **Roster admin window in game:** fix its bugs and regroup the options; remove the useless ones.
  12. **Race to 60 leaderboard redesign:** more like a public leaderboard, with a card when someone hits 60.
  13. **Dungeon completion cards (analysis + recommendation):** a card instead of the post, with the dungeon
      image as background and a death heat map of the dungeon.
  14. **Remove the "availability" module** (owner thinks it is useless; confirm what it is and who uses it first).
  15. **One name standard everywhere (owner, 6 Nov late: "the names are not standard everywhere"):** every
      bot post, board, card, DM and addon line shows the character's full name ("First Last", from
      `displayCharacterName`/`fullNameBook`), never a first name alone ("El", "Crashing") or a Discord name
      alone ("Simon"). Where a Discord member is shown, use "Full Name (@member)". Audit all of src/services and
      src/commands for raw `character`/`displayName`/`username` output, fix them, and add a test that fails on
      new raw-name output. The dungeon board (best runs, participation points) is being fixed tonight first.
  16. **#invitation-guilde in the WoW category, and only one of it (Québec Gold has two):** in
      `src/setup-names.ts` move the invite channel to the WoW category (not the Guilded category), so `/setup`
      keeps it there. In Québec Gold, keep one channel. Before deleting the other, list every name in it that
      still needs an invite (no ✅ yet) and repost those names in the kept channel through the invite queue.
      Then delete the extra channel, with the owner confirming the deletion in that session.
  17. **Guild overview panel in the in-game Guilded tab:** a visual page showing the guild's classes, roster,
      professions, cores (raid teams) and more at a glance. Research how other guild addons show this before
      building (roster/class charts, profession directories, core rosters) and propose a layout first.
  18. **Guildmate map pins hidden in instances:** world-map and minimap icons for guild members must not appear
      inside dungeons or raids (check `IsInInstance()` before drawing).
  19. **Native WoW fit for every addon feature:** each feature has a sensible page, tab or button in the Guilded
      window and looks like the default UI (Blizzard frame templates, fonts, spacing); nothing reachable only by
      a slash command.
  20. **Screenshots and guides:** screenshots of the main features for the website, CurseForge and social media;
      step-by-step "install" and "link" guides with screenshots that a non-technical member can follow
      (final phase 1, with guides added).
  21. **Website refresh, especially the Québec Gold pages:** more information and more visuals.
  22. **Phone app, heavy work (Track M):** much more visual. Plan a trading-card game built on Guilded's Discord
      badges and achievements, with dailies that earn packs to open. Research popular TCGs (mechanics, pack
      economy, collection UI) first; plan only until the owner picks a design.
  23. **Every feature has a home in Discord:** each bot, addon and companion feature and command has a channel,
      board or guide entry, so members find it from the server itself.
  24. **Discord server audit, then a fresh-setup check:** bring Québec Gold's permissions, channels and permanent
      or pinned messages up to date, then run `/setup` on a fresh test server and confirm it matches the Québec
      Gold layout (channels, categories, permissions, posts).
- (add more ideas here)

## How to work from this file (any AI session)

1. Read `CLAUDE.md` first (checks to run, command-size limit, French rules, migrations, never start the bot).
2. Pick **one track** below. A track owns the files listed under it; do not edit another track's
   files. If you must, stop and report to the coordinating session instead.
3. Each item lists **Existing** (reuse it, don't rebuild it), **Build**, **Done when** and any
   **Owner decision** still open. If an owner decision is open, build the default written there,
   behind a setting, and say so in the PR.
4. Shared files every track may touch, carefully:
   - `prisma/schema.prisma`: add your models at the end under a `// 8.5 track X` comment. Use only
     your track's migration timestamp (table below), so folders never collide.
   - `src/i18n-fr.ts`, `addon/Guilded/Locale.lua`: append your keys in one block marked with your
     track. Merge conflicts there are expected and easy.
   - `src/setup-names.ts`: only tracks B and C add channels.
   - Never edit `package.json`'s version, `CHANGELOG.md`, `README.md`'s current version line or
     the `.toc` versions. The coordinating session bumps to 9.0.0 once, at release.
5. **Owner decision (6 November 2026): every new 8.5 feature is ON by default in every Discord
   server** (boards, nickname sync, Who's who, roster gaps, Defender alerts, profession posts,
   statistics, the guildmate map, the first-link DM). Each one keeps an off switch for officers
   (server-wide) and, where it is about a member, for that member. Features that need a channel use
   the channel `/setup` creates or adopts; nothing posts until that channel exists.
6. One PR per track against `main`, green on all four checks in CLAUDE.md. Then report back to the
   coordinating session with the PR link, what was verified, and what still needs a real game client.

| Track | Theme | Migration timestamp | Main areas |
| --- | --- | --- | --- |
| A | Achievements and badges cleanup | none expected | `src/services/achievement*.ts`, `achievements-catalogue.ts` |
| B | Leaderboard boards: race to 60 and the arena/PvP ladder | `20261219000000` | new `src/services/*-board.ts`, PvP setup channels, `addon/.../Battleground.lua` |
| C | Roster and membership: who's missing, character names, roster visual | `20261220000000` | `roster-*.ts`, `guild-health.ts`, new nickname and roster-gap services |
| D | Artisans' Gallery and crafter "last seen" | `20261221000000` | `craft*.ts`, `profession-*.ts`, `recipes.ts`, gallery web page |
| E | Addon quality of life: chat tab, minimap, tooltip last seen | none | `addon/Guilded/Modules/ChatTab.lua`, `Minimap.lua`, `Tooltip.lua`, `Recipes.lua` |
| F | Companion: problem alerts, simpler settings, linking, fresh install | none expected | `companion-app/`, `companion/`, member install docs |
| G | Server and guild statistics with graphs and Google Sheets | `20261222000000` | new `stat-snapshot` service, owner/guild tools web page |
| H | Ideas from Kinfolk Guild Hub (later) | n/a | design notes only until picked |
| I | WoW Forever armory: spike, then links or lookups | none until the spike | new `docs/FOREVER_ARMORY.md`, later a small `armory.ts` service |
| J | Call for help (world PvP) | none expected | new `addon/Guilded/Modules/CallForHelp.lua`; companion chat-log watcher later |
| K | Addon-only members still sync | none expected | `LedgerSync.lua`, `LedgerRelay.lua`, `Digest.lua`, `character-verify.ts` |

C4 and C5 (roster professions, promotion panel) belong to track C; E4 (companion link in game)
belongs to track E. They were added after wave 1 started, so they ship as follow-up PRs.

Suggested order if one session does everything: A, C, E, B, D, F, G. Tracks are independent
except where noted, so they can run at the same time.

---

## Status board — every item and where it stands (6 November 2026, evening)

**What the states mean:**
- **Live (preview):** on `main` and running on the bot (`e16d381`), active only for the servers in
  `FEATURE_PREVIEW_GUILD_IDS`: the test server and Québec Gold.
- **In candidate:** merged into `release/8.5-candidate`, not deployed yet.
- **Needs client release:** the bot side is live, but members get it only with the next addon/companion
  release (version 9.0.0).
- **In progress:** a worker session is building it.
- **Owner:** waiting for the owner.
- **Planned:** not started.

### Original 8.5 list → 9.0.0

| Item | Track | State | Notes / evidence |
| --- | --- | --- | --- |
| Achievements Forever + guild only, a badge for each | A | Live (preview) | Test server: 0/89, Forever 0/9, guild 0/80 |
| Arena = battleground/duel PvP module + channels | B | Live (preview) | PvP category on the test server; Québec Gold's existing PvP channels adopted |
| Separate duel and BG ladders | B | Live (preview) | Two messages, separate points |
| Separate duel and BG **channels** and cards | B | In progress | Batch 3 #10 |
| Race to 60: top 25 with details, full names | B | Live (preview) | Québec Gold `#course-au-60`: full names (e.g. "Lebowski Holyroller") |
| Race to 60 Hall of Fame (permanent, editable) | B | Live (preview) | No level 60 yet, so not seen |
| Server/guild statistics + Google Sheets feed | G | Live (preview) | #400; IMPORTDATA feed, no Google credentials |
| Discord vs guild roster gaps (`/officer roster gaps`) | C1 | Live (preview) | Québec Gold: 258 unlinked members, 8 unclaimed characters |
| Nicknames `Name (First Last)` with fallbacks | C2 | Live (preview), **not yet seen** | Hourly; check the bot's Manage Nicknames in Québec Gold |
| Who's who board (mains + alts) | C2 | Live (preview) | Québec Gold `#guilded-guide`, 7 of 7 linked |
| Roster card (classes, professions) | C3 | Live (preview) | `/report guild`; the ⚜ fix is live |
| Professions on the roster + opt-in public-note tool | C4 | Needs client release | Bot #396, addon #401 |
| Promotion panel (Initiate → Member) | C5 | Live (bot list); **gap:** the addon panel gets no bot data | Bot feed queued with Track C |
| Artisans' Gallery + per-profession posts + last seen | D | Live (preview) | #402 |
| Gallery Request/Details buttons; better profession display | D | In progress | Batch 3 #9/#11 |
| Guild events in the chat tab (join/online/offline) | E1 | Needs client release | Online lines not seen live yet |
| Minimap shortcuts (+ Shift+right-click = call for help) | E2 | Needs client release | Tested in game on the main PC: pass |
| Last seen in the Crafted by tooltip | E3 | Needs client release | Not seen live (needs a guild-crafted item) |
| "Get the companion" in game | E4 | Needs client release | Tested in game: pass |
| Companion problem alerts + support report | F1 | Needs client release | #415 (summary fields) in progress |
| Simpler companion settings / Advanced | F2 | Needs client release | |
| Less friction linking, first-link DM | F3 | DM live (preview); companion parts need release | DM confirmed on the second PC |
| Fresh-PC install test | F4 | Done once (8.4.7) | Friction list → Track L |
| Store companion updates itself (Win 10/11) | F5 | Needs client release | #393; real Store test owed |
| Effortless linking (15 findings) | L | Partly done (#411, #413); rest in progress | Target: 2 min alone |
| Setup wizard, Repair, slimmer companion | F | In progress | Batch 3 #3/#4 |
| Server stats feed / Sheets | G | Live (preview) | |
| Kinfolk ideas (events RSVP, recruiting kit, board…) | H | Planned (owner picks) | |
| Forever armory | I | Recommendation done (links only); links in progress | `docs/FOREVER_ARMORY.md` |
| Call for help (button, Defenders, guild line, confirm) | J | Needs client release | Sending tested live; Defender banner not yet tested |
| Call for help: who's in the zone + party invites | J | In progress | Batch 3 #7 |
| Addon-only members still sync (relay) | K | Live (bot) + needs client release | |
| Forever full names (alts no longer merge) | K | Live (bot) | **Owner:** run `npm run names:forever` |

### Fixes found by today's live tests

| Fix | State |
| --- | --- |
| Duplicate key-binding header (Lua warning) | In candidate/main; addon release |
| `/gsos` asks before sending; All clear posts a line | Main; addon release (popup verified in game) |
| Minimap first click after Escape | Main; addon release (verified in game) |
| Command-size overflow (`/character`) | Live |
| Channels without a member role; setup role picker | Live (verified on the test server) |
| Standings feed starving (hotfix 1) and 20 s timeout (hotfix 2) | Live; retest passed on the second PC |
| "0 guildmates" on dungeon posts (#408) | Live (preview) |
| Guild key on first login (#410) | Addon release |
| Installer: launch before the shortcut, empty InstallLocation, 123 MB leftover, Install addon button | Companion release (#403) |
| Card ⚜ glyph | Live |
| Race board first names | Live |
| Run credit for players linked later (#418) | In candidate (next deploy) |
| Credit players **without the addon** by character | In progress (Track J) |
| Beta characters + pre-launch season cleanup (#419) | In candidate; **owner** runs the preview/apply after the next deploy |
| Item stats from guild chat `[Item]` → Discord | In progress (Track C) |
| Always share, only "Delete my data" kept | In progress (Track A) |
| Season 1 scoring check + Season 2 on 9 December | In progress (new session) |
| `#invitation-guilde` invite queue + WoW-role DM + ✅ | In progress (new session) |

### Owner decisions that apply everywhere (6 November 2026)

- **Everything on by default** in every server, with no per-feature setup (rule 5).
- **Sharing and sync are always on, with no option to turn them off**: stats, badges, profiles,
  leaderboards, map sharing, ledger sync, the guildmate relay, the officer bridge and the presence
  reports. The off switches are removed from the addon, the companion and the bot (Track A, batch 3 #8,
  extended). The single exception is "Delete my data" (Store and Discord policy requirement).
- **Channels Guilded creates are public** when the server has no member role. Québec Gold's
  `#course-au-60` stays public (owner, 6 November).
- **The next release is 9.0.0** after in-game testing and polishing.

### Every owner request made on 6 November 2026, and where it is

The owner's first message:
- Server/guild stats + Google Sheets → G.
- Arena module and channels → B.
- Badges for new achievements; only Forever and guild achievements → A.
- Discord members not in the game guild → C1.
- Artisans' Gallery → D.
- Arena ladder channel → B.
- Race to 60 → B1.
- Chat tab joins and online/offline → E1.
- Character names in Discord → C2.
- Companion alerts with a fix and a report → F1.
- Less linking friction → F3 / L.
- Fresh-PC install test → F4.
- Minimap shortcuts → E2.
- Companion niche options under Advanced → F2.
- Last seen in crafting tooltips → E3 / D3.
- Visual roster → C3.
- Kinfolk analysis → H.

Later the same day:
- WoW Forever armory → I.
- Call for help (world PvP) → J.
- Companion link in game → E4.
- Addon-only members still sync → K.
- Professions as notes or on the roster → C4.
- Initiate → Member promotion panel → C5.
- Screenshots and website refresh, then the phone app (leaderboards, guild view, last-seen heat map, help pins, dungeon notifications) → final phases, M.
- Everything on by default → rule 5.
- Guildmate map on by default → M.
- Main name in nicknames, with fallbacks `kevmister28(Lebowski H.)` / `kevmister28(Lebowski)` → C2.
- Link confirmation by DM → F3.
- Québec Gold Discord up to date → release step (done early in preview).
- Race to 60: top 25 with details, then a Hall of Fame → B1.
- Duel ladder and BG ladder with separate points → B2.
- Separate duel and BG channels and cards → batch 3 #10.
- Call for help as a minimap shortcut → Shift+right-click.
- Store companion auto-update on Windows 10/11 → F5.
- Remote-control testing that saves credits → `docs/V8_5_0_GAME_TEST_PLAN.md`.
- Two-PC Discord and in-game tests → test plan, two-PC window.
- Unlink, reinstall and relink here, including a second character → relink test.
- Effortless linking (15 findings) → L.
- Delete the pre-launch season and beta characters → cleanup #419.
- Crashin's run credit for guildmates; credit players without the addon → #418 + Track J.
- Dungeon scoring check and Season 2 on 9 December → batch 3 #1.
- `[Item]` stats from guild chat, and in profession posts → batch 3 #2.
- Companion self-repair and setup wizard → batch 3 #3.
- Slimmer companion → batch 3 #4.
- Google Play at low cost → batch 3 #5.
- App heat map → M.
- Call for help: who's in the zone and party invites → batch 3 #7.
- Always share, no off switches → decisions above, batch 3 #8.
- Request a craft from the gallery → batch 3 #9.
- Better profession display → batch 3 #11.
- Full names on the race board and beta removal → done / #419.
- `#invitation-guilde` queue, ✅ reactions, remove `#wow-personnage`, DM on the WoW role → batch 3 #13/#14.
- Version 9.0 → decisions above.

### Added to 9.0.0 on 6 November 2026 (evening, owner approved)

| Item | Owner | Notes |
| --- | --- | --- |
| In-game raid sign-up (Sign up / Tentative / Can't + role) with role and class counts, mirrored to Discord signups | Track E | Kinfolk idea, written from scratch |
| "Near your level" levelling partners (±3 levels, zone, Whisper/Invite) | Track J | From roster data, so no addon is needed on their side |
| Light recruiting kit: recruit records, interview questions, recruiting-post cooldown | invite-queue session | Builds on `#invitation-guilde` |
| **Guild bank ledger** (owner confirmed Forever has a guild bank): contents, gold history, transactions, weekly officer summary | Track K | Captured when anyone with access opens the bank |
| Dungeon runs channel: show **every** party member, including players from outside the guild, and mark guildmates clearly (e.g. a guild tag or icon, guildmates first) | season2-plan session | Uses the addon's per-player `inGuild` flag |
| PvP group finder in Discord works like the dungeon group finder (same buttons, roles, queue, expiry, posts) | Track B | Analysis of the gap in the PR |
| Remove the `#bot-faq` channel (unused): `/setup` stops creating it, offers to retire it with confirmation, `/faq` command stays | Track G | Lighter server and bot load |
| Dungeon guild leaderboards too strict: runs don't show up. Find which gate drops them (estimated targets vs evidence, presence, final boss, level band, season window) and relax what is unfair for Season 1 without breaking integrity; show "why not counted" to officers | season2-plan session | Targets are estimates until Season 1 data exists |
| Welcome DM: a member who picks World of Warcraft gets a **Request a guild invite** button (form: full character name), or can simply reply with the name. The bot posts it in `#invitation-guilde` and adds it to the invite queue automatically | invite-queue session | No need to find the channel |
| **Full character names in every bot message** (the dungeon "classement" showed "El" for "El Pirata"): one display helper used by dungeon boards, run posts, ladders, achievements, profession posts, roster, DMs and cards | season2-plan (dungeon surfaces) + Track C (everything else) | Fallback to first name only when no full name is known |
| Nickname sync uses the member's **server nickname** as the base (not the account name) when they set one, never doubling the `(First Last)` suffix, and follows later nickname changes | Track C | Owner, 6 November evening |
| Companion checks free disk space before installing or updating (the second PC had 26 MB free) | Track F | From the fresh-PC test |
| **Maximum sharing, optimal sync:** keep and upload everything guildmates' addons broadcast (Guilded and Guilded Dungeons); login catch-up (store-and-forward) for runs, professions and the roster, so data recorded with no companion online still arrives later; Dungeons-only players relayed; batching, instance queueing, delta uploads; `/guilded sync stats` | Track K | Owner, 6 November evening |
| Not adopted from Kinfolk | — | Module switches (they contradict always-on), class guides (the in-game board was built later: docs/GUILD_BOARD.md) |

### Phases after the features

| Phase | State |
| --- | --- |
| Two-PC window (duel, Defender banner, online lines) with the 9.0 addon on both PCs | Planned (after the client build) |
| Relink + second-character test | Planned (after the companion release) |
| Release 9.0.0: bump, remove the preview list, deploy, GitHub, CurseForge (script), Store | Planned |
| Québec Gold rollout | Done early (preview); finish nicknames and Hall of Fame checks |
| Screenshots + website refresh | Planned |
| Phone app (Track M), opt-in → on-by-default guildmate map | Planned |
| Google Play (USD 25, 12 testers / 14 days) | Owner; plan in `mobile/README.md` |

---

## 9.0.0 — requested 6 November 2026

### Track A — Achievements and badges

**A1. Every achievement has a badge.**
- Existing: badge art is generated as SVG by `src/services/achievement-badges.ts` from a glyph map,
  with tier frames and locked silhouettes; previews in `marketing/achievements-preview/`.
  The 8.4.5 achievements (duels, PvP, first dungeon clears) were added after most glyphs.
- Build: give each catalogue row a deliberate glyph (no fallback glyph). Add a test that fails when a
  catalogue id has no explicit glyph entry. Regenerate the preview sheet.
- Done when: the test passes and the preview sheet shows every active achievement with its own art.

**A2. Achievements are Forever and guild only.**
- Existing: `achievements-catalogue.ts` (catalogue version 6) has `wow | poe2 | guild` rows and
  per-edition rows for Era, TBC, Mists and Retail. Today they are only hidden by the
  `active-editions` / `active-games` switches.
- Build: catalogue version 7 contains only Forever (`wow-forever-*`) and guild rows. Move the removed
  ids to a `RETIRED_ACHIEVEMENT_IDS` list so they are never reused, keep earned `MemberAchievement`
  rows in the database (history and the switch back stay possible), and stop the web page, cards,
  `/achievements` and announcements from showing retired rows even when a switch is turned back on.
  Update `docs/ACHIEVEMENTS.md` and `docs/FOREVER_ONLY_FOCUS.md` (how to restore an edition's rows).
- Done when: no PoE2/Era/TBC/Mists/Retail achievement appears anywhere a member can see; counts in
  `docs/ACHIEVEMENTS.md` match the catalogue; existing earned rows are untouched.

### Track B — Boards: race to 60 and the arena ladder

Both boards copy the **duel board pattern** (`src/services/duel-board.ts`): one bot message edited in
place, a marker, a pure embed/card builder, refresh through `discord-jobs.ts`, opt-in per server.
Render images with `src/services/score-card.ts` (roster layout) so they match the other cards.

**B1. Leveling leaderboard, "race to 60".**
- Existing: `Character.level` from uploads; level milestones every 10 levels (`Milestones.lua` →
  `MemberMilestone`), achievements `wow-forever-level-N`. The officer's addon upload also sees levels
  of guildmates who never linked (`UnclaimedCharacter.level`).
- **Owner request (6 November 2026):** the `race-to-60` channel shows a leaderboard of the **top 25
  guild characters** (officers can set 10-30) with, per row: rank, character first and last name,
  class (class colour and icon), race, level with a progress bar and % to next level when known,
  professions with skill, last seen, the linked Discord member, and, for those at 60, the date they
  reached it (finish order). Below it: "levels gained this week" top 5 and the guild's count of 60s.
- **Hall of Fame (owner request, 6 November 2026):** the channel is kept after the race. Each time a
  guild character reaches 60, the bot posts a **permanent Hall of Fame entry** in the channel (number
  in order, e.g. "#7 to reach 60", name, class, race, date, days since first seen in the guild,
  professions, linked member) that is never edited or deleted, and stores it in the database so the
  history survives channel resets. The live top-25 board stays the channel's first message. When an
  officer ends the race (`/officer race end`) or everyone tracked is 60, the board switches to Hall of
  Fame mode: every level 60 in the order they arrived.
- Build: a permanent board in a `race-to-60` channel (or a channel the officer picks): every guild
  character ordered by level, class-coloured progress bars, time each one reached 60 (finish order),
  "levels gained this week". Linked and unlinked characters both count (unlinked shown by character
  name only). Members can hide their characters (`/character privacy` or a button). Optional "Near
  your level" line per member for finding levelling partners (idea from track H).
- Done when: board appears after opt-in, updates within one sync of a level change, survives a bot
  restart without duplicating, French text present.

**B2. Arena ladder and the PvP channels.**
- Existing: battleground module (`src/commands/battleground.ts`, `battleground-*.ts`,
  `BattlegroundReport`, addon `Modules/Battleground.lua`, docs `BATTLEGROUNDS_NEXT_MODULE.md` and
  `BATTLEGROUND_CAPTURE_PILOT.md`), duels and the duel board. Its channels (`BG_SETUP_NAMES`:
  `battleground-groups`, `battleground-results`, `battleground-statistics`) are an optional module that
  normal `/setup` does not create. No arena code exists.
- Step 0 (blocks the arena half): confirm in the live Forever client whether rated or skirmish arenas
  exist (`GetBattlefieldArenaFaction`, `GetBattlefieldTeamInfo`, `IsActiveBattlefieldArena`). Record
  the answer in `docs/BATTLEGROUNDS_NEXT_MODULE.md`.
- Build, PvP channels (do now): one **PvP** category created by `/setup` when the module is switched on:
  `pvp-groups`, `pvp-results`, `pvp-ladder` (permanent boards: duel board, BG statistics, arena
  ladder) with English and French names in `setup-names.ts`. Existing BG channels are adopted, not
  duplicated.
- Build, arena (if step 0 says arenas exist): addon captures the arena end screen (teams, members,
  win/loss, rating change if the client exposes it) into SavedVariables; companion uploads it;
  `ArenaTeam` and `ArenaMatch` models; both teams' uploads deduplicate one match; ladder by bracket
  (2v2, 3v3, 5v5) using the client's team rating, or a clearly labelled unofficial Guilded rating
  when the client gives none. Board in `pvp-ladder`.
- If arenas do not exist in Forever: the ladder is the PvP ladder (duels plus BG reports) and the
  arena capture waits behind the edition switch.
- Done when: `/setup` creates the PvP category once, the ladder board updates from uploads, and
  `docs/BATTLEGROUNDS_NEXT_MODULE.md` drops its stale 30 October checkpoint header.
- **Owner decision (6 November 2026): two separate ladders, never mixed points.** A **duel ladder**
  (wins/losses, win rate, streak, from `DuelResult`; the existing duel board feeds it) and a
  **battleground ladder** (from battleground reports: games, wins, win rate, kills/honorable kills
  and other stats the capture provides, per bracket), each its own message in `pvp-ladder` with its
  own scoring. Battleground stats stay labelled as player reports, not verified matches.
- **Owner decision (6 November 2026):** "arena module" means the existing **battleground/duel PvP
  module**. Build the PvP channels and the PvP ladder (duels plus battleground reports). Arena
  capture is not part of 8.5; step 0 stays as a note for later.

### Track C — Roster and membership

**C1. In Discord but not in the game guild (invite list).**
- Existing: `Character.guildRankName/guildRankAt/lastSeenAt`, `UnclaimedCharacter` (in guild, not
  linked), `src/services/link-coverage.ts` (local script only), `member-cache.ts`, roster dashboard.
- Build: `/officer roster gaps` (under `/officer`, keep `/setup` within Discord's size limit) and a
  "Discord only" filter on the roster dashboard, listing:
  1. members with a linked Forever character that is **not** in the guild roster (no fresh
     `guildRankAt` within 14 days), each with a copyable `/ginvite First Last` line (Forever
     characters have first **and** last names);
  2. members with no linked character ("ask them to link" button that sends the normal link prompt);
  3. the reverse: guild characters nobody in Discord has claimed (`UnclaimedCharacter`).
  Ignore bots and an officer-chosen list of roles (for example guests).
- Done when: the three lists match a hand check on Québec Gold, and an officer can copy all
  `/ginvite` lines in one click.

**C2. Character names visible in Discord.**
- Existing: `rank-roles.ts` (in-game rank → Discord role, loops guilds with `forEachGuildScope`);
  `/character list @member`. Nothing writes nicknames today.
- Build: opt-in nickname sync. Officer picks a format, default `Discord name (Main First)`, capped at
  32 characters; members can opt out; the bot skips the server owner and anyone above its role and
  needs Manage Nicknames (`/setup` checks it). Also a permanent **Who's who** board (one message,
  duel-board pattern) listing each member with their main and alts, for when nicknames are off.
- Done when: renaming works on a test server, opt-out restores the previous nickname, and the board
  stays one message.
- **Owner decision (6 November 2026):** default format `Discord name (Main First Last)`, for example
  `kevmister28 (Lebowski Holyroller)`, main only. Discord caps nicknames at 32 characters, so fall back
  in order: drop the space before `(`, then shorten the last name (`kevmister28(Lebowski H.)`), then
  first name only (`kevmister28(Lebowski)`); only if that still does not fit, shorten the Discord name
  with `…`. Alts stay on the Who's who board (bots cannot write Discord's personal member notes).

**C3. Visual guild roster (classes and professions).**
- Existing: `/guild-health` text (`buildComposition`, level bands, retention); roster dashboard
  filters and `professionCoverage`; `score-card.ts` roster layout.
- Build: a roster card (image) with class counts by level band (class colours) and a profession grid
  (how many crafters per profession, max skill, gaps), shown by `/guild-health` and as charts on the
  roster dashboard web page. Optional permanent board in an officer channel.
- Done when: card renders for 0, 1 and 150 members without overlap; numbers equal `/guild-health`.

**C4. Professions on the guild roster (requested 6 November 2026).**
- **Recommendation:** show professions in the roster, not in notes by default. Guild notes are 31
  characters, are often already used by other addons or for main/alt names, and editing them
  needs officer permission. Guilded already shares professions by addon message.
- Build: (1) professions and skill as icons in the roster view (C3 web dashboard and the addon's
  roster window) and in the tooltip when hovering a name in Blizzard's guild roster; (2) an
  **opt-in officer tool** "write professions to public notes" using the existing reviewed note
  action (`Modules/RosterTools.lua`, one click per batch): it writes a short tag such as
  `Alch300 Herb300` only into notes that are empty or already carry the Guilded tag, shows a
  preview first, and never touches officer notes.

**C5. Promotion panel: Initiate → Member (requested 6 November 2026).**
- Existing: one-click reviewed promote in the addon (`RosterTools.lua`, `RosterAdmin.lua`); in-game
  rank → Discord role sync (`src/services/rank-roles.ts`); the officer bridge brings bot data into
  the addon.
- Build: officers set the rule with `/officer promotion` (default: in the Discord server, at least one
  linked character, rank "Initiate" for 7+ days; optional minimum level or activity). The bot
  computes **Ready to promote** and **Not in Discord yet**; officers see it as (1) a weekly list in the
  officer channel (opt-in) and (2) an addon **Ready to promote** panel, fed by the officer bridge,
  with one **Promote** click per member. After the in-game promotion, `rank-roles` updates the
  Discord role by itself, so nobody edits roles by hand.
- Done when: the list matches a hand check, and promoting in game changes the Discord role on the
  next sync.

### Track D — Artisans' Gallery and "last seen"

**Recommendation:** one **Artisans' Gallery** built on data we already store, shown in three places,
instead of a new database. Recipes come from `RecipeKnown` (item ids, `scannedAt`), skills from
`ProfessionSkill`, cooldowns from `ProfessionCooldown`, offers from `CraftOffer`.

**D1. Gallery web page** (guild tools site, signed-in members of that guild only): search by item,
reagent or crafter; each recipe shows icon and quality (reuse the item-preview data), every crafter
who knows it, their skill, "last seen", open offers and a **Request** button that creates the normal
craft request. Crafter cards: professions, skill, notable recipes, cooldowns ready.

**D2. Discord:** keep the craft forum. Add one auto-updated post per profession (duel-board pattern,
one message each) listing recipes → crafters with last seen; replace the current top-3 directory text
(`profession-directory.ts`). `/craft who` adds last seen and sorts recently seen crafters first.

**D3. Last seen everywhere.** Use `Character.lastSeenAt` (fallback `RecipeKnown.scannedAt`) in
`findProfessionHolders`, `/craft who`, the directory, the gallery and the in-game tooltip (track E3
reads the same value from the guild roster). Show it as "today", "2 days ago", "3 weeks ago".

- Done when: searching an item finds every crafter who knows it, last seen matches the roster, and
  requests from the gallery land in the existing craft board flow.

### Track E — Addon quality of life

**E1. Guild events in the Guilded chat tab.**
- Existing: `Modules/ChatTab.lua` (tab for Guilded's own output); `GuildLog.lua` (game guild log);
  `Presence.lua`.
- Build: echo guild **join, leave, kick, promote/demote, come online, go offline** into the Guilded
  tab, matched from `CHAT_MSG_SYSTEM` with the game's own global strings (`ERR_GUILD_JOIN_S`,
  `ERR_GUILD_LEAVE_S`, `ERR_FRIEND_ONLINE_SS`, `ERR_FRIEND_OFFLINE_S`, ...) so every locale works, only
  for guild members. Class-coloured names, a timestamp, and a toggle per event type in settings
  (all on by default; online/offline can be set to officers-only view).
- Done when: Lua tests cover the pattern matching for English and French strings; in game the lines
  appear in the tab and not twice in General.

**E2. Minimap button shortcuts.**
- Existing (`Modules/Minimap.lua`, `minimapClick`): left = tools window, right = check my gear,
  alt = guild map, drag = move. Shift and Ctrl unused; only left and right buttons registered.
- Build (proposed, simplest to remember):

  | Click | Opens |
  | --- | --- |
  | Left | Guilded window on the last page used |
  | Right | Quick menu: Raid signups, Loot and standings, Dungeons, Crafting search, Guild map, Race to 60, Settings |
  | Shift + left | Dungeon groups / finder |
  | Ctrl + left | Check my gear (moved from right) |
  | Alt + left | Guild map (unchanged) |
  | Middle | Settings |

  Tooltip lists every shortcut plus live status (sync waiting, unread board posts). Keep the addon
  compartment entry in step with the same actions.
- Done when: every click works out of combat and does nothing protected in combat; tooltip text in
  French too.

**E3. "Last seen" in the Crafted by tooltip.** Read `GetGuildRosterLastOnline` for crafters (online
now = "online"), cache it in SavedVariables with the time it was read, and add it to the compact
Crafted by line (8.4.6 #375) without making the tooltip taller.

**E4. "Get the companion" in game (requested 6 November 2026).** Addons cannot open web pages, so
the addon shows a copy box with the short link (`guilded.kcaron.top/companion/`) and the stable
direct link, on the Home page and in Settings, plus a gentle reminder at most once a week for members
whose characters have not been uploaded by their own companion in 7 days (the officer bridge tells
the addon who that is). The reminder says what syncing gives them and can be turned off.

### Track F — Companion

**F1. Problem alert with the fix and a report to copy.**
- Existing: Activity page, "Review support summary" (`syncDiagnosticPreview`), save diagnostics as a
  file; `companion/sync-status.mjs`; bot error references (`/report bug`).
- Build: a red **!** on the window header and tray icon when a check fails, opening a Problems panel.
  Each problem: one plain sentence, **How to fix** steps, a **Fix it** button where possible, and
  **Copy report for the developer** (the privacy-reviewed summary plus a short reference, copied to
  the clipboard; optional "Send to developer" that files it like `/report bug`). Checks: addon not
  installed or wrong edition folder, saved file missing or not updated after `/reload`, WoW running
  during an update, sign-in expired, upload rejected (with the server's reason), companion outdated,
  no internet / bot unreachable.
- Done when: each check has a unit test that triggers it and a screenshot in the PR.

**F2. Simpler settings.** Keep visible: connection status, Sign in with Discord, WoW saved-data
(Detect/Browse), start with Windows, automatic updates, Check for updates. Move under **Advanced**:
bot address and pairing code ("older companions or your guild's own bot"), Battle.net (already hidden
for Forever), manage devices, reset/remove data, realm and guild filters, interval. Hide pages a
member does not use (Pricing, Cores, Reserves, Wishlist) until the guild uses those features.

**F3. Less friction when linking** (open items 7-10 of
[the member journey audit](docs/MEMBER_JOURNEY_AUDIT_2026-11-05.md)):
- folder picker that starts at the WoW install root and finds the Forever account folder itself,
  including several accounts (pick one per character);
- after the first companion link, a Discord confirmation ("You're linked: First Last, Second Last");
  **owner decision (6 November 2026):** send the member a **DM** (clearer than a delayed line); this
  is an owner-approved automatic message, so it is on by default, once per member, and quiet if
  the member's DMs are closed;
- `/guilded verify`: show "waiting for a guildmate's companion" vs "linked" in game, and keep the code
  in the guild digest until it is heard instead of losing it when nobody is online;
- companion offers to install or update the matching addon (WoW closed check, correct edition folder).

**F5. Store companion updates itself (owner request, 6 November 2026).** Today a Store install
shows a button that opens `ms-windows-store://downloadsandupdates` (`companion-app/main.cjs`), and
Windows' own Store auto-update installs it later, often hours afterwards. Build: when
`process.windowsStore` is true, call the Windows Store API from the packaged app
(`Windows.Services.Store.StoreContext`: `GetAppAndOptionalStorePackageUpdatesAsync`, then
`TrySilentDownloadAndInstallStorePackageUpdatesAsync` on Windows 11 and Windows 10 2004+; on
Windows 10 1607-1909, where the silent call does not exist, `RequestDownloadAndInstallStorePackageUpdatesAsync`,
which shows one small Store "Update" prompt instead of opening the Store; Windows 7/8 cannot run
Store apps or current Electron, so those members use the direct download), at most once every 6 hours
and when WoW is not running, and restart the companion quietly after it closes. Fall back to the
current button when the call is unavailable or fails. Mark future Store submissions' packages as
mandatory in Partner Center so the API reports them as required. Needs a real Store install to
test; the direct-download build already updates itself (8.4.7).

**F4. Fresh computer test.** Run the member path end to end on a clean Windows profile (Windows
Sandbox on the owner's Windows 10 Pro for the companion and folder steps; a real second PC for the
Store and WoW steps). Time each step, screenshot each screen, fix what confuses, and rewrite
`docs/MEMBER_INSTALL.md` (the French paragraph still lists all five editions). Record results in
`docs/FRESH_INSTALL_MEMBER_TEST.md`.
- Done when: a non-technical member can go from the Discord prompt to "Everything is linked" in under
  10 minutes with no question to an officer.

### Track L — Effortless linking (owner request, 6 November 2026)

**Goal:** a member goes from the Discord prompt to "linked, with my characters" in about 2 minutes
alone. Measured on a fresh PC today: about 25 minutes with help, and at least 5 places where a
member alone would stop. The owner's standing preference is the fewest steps, automatic where
possible, with a DM and an undo. Builds on F1-F5; same files (`companion/`, `companion-app/`, site
`/me/companion`, the bot's link-request expiry).

| # | Item | Status |
| --- | --- | --- |
| 1 | Find WoW on any drive (all drives, Battle.net install record, `.build.info`); pick the account `Guilded.lua`; list several if found; say when none; Browse starts at the WoW root | in Track F fix list |
| 2 | Install or update the addon from the companion (checksum-verified), and say when it's missing | done (#403) |
| 3 | Account not in the guild's Discord: detect it, show a **Join Québec Gold** invite button, then continue the link by itself. Later: accept by in-game guild membership | next |
| 4 | "Connected as <name>" with avatar and "Not you? Switch"; sign in through the Discord desktop app when possible | next |
| 5 | Browser opened behind the windows: bring it forward, plus a "Waiting for your browser… Reopen / Copy link" panel and a taskbar flash | in Track F fix list |
| 6 | One Discord click, not two (go straight to sign-in when coming from the companion) | in Track F fix list |
| 7 | Link request lasts 15 min, with a countdown in the companion and on the page and a Restart button | in Track F fix list |
| 8 | Warn ahead about Discord's "new login location" email check; offer QR-code login | next |
| 9 | Never say "Everything is linked" unless Discord, the guild server and at least one character are confirmed; otherwise a checklist (Discord ✓ / server ✗ Join / character ✗ play and `/reload`) | in Track F fix list |
| 10 | One live source of truth for status (companion home, website "Mon Guilded", the browser box) | in Track F fix list |
| 11 | All errors translated, in friendly words ("Guilded's server is restarting, retrying in 1 min") | in Track F fix list |
| 12 | Partial status: upload OK / rankings delayed; server-side issues never turn the member's badge red | next |
| 13 | Explain where characters come from (play with the addon, `/reload`; Battle.net optional on Forever), plus a **Detect now** button that waits for the next save | next |
| 14 | A big success screen mirroring the DM, and in game "Linked to Discord as … ✓" after the first sync | next |
| 15 | First-run wizard, 3 steps (Discord → server → character) with progress; each step has "Something's wrong?" running diagnostics, plus one-click "Copy support summary" | next |

**Done when:** a non-technical member on a fresh PC, with WoW on a non-default drive and a Discord
account that isn't in the guild yet, links without help in about 2 minutes, measured by the
second-PC tester.

### Track G — Server and guild statistics

**Recommendation:** charts on the guild tools web page first, Google Sheets as a live feed, not the
other way round. A Sheets API integration needs Google service-account credentials the repo must not
hold; `IMPORTDATA` needs none.

- Existing: `/stats`, `guild-stats.ts`, `weekly-report.ts`, `/guild-health`, `/officer export` CSVs,
  `MemberActivityTotal`, `CommunityParticipationDay`, companion spreadsheet export.
- Build:
  1. `GuildStatSnapshot`, written once a day per guild: Discord members, members active (messages,
     voice), linked members, guild roster size, online peak (from uploads), level distribution,
     class counts, level 60 count, raids and dungeon runs that day.
  2. A **Statistics** page on the guild tools site with line and bar charts (members over time,
     activity, levels, classes, professions); officers only by default.
  3. A read-only CSV feed per guild (`/officer stats feed` shows the URL with a revocable key) that
     an officer pastes into Google Sheets with `=IMPORTDATA("…")`; Sheets then draws its own graphs.
     Ship a ready-made Sheet template link in the doc.
  4. `/stats server` embed with a small chart image (score-card renderer).
- Done when: 7 days of snapshots draw correctly; the CSV loads in Google Sheets; revoking the key
  stops the feed.
- **Owner decision:** later direct Google Sheets writing (needs a Google Cloud service account the
  owner creates). Not part of 8.5.

### Track H — Ideas from Kinfolk Guild Hub (later; pick before building)

Kinfolk ("KinFolk: Guild Hub", CurseForge, Forever, 0.18.16 on 5 November 2026) is **All Rights
Reserved**: reuse ideas only, never code, text, layout, art or the name. Guilded already matches or
beats it on loot/EPGP, crafting, the Discord bot, linking, dungeon scores, duels and the guild map.
Worth adopting, most useful first:

1. **Built (9.0.0):** **Events with RSVP in game:** sign up / tentative from the in-game calendar with role and class
   counts, mirrored to the existing Discord raid signups (we have signups; the in-game side is thin).
2. **Built (9.0.0):** **Recruiting kit:** recruit records, editable interview questions, recruiting posts with a shared
   guild cooldown, building on `/mod recruit` and the officer Prospects window.
3. **Built (9.0.0):** **Levelling partners:** "near your level and zone" list with a whisper button (folded into B1).
4. **Built (#508):** **In-game guild board** for officer posts and polls, mirrored from Discord polls. Built 7 November
   2026 (`docs/GUILD_BOARD.md`): Guild board page, `/poll news`, `/poll board`, votes from the game.
5. **Done (9.0 rule 5):** **Per-guild module switches** set by officers (extend the announce off switch). Every 9.0 feature has officer and member off switches.
6. **Short class notes** labelled confirmed or early advice (not planned, low priority, content upkeep).

### Track I — WoW Forever armory (spike first; requested 6 November 2026)

Blizzard's Forever armory is live at `worldofwarcraft.blizzard.com/en-us/forever/{us,eu,kr,tw}/armory`
(characters from level 10). What we know: the page is a client-side app; `robots.txt` only blocks
login pages; no public Forever API namespace has been announced, and Blizzard's Profile API never
covered Classic characters before. Character URL pattern, name encoding (Forever first **and** last
names) and guild pages are **unverified**.

**Recommendation:** use it only through an official route, and only as optional enrichment. The addon
and companion stay the source of truth; nothing breaks when the armory is down or changes.

- **I0. Spike (blocks everything else, ~1 hour):**
  1. The owner opens one real Forever character page and one guild page in a browser with DevTools →
     Network, and saves the URL patterns and any JSON request names (no cookies or tokens copied).
  2. With the existing Battle.net developer app (`docs/BATTLENET_SETUP.md`), test whether
     `profile-forever-us` / `dynamic-forever-us` (or similar) namespaces answer for a known character.
  3. Read Blizzard's website and API terms on automated access. Record all three answers in
     `docs/FOREVER_ARMORY.md`.
- **If an official API covers Forever:** (a) `/character link` checks the character exists and shows
  its level, class and guild before saving; (b) a daily guild-roster import fills levels for members
  without the addon (feeds B1 race to 60 and C1 roster gaps); (c) `/armory First Last` lookup and an
  armory link on every character card, profile and the Artisans' Gallery.
- **If only the website exists:** add armory **links** (character cards, `/character list`, gallery,
  race board) and no automated reading. No scraping of undocumented endpoints.
- Battle.net sign-in stays hidden for Forever members until I0 proves it links Forever characters.

### Track J — Call for help (world PvP), requested 6 November 2026

**Goal:** a member being ganked presses one button and the right guildmates know at once, in game
and in Discord.

**Recommendation (who gets alerted):** guildmates with Guilded who opted in as **Defenders**
(default on for level 60s, off below level 40, a member setting), within the same zone, sorted by
distance when the guild map knows both positions. Everyone else in the guild sees one quiet chat line.

- **Existing:** guild map position sharing (`Modules/GuildMap.lua`, default on, paused in instances
  and combat, so the last position before combat is still known); the paced addon-message queue
  (`ns.comm.send`); the Guilded chat tab; Québec Gold's **Blizzard-native guild chat ↔ Discord link**
  (`#chat-guilde`), which already carries guild chat into Discord with no bot involvement.
- **Build, addon:**
  1. Trigger: `/guilded help`, a key binding, the minimap quick menu (E2) and a **Call for help**
     button that appears for 20 s when an enemy player damages you outside a battleground
     (`COMBAT_LOG_EVENT_UNFILTERED`, hostile player source). Never sends by itself.
  2. Message (prefix `GuildedSOS`): caller, zone, subzone, map position if known, level, attacker
     names/classes/levels seen in the combat log, time.
  3. Receivers who are Defenders get a raid-warning-style banner, a sound, distance and direction
     when known, a map pin, and **On my way** / **Can't** buttons; the caller sees who is coming.
     Others get one line in the Guilded chat tab. No secure or protected action (works in combat).
  4. Optional **Also post in guild chat** (caller's choice, default on): one short guild-chat line
     such as `[Guilded] Help! Lebowski is under attack in Duskwood (2 Horde, 58-60)`. Through the
     native link it appears in Discord immediately.
  5. Anti-spam: one call per caller per 2 minutes, an "all clear" button, auto-expiry after 5 minutes.
- **Build, Discord (optional, opt-in per server):** a `@Defenders` role ping in a chosen channel.
  The addon cannot reach Discord itself and SavedVariables are only written on reload or logout, so
  live pings need the companion: it watches the game's chat log file (`Logs/WoWChatLog.txt`, written
  live while `/chatlog` is on) for the `[Guilded] Help!` line and forwards it to the bot.
  Feasibility of the chat log on Forever is step 0 of this part.
- **Done when:** Lua tests cover the trigger, cooldown and receiver filter; in game, two clients in
  the same zone see the banner within 2 seconds; the guild-chat line shows in Québec Gold's Discord.

### Track K — Addon-only members still sync (and sync is as good as other addons)

**Goal:** a member who never installs the companion still has their data (characters, levels,
professions, recipes, dungeon runs, duels, attendance) reach Discord and the website, through any
guildmate whose companion is running.

- **Existing:** member ledger sync on by default (`LedgerSync.lua`, `LedgerDigest.lua`,
  `LedgerRelay.lua`: officer receipts, whisper delivery, digest checks), the officer bridge for the
  other direction (`docs/OFFICER_COMPANION_BRIDGE.md`), `/guilded verify` for linking without a
  companion, and the provisional/trusted upload rules in `src/services/character-verify.ts`.
- **Build:**
  1. Audit, field by field, which member data travels by addon message today and which only leaves
     the PC through that member's own companion. Write the table in `docs/ADDON_ONLY_SYNC.md`.
  2. For each gap, add the field to the guild digest or relay, with provenance (who saw it, when)
     so the bot can mark relayed data "reported by a guildmate" and prefer first-hand uploads.
  3. Compare with how other guild addons sync (findings below) and adopt what is better: chunking,
     throttling, version checks, conflict rules.
  4. Show in game which guildmates have a companion syncing ("Synced via Lebowski, 2 h ago").
- **Done when:** in a two-client test, a member with no companion gets their level, professions and
  a dungeon run onto the website through the other member's companion.

**What other addons do (research 6 November 2026; search snippets, not code review):**
- **GRM** syncs over GUILD addon messages, needs matching versions, sets edit rights by rank, and on
  Retail can no longer edit public/officer notes (it keeps its own "custom note"). Whether Forever
  still allows addon note edits must be tested in game before C4's note tool ships.
- **CEPGP/EPGP** store standings in officer notes, so other addons must never write officer notes.
- **Guildbook, GuildCrafts, Recipe Registry, Profession Master** share professions by addon message
  after each player opens their profession window; none writes notes. GuildCrafts prunes data not
  refreshed in 45 days and notes that GUILD addon messages are not delivered inside instances.
- **No guild addon uploads to a website**; Raider.IO and Warcraft Logs use their own desktop apps.
  So Guilded's companion relay is already ahead. The lesson is to make every relayed record
  self-describing (author, time, id) so the bot can deduplicate and trust first-hand data first.
- Adopt for Guilded: an explicit addon version check with a "please update" line, stale-data pruning
  with a visible age, and queueing sends while in an instance until the player is back outside.
- **Call for help:** WarlordsPvP has a manual SOS (command, minimap click, button) that posts zone,
  coordinates and nearby enemies to guild chat with a 10 s cooldown; Spy2 detects enemies from the
  combat log. No addon alerts opted-in guildmates with a banner and "On my way" replies, so Track J
  would be new. Write it from scratch: these addons are references for ideas only.
- **Promotions:** GRM records promotion dates and has promote macros but no "ready to promote" list,
  so C5 is new work. Test in the Forever client that promoting from an addon click works with the
  officer's Promote permission.

### Release blocker — the companion upgrade loses settings (found 6 November 2026, evening)

Installing the 9.0 candidate companion over 8.4.7 on the second PC lost the Discord link and the
WoW folder, although `config.secure` was still on disk, unchanged. Every member would have to set up
again. Track F is finding the root cause and making upgrades always keep settings (never overwrite
after a failed read, a `.bak` before migrations), with an 8.4.7 → 9.0 regression test. The retest is
a true upgrade on the second PC (its old config is backed up).

### Release blocker — Forever characters keyed by first name only (found 6 November 2026)

A live two-PC test showed that on WoW Forever every key uses only the first word of a character's
name, so alts that share a first name (the owner's "Lebowski Holyroller", "Lebowski Highspirits"…)
collapse into one entry: ledger account, dungeon runs, duels, recipes, roster, relay, the bot's
`Character` row and every name-keyed table. Track K is switching Forever keys to the full
"First Last" name, with a no-loss migration (dry run first, ambiguous rows flagged for an officer,
legacy ledger history kept on an officer-assigned account) and backward compatibility for 8.4.x
addons. Details: `docs/FOREVER_NAMES.md`. The relink and second-character test waits for it.

### 9.0.0 release checklist (coordinator; review 6 November 2026, evening)

**Work still open (PRs into `release/8.5-candidate`):**
- Track F: #415 (support summary); then the setup wizard + Repair + slimmer companion (batch 3 #3/#4).
- Track J: no-addon credit by character (follow-up to #418); then party invites in call for help (batch 3 #7).
- Track B: separate duel/BG channels (batch 3 #10). Track C: item previews (batch 3 #2), then the bot feed for the promotion panel.
- Track D: gallery Request/Details + profession display (batch 3 #9/#11). Track A: always-share, keep only "Delete my data" (batch 3 #8).
- Track I: Armory links on character cards. New sessions: Season 2 plan (batch 3 #1), guild invite queue (batch 3 #13/#14).
- Kinfolk ideas (Track H) stay unscheduled until the owner picks some.

**Owner actions:**
- On the server, after a backup: `npm run names:forever` (preview, then `-- --apply`), and the pre-launch cleanup preview/apply (#419, `docs/PRELAUNCH_CLEANUP.md`).
- Decide whether `#course-au-60` in Québec Gold stays public.
- Merge or close on GitHub (agent merges into main were blocked): #388 site pointers to 8.4.7; close the superseded #394 and #396; review dependabot #407.
- Microsoft Store: 8.4.7.0 after 8.4.6.0 certifies, then 9.0.0.0.
- Google Play account (USD 25) when ready (`mobile/README.md`).
- Change the Discord password used for testing.

**Testing still owed:**
- Québec Gold nickname sync (hourly) and the bot's Manage Nicknames permission.
- The two-PC window with the 8.5 addon on both PCs: duel, Defender banner, chat-tab online lines.
- The relink + second-character test (after the 8.5 companion release).
- The live item-preview step 0.
- Uninstall on the second PC (last).

**Release steps:**
1. Merge the last PRs.
2. Full suite.
3. Bump to **9.0.0** once (README, CLAUDE.md, ROADMAP current stage, CHANGELOG, `.toc`, companion `package.json`).
4. Remove `FEATURE_PREVIEW_GUILD_IDS` from the server, and delete `src/services/feature-preview.ts` and its callers in the release PR.
5. Deploy, then GitHub release, CurseForge (`node scripts/curseforge-upload.mjs`), Store.
6. Website refresh and screenshots (final phase 1).
7. Phone app (Track M).

### Owner requests, 6 November 2026 (afternoon)

- **Delete the pre-launch season and all beta characters.** They still appear in Québec Gold's professions, the race to 60 and the unlinked characters. Track K is building a cleanup script: preview first, `--apply` after a backup, never touching EP/GP history or Season 1. See `docs/PRELAUNCH_CLEANUP.md`.
- **Crashin's Ragefire run didn't credit Xaldin or El Pirata.** Track J is investigating how party members get run credit (linking, two-word names, validation) and will fix it.

### Owner requests, 6 November 2026 (batch 3) — recommendations and owners

| # | Request | Recommendation | Owner |
| --- | --- | --- | --- |
| 1 | Verify dungeon scoring; adaptive first season, Season 2 on 9 December with better estimates | Season 1 keeps its frozen rules (current-v1) for fairness, but the bot records real run times per dungeon and bracket. Season 2 starts **9 December** (Forever's first raids) on targets computed from Season 1's real times (median and percentiles), published in advance. An analysis doc first: `docs/DUNGEON_SEASON_2_PLAN.md`. | new session (Sonnet) |
| 2 | Item links `[Item]` from in-game guild chat shown with stats in Discord; same in profession posts, not crowded | The item-preview feature is already built and off (`docs/ITEM_PREVIEWS.md`). Verify the webhook in the Blizzard-linked channel (step 0), then turn it on for Québec Gold. Profession posts get compact one-line items, with full stats on a button ("Details"). | Track C |
| 3 | Companion repairs and links itself; a simple link + install wizard that auto-updates | One **Guilded Setup**: installs the companion **and** the addon, finds WoW, signs in, links, then auto-updates both. A **Repair** button re-checks files, folder, sign-in and pairing and fixes what it can. Builds on Track L. | Track F |
| 4 | Remove extra things from the companion that the phone app will cover | The companion keeps only sync, status, linking, addon install and updates. Raid planning pages (Cores, Pricing, Reserves, Wishlist, Leaderboards) leave the companion and open the website instead, until the app covers them. | Track F |
| 5 | Start the Google app verification, free or very low cost | **Google Play:** a developer account costs a one-time USD 25 plus free identity verification. A new personal account must run a closed test with 12 testers for 14 days before going public (the guild can be the testers). No Google Cloud OAuth verification is needed, because Guilded uses no Google sign-in. Owner-only steps; the plan goes in `mobile/README.md`. | coordinator (doc) + owner |
| 6 | App: heat map of last-seen guild members | Already Track M item 3, on by default. | Track M |
| 7 | Call for help: see who is in the same zone and invite them to the party | The guild roster already gives every online member's **zone** (no addon needed). The caller's banner lists online guildmates in the zone, with **Invite** buttons (party invite on click; WoW only allows invites from a click). Defenders get **Join** (whisper "inv") and **Invite caller**. | Track J |
| 8 | Remove the privacy options: everything (stats, badges) is shared, always on | Done the simple way: no per-feature sharing switches; everything is shared within the guild and on public boards. One exception: keep a single **"Delete my data"** request, because the Microsoft Store privacy policy and Discord's developer terms require a way to remove personal data. Update `docs/PRIVACY.md` and the Store listing text. | Track A |
| 9 | Link profession chats so a member can request a craft from the gallery | In the gallery and the profession posts, each item gets **Request** (opens the existing craft request, prefilled) and **Details** (stats). The request thread pings the crafter once. | Track D |
| 10 | Separate duels from battlegrounds (channels, stat cards) | Separate `duel-ladder` and `bg-ladder` channels and cards. Existing Québec Gold channels are adopted, not duplicated. | Track B |
| 11 | Better profession names in Discord | Profession icon, name and skill bar per crafter, grouped by profession, with a short legend. Research first, then apply to the directory, the gallery and the posts. | Track D |
| 12 | Full names on the race to 60, and remove the beta characters | Full names done (deploy 3). Beta cleanup: Track K #419. | done / Track K |
| 13 | Québec Gold: remove `#wow-personnage`, use `#invitation-guilde` for in-game names; tell officers in game who needs an invite; ✅ reaction once invited | New **guild invite queue**: a member posts their full character name in `#invitation-guilde`, and the bot reads it and adds it to an officer list. In game, the officer addon shows **To invite** with an **Invite** button (guild invite on click). The bot adds ✅ on the message when the character shows up in the guild roster (or when an officer reacts ✅). `#wow-personnage` is removed by the owner's `/setup` action, after its messages are archived. | new session (Sonnet) |
| 14 | DM when a member takes the World of Warcraft role, asking for their full character name in `#invitation-guilde`; update that channel's description | Part of 13: one DM per member per role grant, with a link to the channel. The channel topic is updated (EN/FR) by `/setup`. | same as 13 |

### Release step — in-game testing by desktop control

After the track PRs are merged into the 8.5 candidate, one Sonnet tester session runs
[the 8.5 game test plan](docs/V8_5_0_GAME_TEST_PLAN.md) on the owner's PC: WoW Forever in windowed
mode, entering from the character screen as Lebowski Holyroller. To save cost it reads the chat
log, saved data and Discord page text, and takes about a dozen screenshots in total.

### Final phase 1 — new screenshots and website refresh (after all tracks are merged)

Owner request, 6 November 2026. Once 9.0.0 is feature-complete:
1. Take fresh screenshots in game (race board, PvP ladder, call for help banner, chat tab, minimap
   menu, roster card, Artisans' Gallery, companion Problems panel and settings) and in Discord.
   Sanitize names that are not Québec Gold members.
2. Update guilded.kcaron.top and kcaron.top: features page, guides (`docs/MEMBER_INSTALL.md`,
   `docs/QUICK_START.md`), companion page (Store self-update, direct download), FAQ and `/help`.
   English and French. Merges to `main` publish the site.

### Final phase 2 — the phone app as a "glance and group" companion (Track M)

Owner request, 6 November 2026: an app to check leaderboards at work and to help group while playing.
- **Existing (`mobile/`, Expo, preview APK 0.2.0 live):** public leaderboards; companion sign-in for
  characters, reserves, wishlist, raid standings and on-device reminders. PR #345 adds the server
  side for mobile alerts and sign-in renewal.
- **Build:**
  1. **Leaderboards first:** dungeon season, race to 60, PvP ladder, duels, achievements; fast,
     cached, readable in 5 seconds.
  2. **Guild view:** roster with class/level/professions, who is online now, last seen, mains and alts,
     the Artisans' Gallery search.
  3. **World map of guildmates:** last known position of guildmates who share their map position,
     shown as dots, with a **last-seen heatmap** of where the guild plays. **Owner decision
     (6 November 2026): approved, on by default.** Each member can turn sharing off, only
     signed-in members of the same guild see it, it is never public, and a member who turns it off
     has their stored positions deleted. (This is separate from the 26 October refusal of a
     guild-wide activity-time heatmap, which still stands.) Positions only reach the bot
     when a companion uploads (at reload or logout), so they are "last seen", not live, unless the
     companion chat-log watcher from Track J is built.
  4. **Call for help on the map:** active calls from Track J shown as pins with time and attackers;
     push notification to Defenders who opted in on the phone.
  5. **Dungeon and group notifications:** a group needs your role, a vacancy in a raid you signed up
     for, your dungeon run counted, someone in the guild beat your score. Each one off/on per member.
- Ship as the next APK after PR #345 is merged, then Google Play.

### Release step — bring the Québec Gold Discord up to date (owner request, 6 November 2026)

After 9.0.0 is merged and deployed, the coordinating session turns the new features on in the
Québec Gold server and checks each one live. Opt-in switches stay off for every other server.
1. Re-run `/setup` so the PvP category (`pvp-groups`, `pvp-results`, `pvp-ladder`) and the race-to-60
   channel exist; existing battleground channels are adopted, not duplicated.
2. Turn on and check: race-to-60 board, PvP ladder board, Who's who board, nickname sync
   (`kevmister28 (Lebowski Holyroller)` style; check Manage Nicknames and role order first),
   profession posts / Artisans' Gallery, statistics snapshots and the Sheets feed.
3. Run `/officer roster gaps` and hand the `/ginvite` list to an officer.
4. Check that `/achievements` and the web page show only Forever and guild achievements.
5. Update pinned guides and the bot-guide channel text where commands changed; record the results
   in `docs/V8_5_0_RELEASE_ACCEPTANCE.md`.

---

## Carried over (still open from 8.4)

- **8.4.7 distribution** — obsolete (9.0.x was released everywhere; see the 8 November completeness audit). Old notes, kept for history:
  - CurseForge: upload the `Guilded-v8.4.7-forever.zip` (project 1712677, display name
    "Guilded 8.4.7 (WoW Forever)") and `GuildedDungeons-v8.4.7-forever.zip` (1754138). Both are in
    `C:\Users\Kev\Desktop\guilded-release-8.4.7\`. Game version 1.60.1 only, release type Release.
  - Microsoft Store: after Submission 11 (8.4.6.0) certifies, submit
    `Guilded.Companion.8.4.7.x64.STORE-SUBMISSION.msix` (8.4.7.0); upload trick in the
    `release-8-4-6` memory note.
  - Site pointer PR #388 (releases.json → 8.4.7): its Cloudflare preview build failed; rerun, then merge.
  - Existing direct-download companions need one manual update to reach the self-updating 8.4.7.
- **Dungeons:** the unknown final bosses are done (#491). Old note: unknown Forever final bosses log `DUNGEON_FINAL_UNMATCHED`. Add their ids as they
  appear. For 8.5 the owner leans toward **dungeon Season 2 on current-v2 rules** (Season 1 stays
  current-v1; the level-60 Best 8 is implemented but inactive). DONE 16 Nov: Season 2 starts 9 December 2026 15:00 Pacific (#1019, #1021).

- **WoW-linked Discord item previews** in the Blizzard-linked guild chat channel: built off by
  default (`docs/ITEM_PREVIEWS.md`, `src/services/item-preview.ts`); webhook posting and non-echo
  into WoW still unproven live. Do not change the native Blizzard relay.
- **Crafter offers** (`docs/CRAFT_OFFERS.md`): built, off by default, awaiting real-server acceptance.
  Track D builds on it.
- **Real-client acceptance** still owed: member ledger sync, duels and announcements with several
  clients; the addon UI batch of 5 November needs an in-game re-check
  ([backlog](docs/archive/UI_FIX_BACKLOG_2026-11-05.md)); Forever live acceptance; dungeon G6-G8 and
  French client G10 ([6.2 game acceptance](docs/V6_2_GAME_ACCEPTANCE.md)).
- **Microsoft Store:** confirm which version has certified before claiming status.
- **Commands:** DONE 7 November: `/raid signup` and `/craft claim` removed (the raid post's role buttons and the craft post's
  **I'll craft it** button do the same work); `/community lottery join` was already gone (lottery tickets use the post's buttons).
  A craft request made while no craft board is set up has no post and so no claim button: set the board up first.
- **Public page per guild** ([design](docs/GUILD_PAGES_DESIGN.md)): DONE (#485, #522); officers choose what is public.
- **Android app** (`mobile/`): the Expo/EAS project is linked (`ddda073f-f6bb-4e04-8a78-7ac343e03864`,
  account kevincaron28) and preview APK 0.2.0 is published (GitHub pre-release `mobile-v0.2.0-preview`,
  linked on /companion/), with OTA updates on channel `preview`. (16 Nov: PR #345 was closed, branch kept.) Still open: merge PR #345 (server
  parts for mobile alerts and token renewal); add an `EXPO_TOKEN` repo secret so merges publish OTA
  updates; add `--environment preview` to the `update:preview` script; push notifications need a
  Firebase project (`google-services.json`); then Google Play (12 testers for 14 days). On this PC
  run EAS as `npx.cmd eas-cli …` (PowerShell blocks plain `npx`).

## Discord text audit (owner, 8 November 2026)

Keep what the bot and the docs say about Discord accurate, especially messages that name a channel.
Done in the 8 November audit: `tests/channel-names-in-text.test.ts` fails when member-facing text (bot strings, website
pages, the member install guide) names a retired channel (#bot-faq, #wow-personnage, the PvP groups channel) or a channel
`/setup` does not create; stale mentions in the docs and site were fixed. The read-only look at the live servers' topics, pins and
posted guides is in [DISCORD_TEXT_AUDIT_2026-11-08.md](docs/DISCORD_TEXT_AUDIT_2026-11-08.md); the owner or coordinator applies its edits
in Québec Gold (the bot never edits there by hand). Repeat after every channel is added, merged or retired (add the new name to
`src/setup-names.ts` and the test follows).

## Later

- Raid leader tools live in the separate **Pullscript** addon (CurseForge 1729283).
- More standalone first-run improvements: [STANDALONE_ADDON_ROADMAP.md](docs/STANDALONE_ADDON_ROADMAP.md).
- Turning other WoW editions or PoE2 back on: [FOREVER_ONLY_FOCUS.md](docs/FOREVER_ONLY_FOCUS.md).
