# Card artwork slots (13 November 2026)

`src/services/card-backdrop.ts` draws approved paintings behind Discord/website cards. No file, no change: a card without an
approved picture is drawn exactly as before. Analysis and the full slot proposal: the card-art analysis note of 13 Nov.

**Where files go:** `site/card-art/<kind>/<key>.jpg` (or `.png`). One painting per slot, 1200x630 (2400x1260 is fine, it is
downsized), JPEG under about 400 KB. Subject on the right, the left 45 % calm and dark (the text sits there), no text, no logos,
nothing recognisable from another studio. The owner approves each piece before the file is added.

**How it is used:** ladders and the roster card take a 1200x176 band out of the painting for their header (faded into the card);
two-column cards (raid end, battleground end, Hall of Fame) use it whole under the left column. The loader darkens it and checks
that muted card text keeps 4.5:1 contrast where text is drawn.

**Wired slots:** `board/duel`, `board/battlegrounds`, `board/world-pvp`, `board/crafters`, `board/race-to-60`,
`board/dungeon-season`, `board/activity`, `board/hall-of-fame`, `battleground/<map slug>` (alterac-valley, warsong-gulch,
arathi-basin, eye-of-the-storm, strand-of-the-ancients, isle-of-conquest; `battleground/default` is the fallback), `raid/default`,
`roster/default`. Dungeon paintings stay in `site/dungeon-art/` (dungeon-backdrop.ts).

**When new art shows:** a missing file is remembered for 10 minutes, and a card already drawn is kept in the rendered-PNG cache, so a picture added while the bot runs can take up to 10 minutes (or a restart) to appear. Art ships with the bot deploy (`site/` files are read from disk by the bot).

**Memory:** only finished JPEGs are cached, limited to 4 MB of bytes; pictures are prepared one at a time; absent files are
remembered for 10 minutes so no disk reads happen per render.
