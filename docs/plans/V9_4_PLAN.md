# Guilded 9.4 — plan (owner list of 19 November 2026)

The owner gave 12 items on 19 November 2026 ("we will be working on 9.4 today … add on roadmap, analyse how to implement each the best way, and work progressively"). Each was analysed read-only against main a8a62bda (9.3.11), using 48 h of server logs. Tracks are numbered in build order: reliability first, then member-visible work, then the larger features.

Decisions the owner still has to take are marked **Decide:** below.

## T1 — Timeouts and sync health (bot plus companion) — first

Evidence, from 48 h of logs:
- Uploads:
  - p50 9.4 s, p95 18.4 s, max 33 s, against the Worker's 20 s cut-off.
  - The slowest phases are `guild-check` (3.2 s average, 12.8 s max), `lanes` (2.5 s), `auto-apply` (1.6 s) and `link-uploader` (1.1 s).
  - There are 0 P2028 and 0 P2034 errors.
- The standings rebuild goes over its 10 s budget about once an hour.
- There were 19 restarts in 48 h. Each one causes a retry herd, for example 503s at 17 Nov 15:01.
- Of 9,977 runs uploaded, only 52 were new.

Build in this order:
1. **Bug: malformed realm.** 1,788 "players.N.realm: too_small" refusals. The schema requires a realm, and some carried players have none. Fix:
   - Normalise an empty realm to "-".
   - Make permanent validation failures `refused`, not `retry`. The companion currently resends for 3 days.
   - Find the source: carried players in `Dungeon.lua` `p=` parsing.

   Effort S.
2. **Diagnosable failures.** Log a reason for `import-apply ok=0` and for refused relayed runs. Effort S.
3. **Companion retries.** Add jitter, honour Retry-After on a 503, and add an explicit upload timeout of about 18 s. Needs a companion release. Effort S.
4. **Parallel queries.** Parallelise the upload phases (`link-uploader`, `verified-links`, `preview`) and bundle the standings queries. Effort M.
5. **Answer first, work after.** Reply as soon as the upload is stored. `auto-apply` and `record` then run in the background, confirmed through the existing receipts. Effort M-L.
6. **Delta uploads.** The receipt returns known and duplicate run refs, so the companion and addon stop resending. Also cut the addon's duplicate relays: 87% of relayed runs are duplicates, so this needs an addon release. Effort M.
7. **Deploy discipline.** Batch deploys and warm the standings for every guild before taking traffic. Effort S.

## T2 — Companion auto-update (verified) — upgrades

What was verified, by reading the code end to end:
- The installer is checked by size and SHA-256 from the feed.
- It installs only while idle with WoW closed, after at most 2 attempts with a backoff.
- The Store build never self-installs.
- The feed and the repo agree at 9.3.11.
- The fleet goes from 9.3.8 to 9.3.11. The rollout is slow by design.

Upgrades:
- **Release signing:** sign `releases.json` with an offline ed25519 key whose public key is shipped in the app. Biggest risk today: whoever controls the site controls the hash. Effort M. **Decide:** key custody, meaning where the owner keeps the private key.
- **Staged rollout:** a percentage in `releases.json`, by device-key hash. Effort S.
- **Visible failures:** show "update failed, retrying at …" in the window. Effort S.
- **Hash header:** serve `x-sha256` on downloads. Effort S.
- **Rollback:** keep the previous installer for one-click rollback. Effort M.
- **Smaller updates:** delta updates. Effort L, later.

## T3 — Clear, short Discord messages

- **Messages:** rewrite the 15 worst messages, EN and FR:
  - the version notice;
  - the approval welcome;
  - `pair.verify` and `pair.optional`;
  - `onboard.chat.guide` and `dmlink.none`;
  - the world PvP description and the shared footer;
  - the daily recap footer;
  - the Lite idle notice;
  - the weekly lines;
  - the profession footer;
  - `/craft who` empty (no French today).
