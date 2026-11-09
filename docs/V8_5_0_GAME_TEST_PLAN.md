# 8.5.0 in-game test plan (desktop control, low cost)

Written 6 November 2026 for the session that drives WoW Forever on the owner's PC by desktop
control (computer use). Goal: prove each 8.5 feature in the real client with as few screenshots
as possible, because screenshots are what cost the most.

## Who runs it, and when

- **One tester session** (Sonnet), started by the coordinating session **after** the 8.5 track PRs
  are merged into one candidate branch and the addon is built. Never two sessions controlling the
  desktop at once (CLAUDE.md).
- It reports back to the coordinating session with a pass/fail table and only the screenshots
  that prove a visual item.
- Results go into `docs/V8_5_0_RELEASE_ACCEPTANCE.md`.

## Ground rules (safety)

- WoW Forever is open in **windowed mode**. The tester may enter the game **only from the character
  selection screen**, on **Lebowski Holyroller**. If WoW shows the Battle.net login, a password
  prompt or an authenticator, stop and ask the owner: never type credentials.
- Real guildmates can see what the tester does. Allowed: Guilded slash commands, opening windows,
  `/reload`, `/chatlog`, one announced call-for-help test. **Not allowed without the owner's OK in
  chat at that moment:** promoting, demoting, kicking or inviting anyone, writing guild notes,
  whispering members, posting more than one line in guild chat, trading, buying or deleting items.
- WoW Forever's `/quit` and `/logout` return to the **login screen**, which needs a password. To
  restart the client (needed when the addon adds new files), close the WoW process and press
  **Play** in Battle.net, which signs in by itself and opens the character screen.
- `/guilded sos` with no arguments **sends a real call for help** (until the confirm prompt lands).
- Do not move the character into danger (no PvP zone, no flying across contested areas).
- Close nothing the owner had open; leave WoW at the character screen or in game, as found.

## How to keep it cheap

1. **Read files, not pixels.** Learned 6 November: `/chatlog` records real chat (guild, system)
   but **not** addon output printed to a chat frame, and it may only flush to disk at logout, so use
   zoomed screenshots of the chat box for Guilded's own lines. `/chatlog` still helps for guild chat,
   written to
   `D:\Program Files (x86)\World of Warcraft\_forever_\Logs\WoWChatLog.txt`. After each command,
   read the new lines of that file with the shell. That replaces most screenshots.
2. **Saved data after `/reload`.** State checks (settings, Hall of Fame cache, last seen, relay
   provenance) read
   `D:\Program Files (x86)\World of Warcraft\_forever_\WTF\Account\<account>\SavedVariables\Guilded.lua`
   after a `/reload` (the game writes it then). Compare with expected values in text.
