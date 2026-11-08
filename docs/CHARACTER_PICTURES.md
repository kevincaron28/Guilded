# Character pictures (9.1)

A member picks a picture for each linked character; cards and profile pages show it. Built in three stacked pull requests: slice 1 (storage and upload), slice 2 (cards), slice 3 (profiles and reports). Plan and owner decisions: [plans/CHARACTER_VISUALS.md](plans/CHARACTER_VISUALS.md). Owner decisions (7 November 2026):
- pictures are guild-only unless the member chooses Public;
- officers can switch pictures off for the server;
- members may upload any image they own, with officer removal and reports;
- a removed picture cannot be pulled out of cards already posted.

## Slice 1: storage and upload

- **Table** `CharacterPicture` (migration `20270121000000_character_pictures`): one row per character with two re-encoded WebP copies (`large`, at most 512 px on the long edge; `thumb`, a 128 px square cropped on the interesting part), `version`, `visibility` (`guild` | `public`), `status` (`ok` | `removed`), and `removedById` / `removedAt` for an officer removal. The row goes with the character (`onDelete: Cascade`), so **Delete my data**, unlinking and relinking remove it.
- **Server switch** `GuildSettings.characterPicturesEnabled`, on by default (ROADMAP rule 5). Off hides every picture in that server (pages answer 404, cards will fall back) and blocks uploads; stored pictures are kept for when it is turned back on.
- **Upload page** `/me/pictures/` (linked from My page):
  - lists the member's own characters in guilds whose membership is verified (`guildDashboardAccess`, member level);
  - per character: pick a file, choose who sees it, and confirm "my own image, shows my character, not a real person"; change who sees it; remove.
  - The browser shrinks the file to 1280 px JPEG before sending (one inline script, allowed by a `sha256` hash in that page's CSP only), so the form stays under the Worker's 1 MB body cap (`webFormLimit("/me/pictures/upload")`). No Worker change was needed.
- **Checks on the bot** (`processPicture` in `src/services/character-picture.ts`):
  - the type comes from the bytes (JPEG, PNG or WebP only; SVG and GIF are refused);
  - at most 750 KB decoded and 4096 px a side, with sharp's pixel limit against decompression bombs;
  - the first frame only;
  - orientation applied, then re-encoded, so EXIF, GPS and anything hidden in the file are dropped;
  - at most 5 new pictures a day per member (kept in memory, so the count restarts with the bot).
- **Serving** `GET /players/pictures/<characterId>/<version>.webp` and `<version>-thumb.webp`:
  - a public picture goes to anyone;
  - a guild picture goes only to a signed-in member of that guild (membership answers cached 5 minutes);
  - a removed picture, a switched-off server or an old version answers 404.
  - The version in the address changes with every new picture, so caches never show an old one. The Worker forwards `/players/...` already.
- **Officers**: `/officer character picture action:remove name:<character>` removes a picture (bytes cleared, who and when kept, logged in the bot log channel). `action:off` / `action:on` is the server switch.
- **Privacy notice**: `docs/PRIVACY.md` (EN/FR) lists pictures.

## Slice 2: pictures on cards

`withCardPictures` (`src/services/card-pictures.ts`) runs when a queued Discord message draws its card (`discord-jobs.ts`), after `withDiscordMember`. Nothing is added to the stored card definition.
- **Dungeon completion card**: each guild party member's thumb is drawn in place of the role disc, ringed in the role colour, with a small role badge on its corner.
  - The card definition now carries each guild member's addon name (`DungeonCardMember.character`). Delivery matches it, or the full name shown, to the guild's characters that have a picture.
  - Two characters answering to one name show neither. Outsiders never get one.
- **Achievement unlocked card** (`cardMember`): the member's picture (their main first, else the newest) replaces the Discord avatar in the header circle; without one the avatar stays.
- Order for a picture slot: character picture, then Discord avatar, then the plain role disc (or no portrait).
- **Cards post in the guild's own Discord**, so guild-only and public pictures both show there. With the server switch off, or a removed picture, nothing changes; any failure draws the card as before.
- Samples: `docs/cards/dungeon-card-pictures.png` and `achievement-card-picture.png`, from `npx tsx scripts/render-picture-cards.ts`. Their pictures are generated stand-ins, not real characters.

Not built:
- the roster card's per-row thumbs (the plan marks them optional);
- the generated emblem fallback (plan item 3).

## Slice 3: profile pages and reports

- **Player profile** `/players/<account>` and the "Your player profile" block on `/me/`:
  - a picture block under the name, using the main character's picture first, else the first character with one;
  - a 32 px thumb beside each character in the list.
- **Who sees which picture** (`visibleTo` in `player-profiles.ts`): public pictures go to everyone; guild pictures only to that guild's signed-in members (the same cached check as the image route) and to the owner. The image route enforces the same rule, so a copied address shows nothing to others.
- **Report this picture** (signed-in viewers, not on their own picture): a form posting to `/players/pictures/report`.
  - The post is checked like every website form (origin and CSRF token), and only for a picture the reporter can currently see. At most 10 reports a day per member.
  - The guild's officer log gets "X reported the picture of Y (member). To remove it: `/officer character picture action:remove name:Y`" (EN/FR, no pings).

## Extras: pictures on open pages

Pages that look the same for every viewer, and links pasted into Discord, use **Public pictures only**. Guild-only pictures stay on the profile page, where each viewer is checked. `src/services/public-pictures.ts` does the lookups, and a picture shows only when:
- its status is ok and its owner set it to Public;
- the server switch is on and the site serves that server;
- it is the only character with that name and realm. If two different characters share them, neither picture shows.

Where the pictures appear:
- **`/players/` search cards:** a 40 px thumb beside the character's name. The lookup is two queries for the whole page and reads no image bytes.
- **Leaderboard character page** `/leaderboards/character/<Name-Realm>`: a 64 px thumb beside the name, and the picture on that page's share card (`card.png`).
- **Profile share image** (`/players/<account>/achievements.png`): the main character's Public picture, in a gold ring beside the name ([sample](cards/achievements-share-picture.png)). The member's own `/me/achievements.png` may also use their guild-only picture, since only they can open it.
- **Score cards:** the default card layout (`render` in `score-card.ts`) now draws `portrait` the same way the unlock cards do.

Not built yet:
- the addon photo mode (slice 4, which needs a real-client check).

The plan's "previous picture kept 30 days for undo" was left out: replacing a picture deletes the old one, which is simpler to explain and keeps nothing the member removed.