- **Shared footer:** one constant, reused everywhere.
- **Limits:** `/setup` text only gets shorter (4000-character limit). FR entries go in `i18n-fr.ts`.
- Effort M.
- **Decide:**
  - Link the version notice to the website changelog?
  - Make the approval welcome one language?
  - Move the PvP rank rules to `/help`?

## T4 — Recap ("bilan") card and repeated information

Today the posts are:
- the daily recap (card);
- the weekly report (card plus text sections);
- the weekly records (card, opt-in);
- the world PvP weekly (card);
- the private "My weekly recap", which has no card.

All four public posts go to `bilan-hebdo-wow` on Tuesdays. Dungeon records appear 3 times: the run card, the weekly report, and the weekly records.

Plan:
- A card for the personal recap.
- Fold the weekly cores into the card, or give dungeons a second card.
- Keep records in one place only.

Effort M. **Decide:**
- Which post is the missing "bilan" card?
- Remove Records and First completions from the weekly report text?
- Merge the weekly records post into the weekly report?

## T5 — World PvP everywhere

- **Discord:** it exists, as a panel on the BG ladder plus a weekly card. The panel is silently missing when `bgStatsChannelId` is not set.
  - Add a `/setup` warning.
  - Add a world PvP line to the daily recap and weekly report.
  - Check the live setting.
- **Website:** it exists (the hub card, `/leaderboards/pvp/`, player and guild panels). Add:
  - a full guild table (kills, deaths, K/D, defends, helped);
  - an 8-week trend;
  - an explanation when it's empty instead of the panel vanishing;
  - a `/me` mini card.
- Effort S-M. **Decide:**
  - Defends and helped shown publicly?
  - An 8-week trend?
  - A guild-vs-guild ranking?

## T6 — Recipes by category in Discord

Today:
- one flat alphabetical list per profession, cut at about 3,900 characters;
- the Details menu is capped at 25 recipes.

Plan:
- A pure `recipe-categories.ts` (`categoryOf`), using the cached item slot and type, plus name rules:
  - Enchant <slot>;
  - Potions, Elixirs, Flasks and Transmutes;
  - Weapons, Armor by slot, Trade goods;
  - Other as the fallback.
- One section or embed per category.
- A two-step Details menu, category then recipe.

Effort M-L. **Decide:** sections in one post per profession, or one thread per category?

## T7 — In-game crafting window (addon)

Inspired by retail Crafting Orders, CraftSim, TSM and Skillet. Forever has no crafting-order API, so this stays guild-chat based and combat-safe.

Three sub-tabs:
- **Request:**
  - recipe tree by profession;
  - Favourites and Recent;
  - a "crafter online" filter;
  - a detail pane with reagent `have/need`, "I bring materials / crafter provides", a tip hint, and a recipient (anyone, online, named).
- **My requests:** status chips (Sent, Seen, Claimed by X, Done) and Mark received.
- **Craft for the guild:**
  - a shopping list across claimed orders;
  - a craft queue with "N craftable now";
  - a whisper/invite through the secure pattern.

Build first:
1. Status chips plus favourites (S).
2. The tree and online filter (M).
3. The materials toggle plus shopping list (M), then the queue (M).

**Decide:**
- Go ahead with the three sub-tabs?
- Add a "materials provided" field to the Discord request?
- Keep the tip as text only?

## T8 — My Guilded: manage characters (website)

Today `/me` lists characters read-only. Everything else is Discord-only (`/character list` panel).

Plan:
- **A (S/M): read-only table.** Columns: in-game guild and rank (from `GuildRosterEntry`), linked Discord server, trust, and an armory link.
- **B (M): Make main and Unlink.**
  - CSRF and the own-account check on every id.
  - Shared code with the Discord panel (`setMainCharacter`).
  - `markMemberChanged` so nicknames and roles follow.
  - Audit log entries (new AuditAction values, hand-written migration).
  - An officer-log line.
