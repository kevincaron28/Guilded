# Easy linking, pairing and sync: plan and status (2 November 2026)

Goal: a non-technical member links their characters, pairs the companion and syncs
in as few steps as possible. Nothing here bumps the version, deploys, or messages
anyone automatically. The owner reviews and merges.

## 1. What Blizzard's API gives us (and what we could not confirm)

Blizzard's developer portal documentation pages are rendered by JavaScript and could
not be fetched by a text reader, so the points below come from community and forum
sources plus the owner's own production check. Treat anything marked *unconfirmed* as
untested until a real account is tried.

| Edition | Account profile (`/profile/user/wow`) with `wow.profile` | Notes |
| --- | --- | --- |
| Retail | Yes. Verified in production by the owner (US consent, discovery and saving, see `NOV4_RELEASE_STATUS.md`). | Namespace `profile-{region}`. |
| Classic Era | *Unconfirmed.* Namespace `profile-classic1x-{region}` exists ([npm wrapper](https://www.npmjs.com/package/@blizzard-api/classic-wow), [Blizzard forum](https://us.forums.blizzard.com/en/blizzard/t/wow-classic-era-realm-apis/16812)). Era guild endpoints returned 403 for a time ([forum thread](https://us.forums.blizzard.com/en/wow/t/era-guild-and-guild-roster-api-no-longer-works/1969144)). | |
| TBC Anniversary | *Unconfirmed.* Forum posts suggest `profile-classicann-{region}`; official docs list only Era and Progression ([forum thread](https://us.forums.blizzard.com/en/blizzard/t/tbc-anniversary-namespaces-and-data-refreshes/57155)). | |
| Mists (Progression) | *Unconfirmed.* `profile-classic-{region}`. | |
| WoW Forever | **No known API.** Nothing in Blizzard's documentation or the community sources lists it. | Addon path only. |

Guild name and rank per character need one extra request per character
(`/profile/wow/character/{realm}/{name}`) and are not reliably available for Classic
editions. We do not use them: the bot already knows its own guild's roster from addon
uploads, so matching is done the other way round (see design).

## 2. Today's journey (from the code and docs)

New member, hardest path (no Battle.net):

1. Install the addon.
2. Install the companion (Store).
3. Open it and sign in with Discord (browser approval; a device name is asked).
4. Choose or confirm the WoW folder (auto-detected in most cases).
5. In game, paste `/guilded verify CODE` once (the code comes from the welcome message or `/character pair`).
6. `/reload` or log out so WoW saves; wait for an upload, and for an officer's sync to confirm a guildmate-reported link.
7. Check `/character list`; claim anything missed.

About 7 steps, three of them outside Discord, and one that asks someone to type a code into a game.
Where people stall: step 5 (a code to copy and type), step 6 (WoW only saves on reload or logout, and
an officer must also sync), and not knowing whether it worked (no status line anywhere).

Officer: the same plus reviewing imports and `/officer character link` for names that did not auto-match.

## 3. Design

**One button, no codes.** `Connect Battle.net` on `/me/` and in the Discord welcome message is a
link to `/me/battlenet/connect`. After Blizzard's consent screen the bot:

1. asks Blizzard once for every region and edition it covers (one consent, up to 16 parallel
   requests, any that fail are skipped, not fatal);
2. stores the person's characters privately (existing `BattleNetIdentity` / `BattleNetCharacter`
   tables, no schema change, no tokens kept);
3. links each of those characters that the member's Discord server already has as an *unclaimed*
   roster entry (name, realm and edition match), with the same rules as `/guilded verify`:
   never moves a character owned by someone else, never relinks one that was unlinked or removed;
4. shows a summary of what was linked with a single **Undo these links** button.

Blizzard proves ownership, so this is stronger than the provisional guildmate-reported link and needs
no officer. The owner approved publishing alts, so the member's other characters on the same realm as one the guild
already knows are added too, with the class, race and level Blizzard reports. Characters on other realms stay
private and link by themselves when the addon or companion reports them (the existing path).

**Fallback.** WoW Forever (and any edition Blizzard does not answer for) is not an error: the summary
says the addon and Guilded app link those characters, and the status line says what to do.

**Status line**, in plain words, on `/me/`, on `/me/battlenet` and in the Discord welcome message:
*Connected* (Battle.net / Guilded app), *Last synced*, *What to do next* (one step).

**Privacy.** Scope stays `openid wow.profile`. Tokens are used once and discarded. Disconnect removes the
private selection. Undo removes only links made by the last connection, within 24 hours and only while
the character is still that member's (older links use `/character unlink`, so history is never lost by
accident). Nothing is posted to a channel, no points or awards are granted, no DM is sent.

## 4. Implemented in this change

- `src/services/battlenet.ts`: `discoverAllBattleNet` (one consent, every region/edition).
- `src/services/battlenet-autolink.ts`: ownership-verified auto-link and undo (uses the existing
  `CharacterVerifyClaim` table with status `BNET`, and `BLOCKED` after undo; no migration).
  Realm slugs are matched to addon realm names with punctuation and spaces ignored.
- `src/services/battlenet-page.ts`: `GET /me/battlenet/connect`, the one-click callback, `POST /me/battlenet/undo`,
  summary, status line and the `/me/` section. The old region/edition chooser remains under it as an advanced path.
- `src/services/link-status.ts`: the status line (English and French).
- Discord welcome and `/character pair` prompt: status field and a *Connect Battle.net* link button, shown
  only when Battle.net credentials are configured.
- Tests: `tests/battlenet-autolink.test.ts` with mocked Blizzard responses.

When `BATTLENET_CLIENT_ID` or `BATTLENET_CLIENT_SECRET` is missing, none of this appears and nothing changes.

## 5. Owner steps (no secrets in chat, in the repo or in the app)

The existing Blizzard application is reused. The only step left is adding the redirect URI
`https://guilded.kcaron.top/me/battlenet/callback` to it in the Battle.net developer portal (keep the existing ones).
If the bot's environment on Oracle already has `BATTLENET_CLIENT_ID` and `BATTLENET_CLIENT_SECRET`
(`src/config.ts`), nothing else is needed; otherwise add that application's values there and restart the bot.
Also: apply the existing additive migration `20261127000000_companion_devices_battlenet` if it is not live yet.
The Worker already allows the start POST; the new `GET /connect` page is an ordinary page, so no Worker change.
Then connect with a real account per edition and note which editions answer, to settle the *unconfirmed* rows above.
Details: `BATTLENET_SETUP.md`.

## 6. Not done, for after launch

- Companion app: sign in with Discord already exists; the in-app status line, deep-link approval and removing
  the remaining folder prompt are not changed here (they touch the Electron app and the Store-first work
  running in parallel).
- Guild-name matching through per-character requests (alts are matched by shared realm instead).
- Per-edition confirmation of the Classic namespaces with real accounts.
- The existing manual region/edition chooser can be removed once the one-click path is proven.
- Refresh needs the person to press the button again (no stored tokens, by design).
