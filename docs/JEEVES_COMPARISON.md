# Jeeves bot compared with Guilded (research, 7 November 2026)

Owner request, 5 November: "research Jeeves bot, it just updated how it syncs characters and guilds because it is unsure of the available API yet."
Public sources only; nothing was installed or run. Not read in full (the docs pages are script-rendered), so details below come from the
page titles and search summaries and should be re-checked before anything is copied. "Jeeves" here is the **jeeves.bot** service, not the
unrelated GitHub project `AlecAivazis/jeeves`.

## How Jeeves handles WoW Forever

| Topic | What Jeeves says | Source |
| --- | --- | --- |
| API | Blizzard has no Battle.net API for Forever yet, so Jeeves cannot look Forever characters up as it does for Retail and Classic | [WoW Forever docs](https://www.jeeves.bot/docs/configuration/forever) |
| Character data | The **Jeeves desktop app reports what it sees in the game**; members link Battle.net with `/authorize`, and reported characters show as "Forever characters (unverified)" on the website | same; [desktop app guide](https://www.jeeves.bot/docs/guides/Desktop-App) |
| Guild rosters | Forever guilds are tracked from rosters the app reports; the roster updates when a reporter **logs out of Forever with the app running** | same; [Role management](https://www.jeeves.bot/docs/configuration/role-management) |
| Trust | Nobody checks what the app reports; officers you trust run it for rosters. Managers link reported characters to Discord members | same |
| Later | Once Blizzard ships an API, Forever moves to it and real linked characters replace the reported ones | same |
| Retail/Classic guild sync | Automatic every 3 hours (Blizzard's guild API refreshes that slowly); a manual Sync-Guild runs early; the linker must be the Guild Master or the rank below | Jeeves docs, guild sync page (search summary) |
| Output | Role management: Discord roles from characters and guild membership, counted per game tab | [Role management](https://www.jeeves.bot/docs/configuration/role-management) |
| Platform | Windows 10 or later | [client download](https://www.jeeves.bot/client-download) |

## Against Guilded

| | Jeeves | Guilded |
| --- | --- | --- |
| Source of Forever data | Desktop app watching the game | Addon writes SavedVariables; companion uploads; **any member's upload** carries roster, event log and MOTD (`docs/ADDON_ONLY_SYNC.md`, #479) |
| When it updates | On reporter logout | On `/reload` or logout, plus guildmate catch-up and relay between members |
| Trust | Unverified, trusted reporters | Pairing credentials per member; Discord sign-in; `/guilded verify`; officers only authorise awards |
| Linking to Discord | `/authorize` Battle.net, manager links by hand | Automatic from the companion, DM confirming linked characters, pre-link from the invite channel |
| Same blocker | No Forever API | Same: `docs/FOREVER_ARMORY.md`, probe `scripts/forever-armory-probe.mjs` |
| Beyond rosters | Roles, Mythic+ keystones (Retail) | Standings, dungeons, PvP, crafting, bank, in-game boards |

Reading: Jeeves reached the same conclusion as Guilded (no API, so report from the client), but its chain is thinner: one reporter, refreshed on logout, unverified, linked by hand.
Guilded already does more (many reporters, catch-up, automatic linking). What Jeeves does that is worth borrowing is presentation, not plumbing.

## Ideas to adopt

Ideas 1-3 were approved by the owner on 9 November 2026 and **built** (one pull request, 9.1 work).

1. **"Reported, not verified" label. Built.** `src/services/character-trust.ts` decides it. Confirmed: the member's own signed-in companion uploaded the character, an officer linked it (`/officer character link`), or an officer's upload heard the member's `/guilded verify` code (claim `LINKED`). Reported: typed in (`/character add`, import code), matched by name (autolink, `/character claim`), heard by a guildmate's addon (claim `PROVISIONAL`) or named in an invite request. New column `Character.confirmedAt` (migration `20270128000000_character_confirmed_at`); rows from before it turn confirmed with the member's next companion upload. Shown on `/me/` (Your characters), `/me/data`, `/character list`, `/who` and a new "Linked, reported but not verified" list in `/officer roster gaps`, English and French on the website.
2. **Role rules preview. Built for rank roles.** `/mod rankroles set` and `/mod rankroles enabled on:true` (when it was off) now show, per mapped role, how many members would get it with up to five names and how many would lose a mapped role, and save nothing until the officer presses Confirm (`previewRankRoles` in `src/services/rank-roles.ts`). Guilded has no crafter roles yet; when they are built, reuse the same preview.
3. **"Last roster update" per source. Built.** `/setup status` shows "Guild roster updated (time) by (member)'s upload (N members)", or a warning after 3 days without a new roster reading, with who brought the last one and how to refresh it (`rosterFreshness` in `src/services/guild-data.ts`, from the stored `GuildRosterEntry` readings; no new field). The officer-sync row beside it still covers ranks and `/guilded verify`.
4. **Re-check when** Jeeves publishes its Forever migration after Blizzard opens an API: compare how it replaces reported with real characters, and reuse the idea for the armory enrichment item.
