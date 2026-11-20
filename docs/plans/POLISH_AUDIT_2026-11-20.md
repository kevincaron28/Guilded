# Polish audit, 20 November 2026

Read-only audit of `origin/main` 8c0e2e32 (package 9.4.2) and the live site https://guildedwow.com (72 sitemap URLs, 237 internal links, 43 external links crawled with curl; mobile width checked in the browser pane on 5 pages). No code was changed. "Safe" means a worker can fix it without an owner decision.

Checked and found clean: no `/guilded verify`, `/character claim|pair|import`, `/wow list|use`, `/import`, `/poll` left in member-facing bot text, the website or the phone app (only code comments and the intentional "moved" notes); all 72 sitemap pages answer 200 with EN and FR in step (36 each); no horizontal overflow at 375 px on home, download, leaderboards, link guide and a bot-backed page; addon FR has 0 missing strings out of 1086 used (DE and ES 1 each); companion FR is covered by `tests/companion-i18n.test.ts`; no TODO or FIXME in shipped Lua, mjs or TS paths (only the `MAX_TODO` constant in `InviteQueue.lua`); every nav and footer link is 200; the 9.4.2 release assets resolve.

## Status after the fix pass (branch claude/polish-audit-fixes)

Owner decisions (not changed): French tu/vous across `src/i18n.ts` (finding 6); the "moved for one release" stubs in `src/commands/index.ts` and `DEFAULT_SITE_ORIGIN` (finding 10); the 502/503 crawl issue (finding 2, production).

Fixed: 1 link guide (FR figures removed; the EN page had none), 3 core-planning.ts (server language, "vous", added to i18n-keys SOURCES), 4 about 38 addon chat lines (Dungeon start/end/detected/recovered, "not in a run", leader-only; Core raid and error lines; Minimap window prompts) with FR, DE and ES, 5 COMMANDS.md and FR typography ("Store ;", "reste ;"; the DE and ES "Type %s to invite them." already existed), 6 GuildedGames FR accents, 7 stale docs.

Not done: about 130 other English-only addon lines (Core usage/help text, Council 16, Bidding 12, Sim 11, Calendar 9, AutoInvite 9, Consumables 7, remaining Minimap); `Guilded.toc` Notes-frFR accents, because `validate-addon.mjs` rejects non-ASCII in .toc files (loosen the validator first, an owner call); the `Dungeon.lua` diagnostics line (:2113) and the command help line (:2155).

## Findings by member impact

### 1. Link-your-character guide shows five missing screenshots (EN and FR)
- `site/pages/guide-link.md` and `site/pages/guide-link.fr.md` (the `<figure class="guide-shot">` blocks, e.g. `guide-link.fr.md:12`) point at `/assets/guides/link-browser-connect.png`, `link-companion-link-everything.png`, `link-companion-linked.png`, `link-discord-confirmation.png`, `link-ingame-reload.png`. All five return 404; `site/assets/guides/` holds only `install-curseforge-page.png` and `install-store-listing.png`. Members see the "Capture a venir" / "Screenshot coming" caption under empty frames on the page the bot and addon send people to.
- Fix: capture the five shots per `docs/SCREENSHOT_SHOTLIST.md` and add them to `site/assets/guides/`. Until then remove the five `<figure>` blocks from both pages.
- Safe: removing the figures yes; capturing needs a real client (owner).

