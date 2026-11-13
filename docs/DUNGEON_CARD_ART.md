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
