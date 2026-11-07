# Companion audit and sync-first redesign (proposal)

Owner request, 7 November 2026: "Complete audit and redesign of the companion; its primary goal is to
sync." This is the audit and the proposal only. Nothing here is built yet; the owner picks before any
code changes. Base: `main` at 9.0.x, with the version panel from #511.

## 1. What the companion is for

One job: **get the member's saved data from WoW to Guilded, and the standings back, without them
thinking about it.** Everything a member must do is a means to that:

1. install the addon (and keep it current);
2. sign in with Discord once (which links their guild's server);
3. let the companion find the WoW folder;
4. play, `/reload` or log out: the companion syncs by itself.

When this works, a member should never need to open the window again. When it does not, the window must
say **what is wrong and the one thing to do**, in plain words.

## 2. Audit: every screen today

The window has 15 page sections, 11 navigation entries and 3 website links. The table below lists
each screen, what it is for, who needs it, and the verdict.

| Screen (nav label) | What it holds today | Who needs it | Verdict |
|---|---|---|---|
| **Home** | Repair, Sync now, Store banner, version panel (#511), moved-folder banner, addon install banner, "Let's get you connected" banner, 3 health tiles, 3 shortcut cards, two "Your games" cards (WoW, PoE2) | everyone | **Keep, simplify.** Up to six banners can stack; the health tiles repeat the banners; the shortcut cards link to pages that are elsewhere in the nav. |
| **Link everything** | 4-step wizard: WoW and the addon → Discord → the guild's server → characters | new members | **Keep as the first-run flow**, not a nav entry once done. |
| **Sync & setup** | Connection & setup: a long explainer ("Do you need to connect?"), Sign in, saved-data file, games, Start with Windows, automatic updates, advanced connections, Remove data | new members, then rarely | **Split.** First-run parts move into Link everything; the rest becomes a short **Settings** page. |
| **My characters** | Characters, guild and raid core per character | members, occasionally | **Keep, under Guild** (or as a Home card). Not a sync task. |
| **Server** (officers) | What is ready on the Discord server, main switches | officers | **Keep for officers only**, under Guild. |
| **My Guilded** ↗ | Link to the website | members | **Keep as a link.** |
| **World of Warcraft** | Configure WoW, upload counter, standings status, saved-data file, Choose WoW folder, Refresh standings, Show addon folder, Export to spreadsheet, GRM import | members (status), officers (export, GRM) | **Split.** Status and folder → Home/Settings. Export and GRM import → **Tools**. |
| **PoE2 mapping** (More tools) | PoE2 log tracking | hidden by Forever-only focus | **Keep hidden** (docs/FOREVER_ONLY_FOCUS.md); move under Tools when shown. |
| Leaderboards, Raids/cores/prices, Reserves/wishlist ↗ | Website links (#434 moved them out) | members | **Keep as links**, one group. |
| Wishlist, Cores, Pricing, Reserves, Leaderboards sections | Old in-app pages, hidden since #434 (code kept for the sync) | nobody in the UI | **Remove the markup** once the website pages cover reserves and wishlist; keep the sync paths. |
| **Problems** (red badge) | Each problem, How to fix, Fix it, Copy report | members with a problem | **Keep, and make it the main "something's wrong" view** that Home points to. |
| **Activity** | Log with search and filters, support summary | support | **Keep, under Help**, not top-level. |
| **Help & privacy** | Store/direct download, data explained, export | everyone, rarely | **Keep**, add Activity and the support summary. |

### What gets in the member's way today

- **Too many places say the same thing.**
  - The connection state shows in the Home banner, the health tiles, the side note, the tray tooltip, Sync & setup's pill and the Link everything wizard.
  - The addon state shows in the Home banner, Problems, Repair and the wizard's step 1.
- **Home can stack up to six banners** (Store, version, moved folder, addon, connect, …). The first one is not always the one that matters.
- **Setup is spread over three pages.** Link everything, Sync & setup and World of Warcraft each own part of first-run setup: Discord, folder, games.
- **Officer and power tools sit next to member basics.** These are Export to spreadsheet, GRM import, connection profiles, upload URL, standings interval and Server.
- **Technical words reach members:** "saved data", "SavedVariables", "Guilded.lua", "standings refresh", "upload".
- **Sync success is hard to see.** "Last sync" sits in a card halfway down Home. The member has to read text to learn whether things work.

## 3. Proposal: a sync-first companion

### Navigation: from 11 entries to 4

```
Sync          (Home: the one status, the one action)
Guild         (My characters, and Server for officers; My Guilded ↗, website links ↗)
Tools         (Export to spreadsheet, GRM import, PoE2 when shown)
Settings      (Discord account, WoW folder, start with Windows, updates, advanced, remove data)
── Help       (Help & privacy, Problems, Activity, support summary)
```

Link everything stops being a nav entry. It opens by itself on the first start, or whenever the
setup is incomplete, and Settings can reopen it ("Run setup again").

### The Sync screen

One large status card at the top, with exactly one state from the list in §4. It has one primary
button and, at most, one secondary link.

```
┌──────────────────────────────────────────────────────────────┐
│  ● Synced 4 minutes ago                                       │
│  Quebec Gold · 3 characters · standings in game are current   │
│  [ Sync now ]                       Details ›                 │
└──────────────────────────────────────────────────────────────┘
  This week   12 uploads · last /reload 21:14 · addon 9.0.1
  Version     Guilded Companion 9.0.1 · up to date      (from #511)
```

- Below the card, two quiet lines: **This week** and **Version**. No tiles, no shortcut cards.
- **Banners are gone.** Everything they said becomes either the status card's state (when it blocks syncing) or a Problems entry (when it doesn't).
- **Details ›** opens Activity filtered to the last sync.

### The states a member can see (one at a time, most urgent first)

| # | State | Card says | Primary button |
|---|---|---|---|
| 1 | Settings could not be saved | "Your settings could not be saved. Restart Windows, then open the companion." | Help |
| 2 | Not enough disk space | "Not enough disk space to update: X MB free." | Open Storage settings |
| 3 | Not signed in | "Sign in with Discord to start syncing." | Sign in with Discord |
| 4 | Sign-in expired | "Your Discord sign-in expired. Sign in again; nothing is lost." | Sign in with Discord |
| 5 | No WoW folder | "We could not find World of Warcraft." | Find WoW |
| 6 | Addon missing / older | "The Guilded addon is missing (or older than this companion)." | Install addon / Update addon |
| 7 | WoW never saved | "Start WoW, log in and type /reload once." | (none: waiting) |
| 8 | Guilded server unreachable | "Guilded's server is not answering. Your data waits here and is sent when it is back." | Try again |
| 9 | Upload refused | "Guilded refused the last upload: <reason>." | Problems |
| 10 | Syncing | "Sending your latest data…" | (none) |
| 11 | Synced | "Synced N minutes ago." | Sync now |
| 12 | Update ready (non-blocking) | shown on the Version line, not the card | Install now |

Most of states 1–9 already exist as Problems ids in `companion/problems.mjs`:
`settings-not-saved`, `disk-space-low`, `sign-in-expired`, `addon-missing`/`addon-outdated`,
`saved-file-missing`, `bot-unreachable` and `upload-rejected`. "Not signed in" and "No WoW folder"
come from the setup check (`validateConfig`), which Sync & setup already shows. The card picks the
first one in that order and adds the "all good" states 10–11. This means no new detection logic is
needed: the card is a view over what the companion already computes.

### Words

Members see game words, not file words:

- "your addon data", not "saved data" or "Guilded.lua";
- "Sync", not "upload" or "standings refresh";
- "your WoW folder", not "SavedVariables".

The exact file names stay in Settings › Advanced and in the Copy report.

### What gets cut or moved

- **Cut from the UI:** the hidden Wishlist, Cores, Pricing, Reserves and Leaderboards sections (their sync code paths stay). Also the Home health tiles and shortcut cards, and the duplicated connection pill in Sync & setup.
- **Moved:**
  - Export to spreadsheet and GRM import → Tools.
  - Connection profiles, the upload URL, the standings interval and Remove data → Settings › Advanced.
  - Activity → Help.
- **Unchanged:** everything the sync needs (`companion/engine.mjs`, profiles, standings, the queue), Repair, the addon installer, sign-in, auto-update, the version panel, Problems detection and the Copy report.

## 4. Build plan (after the owner picks)

Each step is its own PR and keeps the app working between steps.

1. **Status card** on Home, driven by Problems plus the sync state. The old banners are removed. Tests cover the state order (every state in the table, one at a time).
2. **Navigation to 4 entries:** Guild, Tools, Settings, Help; Link everything opens by itself until setup is complete.
3. **Settings page:** the remains of Sync & setup and the WoW page's folder and status parts; Advanced folds away.
4. **Words pass** in English and French (`fr.json`), with the i18n test.
5. **Remove** the hidden website-moved sections once the website has reserve and wishlist pages (Track C).

Each step carries screenshots in English and French and a run with an isolated `--user-data-dir`.
Real-PC checks: a fresh install, an upgrade over a running companion (#494), and a Store install.

## 5. Questions for the owner

1. **PoE2:** keep it under Tools when it is shown again, or give it its own top entry?
2. **Officers:** Server under Guild (proposed), or its own entry for officers only?
3. **The "This week" line:** is a count of uploads useful to members, or should it show the guild name and the last /reload only?
4. **Wizard:** should Link everything open by itself on every start until setup is complete (proposed), or only on the first start?
