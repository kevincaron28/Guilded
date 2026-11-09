# Discord-only WoW item previews (off until step 0 passes, not yet tested live)

## Step 0 in one command (8.5)

`/guilded-previews test channel:#chat-guilde` (bot owner, home server). The bot creates a TEMPORARY webhook in that
channel, posts one test embed through the same code path production uses, and deletes the webhook again. Then look at
the channel (the embed must be there) and at WoW guild chat (it must NOT be there) and press one button:

- **Seen in Discord only: turn previews on** - the bot creates its own permanent webhook (no URL is typed or shown),
  stores only the encrypted URL and turns previews on for that server. Needs `ITEM_PREVIEW_SECRET`,
  `MESSAGE_CONTENT_INTENT=true` and the bot's Manage Webhooks in the channel.
- **It showed in WoW chat: keep off** - nothing is stored.

Either button deletes the test post. While `FEATURE_PREVIEW_GUILD_IDS` is set, previews also act only in those servers.

## Profession posts and the gallery

Profession posts keep one compact line per recipe. Under each post a **Details** menu (first 25 recipes) answers
privately with the full preview: quality and item id, a Wowhead link for verified item ids (none for enchants), and every
crafter with last seen. On the Artisans' Gallery page each recipe is one line (name, crafters, best skill, offers) that
opens with **Details** to the crafter table and the request form.

Implements the offline-safe part of the ROADMAP item "WoW-linked Discord item previews". Blizzard's
own relay is untouched. **Nothing here has run against Discord or a WoW client.** The feature is inert
until an owner enables it for a server.

## What is built

- `src/services/item-links.ts`: scans text (no regex over the message; caps: 2000 chars scanned, 5 items,
  60-char names) for raw links `|Hitem:id:enchant:...:suffix:...|h[Name]|h` (verified numeric id, enchant,
  random suffix, quality colour) and bracket-only `[Name]` (name only, **unverified**). De-duplicated.
- `src/services/item-preview-data.ts`: `ItemDataProvider` interface with a **null default**, a TTL cache
  (never looks up by name alone), and a per-channel rate limit (6/min) plus a 2-minute duplicate window.
- `src/services/blizzard-items.ts`: the live provider (see "Item data source" below).
- `src/services/item-preview-embed.ts`: compact embed; name sanitised (mentions, markdown, control
  characters); Wowhead classic URL only from a verified numeric id; `allowed_mentions: {parse: []}`.
- `src/services/item-preview-webhook.ts`: posts with `wait=true`; 401/404 disables the server's
  previews, 429 honours retry-after (per-server back-off), results never contain the URL or token.
- `src/services/secret-box.ts` (AES-256-GCM, no earlier helper existed) keyed by new env
  `ITEM_PREVIEW_SECRET` (32+ chars). The webhook URL is stored only as ciphertext in the new
  `ItemPreviewConfig` table (migration `20261213000000_item_preview_config`).
- `src/services/item-preview.ts` + a `MessageCreate` handler in `src/main.ts`, registered only when
  `MESSAGE_CONTENT_INTENT=true`, honouring `hostedPilot.allows`. It ignores the bot itself and the
  preview webhook itself. **Other bots/webhooks are deliberately not skipped**: the Blizzard relay is
  probably one, and skipping it would defeat the feature. The preview webhook's id is stored for the
  loop check.
- Owner-only `/guilded-previews enable|disable|delete|status` (home server only, like
  `/guilded-season`; the `/setup` and `/config` size limit is untouched).

## What is NOT verified / not built

- Seen in Québec Gold's #chat-guilde (audit of 1,636 messages, 5-8 November 2026): the Forever relay keeps only
  `[Name]` text, never `|Hitem:` links. Names are matched through the Blizzard item search (exactly one exact name,
  "matched by its exact name", with stats and an item link). A name nobody matched is "Unverified" and its title
  links to a Wowhead **search** for that name, never an invented id. Lookups give up after 4 seconds so a slow
  Battle.net never holds a preview back. The addon's own `[Guilded] Help! ...` lines are not items.
- Whether a webhook can post in the Blizzard-linked channel and whether the post echoes into WoW.
- Item data has not yet been seen in a live preview or Details answer (the API calls below were checked on the
  server on 7 November 2026, the Discord side was not).

## Item data source (Blizzard Game Data API, decided 7 November 2026)

`src/services/blizzard-items.ts`, shared as one instance by `src/item-data.ts` (one token, one cache):

- **Credentials:** the bot's existing Battle.net app (`BATTLENET_CLIENT_ID`, `BATTLENET_CLIENT_SECRET`), with a
  client-credentials token from `https://oauth.battle.net/token` (no member account). The token is kept in memory
  until 5 minutes before it expires; a 401 renews it once. Without the two variables (tests, local dev) the provider
  is the null one and everything behaves as before. A rejected secret backs off for 5 minutes.