3. **Install by copy, not by clicking.** The tester copies the built `addon/Guilded` and
   `addon/GuildedDungeons` folders into `_forever_\Interface\AddOns\` while at the character
   screen (back up the old folders first to `backups/addon-before-8.5/`), then `/reload` in game.
4. **Batch input.** One computer-use batch per step: click chat box, type the command, Enter,
   wait 2 s. Then read the chat log file. Screenshot only when the item is visual.
5. **Screenshots at half scale**, and use zoom on the one region that matters (a tooltip, a
   banner). Save only the ones that go in the acceptance record.
6. **Discord checks by text.** Use the browser's page text (Claude in Chrome `get_page_text`) on the
   Discord web channel instead of screenshots, except for the final card images.
7. **Lua harness first.** Anything the fengari tests already cover (patterns, cooldowns, encoding)
   is not re-tested by hand; the tester only checks what needs the real client.

## Two-PC window (one session, after the merge)

The owner's second PC has WoW Forever (windowed) and Discord signed in as a second member, and a
Claude session with Remote Control that reports to the coordinator. All two-player checks are done
in **one planned window** after the 8.5 candidate is installed on both PCs, so nothing is retested:

| Order | Main PC (Lebowski, coordinator's tester) | Second PC (second member) | Proves |
| --- | --- | --- | --- |
| 1 | — | Fresh install of the companion from the stable link, Sign in with Discord (owner types the login), `/reload` | F4 fresh install, F1 problems panel if anything fails, F2 settings |
| 2 | Watch Discord | Read DMs | First-link DM (F3) arrives once |
| 3 | Same zone, `/guilded help` (announced) | Watch for banner, click **On my way** | J: Defender banner, replies, guild chat line in Discord |
| 4 | Duel the second character | Accept, finish | Duel recorded, duel ladder updates (B2), milestone line |
| 5 | Log out, wait | `/guilded sync peers` | K: addon-only data relayed with provenance; ledger sync |
| 6 | Log in | Watch Guilded chat tab | E1 online/offline line |
| 7 | — | Check own nickname and Who's who in Discord | C2 nickname format, board |
| 8 | — | Turn off nickname sync and Defenders for itself | Member off switches work |
| 9 | — | Uninstall the companion; list what is left in `%APPDATA%`/`%LOCALAPPDATA%` | Clean uninstall |

Second-PC session rules are the same as above; it sends each result to the coordinator, which records
everything in `docs/V8_5_0_RELEASE_ACCEPTANCE.md`.

## Relink test after the next deploy (owner request, 6 November 2026)

On the main PC, as the owner's own member path: record the current links, unlink Lebowski on the test
server, uninstall the companion, download and install it fresh, sign in (the owner types the
login), link, check the DM and `/character list`, then link a second character (an alt) through
`/reload`. Note every friction point with timings.

## Test list

Each line: what to do, how to verify, and whether a screenshot is needed (S).

### Setup (once)
1. Back up and install the candidate addon; enter the game as Lebowski; `/chatlog`.
2. `/guilded diag` and `/guilded version` → chat log shows the 8.5.0 build and no captured errors.

### Track E — chat tab, minimap, tooltip
3. Wait for a guildmate to log in/out (or ask the owner to log an alt) → chat log shows the
   online/offline line in the Guilded tab format. Join/leave lines are checked only if it happens.
4. Minimap: left, right (quick menu), shift, ctrl, alt and middle clicks → each opens the expected
   window (S: one screenshot of the quick menu and one of the tooltip).
5. Hover an item a guild crafter makes → Crafted by line shows "last seen" (S: zoomed tooltip).
6. Home / Settings show **Get the companion** with the copy box (S: once).

### Track J — call for help
7. Announce in guild chat first (owner approves the wording), then `/guilded help` → chat log
   shows the single guild chat line; the Discord linked channel shows it (page text).
8. Second press within 2 minutes is refused (chat log). **All clear** ends it.
9. Defender banner needs a second client in the same zone: **owner-assisted** (second PC), else
   marked "covered by Lua tests only".

### Track K — addon-only sync
10. After `/reload`, Guilded.lua holds the relay fields with provenance for at least one guildmate
    (text check). The in-game "Synced via …" line is shown (S: once, if present).
11. A version check line appears when a guildmate has an older addon (only if one is online).

### Track B — boards (Discord, with game data)
12. After the companion uploads (owner's companion running), the race-to-60 board lists the top 25
    with details; a Hall of Fame entry exists for every level 60; duel and battleground ladders are
    separate messages (page text, then S of each card once).

### Track C — roster and names
13. `/officer roster gaps` in Discord lists the expected people and `/ginvite First Last` lines
    (page text). **No invite is sent** by the tester.
14. Nickname sync renamed members in the `kevmister28 (Lebowski Holyroller)` format; a member
    who opted out kept their name (page text of the member list).
15. Promotion panel in game lists "Ready to promote" (S: once). **No Promote click** without the
    owner's OK.

### Track A, D, G (Discord and web only, no game)
16. `/achievements` and the web page show only Forever and guild achievements.
17. Artisans' Gallery search finds a known recipe and its crafter with last seen.
18. Statistics page shows snapshots; the Sheets CSV link loads.

### Track F — companion (desktop, not the game)
19. Problems panel: rename the saved file folder temporarily → the red ! appears with the fix
    text; restore it → it clears (S: once each).
20. Settings show the short list with niche items under Advanced (S: once).
21. First-link DM: verified with a test member account only if the owner provides one.

### Finish
22. `/reload`, read Guilded.lua for errors captured during the run (`/guilded diag` empty).
23. Leave the game as found. Report the table and the saved screenshots.

## Expected cost

About 10-14 screenshots total (most at half scale), the rest by reading the chat log, saved data
and Discord page text. Items needing a second player are marked owner-assisted instead of being
faked.
