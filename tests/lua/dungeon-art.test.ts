import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { newLuaSession, type LuaSession } from "./harness.js";
import { paintedKey } from "../../src/services/dungeon-card.js";
import { encodeBlp, encodeTga, renderRgb } from "../../scripts/build-dungeon-textures.mjs";

let s: LuaSession | undefined;
afterEach(() => s?.close());

const botKeys = readdirSync(new URL("../../site/dungeon-art/", import.meta.url)).filter((f) => f.endsWith(".jpg")).map((f) => f.slice(0, -4)).sort();
const mediaDir = (addon: string) => new URL(`../../addon/${addon}/Media/Dungeons/`, import.meta.url);
const lua = (code: string) => { s ??= newLuaSession(); return s.run(code); };
function artSession(): LuaSession {
  s = newLuaSession();
  s.run('ROOT={settings={},dungeon={runs={}}}; NS={getDb=function() return ROOT end}');
  s.load("Modules/DungeonArt.lua");
  return s;
}
const luaKey = (name: string) => lua(`return tostring(NS.dungeonArt.keyFor(${JSON.stringify(name)}))`);

// English and French client names, every wing, and names with no painting.
const NAMES = [
  "Alcaz Prison", "The Stockade", "Stormwind Stockade", "La Prison de Hurlevent", "Le Goulet", "Wailing Caverns", "Grottes des Lamentations",
  "The Deadmines", "Les Mortemines", "Shadowfang Keep", "Donjon d'Ombrecroc", "Blackfathom Deeps", "Profondeurs de Brassenoire", "Gnomeregan",
  "Razorfen Kraul", "Souilles de Tranchebauge", "Razorfen Downs", "Ragefire Chasm", "Gouffre de Ragefeu", "Uldaman", "Zul'Farrak", "Maraudon",
  "Temple of Atal'Hakkar (Sunken Temple)", "Le Temple d'Atal'Hakkar", "Blackrock Depths", "Profondeurs de Rochenoire", "Lower Blackrock Spire",
  "Upper Blackrock Spire", "Pic Rochenoire inférieur", "Pic Rochenoire supérieur", "Blackrock Spire", "Dire Maul: East", "Dire Maul: West", "Dire Maul: North",
  "Hache-Tripes : Nord", "Hache-Tripes : Ouest", "Hache-Tripes", "Scholomance", "Stratholme: Main Gate", "Stratholme: Service Gate", "Stratholme",
  "Scarlet Monastery: Graveyard", "Scarlet Monastery: Library", "Scarlet Monastery: Cathedral", "Scarlet Monastery: Armory", "Scarlet Monastery",
  "Monastère écarlate : Bibliothèque", "Monastère écarlate : Cathédrale", "Monastère écarlate : Armurerie", "Monastère Écarlate",
  "The Drowned City", "La Cité noyée", "Shaper's Terrace", "Terrasse des façonneurs", "Krol'dok Stronghold", "Blackmaw Hold", "The Hall of Thanes",
  "Ruins of Lordaeron", "Excavation Site: Wetlands", "City of Dalaran", "Somewhere Nobody Charted", "Molten Core", "Dungeon", ""
];

