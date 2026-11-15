# Dungeon card artwork in the addon (13 November 2026)

The result card (`Modules/RunResults.lua`) and the Run tab's "Current run" band (`Modules/DungeonScorePanel.lua`) show the
bot's painted dungeon backgrounds. Textures: `addon/Guilded/Media/Dungeons/<key>.blp` (34 files, 256x128, BLP2 DXT1 with
mips, ~22 KB each, 0.75 MB total), copied byte for byte to `addon/GuildedDungeons/Media/Dungeons/` by `npm run dungeons:sync`.

Regenerate: `node scripts/build-dungeon-textures.mjs --size 256x128` (then `npm run dungeons:sync`); `--report` prints the size
of every option; `--format tga` and `--size 512x256` also work. The mapping name -> key is `Modules/DungeonArt.lua`, mirroring
`PAINTED` in `src/services/dungeon-card.ts`; `tests/lua/dungeon-art.test.ts` fails if they drift.

## Which formats the client loads (evidence)
- BLP2 (DXT1/DXT5/palette) and TGA: certain. The addon's logo is a TGA, `DBM-Core` ships BLP2 DXT1/DXT3/DXT5 and
  `GatherLite` TGAs, `ForeverDungeonJournal` ships 36 BLP maps and 364 TGAs (WoW Forever, interface 16001).
- PNG: probable, not proven. `TradeSkillMaster` and `WIM` (both list interface 16001 in their `.toc`) call
  `SetTexture("...\\ramp_wheel.png")` with the extension, `Wow.exe` contains libpng strings. Needs a real client to confirm.
- JPG: no evidence at all (the only JPEG strings in `Wow.exe` are most likely the screenshot writer). Not used.
- Only a real client can confirm that our own BLP2 files render (the header matches the client's own DXT1 files: encoding 2,
  alpha 0, DXT1, mips, 148-byte header plus 1 KB palette block).

## Sizes (34 paintings; zipped = fflate level 9)
| Option | per file | raw | zipped |
|---|---|---|---|
| BLP DXT1 512x256 | 86 KB | 2.87 MB | 2.23 MB |
| BLP DXT1 256x128 (shipped) | 22 KB | 0.75 MB | 0.59 MB |
| TGA 24-bit 512x256 | 384 KB | 12.75 MB | 9.03 MB |
| TGA 24-bit 256x128 | 96 KB | 3.19 MB | 2.35 MB |

The Guilded zip went from 0.8 MB (85 files) to 1.42 MB (119 files); GuildedDungeons from ~0.27 MB (18 files) to 0.87 MB (52).
Alternatives if that is too much: 128x64 BLP (~0.2 MB), a shared set of ~8 mood backdrops by dungeon family, or textures in the
Guilded Dungeons addon only.

## In-game result card v2: party table (9.3.5)

The in-game card shows the same party table as the Discord run card (level, guild, score gained by this run, season total) once the bot's receipt has come back:

1. The bot stores `DungeonRunReceipt.card` (`receiptCardOf` in `src/services/dungeon-card.ts`, built from the same `playerDetails` the Discord card reads) and answers `runCards` ({ runRef: [{ n, l, g, a, t }] }, newest 30 runs, five players each) in the signed standings answer and the unsigned device answer. The field is optional: an older companion ignores it.
2. The companion (`companion/run-cards.mjs`) writes it as `GuildedDungeonCards` in Standings.lua and Guilded Dungeons' Accepted.lua, and keeps earlier cards between answers.
3. `Modules/RunResults.lua` reads `GuildedDungeonCards[run.id]`. Without an entry the card is exactly as before. The game reads those files only at login or `/reload`, so the table appears when the card is shown or reopened (`/gdg results`) after that; showing is deferred while in combat. `/guilded sim dungeon` then `/gdg results` previews the table with sample names.

## Dark cards fix (15 November 2026)

Discord run cards came out almost black for dark paintings (Deadmines, Blackfathom Deeps, Shadowfang, Wailing Caverns...): the card's left shade
(`renderDungeonCard`, 0.9 to 0.82 black) sat on top of paintings whose text column already averaged 47-66 of 255. Now `lifted()` in
`dungeon-backdrop.ts` brings the left 700 px of any painting (and of the procedural fallback) up to a mean of about 100 (gain at most 1.9, never
darker), and the shade is 0.66 to 0.52. `tests/dungeon-art-mapping.test.ts` checks that every dungeon name the bot knows maps to an existing file
and that every file is reached by a name. Scarlet Monastery: Armory still has no painting (procedural scene, lifted): a painting for it is a
follow-up (also needs `Modules/DungeonArt.lua` and a `.blp` in the addon).
