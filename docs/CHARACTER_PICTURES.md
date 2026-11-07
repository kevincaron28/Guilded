# Character pictures (9.1)

A member picks a picture for each linked character; cards and profile pages show it. Plan and owner decisions: [plans/CHARACTER_VISUALS.md](plans/CHARACTER_VISUALS.md). Owner decisions (7 November 2026):
- pictures are guild-only unless the member chooses Public;
- officers can switch pictures off for the server;
- members may upload any image they own, with officer removal and reports;
- a removed picture cannot be pulled out of cards already posted.

## Slice 1: storage and upload (this change)

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

Not in slice 1:
- cards (slice 2: `withMemberPicture` in front of the Discord avatar, in `score-card.ts`);
- profile pages and the "Report picture" link (slice 3);
- the addon photo mode (slice 4, which needs a real-client check).

The plan's "previous picture kept 30 days for undo" was left out: replacing a picture deletes the old one, which is simpler to explain and keeps nothing the member removed.
