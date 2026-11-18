# Battle.net Forever profiles: what to build when Blizzard opens them

Status (18 November 2026): **closed**. Blizzard's public API answers WoW Forever for static game data only
(`static-forever-us`: item previews use it). `profile-forever-us` character and guild routes and the realm indexes in
`dynamic-forever-us` return 404 (`docs/FOREVER_ARMORY.md`, "API probe"; `docs/BATTLENET_SETUP.md`). Guilded gets characters
from the addon and companion, and links the armory website only.

## Watch

`npx tsx scripts/probe-forever-profile-api.ts [character-slug]` is the watch. It is read-only, uses the bot's existing
`BATTLENET_CLIENT_ID` / `BATTLENET_CLIENT_SECRET` (environment or `.env.local`), never prints a secret or token, and
exits 0 when Forever realms or profiles answer ("OPEN"), 1 when still closed, 2 when nothing could be checked. Run it by hand after a
client patch, on 9 December (first raids), and about every two weeks; the owner can schedule it. Do not build anything until it says OPEN.

## When it opens, in this order

1. **Ownership check (the main prize).** A member signs in with Battle.net; the bot reads
   `GET /profile/user/wow?namespace=profile-forever-us` with the member's own user token (reported to work with a user token before
   the public routes do). The characters it lists are proven to belong to that Battle.net account, so linking no longer depends on
   `/guilded verify` and officer sync.
   - Needs the authorization-code flow with scope `wow.profile`. The registered redirect URI
     `https://guilded.kcaron.top/me/battlenet/callback` is still on the application. Keep the token only as long as the one read needs;
     store the character list, never the token.
   - Fits the existing trust model: a Battle.net-proven link outranks the companion's reported names
     (`docs/plans/LINKING_AUDIT_2026-11-10.md`), and the member-facing flow stays one button.
   - Reuse the retained `BattleNetIdentity` / `BattleNetCharacter` tables if their shape still fits; otherwise a small new migration.
   - Say plainly, in English and French, what is read (the character list) and how to remove it (**Delete my data**).
2. **Character pages: gear and talents.** On player pages (`/leaderboards/character/<name>`) add an "Equipment" and a "Talents" block
   from `/profile/wow/character/<realm>/<name>/equipment` and `/specializations`, public data read with the client-credentials
   token. Cache for an hour, show the "as of" time, fall back to the addon's own gear and spec report, and never block the page on
   the API.
3. **Guild roster check.** `/data/wow/guild/<realm>/<guild-slug>/roster` could confirm guild membership for run trust
   (`docs/plans/RUN_TRUST_2026-11-10.md`); use it as one more witness, never as the only one.

## Out of scope now

The user OAuth flow, new tables, and any scraping of the armory website. Nothing here changes while the probe says CLOSED.
