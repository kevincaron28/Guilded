> **Start here:** the work queue is [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md). Work only from its "Ready for Claude" section, top first; ROADMAP.md stays the release and status record.

> 9.4.6 (21 November 2026): world PvP kills count from the honorable-kills statistic and get a victim name (#1216, #1220), the website PvP map shows kills and deaths (#1216), guild data repaired after the 1.60.1 blank-realm hotfix (#1219), the companion reads saved files up to 4 million values and shows an unreadable one (#1215, #1218), officer windows stay apart after a drag (#1214), Québec voice in the addon (#1211); bot: standings dungeon board kept per guild (#1217), database moved to the free Guilded-DB VM. Store: 9.4.6.0 (companion changed).
> 9.4.5 (20 November 2026): one help flow for layer swap and call for help (#1194: On my way joins the caller's layer, one Guild calls window, Help guildmates, quick layer key binding), officer windows side by side (#1196, #1201, checked in game), duel stats (#1200: time, damage, healing, health, head-to-head, rank, upset), WoW Forever 1.60.1 realm hotfix (#1202: guild data kept when realms go blank). Bot already live: duel card redesign (#1197), promotion log dedupe (#1195), podium (#1199), lighter uploads (#1203). Store: 9.4.5.0.
> 9.4.4 (20 November 2026): first-time setup window `/guilded setup` (#1175), alts and main/alt swaps in the promotion window (#1177), Crafting tab polish (#1176, #1187, #1188), exact character ids from the game (stages A-C, #1183, #1186, #1189; always on, no switch), carried runs keep levels (#1171), French vous + Quebec vocabulary (#1172, #1180). Bot already live: Armory roster (#1178), promotion cards in the community chat (#1174, #1182), English dungeon names (#1185), fontconfig (#1179). Store: 9.4.4.0.
> 9.4.3 (20 November 2026): addon knows the final bosses of Krol'dok Stronghold and Alcaz Prison (#1163), 38 chat lines translated FR/DE/ES (#1164); companion rolls back a self-update that fails to start (#1160). Bot already live: promotion cards per rank (#1161), error triage (#1162), faster upload answers (#1159). Store: 9.4.3.0 after the pending certification.
> 9.4.2 (19 November 2026): the data-loss audit fixes (docs/plans/DATA_LOSS_AUDIT_2026-11-19.md). Addon: achievements no longer evict other milestones, stored run copies heal from relays, peer digest fields always fit, 800-recipe relay (#1148), crafting-order lists keep good lines (#1151). Companion: big uploads split into parts under the bot's limits, every milestone, duel and recipe sent, runs pruned only after a full send (#1147). Bot already live: later reports enrich stored runs, no null or stale overwrites, 5000 milestones/duels, wider device upload (#1149, migration 20270306120000). Store: 9.4.2.0 to submit after 9.4.1.0 certifies.
> 9.4.1 (19 November 2026): fixes from the owner's day of testing. Addon: Ready to promote opens in front without overlaps, one reviewed click per member with a rank-number self-check per client build (#1134); `/guilded verify` retired, links are confirmed by sync (#1137); run summaries keep each player's guild, faction, levels and presence (#1141, #1142). Bot already live: faction-aware invite tags and guild factions on the site (#1135), do-not-invite wording and Undo (#1136), DM links prefer the full-name row (#1138), run reports no longer erase each other's guild (#1139, 45 rows backfilled), doubled first names are one character (#1140), new podium and weekly MVP cards (#1143). Store: 9.4.1.0 to submit.
> 9.4.0 (19 November 2026): the owner's 9.4 list (docs/plans/V9_4_PLAN.md). Addon: Layer gets its own sidebar button with the layer switches (#1114), `/guilded layer auto|helper|direct` toggles instead of sending a request (#1126), Promote next key binding and Initiates under an Alt rank offered again (#1119), crafting window with Request / My requests / Craft for the guild (#1125), officer-only do-not-invite tag (#1120), LedgerSync never sends half a day (#1126). Companion: jittered retries with an 18 s upload timeout, known-run deltas, staged rollout and visible update failures (#1122), empty realms exported as "-" (#1116). Bot already live: promotion rule (linked + 7 days + 3 h voice) with /promotion status and the Where am I? announcement (#1121), do-not-invite v2 (#1120), recap cards and shorter messages (#1124), recipes by category (#1118), world PvP everywhere, My Guilded characters with Make main/Unlink and the armory card (#1117, #1123), sync health (#1116), and the command restructure: /leaderboard, /character link, officer tools out of member commands, 26 top-level commands (#1127, #1128). Store: 9.4.0.0 to submit.
> 9.3.11 (18 November 2026): the addon records raid boss kills for the raid progress board (RaidProgress.lua, `/guilded raidprogress`) and the companion uploads them, ready for the 9 December raid launch (#1108). Bot already live: raid progress board and raids.json, opt-in weekly records post, Battle.net Forever profile watch (#1108), sitemaps, page titles, armory links, per-dungeon records, class/role filters, a scoring page and the climbers fix (#1107), the invite /who tip (#1106). Store: 9.3.11.0 to submit.
> 9.3.10 (18 November 2026): party invites go straight to the game (C_PartyInfo.InviteUnit, as AutoLayer and ForeverLayers do; a refusal is remembered per client build and falls back to the copy box), an opt-in layer auto-invite on your continent, Guild invites in the minimap menu, and the Send to Discord button follows window drags (#1097). Bot already live: cards keep their painting's lighting (#1093), Season 1 has every Season 2 dungeon route (#1094), DM a character name to link it (#1095), instant per-member nickname and rank-role sync (#1096). Store: 9.3.10.0 package built; 9.3.8.0 certifying (Submission 14).
> 9.3.9 (17 November 2026): addon-only players: carried runs hand over right after a dungeon, carry a compact presence proof so they rank under Season 2's current-v2 (and rank now in Season 1, Scarlet wings named from boss ids), refusals reach the player with a reason (#1083, #1085, #1089); fewer login lines (#1065); smaller uploads and saved data (#1081); companion: one Windows startup entry (#1068) and a packaged self-test in CI (#1075); craft requests never share a ref (#1088). Bot already live: sync speed-ups, standings 304s and gzip, shorter deploys, officer companion-stopped signal, the one-time 9.3.7 DM, SEO3/SEO4, Horde achievement art. Store: 9.3.9.0 package built; 9.3.8.0 is certifying (Submission 14).
> 9.3.8 (17 November 2026): addon fixes: the Guilded setup window opens on top and can be dragged, a quiet-login switch (Settings or `/guilded quiet on`) hides Guilded's login chat lines (#1053), and milestone and achievement lines wait in a Share bar and go to guild chat on one click, because WoW Forever refused the automatic line (ADDON_ACTION_BLOCKED UNKNOWN(), #1061); bot already live: card redesign (Pirata One titles, achievement badge as hero, brighter dungeon cards without the death map, #1054-#1059), invite request sweep and typo replacement (#1060), audit polish (#1062). Store: 9.3.8.0 package built; the Store serves 9.3.4.0.
> 9.3.7 (16 November 2026): fixes from the two-PC test: the companion log covers the whole run, truthful restart and addon-update lines, a guild joined mid-session saved at once (#1043); card polish already live on the bot (#1042); French guides (#1039), website analytics (#1040). Store: 9.3.7.0 package built after 9.3.4 certifies.
> 9.3.6 (16 November 2026): security fixes and Worker hardening (#1015, #1031), French dungeon names and addon id matching (#1016), Discord text fixes (#1017), hide my profile from the public directory (#1018), race to 60 for current members only (#1020), Season 2 starting 9 December with every known 45-60 dungeon as a provisional route and duels, battlegrounds, world PvP, Clash and raid attendance following the season calendar (#1019, #1021), secret achievements with the first one, killed by the Son of Arugal (#1022), an officer member-trend graph and community points wording (#1023), a promotions rework where the bot rule decides and Alts are never promoted (#1024), a compatibility policy (#1025), linking that offers only matching servers with a one-click claim of reported characters (#1026), gold and auction house achievements (#1027, #1034), art and leaderboard polish (#1028), an edge-case sweep (#1029), confirmed links that need ownership (#1032), and client probes the companion uploads for the new /guilded-probes owner command (#1033). Nothing in 9.3.6 is confirmed on real clients yet.
> 9.3.5 (15 November 2026, published: GitHub, the website and the bot; CurseForge 9.3.5 approved 15 November 2026): player-facing polish after 9.3.4: a new painted logo spelled GUILDED (#988), the in-game dungeon result card shows each player's level, guild, score gained and season total from the bot's receipt (#986), brighter dungeon cards and Scarlet Monastery wing names, also in game (#990), an achievement-unlocked painting (#985), a short guild guide (#987), a community points rebalance with community points wording (#989, #990), sync health alerts for stuck syncs (#991), a "last saved" line and a quiet one-time /reload reminder in the addon (#992), a run digest compared before the login replay (#993), and the old dungeon points board embed retired (#995). Nothing in 9.3.5 is confirmed on real clients yet (docs/V9_3_5_RELEASE_ACCEPTANCE.md).
> 9.3.4 (15 November 2026, published: GitHub, the website and the bot; CurseForge 9.3.4 approved 15 November 2026): guild-only Discord (a guild's Discord shows only runs and duels with one of its players, #950); the website without account tool pages, with a small Discord sign-in and one basic My Guilded page (#953, #968); `/delete-my-data` Discord command and public page (#964); addon polish: Guild board tab removed, Layer invite in the minimap right-click menu, window fixes (#969, #970); addon-only records ask for a companion player at once and show a plain waiting line (#973, #976); companion: a warning for a damaged parked-uploads record (#958, #959, #960); `/poll board` removed and `/poll news` Discord-only (#970), so guild board votes and news made in game on 9.3.3 no longer reach Discord; website art (#961, #963, #965, #967); the phone app deletes data in the app (#962, #966; it keeps its own version). Nothing in 9.3.4 is confirmed on real clients yet (docs/V9_3_4_RELEASE_ACCEPTANCE.md). Store: 9.3.4.0 submitted 15 November 2026, in certification as Submission 13 ("Guild Sync Companion").
> 9.3.3 (15 November 2026, published: GitHub, the website and the bot; CurseForge 9.3.3 approved): fixes after 9.3.2 and the two-PC tests of 14 November: the duel result card shows the character you dueled (it could show another character with the same first name); the companion tells the addon it is alive, so a stopped companion no longer holds other players' records for days; carried records have clearer counts, receipts sooner, the opponent's real realm and a line in the companion's Activity list; a waiting duel or invite can no longer loop and invite replies are matched by whole name; a waiting addon update installs the moment WoW is closed; the companion's self-update is hardened (an unfinished update shows Try again); "Start with Windows" shows and changes the real startup entry; group runs have bounded re-offers and a "sent, not confirmed yet" state (#928, #930, #931, #938, #939, #941, #944). Bot and website already live: carried records of guildmates were dropped and are fixed, PvP position import fix, standings feed memory bounds, PvP map cap and small-zone markers, French wording, website pictures (#927, #929, #934, #940, #942). Nothing in 9.3.3 is confirmed on real clients yet (docs/V9_3_3_RELEASE_ACCEPTANCE.md). Store: 9.3.3.0 submitted 15 November 2026, in certification; the 9.3.2.0 submission was cancelled.
> 9.3.2 (14 November 2026, published: GitHub, the website and the bot; CurseForge files approved): duel records of addon-only players are carried to the guild by a nearby player's companion (on by default, `/guilded carry off`, an officer switch; #916, #918, #911); dungeon runs of groups with players from different guilds reach each guild (#880, #896); a result line after every duel and a duel ending right after login is no longer lost (#919, #921); kill and death positions for the PvP map sent by the companion (#902, #913); Drowned City final boss and run recovery (#895); season details tolerate the coming boss rule (#899); `/gdg` with both addons (#893); companion: every update check is logged and a downloaded update installs when idle (#904, #909). Bot and website already live: one community leaderboard with in-game points, the PvP map with the real in-game map and zone names, painted run and achievement cards, the standings feed fix. On 14 November 2026 two real PCs confirmed the update, no blocked-action warning at login, a duel on both sides with zone, result line and card, and carried duel records applied once by the bot; a carried record from an addon-only guildmate, the companion idle self-update, a real dungeon run and group relay across guilds are still owed (docs/V9_3_2_RELEASE_ACCEPTANCE.md). Store: 9.3.2.0 in certification.
> 9.3.1 (14 November 2026, published: GitHub and the website, CurseForge approved 14 November 2026): fixes after 9.3.0 and the real-client tour of 13 November: the save button no longer blocks the Guilded window in combat (#874); the duel rating in the game starts from 1000 and the season ladder runs from 13 November 2026, duels outside the guild are kept and old history is pruned by season (#882, #886); 21 fixes from the tour (#884): a character without a guild is not shown as an officer, `/gdg` and `/guilded dungeons` open the dungeons window, opaque cards and options panel, French text that overlapped, invite marks that survive a reload, the copy box below the To invite window, a line saying how old the list is, Store name "Guild Sync Companion"; the installer run by hand over a running companion finishes and restarts it, and the uninstall entry is safe (#877, #885); runs made for another guild wait for that guild's server (#856). Bot and website already live: card redesign (#865, #881), painted badges (#875, #879), duel rating with guild and global ladders and public pages (#876, #878), one witness is enough for a dungeon run and officers review held runs with `/officer dungeon flagged` (#872, #883). On 14 November, on a real client, the main 9.3.1 fixes were seen working (details in docs/V9_3_1_RELEASE_ACCEPTANCE.md); the save button in combat, a real duel, a real dungeon run, the French pages and the options panel background are not yet verified. Store: 9.3.1.0 package built, not submitted (Submission 13 certifying).
> 9.3.0 (13 November 2026): addon polish after 9.2.0 and dungeon-run fixes: the Availability module removed (the website "Who's free?" page retired), settings in tabs with a description for each, one online/offline line in the Guilded chat tab, no more driving of the game's tooltips plus a `/guilded chattab` how-to, dungeon paintings behind the in-game result card and the Run tab, a redesigned duel leaderboard and end-of-duel card, the Guilded map shortcut removed; a PC with only Guilded Dungeons uploads its runs through the companion and the sync line counts runs sent, stored, copied or refused (#843); fewer runs end as abandoned, a chat line says why an abandoned run will not count, a run can be completed from a guildmate's copy, runs are relayed for members without a companion, each player's guild is recorded on a run (#842); the companion has a painted banner and its installer closes a running companion by itself (#848, #853); professions under one name everywhere, with Poisons (#858, #864, bot #857); World PvP deaths with K/D and deadliest zones (#862, bot #863); the To invite window shows only who still needs an invite (#860, #869); UI polish: a left menu that no longer jumps, clamped windows, cards that remember their position (#866); the end-of-duel card has a painted background, a stat row and a card for duels outside the guild (#867); more Discord cards (season, welcome, rookie, World PvP recap) and a second batch of backgrounds; a painted website hero. Discord cards (a card per counted duel with `/bg duel-cards`, the weekly report card, card-only messages, ten backgrounds), stable guild addresses and fuller guild pages on the website, deploys that update only changed dependencies. On 13 November, on a real client, a test dungeon run reached the bot through the 9.3.0 companion with full Guilded and with Guilded Dungeons alone, and the end-of-duel card appeared after a real duel; the rest of the addon changes is not yet confirmed in a real client. Store: 9.3.0.0 package built, not submitted (Guild Sync Companion 9.2.0.0 certifying).
> 9.2.0 (12 November 2026): the simpler addon and companion: one addon window with five member tabs (Home, Guild, Dungeons, Crafting, Raids) plus Officer and Settings, a short `/guilded help`, the guild-message feature and blocked/dead parts removed, Layer invite replacing levelling partners, the Crafting page with craft requests made in game (bot #804), a small call-for-help toast, one global send budget ending the "messages are limited" spam, diagnostics that name blocked functions; the companion is one simple window with a tray menu and an Advanced view; Store display name "Guild Sync Companion". Bot items already live: character panel, invite-channel cleanup, game reminders, World PvP extras, painted dungeon card art. Published 13 November 2026 (UTC): GitHub v9.2.0 is the latest release (64d8bf3b), CurseForge files 9585868 and 9585869 are in review, the Store resubmitted 9.2.0.0 (Submission 13, in certification), the website feed is at 9.2.0. The bot is live on main with the upload fixes of 12-13 November (#811, #813, #814, #815, #817): see CHANGELOG.
> 9.1.6 (10 November 2026): guild sync and invite fixes from the owner problem log: sync messages fit the 255-byte limit (standings chunks were dropped), `/guilded invite raid` shows copyable `/invite` lines and no longer calls the invite API, guild MOTD reads guarded in combat, the "To invite" window shows the game answer per row with one row per requester and a Remove button (#731). Store: 9.1.6.0 package built, not submitted.
> 9.1.5 (10 November 2026): run trust and confirmed characters: unsigned companions also upload runs that guildmates' addons relayed (one companion carries addon-only members' runs), a run counts with a roster/linked party member or a second PC agreeing, `/guilded dungeon` shows why a received run is not counted yet (#725); during Season 1 runs only anonymous devices vouch for still count, marked as device runs, strict from Season 2 (#726); "confirmed" needs the member's own companion plus the guild roster or a heard verify code, nicknames follow confirmed mains only (#724). Bot side already live. Store: 9.1.5.0 package built, not submitted.
> 9.1.4 (10 November 2026): linking and dungeons: the wrong-server guard (signed uploads link only where the in-game guild is known, sign-in lists matching servers first, `/api/v1/companion/leave`, #719), stronger proof wins and unlink detaches (#720), per-character "Linked to Discord" line (#717), `/gdungeons` and `/gdg` with Guilded alone (#712), world map dots, no blocked guild reads, Invite copy box (#714), dungeons-only members reach the boards through a guildmate (#715); bot: Guilded Clash balance (#718). Store: 9.1.4.0 package built, not submitted.
> 9.1.3 (9 November 2026): plug-and-play fixes from the two-PC fresh-install test: addons update by themselves (#705), unsigned dungeon-run receipts end to end and the stale link line (#708), Repair shows sign-in as optional, the uninstaller keeps data and removes the startup entry, Store→website settings import (#707), Start page wording (#706). Store: 9.1.3.0 package built, not submitted (Submission 13 certifying).
> 9.1.2 (9 November 2026): one clear 3-step companion guide in the addon (`/guilded companion`, `/gdungeons companion`), website and /help (#699, #701), and professions stored under one English key so Cooking = Cuisine across French and English clients (#702, bot migration already live). Store: 9.1.2.0 package built, not submitted (Submission 13 certifying).
> 9.1.1 (9 November 2026): the zero-setup companion finds Québec Gold: the Discord server is matched by normalised in-game guild name, the realm only a hint (#695), unsigned companions upload dungeon runs (#694), empty dungeon boards explain why (#693), Rare card art in the mobile app (#692). Bot deployed separately. Store: 9.1.1.0 package built, not submitted (Submission 13 certifying).
> 9.1.0 (9 November 2026): the zero-setup companion (#684): install it and it syncs with no Discord sign-in (device key, server picked from the in-game guild, characters shown as reported until a sign-in confirms them); Discord sign-in is optional. Migration `companion_devices`; the website Worker allow-lists `/api/v1/device/*`. Store: 9.1.0.0 package built, not submitted (Submission 13 certifying).
> 9.0.9 (9 November 2026): every guild and party Invite button is a secure `/ginvite` or `/invite` macro button (#681), uploads survive two connections sending one file (P2034 retry, queued uploads), the companion warns about a wrong server and can Remove this server (#682), members download from the website instead of GitHub (#683); bot: smaller addon-import payloads and backups (#679). Store: 9.0.9.0 package built, waits for Submission 13.
> 9.0.8 (9 November 2026): the bot confirms every received dungeon run (DungeonRunReceipt, #669) so none wait forever, uploads skip known runs (ended the P2028 timeouts), the Store companion can start with Windows; the addon's chat tab and auto-invite stop calling protected functions (login popup, #668) and map dots use Guilded's own layer (#662); bot: confirmed vs reported characters, rank roles preview, roster freshness (#667). Store: 9.0.8.0 waits for Submission 13.
> 9.0.7 (9 November 2026): Guilded Dungeons no longer taints `SlashCmdList`, so `/ginvite` works again (#655, guard test), tooltips are no longer refreshed or decorated by Guilded in combat (duel Lua error and blocked actions, #657), and every WoW Forever achievement is tracked as a generated badge (#649, companion uploads it). Website installer served from the bot's server (#653, already live). Store: submit 9.0.7.0 (companion changed).
> 9.0.6 (8 November 2026): the companion updates itself and installs the addon from the website first (GitHub second, after GitHub downloads timed out on 8 Nov, #633), and `/guilded probe achievements` reads what achievement data WoW Forever exposes (#625). Bot (already live): Guilded Clash card game server (collection, AI + PvE, matches, guild trading, friendly and ranked PvP), board channel fixes, 17 s standings deadline. Store: submit 9.0.6.0 (companion changed).
> 9.0.5 (8 November 2026): no more "Guilded has been blocked" popup at login on WoW Forever (the game refuses addon guild-note edits even on a click; officer auto notes stopped, refused guild actions remembered per client build, #618), plus the bot updates live since 9.0.4: dungeon score on run cards (#611), one group finder for dungeons and PvP (#619), readable journal notices. Companion code unchanged since 9.0.4 (Store: 9.0.4.0 submission kept).
> 9.0.4 (8 November 2026): no more "blocked action" warning at login (RosterProfessions taint, #595), several WoW accounts per member in the companion (#592, #593), plus the bot updates live since 9.0.3: character pictures, record cards, Discord polish (French, card text fits), item previews always link, WoW role button fix, addon-import failure reasons and retries, deploy guards after the 7-8 Nov freeze (#598, #601) and an uptime email. Store: submit with every companion release (owner, 7 Nov).
> 9.0.3 (7 November 2026): WoW Forever only everywhere (addons, companion, packaging, website and bot; old rows kept, stage 7 declined), world PvP board, any online guild member tagged for invites with join auto-detect, correct roles on dungeon cards, plain-letter names on cards, lighter deploys. Owner decisions: character pictures and several accounts per member approved; paid tier stays off. Store: skipped unless the owner asks.
> 9.0.2 (7 November 2026): companion redesign with automatic setup, an installer that replaces a Store install, in-game crafting orders, dungeon stats screens, world PvP stats, traced dungeon maps, profession badges, the false call-for-help fix; bot: guild activity ladder, Top crafters, craft order channels, duel scoring by level, 24h rank arrows, read-only boards, rookie of the week, countdowns removed, low-priority deploys. Store: skipped unless the owner asks (next package 9.0.2.0).
> 9.0.1 (7 November 2026): fix release after 9.0.0 — addon fixes (guild snapshot error, companion download window, roster admin window, Info and data tab, officer notes, sync relay), bot fixes (one dungeon card per run, nickname sync, race to 60 cards, Delete my data, full names) and website updates. Store: ship the companion as 9.0.1.0.
> 9.0.0 (6 November 2026): the 8.5 work shipped as 9.0 — achievements, duel and battleground ladders, race to 60 board and Hall of Fame, nickname sync, guild roster/bank/event sync, call for help, PvP finder, levelling partners, in-game raid sign-up, recruiting kit, companion setup/repair and settings-save fixes. Store: ship the companion as 9.0.0.0.
> 8.4.7 (6 November 2026): Forever dungeon final bosses and recovery of abandoned runs (#384), silent auto-update for the direct-download companion with a fixed-name `Guilded.Companion.Setup.exe` release asset (#383) on top of 8.4.6's member ledger sync (#379), live duel board (#378), companion account-folder fix (#376), combat-safe windows (#377), compact Crafted by tooltip (#375) and Forever-only focus (#380, see docs/FOREVER_ONLY_FOCUS.md). The Store requires strictly increasing versions: ship the companion as 8.4.7.0 (revision 0).
> **"Continue work" (owner, 6 November 2026):** start at ROADMAP.md "Start here — 7 November 2026". You are the coordinator: dispatch one worker session per track on the cheapest fitting model, workers report back, you merge, back up, deploy and publish. Next versions: 9.0.1 (fixes) or 9.1.0 (features); only the coordinator bumps.
> Current checkpoint: 15 November 2026 (UTC). 9.3.5 published: GitHub v9.3.5 latest (tag at 57c07a23), the website download live; CurseForge 9642051/9642052 approved; bot deploy and Store 9.3.5.0 submission follow. Before that, 9.3.4 published: GitHub v9.3.4 latest (tag at 6bc7c755), the website download and the bot live; CurseForge 9632579/9632613 approved; Store 9.3.4.0 in certification. Before that, 9.3.3 published: GitHub v9.3.3 (tag at f849e748); CurseForge 9624204/9624207 approved. Before that, 9.3.2 published: GitHub v9.3.2 (tag at 9d8b5b1d), the website download and the bot live; CurseForge 9620000/9620020 approved (pointer #937 merged); the bot is live on 0ffb684b or later with #940 and #942; Store 9.3.2.0 resubmitted and in certification (Submission 13 was cancelled, Partner Center kept the number); Season 1 runs with the boss-skip rule since 14 November 2026 22:35 UTC. Check each provider live before claiming status. Next session: ROADMAP "Start here".
> Cards: `src/services/score-card.ts` renders every share card (WoW theme, roster layout); `end-cards.ts` builds the raid and battleground cards; queued Discord messages store a card definition and draw it on delivery.
> Docs: `docs/` holds living guides and design notes plus the 8.3+ release records; point-in-time handoffs, audits and older release notes live in `docs/archive/` (`docs/archive/releases/` for release notes and evidence before 8.3). Archived docs are history, not current status.
> Latest owner authorization: ALL AVAILABLE TESTING NOW. Native/game testing is assigned to Claude; avoid concurrent desktop control.
> Release evidence: `docs/V9_2_0_RELEASE_ACCEPTANCE.md` (latest, 9.2.0), `docs/V8_4_7_RELEASE_ACCEPTANCE.md`, earlier 8.4.x and `docs/V8_3_0_RELEASE_ACCEPTANCE.md` beside it. Preserve published artifact bytes; never overwrite a published download.
> Keep the stored edition calendars unchanged ([EDITION_CALENDARS_2026-10-30.md](docs/archive/EDITION_CALENDARS_2026-10-30.md)); since the Forever-only removal nothing creates or edits other editions' calendars.
> No automatic messages/awards without configured opt-in. Exception (owner decision, 5 November 2026): the addon's guild-chat milestone announcements (levels, first dungeon clears, PvP and duel milestones) are ON by default for members, after a one-time local notice; members turn them off with `/guilded announce off`, and an officer's guild-wide off switch wins. Discord echoes of them stay opt-in per server. Second exception (owner decision, 6 November 2026): a member gets one Discord DM confirming which characters were linked after their first companion link (skipped quietly when DMs are closed). Third decision (owner, 6 November 2026): every new 8.5 feature is ON by default in every server, with officer and member off switches; see ROADMAP.md rule 5. Fourth exception (owner decision, 17 November 2026, "One DM each"): members whose website companion stopped on 9.3.7 (it left run-log.cjs out of its package and cannot update itself) get ONE Discord DM to run the 9.3.8 installer, never repeated, skipped quietly when DMs are closed, until 24 November (`src/services/companion-937-notice.ts`; `COMPANION_937_NOTICE` must be `on` to send, the default is a dry run that only logs, `=off` disables; members are found by the sync-health stalled-companion rule).

# Working on Guilded

Discord bot (`src/`) + WoW addon (`addon/Guilded/`) + companion uploader
(`companion/`, `companion-app/`), one product shipped together (they share a
version number). TypeScript/Node/Prisma/Postgres on the bot side, Lua on the
addon side. Full context: `docs/GETTING_STARTED.md` (setup), `docs/DEPLOY_ORACLE.md`
(how the live bot gets updated), `docs/CHARACTER_PAIRING_HANDOFF.md` (one
feature's design notes, as an example of this file's format for a specific
feature).

**Current status (21 November 2026): version 9.4.6, protocol 2.**
9.4.6 is prepared (21 November 2026). 9.4.5 is published (GitHub release v9.4.5 is the latest, tag at 68540df5, the website download and the bot, 20 November 2026; CurseForge 9723332/9723333 in review; Store Submission 21 certifying). 9.4.4 is published (GitHub release v9.4.4 is the latest, tag at eee18935, the website download and the bot, 20 November 2026). 9.4.3 is published (GitHub release v9.4.3 is the latest, tag at be056849, the website download and the bot, 20 November 2026; CurseForge files 9709936/9709937 in review). Before it, 9.4.2 was published (GitHub release v9.4.2, tag at ce11a4c7, the website download and the bot, 19 November 2026; CurseForge files 9707852/9707853 in review). Before it, 9.4.1 was published (GitHub release v9.4.1, tag at b0547c36, the website download and the bot, 19 November 2026); CurseForge files 9707178/9707179 in review. 9.4.0 was published earlier the same day (CurseForge 9702092/9702094). The Store serves 9.4.0.0 (Submission 17 live); 9.4.1.0 is in certification (Submission 18).
9.3.11 is published (GitHub release v9.3.11 is the latest, tag at cb0ac57a, the website download and the bot, 18 November 2026); CurseForge 9.3.11 approved (files 9691780/9691782, the website points at them). The Store serves 9.3.11.0 (Submission 16 live).
9.3.10 is published (GitHub release v9.3.10 is the latest, tag at c7905226, the website download and the bot, 18 November 2026); CurseForge 9.3.10 approved (files 9677628/9677629, the website points at them); the Store serves 9.3.10.0 (Submission 15 passed).
9.3.9 is published (GitHub release v9.3.9 is the latest, tag at 9aa469fd, the website download and the bot, 17 November 2026); CurseForge in review. The Store serves 9.3.4.0, 9.3.8.0 is certifying (Submission 14) and the 9.3.9.0 package is built.
9.3.8 is published (GitHub release v9.3.8 is the latest, tag at 095452ef, the website download and the bot, 17 November 2026); CurseForge files 9665832 and 9665833 in review. It fixes the 9.3.7 companion that could not start (run-log.cjs missing from the package, #1064). The Store serves 9.3.4.0.
9.3.7 is published (GitHub release v9.3.7 is the latest, tag at 690040bd, the website download and the R2 mirror, 16 November 2026): companion and addon fixes from the two-PC test; the bot already runs the card polish. CurseForge 9.3.7 approved (Guilded file 9654361, Guilded Dungeons file 9654362; the website points at them); the Store 9.3.7.0 package is built and is submitted after 9.3.4.0 (Submission 13) certifies.
9.3.6 is published (GitHub release v9.3.6 is the latest, tag at e2997f82, the website download and the bot, 16 November 2026); CurseForge approved 16 November 2026 (Guilded file 9649625, Guilded Dungeons file 9649626; the website points at them); the Store package waits for the 9.3.4 certification. 
9.3.5 is published (GitHub release v9.3.5 is the latest, tag at 57c07a23, the website download and the bot, 15 November 2026); CurseForge 9.3.5 is approved (Guilded file 9642051, Guilded Dungeons file 9642052) and the Store 9.3.5.0 package is to be submitted. 9.3.4 is published (GitHub release v9.3.4 is the latest, tag at 6bc7c755, the website download and the bot, 15 November 2026); CurseForge 9.3.4 was approved on 15 November 2026 (Guilded file 9632579, Guilded Dungeons file 9632613) and the Store 9.3.4.0 package was submitted the same day, in certification as Submission 13 ("Guild Sync Companion"). 9.3.3 is published (GitHub release v9.3.3 is the latest, tag at f849e748, the website download and the bot, 15 November 2026); CurseForge 9.3.3 is approved (Guilded file 9624204, Guilded Dungeons file 9624207). 9.3.2 was published 14 November 2026 and its CurseForge files were approved (Guilded file 9620000, Guilded Dungeons file 9620020; the website pointer #937 is merged). The bot is live on 0ffb684b or later with #940 and #942. The Store has the 9.3.3.0 ("Guild Sync Companion") package submitted on 15 November 2026 and in certification; the 9.3.2.0 submission was cancelled and Partner Center kept the number 13. Dungeon Season 1 runs with the boss-skip rule since 14 November 2026 22:35 UTC. Check each provider live before claiming status. WoW Forever launched 4 November 2026; its
first raids open 9 December.
Production uses a self-hosted PostgreSQL 18 on a second Always Free Oracle VM ("Guilded-DB", private IP in the bot's VCN, moved from Aiven on 20 November 2026; nightly dumps on the bot server); Aiven and Neon settings are kept only as fallbacks.
Guilded supports WoW Forever only: the other WoW editions were removed on 7 November 2026
(`docs/plans/FOREVER_ONLY_REMOVAL.md`); stored rows of other editions stay readable and new uploads from them are
refused (`assertForeverEdition` in `companion/game-edition.mjs`). Message earning covers accessible guild
channels/threads; officers inspect coverage with `/participation channels`
(`docs/PARTICIPATION_CHANNEL_COVERAGE_2026-10-28.md`). Loot-history import: `docs/LOOT_HISTORY_IMPORT.md`.
Battle.net developer-app setup: `docs/BATTLENET_SETUP.md`. Still-owed real-client checks are
listed under "Carried over" in `ROADMAP.md`. Use `npm run setup:check` to check a new owner's
configuration without starting the bot. Live deployment, final-commit CI and stable publication
remain separate gates. Do not bump the version incidentally.

Raid tools were removed from Guilded v6 and archived in
`docs/archive/raid-tools/README.md` for a future standalone addon. Preserve
SavedVariables. Standalone first-run work is tracked in
`docs/STANDALONE_ADDON_ROADMAP.md`.

This file is for whichever agent picks this repo up next — including a cloud
session with no access to this machine's local state. If you're running
somewhere that can't reach Neon or Discord and has no `.env.local`, that's
normal; see below.

## Before you consider anything done

Run these, always — `tsc` passing is not enough on its own:

```
npx tsc --noEmit -p .
npx vitest run
npx eslint .
node addon/Guilded/validate-addon.mjs
```

Without `.env.local` (cloud sandboxes), 9 bot test files fail to load on
`src/config.ts`'s environment check, not on a code error. Run the suite with
throwaway placeholders set in the shell only (never commit them):
`DISCORD_TOKEN=placeholder DISCORD_CLIENT_ID=123 DISCORD_GUILD_ID=456 DATABASE_URL=postgresql://u:p@localhost:5432/x npx vitest run`.

`tsc` is TypeScript 7 (installed as `@typescript/native`), but the `typescript` package is
the 6.0 API (`@typescript/typescript6`, CLI `tsc6`): 7.0 ships no compiler API, and
typescript-eslint and `tests/command-handler-coverage.test.ts` need one. Keep both
aliases until typescript-eslint accepts TypeScript 7.

Two failure modes only the test suite catches, not the type checker:

- **`/setup` and `/config` are merged into one Discord command**
  (`src/commands/index.ts`'s `MergedCommand`) that sits close to Discord's
  4000-character total-text limit across every subcommand/option/choice name
  and description combined. Adding text anywhere in `src/commands/setup.ts`
  or `src/commands/settings.ts` can push it over with no type error — only
  `tests/commands-shape.test.ts` ("keeps every command under Discord's size
  limit") catches it. If it fails, trim wording; don't just raise the limit.
- **French translations are enforced for specific files only.** Any new
  `tx(lang, "...")` / `T("...")` call in `src/commands/setup.ts`,
  `src/services/setup-status.ts`, `src/commands/craft-board.ts`,
  `src/commands/dungeon-group.ts`, `src/commands/poll.ts`,
  `src/services/raid-core.ts`, `src/commands/wcl.ts`,
  `src/services/dungeon-guide.ts`, `src/commands/group-alerts.ts` or
  `src/commands/faq.ts` needs a matching entry in `src/i18n-fr.ts`, or
  `tests/i18n-fr.test.ts` fails (the list is `SOURCES` in
  `scripts/i18n-keys.mjs`). In the addon, French lives in `Locale.lua`
  (accents as `\195\169`-style escapes: the validator rejects non-ASCII). Other files
  aren't checked (e.g. `src/commands/help.ts` keeps its own separate
  `en`/`fr` arrays, not `tx()`).
- **A version bump updates the "current" lines too.** `tests/current-version-docs.test.ts`
  fails until `README.md` ("Current version"), this file (status line and top history line),
  `ROADMAP.md` ("Current stage"), `CHANGELOG.md`, both addon `.toc` files and
  `companion-app/package.json` match `package.json`. Guides link "latest release" instead.

Older addons and companions must keep working: wire changes are additive only (optional fields, defaults, new message kinds), the support window is N-2 minor releases, and `tests/compat-guard.test.ts` fails if a `COMPANION_FEATURES` entry or a known wire field is removed or made required. Protocol constants and `MIN_COMPANION` live in `src/compat.ts`; the rules and how to add a fixture are in `docs/COMPAT_POLICY.md`.

Two sync sharp edges (see `docs/SYNC_SPEEDUPS_2026-10-15.md`):

- **The Lua test harness (fengari) has 32-bit integers; WoW's Lua uses doubles.** Arithmetic
  that passes 2^31 (hashes, sums of hashes) gives different answers in tests than in game.
  Keep such values small (LedgerSync.lua uses a 24-bit modulus).
- **The website's Cloudflare Worker (`worker/index.mjs`) forwards only the request headers it
  lists and gives up after 20 seconds.** A new header the bot needs must be added there (and
  the bot should cope without it until the Worker is redeployed); long polls stay at 12 s.
  Headers named `x-guilded-*` or `x-companion-*` pass through without a Worker change, except `x-guilded-origin`, which only the Worker may set.

Prisma 7 (see `docs/PRISMA_7_UPGRADE.md`):

- **The client is generated TypeScript in `src/generated/prisma/` (gitignored).** `npm install`
  and `npm run db:update` regenerate it; if it is missing, run `npx prisma generate`. Import
  from `src/generated/prisma/client.js`, never from `@prisma/client`.
- **Create clients only with `createPrismaClient()` from `src/database.ts`.** Prisma 7 needs the
  node-postgres adapter, and `poolSettings()` translates `DATABASE_URL`'s Prisma 6 parameters
  (pool size, timeouts, the Aiven CA in `sslcert`) that node-postgres would misread. The CLI
  reads the URL from `prisma.config.ts`.

Character links (linking audit T3, 10 November 2026; `src/services/character-move.ts`):

- **Unlink detaches, it does not delete.** An unlinked character keeps its row and history under the
  server's hidden holding member (`detached-<guildId>`, LEFT, isTest) with `detachedAt` set.
  `createPrismaClient()` hides those rows from every `character` list, search and count; a query that
  must see them names `detachedAt` in its `where` (`DETACHED`, `WITH_DETACHED`). Lookups by id and
  nested reads through other tables are not filtered. Test fakes do not have this filter.
- **Never change `Character.memberId` by hand.** Use `moveCharacter(tx, id, toMemberId, reason)`: it
  keeps the id, hands over the main flag, records the proof (`linkEvidence`: named < companion <
  heard < officer) and updates both members' verify claims. New characters go through
  `guildService.addCharacter` or `createSelfCharacter`, which bring a detached row back.

## No database or Discord access from here

Cloud sandboxes may not reach the production database or Discord and may have no
`.env.local` (gitignored; contains credentials). Check actual local access
without printing secrets; retained Neon settings do not identify production.
Consequences:

- **Migrations are hand-written, not generated.** Don't run
  `prisma migrate dev` (needs a reachable database). Instead, add a field to
  `prisma/schema.prisma`, then hand-write
  `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql` with plain
  `ALTER TABLE` statements, using the next chronological timestamp after the
  most recent migration folder. Run `npx prisma generate` afterward so the
  TypeScript client matches (this works offline).
- **Never invent or commit a secret** to make something "work" locally —
  hardcoded tokens, a committed `.env`, a fallback credential in code. If a
  task seems to need real credentials, it needs a human with access, not a
  workaround.
- **Privileged intents break the login.** The bot asks for Message Content
  only when `MESSAGE_CONTENT_INTENT=true` (answer channel, 5.0). Never make
  a new privileged intent unconditional: if the Developer Portal switch is
  off, Discord refuses the login and the live bot stays down.
- **Never suggest running the bot itself** (`npm run dev`, `start-bot.bat`)
  from an agent session. If a real bot is already live on Oracle, a second
  instance with the same token answers every Discord command twice. Verify
  behavior through the test suite and, where relevant, the Lua test harness
  (`tests/lua/`, fengari — fully offline, no external dependencies), not by
  starting a live bot.

## Deployment and the local Claude handoff

The owner requested a one-prompt update using Claude in their local VS Code checkout.
Follow `docs/V5_0_RELEASE_HANDOFF.md` in order. Cloud sessions lack the existing Oracle SSH key;
do not request or invent it. A local agent on the owner's PC may use the already configured
key and deployment script after tests, CI, ledger preflight and backup succeed. The owner
has authorized the mechanical update work. Preserve local changes and SavedVariables.
Never start a second bot. The 25 October release decision waived unavailable
prelaunch game checks for 7.3.2; retain them as pending post-release acceptance.

Use `npm run release:prepare` for a complete build/check. The new migration refuses duplicate
ledger source refs; `npm run release:ledger-check` diagnoses them without changing data.
The shared upload token is retired: companions authenticate with personal pairing credentials.
Never reintroduce a global-token write bypass to make an old companion appear compatible.

## `package.json`'s version has a live side effect

`src/services/version-announce.ts` posts a one-time "Guilded was updated to
vX.Y.Z" notice to every guild's bot-guide channel the first time the running
version differs from what that guild was last told (checked once per bot
startup, in `src/main.ts`'s `ClientReady` handler). Don't bump the version
number incidentally (e.g. as a side effect of a dependency update) — treat it
as a real, user-facing announcement trigger, not a housekeeping field.

## Bug reports ("fix the bugs")

Members of every guild report with `/report bug` (optional screenshot) and get a short reference
such as `K3X9QZ2A`; the bot's own failures are saved the same way. They reach the developer
live in `ERROR_LOG_CHANNEL_ID` and are collected by `npm run bugs` (on the owner's PC, which
has `.env.local`): it writes `bug-inbox.md` (gitignored, holds Discord IDs: never commit or
paste it publicly) with open reports and errors grouped by cause. Work from that file, fix
through a pull request, then `npm run bugs -- resolve REF [REF...] --note "what changed"`.

## Where things live (for a fresh session)

- **WoW Forever only** — the other WoW editions are removed (`docs/plans/FOREVER_ONLY_REMOVAL.md`). `companion/active-games.mjs` (PoE2 community and tracking) still decides what members see of PoE2; hidden is never deleted (`docs/FOREVER_ONLY_FOCUS.md`).
- `src/commands/` — one file per Discord slash command; `src/commands/index.ts`
  registers them and merges a few into parents (see `MergedCommand` above).
- `src/services/` — business logic, called by commands and by scheduled jobs
  in `src/main.ts`.
- `src/setup-names.ts` — the single source of truth for every channel
  `/setup` can create (name/topic in English and French, permissions,
  category). Adding a new bot-managed channel starts here.
- `companion/` — the Node/CLI half of the uploader (also embedded in
  `companion-app/`, the Electron desktop app); `companion/engine.mjs` is the
  shared logic both use.
- `mobile/` — the Expo app for iPhone and Android (`mobile/README.md`). Public
  leaderboards, plus the companion sign-in for characters, reserves, wishlist,
  raids and on-device reminders. Store identifiers stay in `mobile/app.json`.
  It does not bump the shared product version.
- The companion is **Windows only** (Microsoft Store first, unsigned GitHub download as fallback; guidance everywhere is Store-first). The browser/online companion was removed: `/companion/` is a static download page on the site (`site/pages/companion*.md`), the Worker and bot redirect old `/companion/<asset>` paths to it, and `companion-app/renderer/ui-bundle.js` is built by `npm run companion:build` for the Electron UI only.
- `addon/Guilded/Util.lua` — loaded first: shared helpers (`ns.util`) and the paced
  addon-message queue (`ns.comm`). Every module sends through `ns.comm.send`; the validator
  fails a module that calls `SendAddonMessage` directly.
- `addon/Guilded/` — the WoW Lua addon; `tests/lua/` runs the real `.lua`
  files against a mocked game client (fengari), not a JS reimplementation.

## Website deployments

Main merges trigger Cloudflare site builds/deploys, but no installer or bot release. Never deploy
unrelated unaccepted backend changes to ship styling. History of the October redesign rollout:
`docs/archive/WEBSITE_AND_COMPANION_HANDOFF_2026_10_19.md`.
