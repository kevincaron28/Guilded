# 8.5.0 release acceptance (in progress)

Candidate branch `release/8.5-candidate`, built from `main` (8.4.7) plus PRs #385, #387, #389, #390,
#391, #392, #393, #394 and #395. Track K is not in yet. The local test build still says 8.4.7
because the version bump happens once, at release.

## Single-client test on the owner's PC, 6 November 2026 (WoW Forever 1.60.1, Lebowski Holyroller)

Install: the candidate Forever build was copied into `_forever_\Interface\AddOns\Guilded`. The old
8.4.6 folder is backed up in `backups/addon-before-8.5/`. WoW was restarted through Battle.net Play.

| Item | Result | Evidence |
| --- | --- | --- |
| Addon loads | **Found a bug, fixed on the candidate.** Lua warning at login: "Binding header GUILDED was attempted to be loaded more than once" (`Bindings.xml`): the new call-for-help binding repeated `header="GUILDED"`. Track J asked to fix #395. | Zoomed warning |
| E2 minimap tooltip | Pass: lists left, right, shift, ctrl, alt, middle and drag, plus "Changes waiting to be saved (/reload)". | Zoomed tooltip |
| E2 right-click quick menu | Pass: Raid signups, Loot and standings, Dungeons, Crafting search, Guild map, Call for help, Settings. | Zoomed menu |
| E2 left-click | **Minor bug:** the first left-click after closing the quick menu with Escape does nothing; the second opens the window. Sent to Track E. | Two screenshots |
| E4 companion link in game | Pass: Home shows "Get the Windows companion (select a link, Ctrl+C)" with the site and stable GitHub links. | Screenshot |
| J call for help (sending) | Pass, with two UX findings. A bare `/guilded sos` sent a real call: "[Guilded] Help! Lebowski is under attack in Tirisfal Glades" reached guild chat, and guildmates answered within a minute. The banner "Help called. Waiting for answers." with **All clear** worked. Findings sent to Track J: a bare command should confirm first, and All clear should also post a guild line. A manual "test, all clear" line was posted to the guild. | Zoomed chat |
| J Defender banner (receiving) | Not run: needs a second client in the same zone (two-PC window). | — |
| E1 online/offline lines | Not seen yet: no guildmate logged in or out during the run. | — |
| E3 last seen in the Crafted by tooltip | Not run: needs an item that a guild crafter makes. | — |

### Retest after the fixes (candidate `75aa9b2b`, adds #396 C4/C5 and #397 Track K)

| Item | Result |
| --- | --- |
| Addon loads | Pass: no Lua warning after the `Bindings.xml` fix. |
| J bare `/gsos` | Pass: shows "Call for help now?" Yes/No. **No** sends nothing to guild chat. |
| E2 left-click after Escape | Pass: the first click opens the window. |

### Learned for the test plan
- `/chatlog` does not record addon output, so Guilded's lines are checked with zoomed screenshots.
- WoW Forever's `/quit` returns to the login screen. Restart through Battle.net **Play** instead.
- Bringing WoW forward with the desktop tool's "open application" **starts a new WoW copy**. Bring the
  existing window forward through its window handle instead.
- WoW asks "Allow custom scripts?" for `/run`. That is a game security setting, so it was declined.
  The tests use the real buttons instead.

## Still to do
- Full test suite on the merged candidate (running).
- Track K merge, then the two-PC window ([test plan](V8_5_0_GAME_TEST_PLAN.md)).
- Discord checks: boards, nickname sync, roster gaps, achievements, after a bot deploy of the candidate.
