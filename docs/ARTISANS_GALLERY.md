# Artisans' Gallery and last seen (8.5, track D)

Built on data Guilded already stores (`RecipeKnown`, `ProfessionSkill`, `ProfessionCooldown`, `CraftOffer`, `Character`); no new database.

- **Gallery page** (`/me/artisans`, signed-in members of the guild only): search an item name, item id or crafter. Each recipe lists every crafter who knows it with skill and last seen, open crafter offers and a **Request** button that creates the normal craft request (and posts it on the craft board). Crafter cards show professions, skill, rarest recipes and cooldowns that are ready. Reagent search is not possible yet: the addon reads recipe materials but they are not uploaded or stored. Item icons are not shown (the site's content policy allows no outside images and no item database is bundled); quality colour appears when an item data provider supplies it.
- **Craft forum**: one post per profession (title starts with 📚), edited in place with every recipe and its crafters. The pinned directory is now a short index linking to them. On by default; officers switch it off with `/craft posts-setting enabled:false`. While `FEATURE_PREVIEW_GUILD_IDS` is set, new posts are only created in the listed servers.
- **Last seen**: `Character.lastSeenAt`, falling back to the newest recipe scan of that character, worded "today", "2 days ago", "3 weeks ago" (`src/services/last-seen.ts`). Used by `/craft who` (recently seen crafters first), the directory, the profession posts and the gallery.
- Migration `20261224000000_artisans_gallery` adds `GuildSettings.professionPostsEnabled` (default true).

## Request, Details and profession look (8.5 batch 3)

Each item has Details; each crafter row has its own Request button, which pings that crafter once in the new request post. Profession posts carry a recipe picker (Request / Details). See `docs/PROFESSION_DISPLAY.md` for the display research and reasoning.
