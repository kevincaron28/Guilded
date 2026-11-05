# Member journey audit: "never heard of Guilded" to "all my characters linked and syncing" (5 November 2026)

Scope: a non-technical member on Windows with WoW Forever. Read from the code, not run on a
real client (Forever live acceptance is still NOT RUN). Step counts are estimates from the code
path; a "step" is a click, a typed or pasted thing, a window change, a wait or a decision.
Nothing here bumps the version, deploys or publishes.

## 1. The path as built (before this change)

| # | Where | What the member does | Kind |
| --- | --- | --- | --- |
| 1 | Discord welcome / `/character pair` | Presses **Link my characters** (ephemeral embed) | click |
| 2 | Same embed | Reads three blocks (addon default, `/guilded verify` line, "Optional: companion") and decides which path | decision |
| 3 | Embed | Presses **Connect optional companion** (a second embed with 3 steps) | click |
| 4 | Embed | Presses **Get the Windows companion** | click |
| 5-7 | Microsoft Store | Open page, Get, Open (Store certification of 8.4.2/8.4.3 still pending; unsigned EXE fallback warns) | 3 clicks |
| 8 | Companion (first run lands on **Link everything**) | Presses **Sign in with Discord** | click |
| 9-11 | Browser | Approves, chooses the server, presses **Connect**, returns to the app | 3 steps |
| 12 | Companion | After sign-in the app looks for `Guilded.lua`; **only a file that already exists counts**. A member who installed the addon but has not saved once finds nothing and is told to Browse | decision / dead end |
| 13-15 | Companion, file dialog | Browse into `WTF\Account\NAME\SavedVariables` (hidden path knowledge) | 3 steps |
| 16 | WoW | Log in, `/reload` (SavedVariables are written only on reload or logout) | 2 steps + wait |
| 17 | Companion | Press **Sync now** / wait; check Activity | click + wait |
| 18 | Discord | `/character list` to confirm; `/character claim` for misses | 2 steps |

Addon install happens before all of this and is manual (CurseForge or copy the folder into
`Interface/AddOns` with WoW closed): about 4-6 steps. The companion cannot install it
(`companion/addon-install.mjs` only checks that the right build is there).

Members without the companion are steered to the in-game route instead: copy
`/guilded verify CODE`, open WoW, log in, paste, Enter (4 steps) and then **wait for an officer's
companion to sync** (hours, or never: the embed itself warns when none synced in 2 weeks).

**Estimate before:** about 17 actions after the addon (companion route) with 3 decisions and 1
likely dead end (the file dialog); or about 5 actions plus an open-ended wait on an officer (verify route).

## 2. Friction, ranked by "members who give up"

| Rank | Friction | Why people stop | Fix | Status |
| --- | --- | --- | --- | --- |
| 1 | The Discord prompt and the website call the companion **optional** and lead with "addon only (default)" and the verify line | The path that actually links within minutes is framed as skippable; the path shown first depends on an officer | Lead with the 2-step Windows route; keep the pasted line as "No Windows PC?" | Fixed (bot PR) |
| 2 | "Connect optional companion" is an extra button and an extra embed before anyone reaches the Store link | One click and one screen of reading for nothing | Direct **Get the Windows companion** button on the first embed, steps inline | Fixed (bot PR) |
| 3 | `/start` step 3 sends people to the **website** sign-in, which links nothing | Signed in on the site, "nothing happened", gave up | Step 3 is "sign in in the companion"; the site sign-in is a small secondary link | Fixed (site, bot PR) |
| 4 | Companion cannot choose a saved file that does not exist yet | Fresh addon install, no `/reload` yet: "Choose Browse and select Guilded.lua" | When exactly one live Forever account folder exists, watch its path now; upload starts on the first save. A 20 s background retry replaces the **Find my saved data** button | Fixed (companion PR, needs release) |
| 5 | The status line told a Forever member to "Press Connect Battle.net" (nothing in Blizzard's API covers Forever), and the Battle.net button showed on the prompt | A dead end as the first instruction | Hide Battle.net on the prompt and in the status line while Forever is the only active edition (`battleNetUseful`) | Fixed (bot PR) |
| 6 | Verify route depends on an officer's companion syncing | Open-ended wait, no feedback | Now a clearly marked fallback; the officer wait is still stated | Mitigated |
| 7 | Addon install is manual and edition-specific | Wrong folder, wrong edition build, WoW open | Companion could install the matching addon itself (bundle or download the zip, WoW closed check) | Not fixed: new feature, needs release and real-client testing |
| 8 | Non-default WoW folder or several accounts | `detect-wow.cjs` scans C-G drives and common parents for `warcraft|wow|forever`; anything else, or two accounts, falls back to Browse | A folder picker that starts at the install root and finds the account itself | Not fixed |
| 9 | No explicit "you are done" outside the companion | Member does not know whether it worked | The prompt now says a green ✓ appears; the companion already shows "Everything is linked" | Partly fixed |
| 10 | No Discord confirmation after a **companion** link (the verify route DMs) | Silence | A DM or ephemeral line after the first link needs a configured opt-in per CLAUDE.md | Not done: needs an owner decision |
| 11 | Auto-matching by Discord name only helps members whose nickname is the character name; the sole-newcomer rule needs exactly one waiting member | At 35 members with 32 unlinked it will rarely fire | Companion sign-in proves ownership regardless, so route everyone there (rank 1) | Addressed by rank 1 |
| 12 | Store certification pending, unsigned GitHub EXE shows SmartScreen | Windows warning scares non-technical users | Not fixable in source | Open |

## 3. Plan vs what was built

`EASY_LINKING_PLAN_2026-11-02.md` promised one button and no codes. Built and live: Battle.net
one-click (Retail only in practice), `/guilded verify`, #356 automatic linking of every PC
character. Not built, as the plan itself says: in-app status line after the folder prompt and
removing the remaining folder prompt (this change covers the common case). `COMPANION_HUB_PLAN`
delivered the hub, My characters and the **Link everything** page. The gap between plan and
member reality was the framing (everything called optional, Battle.net first) rather than missing
mechanics; this change closes that.

## 4. After (estimate)

Companion route: Discord **Link my characters** (1) → **Get the Windows companion** (2) → Store
Get/Open (3-4) → **Sign in with Discord**, **Connect** in browser (5-6) → `/reload` in WoW once (7)
→ green ✓ appears by itself. **About 7 actions after the addon, no decisions, no file dialog** in
the common case (down from about 17 with a likely dead end). Website `/start` now reads the same way.

## 5. Left alone / noticed

- Addon panel layout: not audited here. The batch backlog in `docs/` stays as is.
- Bot deploy alone (prompt text, status line, site pages) ships the framing changes. The folder
  auto-pick and background retry need a **new companion release**; until then the old dialog remains.
- `onboard:companion` button handler is kept so old welcome messages keep working.