- **C (L): move a character to another Discord server.**
  - Only between the member's own server memberships.
  - Only when the in-game guild matches.
  - Conflicts go to the existing queue.
  - Ship after B has run in production.

**Decide:**
- Ship A plus B first?
- Server change by the member, or by officers only?
- Show reported (unconfirmed) characters?

## T9 — Armory profile on the website

Findings:
- Blizzard's armory refuses embedding (`X-Frame-Options: SAMEORIGIN`). Our own CSP forbids frames too.
- Forever character media is not in the public API yet (profile namespace 404; see `docs/plans/BATTLENET_FOREVER_PROFILES.md`).
- Scraping or hotlinking armory images is not allowed.

Now:
- A "character card" with our own class art, race, level, guild and rank, and a "View on the Blizzard armory" button.
- Show the member-uploaded character pictures (`/me/pictures`).

Later, when `scripts/probe-forever-profile-api.ts` says OPEN: `character-media` renders, cached, with attribution.

Effort S now. **Decide:** may member-uploaded pictures show on the public player page by default?

## T10 — Guild blacklist (do-not-invite)

What exists:
- `DoNotInvite` plus `/mod dni`, which warns officers on a Discord application or join.
- No expiry, no alts, no in-game surface.

Design:
- **Who adds:** officers only.
- **New fields:**
  - kind (kicked, left badly, scammer, other);
  - `expiresAt` (default 1 year, or forever);
  - evidence;
  - status (active, appealed, cleared);
  - an alias group for alts, filled from known links.
- **Departures:** a prompt when the roster shows someone left ("Add to do-not-invite?"). Never automatic. Probe whether Forever's system chat distinguishes kicked from left.
- **In-game:** an officer-only warning in the addon's Invite and To invite panels, with names only and no reason, sent to officers' clients only.
- **Privacy:** never public; a purge job and an audit log; appeals through Discord.

Effort M. **Decide:**
- 1-year default?
- Prompt on departure?
- In-game warning for officers only?
- Appeals?
- Shared across the guilds of one server?

## T11 — Ads (AdSense and AdMob)

Live today:
- `ads.txt` and the consent banner on guildedwow.com and kcaron.top.
- `GUILDED_ADS=on`.
- Ads load only after the consent choice. Decline means non-personalised ads.

Recommended:
- **Website:** yes (done; browser-verify rendering, and check the AdSense site list and payments).
- **Addon and Discord bot:** no (Blizzard's add-on policy and Discord's rules).
- **Windows companion:** no.
- **Android apps:** AdMob (not AdSense), rewarded ads only, with UMP consent, a Data safety update and `app-ads.txt`.
- **Before any app ads:** the Play trader status must switch from "not a trader". That's owner-only and needs public contact details.

**Decide:**
- No ads in the addon, bot and companion?
- Rewarded ads only in the apps?
- When to switch trader status?
- Same setup for Goldline?

## T12 — Guilded and Guilded Dungeons sync review

- **Comm queue (token bucket, caps):** sound.
- **Carry copy:** generated by `dungeons:sync`.
- **Upload outcomes:** 87 of 93 imports OK.
- **The real waste:**
  - duplicate runs (T1.6);
  - the malformed-realm retry loop (T1.1).
- **Still to read in depth:** LedgerSync and the carry handover. Do it while T1 is built.

## Order of work

1. **Bot-only, ships with a deploy:**
   - T1.1, T1.2 and T1.4;
   - T3;
   - T5 (Discord check plus web);
   - T8A;
   - T9 card.
2. **Client release 9.4.0:**
   - T1.3 and T1.6 (companion and addon);
   - T2 staged rollout and visible failures;
   - T7 first steps;
   - the Layer sidebar button (#1114, merged).
3. **After the owner's decisions:**
   - T4, T6 and T8B;
   - T10 and T11;
   - T2 signing.
4. **Later:** T8C, T9 API renders and T2 delta updates.
