# Blizzard (Battle.net) application

The bot uses one Blizzard developer application for **item data**: item names, icons and tooltips for item
previews (`docs/ITEM_PREVIEWS.md`, `src/services/blizzard-items.ts`). It is optional: without it the previews
use the bot's own data and nothing else changes.

> **Battle.net character discovery was removed on 7 November 2026.** Guilded supports WoW Forever only, and
> Blizzard's profile API has no WoW Forever characters (it only answered for Retail and the Classic editions).
> Members link characters through the Guilded app and the addon. Old `/me/battlenet` links redirect to the
> "Your characters" block of `/me/`. Selections saved before then stay in the database (`BattleNetIdentity`,
> `BattleNetCharacter`) and are removed by **Delete my data**; nothing reads them any more.
> See `docs/plans/FOREVER_ONLY_REMOVAL.md` (stage 4a).

## Configuration

Set these two values in the bot service's protected environment (names are read in `src/config.ts`):

- `BATTLENET_CLIENT_ID`
- `BATTLENET_CLIENT_SECRET`

The bot uses them with Blizzard's client-credentials flow to read the Game Data API; no member signs in to
Blizzard. Missing either value turns the Blizzard item data off. Never put the secret in a committed file,
the website, the Windows companion or a chat message.

## Creating an application (only if none exists)

1. Sign in to the [Battle.net developer portal](https://develop.battle.net/access/clients) and create a
   client named **Guilded**.
2. Keep the generated client ID and secret in the bot's protected environment, then restart the bot.

The redirect URI `https://guilded.kcaron.top/me/battlenet/callback`, registered for the removed discovery
feature, is no longer used; it can stay on the application or be removed.