describe("dungeon card artwork (addon table)", () => {
  it("picks the same painting as the bot for every name (English and French), including no painting at all", () => {
    artSession();
    for (const name of NAMES) expect(luaKey(name), name).toBe(paintedKey(name) ?? "nil");
  });

  it("covers exactly the bot's paintings, and every key has a texture in both addons", () => {
    artSession();
    const keys = lua("return table.concat(NS.dungeonArt.keys(), ',')").split(",").sort();
    expect(keys).toEqual(botKeys);
    for (const addon of ["Guilded", "GuildedDungeons"]) {
      const files = readdirSync(mediaDir(addon)).filter((f) => f.endsWith(".blp")).map((f) => f.slice(0, -4)).sort();
      expect(files, addon).toEqual(botKeys);
    }
  });

  it("ships valid power-of-two DXT1 BLP2 files whose two copies are identical", () => {
    for (const key of botKeys) {
      const a = readFileSync(new URL(`${key}.blp`, mediaDir("Guilded")));
      expect(a.subarray(0, 4).toString(), key).toBe("BLP2");
      expect([a[8], a[9], a[10], a[11]], key).toEqual([2, 0, 0, 1]);   // DXT, no alpha, DXT1, mips
      const w = a.readUInt32LE(12), h = a.readUInt32LE(16);
      expect([w, h], key).toEqual([256, 128]);
      let end = 0;
      for (let i = 0; i < 16; i++) {
        const off = a.readUInt32LE(20 + i * 4), size = a.readUInt32LE(84 + i * 4);
        if (!off) continue;
        const mw = Math.max(4, w >> i), mh = Math.max(4, h >> i);
        expect(size, `${key} mip ${i}`).toBe((mw / 4) * (mh / 4) * 8);
        end = Math.max(end, off + size);
      }
      expect(end, key).toBe(a.length);
      expect(a.equals(readFileSync(new URL(`${key}.blp`, mediaDir("GuildedDungeons")))), key).toBe(true);
    }
  });

  it("the pipeline's TGA and BLP writers agree on size for a small image", async () => {
    const rgb = await renderRgb("deadmines", 64, 32);
    expect(rgb.length).toBe(64 * 32 * 3);
    expect(encodeTga(rgb, 64, 32).length).toBe(18 + 64 * 32 * 3);
    expect(encodeBlp(rgb, 64, 32).subarray(0, 4).toString()).toBe("BLP2");
  }, 30_000);

  it("falls back to the plain card: no painting for the dungeon, or the setting is off", () => {
    artSession();
    expect(lua('return tostring(NS.dungeonArt.path("Scarlet Monastery: Armory"))')).toBe("nil");
    expect(lua('return tostring(NS.dungeonArt.path("Somewhere Nobody Charted"))')).toBe("nil");
    expect(lua('return tostring(NS.dungeonArt.path(nil))')).toBe("nil");
    expect(lua('return NS.dungeonArt.path("Wailing Caverns")')).toContain("Media\\Dungeons\\wailing-caverns");
    expect(lua("return tostring(NS.dungeonArt.enabled())")).toBe("true");
    lua("NS.dungeonArt.setEnabled(false)");
    expect(lua("return tostring(ROOT.settings.cardArt)")).toBe("false");
    expect(lua("return tostring(NS.dungeonArt.enabled())")).toBe("false");
    lua("NS.dungeonArt.setEnabled(true)");
    expect(lua("return tostring(NS.dungeonArt.enabled())")).toBe("true");
  });

  it("the result card shows the painting behind the stats, hides it without one, and respects the setting", () => {
    artSession();
    s!.run(`local original = CreateFrame
      CreateFrame = function(...)
        local frame = original(...)
        local quiet = function() return setmetatable({GetStringHeight=function() return 100 end}, {__index=function() return function() end end}) end
        frame.CreateFontString = quiet; frame.CreateTexture = quiet
        return frame
      end`);
    s!.load("Modules/RunResults.lua");
    const show = (name: string) => lua(`NS.runResults.show({id="r",name=${JSON.stringify(name)},state="COMPLETED",durationSec=900,players={}}); return tostring(NS.runResults.artPath)`);
    expect(show("Wailing Caverns")).toContain("wailing-caverns");
    expect(show("Scarlet Monastery: Armory")).toBe("nil");
    lua("NS.dungeonArt.setEnabled(false)");
    expect(show("Wailing Caverns")).toBe("nil");
  });

  it("is loaded by both addons and the standalone zip step knows the media", () => {
    expect(readFileSync(new URL("../../addon/Guilded/Guilded.toc", import.meta.url), "utf8")).toMatch(/Modules\\DungeonArt\.lua\r?\n\s*Modules\\RunResults\.lua/);
    expect(readFileSync(new URL("../../addon/GuildedDungeons/GuildedDungeons.toc", import.meta.url), "utf8")).toMatch(/Shared\\DungeonArt\.lua\r?\n\s*Shared\\RunResults\.lua/);
    expect(existsSync(new URL("../../addon/GuildedDungeons/Shared/DungeonArt.lua", import.meta.url))).toBe(true);
  });
});