- **By id (verified links, profession recipes):** `GET https://us.api.blizzard.com/data/wow/item/{id}?namespace=static-forever-us`
  plus `/data/wow/media/item/{id}` for the icon. No `locale` is sent, so one answer carries English and French.
  An id Forever answers 404 for (for example 6340, 2042) is looked up in `static-classic1x-us` and marked
  "Classic Era data: WoW Forever does not list this item, so it may differ there."
- **By exact name (bracket-only links):** `/data/wow/search/item?name.en_US=...` (then `name.fr_FR`), first page of
  100. Accepted only when exactly one item id has that exact name (case-insensitive); several ids means no data,
  never a guess. Shown as "matched by its exact name".
- **Cache and limits:** memory cache per id/name (found 24 h, not found 1 h, errors 5 min, 2000 entries), concurrent
  lookups of one item share a request, calls spaced 50 ms apart and capped at 20 000 per hour (Blizzard allows 100/s
  and 36 000/h); over the cap a lookup answers nothing. Each request times out after 8 s.
- **Where it shows:** chat previews (English), profession post Details (waits at most 4 s) and the Artisans' Gallery
  Details (at most 1.5 s per page view; slower answers fill the cache for the next view). French servers get the
  French name, quality and summary. Summary = slot, type, armour or damage, up to 6 stats, item level, required level.
- The link stays Wowhead classic (`/classic/item=ID`); no Wowhead data is fetched.

## Profession links: recipe cards (owner request, 7 November 2026)

When someone links a profession in the preview channel, the same Discord-only path posts a small card:
`src/services/profession-link-card.ts` (pure parts) and `profession-link-card-live.ts` (database), wired in
`src/main.ts` as `professionCard`.

- **Recognised:** raw trade links `|Htrade:...|h[Tailoring]|h` (English or French profession name; the fields after
  `trade:` are ignored because they differ between game versions), and a name-only `[Tailoring]` / `[Couture]` only
  when it is the message's one bracket. Profession brackets are never looked up as items.
- **Who linked it:** the relay's author name (the webhook posts under the character's name), or a leading
  `Name: ` / `[Name]: ` in the text, matched against the guild's active characters by stored name, display name or
  full Forever name. A real Discord member (not the relay) is also matched through their own characters, when exactly
  one of them knows recipes for that profession. No match, two matches or no recipes: **nothing is posted**.
- **Card:** "🧵 Tailoring · First Last", skill bar and level, the number of known recipes, the 8 most notable (best
  quality first, from the item data source, up to 60 lookups with a 3 s deadline), each linked to Wowhead classic,
  "+N more", and a "Full list" link to the Artisans' Gallery searched for that character. French servers get French
  names.
- **Limits:** the same per-channel gate (6 per minute) and duplicate window (2 minutes, per character and profession)
  as items, the same webhook (`allowed_mentions` empty), nothing sent into WoW.
- **Not checked live:** what Forever's relay actually puts in Discord for a profession link (raw `|Htrade` link or
  only `[Tailoring]`) and whether the relay's author name is the character's full name. Test in #chat-guilde: link a
  profession from a character with synced recipes and from one without; expect a card only for the first.

## Owner-run live tests (do these before enabling for real)

1. **Feasibility.** With `MESSAGE_CONTENT_INTENT=true`, post an item link in WoW guild chat and check
   the Discord message in `#chat-guilde`. Temporarily log only `message.content.length` and whether it
   contains `|Hitem:` (never the text); remove afterwards. Record raw link vs bracket-only.
2. **Webhook and non-echo.** In that channel create a *temporary* webhook (Channel settings >
   Integrations). Run `/guilded-previews enable` with it, then link `[Training Sword of the Owl]`,
   a normal item, an unknown item and several items in one message, plus a rapid duplicate. Confirm the
   embed shows in Discord and **does not appear in WoW guild chat**. Also try a revoked webhook (delete
   it in Discord): the next link must turn the feature off ("webhook rejected (404)" in `status`).
   Afterwards run `/guilded-previews delete`, delete the webhook in Discord and remove the test posts.
   If the channel blocks webhooks, record the status and stop; do not work around it.

Enable needs `ITEM_PREVIEW_SECRET` set and the bot restarted. The webhook URL typed into the command is
visible to you only (ephemeral reply) but stays in your client's input history: use a temporary one.

## Rollback

`/guilded-previews disable` (instant, keeps config) or `delete` (erases the stored ciphertext), then
delete the webhook in Discord. Unsetting `MESSAGE_CONTENT_INTENT` also stops the handler.
