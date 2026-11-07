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

## Ideas to adopt (plan only)

1. **"Reported, not verified" label.** Show on the website's My characters page and in officer views which Forever characters come from a client report and which are confirmed by Discord sign-in, `/guilded verify` or (later) Blizzard. Files: `site/` characters page, `src/services/` character-link views.
2. **Role rules preview.** Before an officer turns on rank-to-role or crafter roles, show "these members would get this role" counts, as Jeeves' dashboard does per game tab. Files: `src/commands/setup.ts`, `src/services/` role sync, the rule-check output.
3. **"Last roster update" per source.** Show in `/setup status` how fresh the roster is and which member's upload last refreshed it, so the "reporter logs out" gap Jeeves has is visible and fixable. Files: `src/commands/setup.ts`, `src/services/guild-data.ts`.
4. **Re-check when** Jeeves publishes its Forever migration after Blizzard opens an API: compare how it replaces reported with real characters, and reuse the idea for the armory enrichment item.
