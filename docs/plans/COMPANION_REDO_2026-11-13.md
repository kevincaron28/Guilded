# Companion redo: a small, quiet sync tool (13 November 2026)

On 13 November 2026 the owner asked to *"start planning the companion redo, the TSM companion installed is a great example of
simplicity, just the sync for the companion"*.

**Approved by the owner on 13 November 2026: decisions 1 to 5 as recommended. The plan is fully decided.**

This document is a read-only plan for `companion-app/` (the Electron window) and `companion/` (the shared engine), as of
origin/main at 9.1.6 plus #766. It changes no code. The sync engine, its uploads and its tests stay as they are; only the
window around them is redone.

## Summary

Today the companion is a full app:

- **Pages:** 9 (Sync, Link everything, Guild, Server, Tools, Settings, Problems, Activity, Help & privacy).
- **Links and dialogs:** 4 website links and 2 dialogs.
- **Settings:** an Advanced section with 6 groups.
- **Tray menu:** 6 items.

The redo is **one small window with four status lines and one "needs you" line**, plus an **Advanced** view. Everything
that is not syncing moves to the website, the phone app or Discord.

```
+- Guilded Companion ---------------------------- _  x -+
|  [logo]  Guilded Companion          9.2.0    EN | FR  |
|                                                       |
|  (o) World of Warcraft   Found  D:\...\_forever_      |
|  (o) Guilded addon       Up to date  9.2.0            |
|  (o) Last sync           2 min ago  (3 runs sent)     |
|  (o) Synced as           Marie Tremblay  (Discord)    |
|                          or: This PC, not signed in   |
|                              [Sign in with Discord]   |
|  ---------------------------------------------------  |
|  ! New WoW account found: is it yours?  [Yes] [No]    |  <- only when something needs you
|                                                       |
|  [ Sync now ]                  My Guilded ->  Advanced|
+-------------------------------------------------------+
```

- Each dot is green, amber or red. Only the line that is not green says why.
- Closing the window keeps the companion running in the tray.
- The window opens on the first run and whenever something needs the member, and otherwise stays closed.

| Today (where) | Verdict | Goes to / why |
|---|---|---|
| Sync page: status card, guild line, device panel, version panel, Repair, Sync now | **KEEP (main window)** | Becomes the four lines, the needs-you line and **Sync now**. Repair runs by itself when a line is red; its button moves to Advanced. |
| "Is this WoW account yours?" question | **KEEP (main window)** | Shown as the needs-you line, only while unanswered. The bot depends on the answer (`wow-accounts.mjs`). |
| Sign in with Discord (Link everything) | **KEEP (main window)** | One optional button on the "Synced as" line. Zero-setup sync works without it. |
| Link everything wizard (4 steps, diagnose, characters table, find data, check characters) | **REMOVE** | Zero-setup already finds the game, the folder and the guild. The diagnosis becomes the needs-you line. |
| Problems page | **ADVANCED** | The main window shows the worst problem as one line with **Fix it**. The full list sits in Advanced. |
| Activity log and support summary | **ADVANCED** | For support only: copy the report from there. |
| Settings: WoW folder and accounts list | **ADVANCED** | Found automatically; change it only if wrong. |
| Settings: start with Windows, automatic updates, Store updates | **ADVANCED** + tray | Both are on by default. The tray menu keeps a Start with Windows tick. |
| Settings: Discord account explainer, switch account, sign out, unlink this PC | **ADVANCED** | One "Discord" block. |
| Settings: guild connections (several servers or profiles) | **ADVANCED** | Kept for members in several guilds. Most members never see a list. |
| Reset this companion | **ADVANCED** | Kept: removes this PC's settings, the link and unsent data. |
| Delete my data | **MOVE** to the website `/me` | It is the same erasure (`companion-api.ts:783`). It belongs with the account, not the sync tool. |
| Guild page (my characters, guild, raid core) | **MOVE** to the website `/me` and the phone app | Both already show characters from `/api/v1/hub`. |
| Server page (officers: what is ready, main switches) | **MOVE** to the website and Discord `/setup` | Officer setup is not syncing. |
| Tools: export to spreadsheet | **MOVE** to Discord `/officer export` | It already exists there (`src/services/exports.ts`). |
| Tools: GRM import | **REMOVE** from the window | A one-time conversion for officers. The module stays (`companion/grm-migration.mjs`) for a developer-run import. |
| Website links (My Guilded, Leaderboards, Raids, Reserves) and footer (Discord, Ko-fi) | **MERGE** into one "My Guilded" link | The website's own menu leads to the rest. Discord and Ko-fi go to the bottom of Advanced. |
| Help & privacy page | **MOVE** to the website companion page | Advanced keeps a link plus the one-paragraph privacy summary. |
| Games switch (WoW, PoE2) and PoE2 log settings | **REMOVE** from the window | PoE2 tracking is off (`ACTIVE_TRACKING = []`). The code and the journal stay for later. |
| Bot address and Discord server ID filter (Advanced) | **REMOVE** from the window | Set automatically. The config keys stay readable; developers set them in the settings file. |
| Battle.net connection | **MOVE** to the website `/me/battlenet` | That page already exists. |
| Tray: Open, Send now, Refresh standings, Start with Windows, Quit, Remove all data and quit | **KEEP 4** | New menu: a status line (greyed), **Open**, **Sync now** (sends and refreshes), **Start with Windows**, **Quit**. Remove-all-data moves to Advanced > Reset. |