### 2. Bot-backed website pages intermittently answer 502 or 503
- During the crawl about 70 of the 237 internal URLs (`/forever/leaderboards/dungeons/`, `/forever/leaderboards/guild/*`, `/forever/players/*`, `/forever/leaderboards/run/*`) returned 502, and `/fr/forever/players/` rendered the "De retour dans un instant" 503 page. All recovered on retry (200). It follows the deploy and database-outage work of 19 November (#1162), but ordinary members hit it as "the leaderboards are broken".
- Fix: check the Worker's retry and cache for these routes (`worker/index.mjs`: serve a stale copy on 502/503, one retry on the origin) and whether the origin was restarting. Needs production logs.
- Safe: no (production access); the Worker change itself is safe once reproduced.

### 3. Raid-core weekly schedule planner is French or half-French for every server
- `src/commands/core-planning.ts:80,82,105,108,109,112,76,69,89`: hard-coded French only ("Choisis Arrêter seul...", "Création automatique arrêtée...", "Enregistrer et préparer les raids", "Début : ... fenêtre : ... jours", "Horaire inchangé", "Heures — tz"); lines 21, 22, 28, 36, 71 are bilingual "Taille / Size" strings. An English guild's officer gets French. It uses "tu" while the rest of the officer text uses "vous".
- Fix: route each string through `t(lang, en, fr)` or `tx(lang, ...)` with the guild language (see `src/commands/core-wizard.ts` for the pattern) and add the English text; add the file to `SOURCES` in `scripts/i18n-keys.mjs` so it is enforced.
- Safe: yes.

### 4. Addon: about 170 English-only chat lines on a French, German or Spanish client
- Not wrapped in `L()`: `Guilded/Modules/Dungeon.lua:391,436,2113,2145-2152` and the copy `GuildedDungeons/Shared/Dungeon.lua:392,437,2114,2146-2153` ("Dungeon run started: X. Good luck!", "Not in a tracked dungeon run.", "Only the group leader or an officer can do that."), `Guilded/Core.lua` (52 lines, raid start and end, boss, attendance, usage lines `:411-483,717`), `Modules/Minimap.lua` (16, e.g. `:287,293,313,400,404,434,518,672,925`), `Council.lua` 16, `Bidding.lua` 12, `Sim.lua` 11, `Calendar.lua` 9, `AutoInvite.lua` 9, `Consumables.lua` 7. The dungeon lines are the ones every member sees.
- Fix: wrap each in `L("...")` and add FR (in `FR`), DE and ES lines in `Locale.lua` (and the `GuildedDungeons/Shared/Locale.lua` copy); start with the Dungeon files.
- Safe: yes, needs an addon release.

### 5. COMMANDS.md still documents the pre-#1128 commands
- `COMMANDS.md:32,33` (`/character import`), `:322` (`/import ...`), `:353-356` (`/character pair`, `claim`, `import`), `:457` (`/poll create|close`), `:469-470` (`/import upload|apply|held`), `:489` and `:378` (`/tag set` as a member command), `:564,568` (`/character pair`, `/character claim` trust text). The website reference page (`site/pages/reference.md`) is already correct.
- Fix: rewrite those rows to `/character link`, `/setup import ...`, `/organize poll ...`, `/setup tags ...`; copy the wording from `site/pages/reference.md:39-123`.
- Safe: yes.

### 6. French tu/vous mixed across the bot
- `src/i18n.ts` (member panel, link, DM text) uses "tu/ton" (164 hits, e.g. `:233` "Colle la ligne ... ton PC") while `src/commands/help.ts`, `src/i18n-fr.ts` (93 "vous"), the website (`start.fr.md`, 40 "vous"), the companion (373 vous) and the phone app (141 vous) use "vous". The addon FR is itself mixed (157 tu, 298 vous). A member reads the same flow in two registers.
- Fix: owner picks one register (the site and companion already chose "vous"), then a worker rewrites `src/i18n.ts` and the tu lines in `Locale.lua`, `core-planning.ts`, `signup-character.ts:8` ("Choisis ... Ajoute-le").
- Safe: no (voice decision).

### 7. Addon: DE and ES missing one string; FR typography
- `addon/Guilded/Modules/InviteQueue.lua:650` `L("Type %s to invite them.")` has no DE or ES entry (FR has it). Add both to the `DE` and `ES` tables in `Locale.lua`.
- `src/commands/help.ts:32` FR "Microsoft Store; il synchronise" (French wants a space before the semicolon and "Store ; il"); same `;` pattern in `battleground.ts:132,179`, `race.ts:71` ("reste; supprimez").
- Fix: add the two Lua lines; add the spaces.
- Safe: yes.

### 8. GuildedGames addon French has no accents
- `addon/GuildedGames/Locale.lua:3-12` ("Equipe", "Pret", "Elimination", "a tour de role", "fenetre") and `addon/Guilded/Guilded.toc:4` `Notes-frFR` ("Presences", "systemes", "reserves", "verification d'equipement"). Every other addon table uses `\195\169`-style escapes.
- Fix: rewrite with the byte escapes (Lua) or UTF-8 (TOC, which accepts it); check the validator rule for `.toc`.
- Safe: yes.

### 9. Stale status lines in repo docs
- `ROADMAP.md:12` says "9.4.1 is published; 9.4.2 is next" while 9.4.2 is published (CHANGELOG, GitHub v9.4.2, site download page) and `ROADMAP.md:5` still says "Current stage — 7 November 2026".
- `README.md:37,46,47` link the old host `guilded.kcaron.top` (301 to guildedwow.com) and `README.md:40-43` still carries the 25 October "owner authorized release before the unavailable Forever two-PC tests" note.
- `addon/Guilded/README.md:114,208-211` keeps `/guilded verify` in the command list and "for one more release", which has now been several releases (the handler is `Core.lua:2197`).
- Fix: update the four spots; drop the verify line from the README command list.
- Safe: yes (do not touch `tests/current-version-docs.test.ts` lines).

### 10. "Moved for one release" stubs and the old public host
- `src/commands/index.ts:134,167,171,174,175,209,217` keep `movedStubs` for pair, import, claim, `/wow`, `/import`, `/poll`, officer craft, bank, tag and participation parts, and `site/pages/reference.md:30-33` (+ `.fr.md`) advertises them "for one release". They have lived through 9.4.0, 9.4.1 and 9.4.2. The stubs also cost Discord command-size room.
- Related: `src/site-url.ts:5` `DEFAULT_SITE_ORIGIN` is still `guilded.kcaron.top`, so bot links and the download page's installer link (`guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe`, 16 occurrences in rendered pages; 302 to dl.kcaron.top) use the legacy host while `help.ts` hard-codes guildedwow.com.
- Fix: owner decides the removal release for the stubs; set `PUBLIC_SITE_URL=https://guildedwow.com` (plan: `docs/plans/GUILDEDWOW_DOMAIN.md`) then flip the default.
- Safe: no (owner, production environment).

### 11. Minor
- Every website page ships both language headings in the HTML (two `<h1>`, EN and FR, one hidden by `language.js`); crawlers and screen readers without the script see both. Check that the hidden one uses `hidden` or `display:none`, not only a class set by script.
- `site/pages/mobile.md:16` and `.fr.md:16` say "Coming soon on Google Play" while the Roadmap has 0.5.0 in Google review; update when the closed track opens.
- Off by default on purpose (no change): item previews, crafter offers, `/config achievements`, auto game reminders, message log, weekly recap DM. `CLAUDE.md`'s "new features ON by default" rule conflicts with `src/commands/settings.ts:98` (achievements "off by default"); confirm that is intended.
- External links to ko-fi, CurseForge and Discord support return 403 to curl only (bot blocking); treat as fine.
