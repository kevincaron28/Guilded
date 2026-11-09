# Guilded 9.0.8 — release notes (9 November 2026)

Dungeon runs no longer stay "waiting to reach Discord", no more "Guilded has been blocked" popups from the chat tab
or the world map, and the bot updates since 9.0.7. Protocol 2, WoW Forever only.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md.

## In game (addons)

- **Runs stop waiting forever.** The bot now confirms every run it receives, including a guildmate's copy of a run it
  already has and runs it refuses, so `/guilded dungeon` only counts runs that really have not reached Discord yet. A
  short reason shows for runs that were not scored. (#669)
- **No more login popup from the chat tab.** Guilded no longer opens, closes or docks chat windows itself (that made
  the next typed command run "tainted" and the game blocked it). To get Guilded's messages in their own tab, right-click
  a chat tab, choose New Window and name it Guilded; Guilded uses it from then on. (#668)
- **Auto-invite is click-only.** Guild invites the game only allows from a click now show a ready `/ginvite` line
  instead of inviting by themselves. (#668)
- **No more blocked actions after duels from the world map.** Guildmate dots are drawn on Guilded's own layer instead
  of the game's map, and `/guilded map open` asks you to press M. (#662)
- The Announcements page says milestones are on by default (they are). (#666)

## Companion

- **The Microsoft Store companion can start with Windows.** It asks once and the tray switch works, so runs and duels
  upload even if you forget to open it. (#669)
- Writes the bot's run notes so the addon can show why a run was not scored. (#669)

## Discord bot, website and phone server (deployed with this release)

- Character trust: website and `/character list` show which characters are confirmed and which are only reported;
  officers see "linked, reported but not verified" in `/officer roster gaps`. (#667)
- Rank roles preview: `/mod rankroles` shows who would get or lose a role and saves only on Confirm. (#667)
- `/setup status` shows how fresh the guild roster is and whose upload refreshed it last. (#667)
- Uploads are faster: runs the bot already has skip the slow work, which also ends the transaction timeouts that could
  break character linking during an upload. (#669)
- Raid application cards in French on French servers. (#664)
- Guilded Clash: French card names, rules and flavour for all 150 cards, a writing pass on the English flavour, the
  nine repainted champions and the new card back (ship with the next phone app). (#659, #663, #665)
- Website downloads: optional free mirror ahead of the server and GitHub (#658).

## Still owed

The chat-tab change, the map layer and the Store start-with-Windows switch on a real client; two-PC duel checks.
