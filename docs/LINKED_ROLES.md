# Discord Linked Roles

A member's verified WoW Forever character shows on their Discord profile ("WoW Forever", the character name) and any server that has the Guilded bot can give roles from it.

Code: `src/services/linked-roles.ts` (metadata, values, OAuth), `src/services/linked-roles-web.ts` (the two pages), `scripts/register-role-connections.ts` (owner script). The website Worker routes `/auth/linked-roles` and `/auth/linked-roles/callback` to the bot.

## What a member shows

The best confirmed character across their servers: the chosen main first, then the highest level, then the strongest proof. Only confirmed links count (`character-trust.ts`: an officer, the game, or the member's own synced companion agreeing with the guild roster). A merely reported character shows nothing, and the member sees "No verified character yet".

## The five metadata records (Discord allows five)

| Key | Type | Meaning | Why |
| --- | --- | --- | --- |
| `character_level` | integer >= | level of the character | "level 60 only" roles, raid access |
| `dungeon_score` | integer >= | Guilded dungeon points this season | competitive and "active dungeoner" roles |
| `guild_rank` | integer <= | in-game rank number, 0 = guild master | officer or core roles, without Discord admin work |
| `in_guild` | boolean | character is in a guild Guilded knows | tells guild members from guests |
| `member_days` | integer >= | days since joining a Guilded server | seniority roles |

A value that is unknown (no level, no rank) is left out, so a requirement on it fails instead of passing. Names and descriptions have French localizations (`name_localizations`, `description_localizations`) and fit Discord's limits (5 records, name 100, description 200); `tests/linked-roles.test.ts` checks them.

## Owner steps

1. Developer Portal > your application > **General Information** > **Linked Roles Verification URL**: `<PUBLIC_SITE_URL>/auth/linked-roles` (with the hosted site: `https://guilded.kcaron.top/auth/linked-roles`). Save.
2. **OAuth2** > **Redirects**: add `<PUBLIC_SITE_URL>/auth/linked-roles/callback` (`https://guilded.kcaron.top/auth/linked-roles/callback`). Save. (The existing `/auth/callback` redirect stays.)
3. The scopes requested are `identify role_connections.write`; nothing to tick in the portal.
4. Environment variables: none new. The feature turns on with the website sign-in settings already used by `/auth/login`: `DISCORD_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET`, `PUBLIC_SITE_URL`, `WEB_SESSION_SECRET` on the Oracle server. If any is unset the pages say sign-in is off. The Worker needs no new variable, only the redeploy of `worker/index.mjs` (it now lists the two paths).
5. Register the metadata once, from the owner's PC or the server (it reads `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`, never starts the bot):
   - `npx tsx scripts/register-role-connections.ts` prints the records (dry run);
   - `npx tsx scripts/register-role-connections.ts --apply` registers them. Run it again only if the records change. It never runs at bot start.

## How a server admin uses it

Server Settings > **Roles** > pick the role > **Links** tab > **Add requirement** > Guilded (WoW Forever) > choose a record, for example "Character level at least 60". Members then see a "Connect" prompt in the server; it opens the Verification URL, they accept, and the role is given.

## Design choices

- Values are pushed once, when the member finishes the consent screen. No refresh token is stored, so there is no migration and no secret at rest. The cost: values do not update by themselves. The member opens the link again (the success page says so) to refresh level, rank or score.
- The state is a signed cookie (`__Host-guilded_linked_roles`, 10 minutes, HMAC with `WEB_SESSION_SECRET`) checked against Discord's `state`; Discord is never called with an unchecked callback.
- Background refresh would need a stored, encrypted refresh token and a job; add it only if members ask.

## Member text

English: "Show your WoW Forever character on your Discord profile. Open the link, accept, and servers can give you roles from your level, guild rank and dungeon score. Open it again after you level up."

Français : "Affiche ton personnage WoW Forever sur ton profil Discord. Ouvre le lien, accepte, et les serveurs peuvent te donner des rôles selon ton niveau, ton rang de guilde et ton pointage de donjons. Rouvre-le après avoir gagné un niveau."
