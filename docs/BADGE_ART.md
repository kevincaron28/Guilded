# Badge art (9.3)

Achievement badges are painted pictures: a **tier frame** (6) plus an **emblem** (a family's, or an achievement's own), composed by code. The
old code-drawn SVG badge (`src/services/achievement-badges.ts`) stays as the fallback wherever a picture is missing, so nothing can break.

**Approved by the owner on 13 November 2026:** style A (painted metal medallion), the six tier frames and the first batch of nine family emblems.
No badges in the addon (owner decision). Badges are for Discord cards, the website and the apps.

## Sources (outside the repository, 1254 x 1254 PNG on flat magenta #FF00FF)

`C:\Users\Kev\Desktop\Guilded-Art\badge-rework\set-A\`
- `frames\` `bronze.png`, `silver.png`, `gold.png`, `platinum.png`, `epic.png`, `legendary.png`
- `emblems\` `dungeons-gate.png`, `raids-banner.png`, `duels-blades.png`, `pvp-helm.png`, `professions-anvil.png`, `levelling-axe.png`,
  `guild-horn.png`, `seasons-laurel.png`, `ingame-star.png`

Only the processed assets are committed: `site/badge-art/frames/<tier>-<size>.webp` and `site/badge-art/emblems/<emblem>-<size>.webp`,
sizes 256 (the Discord hero badge) and 128 (list rows, the website's 56-64 px badges at 2x, the mobile album). Transparent WebP, trimmed and
centred in a square; 82 files (6 tiers + 35 emblems, two sizes), about 1.25 MB in all (largest file under 30 KB).

## Build and check

```
node scripts/build-badge-art.mjs --source "C:\Users\Kev\Desktop\Guilded-Art\badge-rework\set-A"     # cut out, trim, write site/badge-art
node scripts/build-badge-art.mjs --check                                                          # the CI check (also in tests/badge-art.test.ts)
```

The cut-out unmixes the background instead of thresholding it: connected magenta regions go fully transparent, and within two pixels of them
the colour is recovered from `pixel = subject * (1 - f) + magenta * f`, so the dark painted outline keeps its colour and there is no pink fringe.
A purple frame or a pink gem inside the picture is never touched. The check fails on a missing file, a wrong size, an opaque corner, magenta along
the edge, a file over 60 KB or a total over 1.5 MB.

## How a badge is drawn

- **Mapping** (`src/services/badge-art.ts`): every catalogue metric belongs to a family (dungeons, raids, duels, pvp, professions, levelling,
  guild, seasons, ingame); the generated WoW Forever in-game achievements pick a family from their name and description (the old keyword rules),
  else `ingame`. The tier frame comes from the achievement's tier.
- **Emblem:** `ITEM_EMBLEMS` lists the finer emblems of the brief by achievement id (`dungeons-torch`, `raids-horn`, ...). A name with no file is
  ignored, so every badge keeps its family emblem until the file exists.
- **Composition:** `composeBadge()` puts the emblem (60 % of the side, centred) on the frame, adds rank pips for a step of a long progression and, for
  a locked badge, desaturates and darkens the result. Composed once per (emblem, tier, state, rank, size) and cached (2 MB).
- **Discord cards:** `badgeIcon()` returns a small token (`<badge-art .../>`) that is stored in the card definition; `scoreCardPng()` swaps it for
  the picture when the card is drawn. Cards queued before this change still carry the SVG and draw as before. Card layouts are unchanged.
- **Website:** `badgeImg()` layers two `<img>` (frame, emblem) with width and height, lazy loading and the achievement's name and tier as the
  emblem's alt text (English and French); locked is CSS (`grayscale`, darker). `scripts/build-site.mjs` copies `site/badge-art` to the site build.
- **Mobile app:** the badge album (`GET /api/v1/companion/achievements`) now returns each card's `emblem`; the app layers the site's frame and
  emblem images and keeps the plain medal when a card has no emblem or a picture does not load.
- **Companion app:** shows no achievements list today, so it gets no badges. A list would go on its Home view, reusing the same two images.

## Adding the next emblems

Approved pictures from the second batch: put the PNGs under the source `emblems\` folder, then

```
node scripts/build-badge-art.mjs --source <folder> --only emblems --emblem dungeons-torch --emblem raids-horn
```

Name them as in `ITEM_EMBLEMS` (or add the name there). Nothing else changes: the website, the cards and the app pick them up by file name.
