# Guilded Collection: card art proposal (option 2 of `APP_TCG.md`)

Status: **owner picked style A, "Gold and stone", on 8 November 2026**, asking for richer, WoW Forever-inspired artwork. This is art pass 2 (illustrated scenes replace the first pass's simple emblems). The nine class Champion paintings are approved and bundled (see "Approved Champion paintings" below).

All art here is original Guilded vector illustration in the guild's WoW gold theme (the same dark stone, parchment and bright-gold palette as `src/services/score-card.ts`). No Blizzard art, icons or screenshots. Class names are plain text. Regenerate the samples with `node docs/plans/app-tcg-art/make-samples.mjs`.

## The three sample cards

| Common: Warrior | Rare: Mage | Epic: Paladin |
| --- | --- | --- |
| ![Common Warrior](app-tcg-art/card-common-warrior.png) | ![Rare Mage](app-tcg-art/card-rare-mage.png) | ![Epic Paladin](app-tcg-art/card-epic-paladin.png) |

Layout (identical on every card, so a grid of 120 cards reads at a glance): name banner on top, a square-ish art window, a type line with the rarity gem, a text box (what the card does or how it was earned, then one line of flavour), and the rarity and set number in the footer.

## Rarity frames

Rarity uses the colours WoW players already read as quality, so it feels native without copying any asset:

| Rarity | Frame | Extras |
| --- | --- | --- |
| Common | grey metal | plain edge, no glow, no corner trim |
| Uncommon | green metal | thin gold inner line |
| Rare | blue | soft outer glow, gold corner brackets |
| Epic | purple | stronger glow, gold corner brackets plus a crest over the art window |
| Legendary | orange with a gold foil edge | glow, brackets, crest, and a slow shimmer on the phone (a static foil in share images) |

Rules: colour is never the only signal (the footer also says the rarity in words and the gem shape grows with rarity), so it stays readable for colour-blind members. Rarer cards add ornament, not clutter: the art window and text positions never move.

## Class cards: the art (pass 2)

Each card now has a layered scene generated in code (SVG through sharp, `make-samples.mjs`), so it scales to any phone, stays in the repo and renders the same every time. Every scene is built from the same layers: a lit sky, distant ridges, fog bands, a silhouette with rim light, atmospheric particles (embers, stars, golden motes), a painterly noise overlay, a vignette and film grain.

- **Warrior (Common)**: a setting sun over a battlefield ridge, red banners, crossed axes behind a gold-rimmed shield, a shield wall and spear tips in the foreground.
- **Mage (Rare)**: a robed figure holding a glowing arcane orb with an orbiting rune ring, a crystal-tipped staff, a crescent moon and distant towers, framed by a stone tower window in the foreground.
- **Paladin (Epic)**: an armoured figure with a crested helm, a gold cross breastplate and a raised warhammer in front of a radiant sunburst, with cape, purple clouds and a rune circle on the ground.

Original only: shapes are drawn from scratch (no Blizzard logos, icons, screenshots, character likenesses or traced art), class names are plain text, and the look follows classic fantasy conventions rather than copying anyone's trade dress. Three treatments per class are kept from the plan (9 x 3): the Common scene is warm and muted, the Rare is cooler with glow, and the Epic is gilded with rays. The same pipeline draws the other six classes later; commissioned illustration can replace any scene without changing the frame.

## Card back and pack

| Card back | Pack |
| --- | --- |
| ![Card back](app-tcg-art/card-back.png) | ![Pack](app-tcg-art/pack.png) |

- **Card back**: gold-bordered dark stone with a painted texture, a sunburst medallion ringed with runes, corner trim, drifting embers and the Guilded shield with a check. One back for everyone; the set-completion cosmetics in the plan can unlock alternate backs later.
- **Pack**: a crimped foil wrapper (zig-zag top and bottom) in a bronze-to-dark gradient with a light sheen, the same rune medallion, "Daily Pack, 5 cards". On open, the foil tears across the top, the cards fan out face down and flip one by one on tap with a "NEW" tag, as in the plan.

## Still open

1. **Class emblems versus scenes for the other six classes**: the same scene approach is planned; say if any class should look different.
2. **Names and flavour lines** are placeholders; they get French translations in the build.

## Next (after approval)

Follow `APP_TCG.md` option 2: the data tables, the server-authoritative pack, daily and dust endpoints, then the app screens in `mobile/` (after the `mobile/` restructure lands). The frame and emblem code from `make-samples.mjs` becomes the card component's SVG.

## Approved Champion paintings

**Owner approved all nine class Champion paintings on 8 November 2026.** Original art made with the owner's own tools (1448x1086 PNG, kept outside the repo); no Blizzard art. The approved set is in [`app-tcg-art/champions/`](app-tcg-art/champions/) (640x480 previews) and the app builds from `mobile/assets/clash/champions/`:

- `<class>.webp`: full picture, 640x480.
- `<class>-window.webp`: the card art window crop, 624x240 (about 2.6:1), used by Champion (class) cards in the collection and pack opening when no `artUrl` is set.
- `<class>-portrait.webp`: 192x192 square, the Champion portrait in a match.

About 1 MB for all 27 files. Regenerate with `node docs/plans/app-tcg-art/make-champions.mjs <folder with the nine PNGs>` (the per-class face focus table is in the script). The set cards (units, spells and so on) keep the class-coloured placeholder until their art is approved.

## Approved Legendary paintings

**Owner approved the "L9-WoW" set (classic online-RPG look) of nine Legendary class unit paintings on 9 November 2026**, over the L9 set. Original art made with the owner's own tools (PNG, kept outside the repo); no Blizzard art. Previews are in [`app-tcg-art/legendary/`](app-tcg-art/legendary/) and the app builds from `mobile/assets/clash/legendary/`, keyed by set 1 card id (`mobile/src/clash/legendaryArt.ts`):

| Card id | Legendary unit | Class |
| --- | --- | --- |
| 011 | Last Shield of the Vale | warrior |
| 022 | Avatar of Aegis | paladin |
| 033 | Ancient Stag-Spirit | hunter |
| 042 | Nightblade Legend | rogue |
| 054 | Resurrected Saint | priest |
| 066 | Storm Colossus | shaman |
| 077 | Archmage of the Tower | mage |
| 088 | Void Sovereign | warlock |
| 099 | Elder Tree Spirit | druid |

- `<id>.webp`: full picture, 640x480. `<id>-window.webp`: the card art window crop, 624x240, used by the card frame when the card has no `artUrl`.
- About 1 MB for all 18 files. Regenerate with `node docs/plans/app-tcg-art/make-legendaries.mjs <folder with the nine PNGs named by class>`.
- The other two Legendary units (121 The Tavern Keeper, 123 Hero of the Hollow) and the four Legendary Standards (147 to 150) have no painting yet.