## 1. What the companion does today

**Background jobs** (`companion-app/main.cjs:770-850`; `companion/engine.mjs`):

- **Watching the game's files:** the engine watches the addon's SavedVariables folder, with a safety re-read for missed
  saves. It uploads what changed: the guild export, dungeon runs (`personal-runs.mjs` for Guilded Dungeons), battleground
  reports, duels, the guild bank, help calls and the rest of the whitelist in `lua-export-content.mjs`.
- **Downloading standings:** the engine long-polls the standings (12 s) and writes the addon's `Standings.lua`. That file
  holds the board, orders, invites, promotion, bank, accepted dungeon runs and the link line.
- **Relaying guildmates:** it carries guildmates' runs and actions that their addons relayed, so one companion serves
  members without one.
- **Zero-setup:** it retries every 5 minutes until the device key and server are set (`device-sync.mjs`), and keeps
  device receipts (`device-receipts.mjs`).
- **Periodic checks:**
  - it re-reads saved-file dates every 5 minutes;
  - it checks every 20 s whether WoW is running, and syncs when WoW closes;
  - it sleeps and wakes with the PC.
- **Updates:**
  - **Self-update** (website build): a fixed-name installer, checked 20 s after start and then every few hours.
  - **Store update:** every 30 min, at most once in 6 h, never while WoW runs.
  - **Addon install and update:** `addon-installer.cjs`, website first, GitHub second.
  - **Store moves:** a sign-in left in a Store copy is imported once, and settings come over when moving from the Store to
    the website build (`store-migrate.cjs`, `replace-store.ps1`).
- **Installer hand-off:** the installer leaves a quit request and the running companion closes for it.
- **Several accounts:** several WoW accounts per PC, with a one-time "is this yours?" question; live-folder switching;
  several connections (profiles).

**Sign-in paths:**

- zero-setup device key (no sign-in);
- optional Discord sign-in through the browser, with a loopback finish or a code;
- a Store sign-in imported once;
- sign-in and settings kept on upgrade, encrypted with Windows `safeStorage` (`store-config.cjs`).

**Two builds:** the website build updates itself and sets startup itself. The Store build gets updates from the Store and
its startup from Windows settings. Both builds read the same settings.

**Already covered elsewhere:**

