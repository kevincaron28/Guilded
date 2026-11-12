# Item links in profession posts and Details (7 November 2026)

Owner request: "Analyse how the Wowhead bot and other bots do it", then show crafted items better in the profession
posts and the gallery. This note says what those bots do, what we take from it in spirit (never their text, art or
tooltip images) and what was built.

## How other bots show items

- **Wowhead's own Discord bot** (wowhead.com/discord-bot): a `/tooltip` command (aliases `/tt`, `/search`) searches
  Wowhead and answers with a picture of Wowhead's tooltip for the best match plus a link to the database page.
  `/setup` picks the site (Classic, Retail…) and language per server or channel. It answers a command; it does not
  watch chat for item links, and it does not post a stats embed: the tooltip is a rendered image of Wowhead's own page.
- **Community bots** (for example the archived ClassicBot on GitHub, and similar "item lookup" bots): a command with an
  item name, a search of a database (Wowhead, a scraped copy, or Blizzard's API), and a Discord embed: title = item
  name coloured or linked, embed colour = quality colour, thumbnail = item icon, description = slot/type, armour or
  damage, stats, item level and required level, and a link to a database page. Several guess the first search result.
- **Common traits worth copying in spirit:** quality colour on the embed's side bar, the icon as a small thumbnail, one
  link to a full page, a short stats block, and quiet failure when the item is unknown.
- **What we do not copy:** Wowhead's tooltip pictures or text (their content), scraped databases, and guessing the first
  search result. Our data comes only from Blizzard's Game Data API (`src/services/blizzard-items.ts`), and a name with
  several items is shown without data.

## Icons

The Game Data media endpoint returns `https://render.worldofwarcraft.com/...` icon URLs. Blizzard's current developer
terms were not found word for word; third-party guidance recommends caching media rather than hotlinking the CDN.
Decision for now:

- **Discord embeds keep the icon thumbnail** (Details answers and chat previews, as in PR #497). Discord fetches the
  image once through its own media proxy and serves it from there, so members' clients never load Blizzard's CDN.
- **The website shows no icon.** The site's Content-Security-Policy allows only its own images, and serving Blizzard's
  icons from our own domain would mean storing copies; not done until the terms are confirmed.
- Pages and embeds that show Blizzard data say so ("Item data: Blizzard").

If the owner or Blizzard says otherwise, removing the thumbnail is one line in `src/services/item-preview-embed.ts`.

## What was built

- **Profession posts stay one line per recipe.** A crafted item's name is now a link to its Wowhead classic page and
  starts with a quality square (⬛ Poor, ⬜ Common, 🟩 Uncommon, 🟦 Rare, 🟪 Epic, 🟧 Legendary) when the item data
  source knows it, otherwise the usual bullet. Enchants (spells, negative keys) stay plain. No stats in the post.
  Qualities are looked up when the post is refreshed (`addItemQuality`, cached 24 h, rate-limited in the provider).
- **Details (Discord, private):** title = item name (French on French boards), side colour = quality, icon thumbnail,
  link to Wowhead classic, one summary line (slot, type, armour or damage, up to 6 stats, item level, required level),
  the crafters, and "Item data: Blizzard" in the footer when data was found.
- **Gallery Details (website):** quality colour, the summary line, the Wowhead link and "Item data: Blizzard"; no icon.
- Without Battle.net credentials everything falls back to the previous display (bullets, no quality, no stats).

## Chat preview identity and layout (12 November 2026)

The chat preview is posted through a webhook the bot creates (`item-preview-webhook.ts`). Every post now sets the sender
itself: `username` "Guilded Items" / "Objets Guilded" (server language) and `avatar_url` = the Guilded logo served by the
site (`/brand/logo-400.png` on `PUBLIC_SITE_URL`; no avatar override when that is unset). Layout (`item-preview-embed.ts`):
quality, slot, type; armour or damage; stats; effects; binding; then Item level, Requires and Sells for as small fields;
footer "Guilded Items · Item id · Data: Blizzard". Empty fields are omitted. Source/drop is not in Blizzard's item data.
