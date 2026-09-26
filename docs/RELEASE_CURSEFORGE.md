# Releasing on CurseForge (v4.0.0)

Everything you need is here; the parts only you can do are marked **YOU**.

## 1. Before you upload

1. The public name is **Guilded** (decided). Use "WoW"/"Warcraft" only descriptively
   ("for WoW Forever"), not in the name. Confirm the name is free on CurseForge.
2. `node addon/Guilded/validate-addon.mjs` passes and `npm run addon:zip` builds
   `dist/Guilded-v4.0.0.zip` (top folder inside the zip must be `Guilded`).
3. **YOU:** play with the zip installed, tick the "Before release" list in
   RELEASE_CHECKLIST.md.
4. **YOU:** take 3 to 5 screenshots in game (Home page, Raid page during a raid,
   Standings, bid popup, the readiness board in Discord). Make a logo 400x400.

## 2. Create the project (CurseForge, "Author Studio")

- Game: **World of Warcraft**, Category: **Raid & Instance**, **Guild** or **Miscellaneous**.
- Name / slug: your public name.
- License: **PolyForm Noncommercial 1.0.0** (source-available; free for noncommercial use, no commercial use or resale). On CurseForge choose "Custom License" and paste the LICENSE text. The LICENSE file is in the repo and inside the zip.
- Source URL: your GitHub repository (make it public first, or leave blank).
- Summary (one line, max ~250 chars):

  > Raid attendance, EPGP points, loot bidding, gear and consumable checks and fun
  > roll games for WoW Forever guilds, with an optional Discord bot.

- Description (paste; CurseForge accepts Markdown):

```markdown
# What it is

An officer-friendly raid toolkit for **WoW Forever** guilds. It works fully inside
the game with no setup, and can optionally sync with a free Discord bot.

## In game
- **Raid tools:** start/end a raid, attendance (with bench credit), boss kills, notes.
- **EPGP and loot:** award EP and GP, live GP bidding with a popup for raiders (and
  whisper bids for people without the addon), standings with priority (PR).
- **Gear check before the raid:** empty slots, missing enchants, flasks/food and
  attunements, with a one-line readiness status per raider.
- **Roll games:** high roll, deathroll, 1v1 duels. No gold, no wagers, no debts.
- **Mass invite:** `/guilded invite raid` invites everyone signed up on Discord.
- **A friendly window:** click the gold coin on the minimap. A Home page tells you what
  is going on, your standing, and whether your data reached Discord.
- **Backups**, per-guild saved data, French translation, and every module can be
  switched off.

## With the optional Discord bot (self-hosted, free)
Signups with roles and waitlist, raid cores with priority, dungeon challenge and
leaderboard, craft board, readiness board, polls, Warcraft Logs, weekly reports.
A small Windows companion app (tray icon) uploads your data after each `/reload`.

## Commands
`/guilded` shows the list. `/guilded menu` opens the window. `/guilded sync` sends your data to Discord.

## Notes
Made for WoW Forever (interface 16001 and 20506). Not affiliated with Blizzard.
```

## 3. Upload the file

- Files, Upload File: `dist/Guilded-v4.0.0.zip`.
- Release type: **Beta** for the first day, then **Release**.
- Game versions: pick the entries matching WoW Forever / Classic (the same numbers as
  the TOC: 16001 and 20506). If your version is not listed, choose the closest Classic
  entry; the TOC is what the game reads.
- Changelog: paste the "4.0.0" section of CHANGELOG.md.
- Submit; CurseForge moderators review the first file (usually within a day).

## 4. After it is live

- Put the CurseForge link in the guild's Discord and in the README.
- Optional: connect the GitHub repo to CurseForge or Wago so new tags upload
  automatically (needs a CurseForge API token and the project ID, put the ID in the
  TOC as `## X-Curse-Project-ID: 123456`).
- Wago Addons listing is the same zip, no extra work.
- The **bot and companion** are not distributed on CurseForge. Give guilds the
  GitHub link and docs/DEPLOY_ORACLE.md.