- *Website `/me`:* characters, connections and devices (#765), Battle.net, delete my data, raid plans, reserves,
  leaderboards.
- *Phone app:* guild roster, characters, wishlist, raids, map, alerts.
- *Discord:* `/officer export`, `/setup`.

## 2. The model: the TradeSkillMaster desktop app (ideas only)

The ideas we take, from general knowledge of the app; no code, names or art are copied:

- One small window of status lines (game found, addon up to date, last sync).
- It lives in the tray and starts with Windows.
- It finds the game folder and the accounts by itself.
- It syncs on a timer and whenever the game writes its files.
- A problem shows as one line, and there are almost no settings.

**Where Guilded differs:**

- **Identity:** a Discord identity (optional, on top of the zero-setup device), and possibly several Discord servers.
- **Dungeon runs:** they need receipts, so a run is never "waiting" for ever.
- **Relaying:** the companion carries guildmates who have no companion.
- **Two-way sync:** it downloads `Standings.lua` for the addon.
- **The addon itself:** it installs and updates the addon, not only data.
- **Distribution:** a Store build with its own rules (strictly increasing versions, Store-first guidance, the 3 November
  objection to the "Guilded Companion" name).
- **Language:** English and French.

None of these needs a page: each is a line or an automatic job.

## 3. The redo

**Main window** (wireframe above). About 460 by 340, not resizable, follows the Windows theme.

| Line | What it shows | Red or amber looks like |
|---|---|---|
| World of Warcraft | Found, with a shortened path | "WoW not found: [Choose folder]" |
| Guilded addon | Up to date, with version | "Update ready, installs when WoW closes" (amber) or "Not installed: [Install]" (red) |
| Last sync | Time ago, with what was sent | "Waiting: the game has not saved yet (/reload or log out)" (amber) or "Bot unreachable, retrying in 30 s" (amber) |
| Synced as | Discord name, or "This PC, not signed in" | "Signed out on another PC: [Sign in]" |

The **needs-you line** shows one item, the most urgent first: a new WoW account to confirm, the wrong server for the in-game
guild, a run not counted yet (with its reason), a companion update, or low disk space.

**Advanced** is one scrolling view inside the same window, with **Back**:

- WoW folder and accounts;
- Discord (sign in, switch, sign out, unlink this PC, server picker when there are several);
- connections;
- language;
- start with Windows;
- automatic updates, or Store updates;
- Repair;
- all problems;
- the activity log and Copy support report;
- the privacy summary and help link;
- Reset this companion;
- Discord community and Ko-fi.

**Must stay**, because the bot or the addon depends on it:

- every upload in `lua-export-content.mjs`, and the device upload and receipts;
- relays, and the standings download into `Standings.lua`;
- the personal runs for Guilded Dungeons;
- the addon installer and updater, self-update and Store update;
- the Store sign-in import, and the Store-to-website move;
- the installer quit protocol;
- multi-account answers and connections;
- the encrypted settings and `language.json`;
- the `/api/v1/hub` and manage APIs, which the phone and website still use (only the companion's window stops calling
  them).

## 4. Implementation method

**A new renderer on the same engine and the same IPC.** `companion/engine.mjs`, `main.cjs`'s jobs and `preload.cjs` stay.
All sync tests stay untouched; about 60 `tests/companion-*` files cover them.

- **New pure model:** `companion/main-status.mjs`, which turns `engine.state()`, problems, the version and the addon state
  into the four lines and the needs-you line. It reuses `status-card.mjs`, `sync-status.mjs`, `problems.mjs` and
  `overview.mjs`, and is tested in Node.
- **New screens:** `renderer/main.html` and `main.js` (about 250 lines) and `advanced.js`. French goes in
  `locales/fr.json`, and `companion-i18n.test.ts` already checks the keys.

**Upgrades:** no migration is needed.

- The app id (`com.guilded.companion`), the data folder, the settings file, the encrypted sign-in and `language.json` don't
  change, so an upgrade keeps everything with no re-setup.
- Members with several connections see them in Advanced.
- Remembered pages (`page-visibility.mjs`) are simply ignored.

**Store:**

- Ship as 9.2.0.0 (strictly higher) with the same identity. The Store listing name may change; see section 4b.
- Refresh the Store screenshots, because the window changes.
- Guidance stays Store-first.

**PRs (each can ship alone):**

| # | PR | Size |
|---|---|---|
| C1 | `companion/main-status.mjs` and its tests (pure, no UI change) | S (about +250) |
| C2 | New main window and Advanced view. The old pages stay reachable from Advanced > "Old window" for one release as a safety net. | M-L (about +700) |
| C3 | Tray menu down to 4 items with a status line; the window opens only on first run or when needed; close goes to the tray | S |
| C4 | Moves and removals: Guild, Server, Tools, Help pages, website links, PoE2 and bot-address settings, Battle.net, delete-my-data (each now points to the website or Discord). Update `companion-navigation`, `settings-page` and `plain-words` tests. | M (mostly deletions) |
| C5 | Remove the old window and its now-unused IPC channels (from the `ipc-security` allowlist and `preload.cjs`), unused `fr.json` keys and packaging entries | M (about −2,000) |
| C6 | Website companion page, guides, `/help` and Store listing screenshots and text for the new window | S |
| N | **Store-only name** (section 4b, decision 5): reserve the new name in Partner Center, set the MSIX display name and the Store description, and add one "listed in the Store as" line on the site and in the addon's companion steps. Its own small PR, independent of C1-C6. *In progress (another worker).* | S |

C1 must land before C2. C3 and C4 need C2. C5 needs one release with C2 to C4 in members' hands, and C6 ships with C5.
N does not depend on the others and can ship with any release (before the next Store submission if possible).

**Checks on a real Windows PC and Store install:**

- **Fresh website install:** it finds the game, installs the addon and syncs without sign-in, all within 5 minutes, and
  the window then stays in the tray.
- **Upgrade from 9.1.6** (website build and Store build): settings, sign-in, start with Windows and connections are all
  kept.
- **Store 9.2.0.0 certification:** it passes, and the Windows startup task still works.
- **Store to website switch:** `replace-store.ps1` still works.
- **Two WoW accounts:** the question appears once.
- **Display:** French Windows, and 150% display scaling (the small window must not clip).
- **Tray:** works on Windows 10 and 11.
- **Self-update:** the update hand-off closes the old companion.
- **Dungeon runs:** they reach Discord, and receipts mark them accepted in the addon.

## 4b. A Store-safe name for the companion (owner, 13 Nov)

The owner's words: *"we should maybe also change names of the companion to stop being flagged, i dont know"*.

The Microsoft Store has failed the product twice on policy 10.1.1.1 ("the product name contains the title of another
software or service"). The flagged word is "Guilded", which is also the name of the guilded.gg chat service.

- 3 November: an appeal note got it through.
- 11 November: it failed again. An appeal was sent on 13 November and the submission is back in certification.

We submit with every companion release, so each release can be held up again. This section covers the **companion's name
only**; the addon, bot and website keep the Guilded brand. Nothing here is legal advice, and none of these names has been
checked for trademarks.

**How the name is wired today:**

| What | Where | Effect of a name change |
|---|---|---|
| Store listing name and package display name | Partner Center reserved name; `displayName: "Guilded Companion"` in `companion-app/build-msix.cjs:19` | A new name must be **reserved in Partner Center** and the package display name must match it. The package identity (`identity.name`, publisher) and app id `GuildedCompanion` **stay the same**, so it is the same product and updates continue. The old reserved name can be kept or released. |
| Website installer, auto-update asset | `productName`, `shortcutName` in `companion-app/package.json`; `Guilded.Companion.Setup.exe` fetched by `update-check.cjs:19`, verified by `scripts/verify-release-artifacts.mjs` and the site | Must keep working. Renaming the asset strands every installed companion's auto-update unless both names are published for several releases. |
| Settings folder | Website build: `%APPDATA%\Guilded Companion`, derived from `productName`. Store build: pinned to `%APPDATA%\Guilded Companion Store` (`main.cjs:20`). | Changing `productName` would **move the website build's folder** and lose sign-in and settings, unless it is pinned with `app.setPath` first. The Store build is already pinned. |
| Shortcuts and tray | Start menu shortcut `Guilded Companion` (NSIS); Store tile = package display name | The Store tile follows the new name by itself. The website shortcut changes only if we change it. |
| Texts that name it | Website companion pages, guides, `/help`, the addon's companion steps (`CompanionLink.lua`, `Locale.lua`), Store description | Guidance is Store-first, so members must recognise the listing: a short "listed in the Store as ..." line. |

**Options:**

1. **(a) Keep "Guilded Companion" and keep appealing.**
   - *Cost:* nothing to build.
   - *Risk:* every submission can fail again, delaying Store updates by days, and two reviewers have already disagreed.
     Lowest effort, least predictable.
2. **(b) A Store-only descriptive name** (recommended).
   - *What changes:* only the Partner Center listing name, the MSIX display name (`build-msix.cjs`, ideally read from the
     identity JSON) and the Store description.
   - *What stays:* everything else keeps "Guilded Companion": the website build, `productName`, the
     `Guilded.Companion.Setup.exe` asset, shortcuts and both settings folders. The window title reads "Guilded" with the
     Store name underneath, and the description says it works with the Guilded addon and Discord bot.
   - *Cost:* a small PR, plus one line in the site guides and the addon's companion steps.
   - *Candidates*, judged on the policy's own terms:
     - **"Guild Sync Companion"** and **"Guild Data Sync"**: lower risk, generic words with no other product's title.
     - **"GuildedWoW Sync"**: higher risk. It still begins with the flagged word and adds "WoW", which is Blizzard's mark
       and itself the title of another product.
     - **"Guild Sync for WoW Forever"**: also higher risk. Avoid "WoW", "World of Warcraft" and "Discord" in the name;
       saying "works with ..." in the description is the usual practice.
   - *Before reserving:* search the Store and the web for the chosen name; a generic name can still collide.
3. **(c) A full rename of the companion everywhere.**
   - *Cost:* the same Store work as (b), plus:
     - pin the website build's settings folder before changing `productName`;
     - keep `appId` `com.guilded.companion`, so the NSIS installer upgrades in place instead of installing a second copy;
     - publish both the old and new installer names for several releases, so old companions still auto-update;
     - update the site download links and tests, every guide and the addon's text.
   - *Size:* about M-L for no Store benefit over (b). It also splits the brand members know.

**Recommendation: (b).** Change the Store listing only, to a name without "Guilded", "WoW" or "Discord" (first choice "Guild
Sync Companion" after a name search). Ship it in C6, or sooner on its own if the 13 November appeal fails. Reserve the name in
Partner Center before the next submission.

## 5. Decisions (all approved by the owner, 13 November 2026)

1. **Move the Guild and Server pages out** to the website `/me` and the phone (officer switches to the website and
   Discord). *Recommend: yes.*
2. **Spreadsheet export only through Discord `/officer export`, and GRM import removed from the window.** *Recommend: yes.*
3. **Window behaviour:** it opens on the first run and when something needs the member, and otherwise lives in the tray.
   The website build starts with Windows by default; the Store build asks Windows once. *Recommend: yes.*
4. **Notifications:** one Windows notification only when something needs the member, and none for successful syncs.
   *Recommend: yes.*
5. **Store name (section 4b):** list the companion in the Store under a descriptive name without "Guilded", "WoW" or
   "Discord" (first choice "Guild Sync Companion", after a name search). Everything else, including the installer, the
   settings folder and the in-app brand, keeps "Guilded Companion". *Recommend: yes. Ship it on its own if the 13 November
   appeal fails.*

## 6. Build order

| Order | PR | Size | State |
|---|---|---|---|
| 1 | N: Store-only name (section 4b) | S | In progress (another worker) |
| 2 | C1: `companion/main-status.mjs` and its tests | S (about +250) | To do |
| 3 | C2: new main window and Advanced view, with the old window still behind Advanced | M-L (about +700) | To do, after C1 |
| 4 | C3: four-item tray menu; window opens only when needed | S | To do, after C2 |
| 5 | C4: moves and removals to the website and Discord | M (mostly deletions) | To do, after C2 |
| 6 | C5: delete the old window, unused IPC channels, strings and packaging entries | M (about −2,000) | After one release with C2-C4 |
| 7 | C6: website, guides, `/help` and Store screenshots and text | S | With C5 |
