import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanRunCards, mergeRunCards, parseRunCards, runCardsToAddLua, runCardsToLua } from "../companion/run-cards.mjs";
import { deviceReceiptsToLua, mergeDeviceReceipts, parseDeviceReceipts, standaloneReceiptsToLua, writeDeviceReceipts } from "../companion/device-receipts.mjs";
import { standingsToLua } from "../companion/standings-format.mjs";

const players = [
  { n: "Aldric Stormvale", l: 24, g: "Québec \"Gold\"", a: 36, t: 412 }, { n: "Brenna", l: 23, g: "Québec Gold", a: 0, t: 388 },
  { n: "Cedric", l: 24 }, { n: "Dara", l: 22, a: 12, t: 57 }, { n: "Edric" }, { n: "Sixth Player", l: 20 }
];
const cards = { "QG-1": players };

describe("run cards for the in-game result card (9.3.5)", () => {
  it("caps players and runs and drops malformed rows", () => {
    expect(cleanRunCards(cards)["QG-1"]).toHaveLength(5);
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`r${i}`, [{ n: "X", l: 1 }]]));
    expect(Object.keys(cleanRunCards(many))).toHaveLength(30);
    expect(cleanRunCards({ a: "nope", b: [{ n: "" }, { l: 3 }], c: [{ n: "Z", a: 5 }] })).toEqual({ c: [{ n: "Z" }] });
    expect(cleanRunCards(null)).toEqual({});
  });
  it("round-trips through the Lua text", () => {
    const text = runCardsToLua(cards).join("\n");
    expect(text).toContain("GuildedDungeonCards = {");
    expect(parseRunCards(`x = 1\n${text}\ny = 2`)).toEqual(cleanRunCards(cards));
    expect(parseRunCards("nothing")).toEqual({});
  });
  it("adds to an existing table in Guilded Dungeons' file", () => {
    const lua = runCardsToAddLua(cards).join("\n");
    expect(lua).toMatch(/^GuildedDungeonCards = type\(GuildedDungeonCards\) == "table" and GuildedDungeonCards or \{\}/);
    expect(lua).toContain('GuildedDungeonCards["QG-1"] = { { n = "Aldric Stormvale", l = 24');
    expect(standaloneReceiptsToLua({ refs: ["QG-1"], cards })).toContain('GuildedDungeonCards["QG-1"]');
  });
  it("is written into the signed standings file and kept in the device file between answers", () => {
    expect(standingsToLua({ updatedAt: "2026-11-15T00:00:00Z", standings: [], acceptedRunRefs: ["QG-1"], runNotes: {}, runCards: cards } as never)).toContain('["QG-1"] = { { n = "Aldric Stormvale"');
    const first = mergeDeviceReceipts({ refs: [], notes: {} }, { acceptedRunRefs: ["QG-1"], runNotes: {}, runCards: cards });
    const file = deviceReceiptsToLua(first, "2026-11-15T00:00:00.000Z");
    const read = parseDeviceReceipts(file);
    expect(read.cards["QG-1"]).toHaveLength(5);
    // A later answer without cards (an older bot) keeps them; a newer run's cards come first.
    const second = mergeDeviceReceipts(read, { acceptedRunRefs: ["QG-2"], runNotes: {}, runCards: { "QG-2": [{ n: "New", l: 10 }] } });
    expect(Object.keys(second.cards ?? {})).toEqual(["QG-2", "QG-1"]);
    expect(mergeDeviceReceipts(read, { acceptedRunRefs: [], runNotes: {} }).cards).toEqual(read.cards);
    expect(mergeRunCards(undefined, undefined)).toEqual({});
  });
  it("rewrites the standings file when only the cards change, whatever the stamp says", () => {
    const body = { updatedAt: "2026-11-15T00:00:00Z", standings: [], acceptedRunRefs: ["QG-1"], runNotes: {} };
    const a = standingsToLua({ ...body } as never);
    const b = standingsToLua({ ...body, runCards: cards } as never);
    const bare = (text: string) => text.replace(/updatedAt = "[^"]*",/g, "");
    expect(bare(a)).not.toBe(bare(b));
  });
  it("writes only the GuildedDungeonCards global an older addon never reads", () => {
    expect(runCardsToLua({})).toEqual(["GuildedDungeonCards = {", "}"]);
  });
});

describe("writeDeviceReceipts passes the cards to the addon files", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  it("puts runCards in Standings.lua", async () => {
    dir = await mkdtemp(join(tmpdir(), "run-cards-"));
    const guilded = join(dir, "Interface", "AddOns", "Guilded");
    await mkdir(guilded, { recursive: true });
    const standings = join(guilded, "Standings.lua");
    await writeDeviceReceipts({ standingsFile: standings, dataAddon: false }, { acceptedRunRefs: ["QG-1"], runNotes: {}, runCards: cards });
    const text = await readFile(standings, "utf8");
    expect(parseRunCards(text)["QG-1"]![0]).toEqual({ n: "Aldric Stormvale", l: 24, g: 'Québec "Gold"', a: 36, t: 412 });
  });
});
