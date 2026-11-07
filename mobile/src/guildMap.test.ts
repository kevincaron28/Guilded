import { afterEach, describe, expect, it, vi } from "vitest";
import { GuildedClient } from "./api";
import { attackersLine, classColor, continentTabs, heatLevel, parseGuildMap, sampleGuildMap, timeAgo } from "./guildMap";

// Track M: the guildmate map tab (last seen dots, heat map, help pins).
const body = {
  enabled: true, sharing: true, days: 28,
  mates: [
    { character: "Aldric Vane", name: "Aldric Vane", className: "Warrior", level: 42, mine: true, zone: "Elwynn Forest", mapId: 1429, x: 0.4, y: 0.6, continentId: 1415, cx: 0.45, cy: 0.71, seenAt: "2026-11-07T11:00:00.000Z" },
    { character: "Bo", zone: "Duskwood", mapId: 1431, x: 0.2, y: 0.3, continentId: 1415, cx: 3, cy: 0.5, seenAt: "2026-11-07T10:00:00.000Z" },
    { character: "Broken", zone: "?", mapId: 1, x: -1, y: 0, seenAt: "x" }
  ],
  continents: [{ id: 1415, name: "Eastern Kingdoms", cells: [[0, 0, 2], [99, 0, 1], [3, 4, 5]], max: 5, zones: [{ zone: "Elwynn Forest", cx: 0.45, cy: 0.7, count: 7 }, { zone: "bad", cx: 2, cy: 0 }] }],
  calls: [{ character: "Bo", name: "Bo", zone: "Duskwood", subzone: null, continentId: 1430, cx: 0.5, cy: 0.5, attackers: [{ name: "Thug", class: "ROGUE", level: 60 }, { class: "MAGE" }], calledAt: "2026-11-07T11:58:00.000Z", active: true, cleared: false }]
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("guild map parsing", () => {
  it("drops unreadable rows and treats an off-map point as no map position", () => {
    const map = parseGuildMap(body);
    expect(map.mates.map((m) => m.character)).toEqual(["Aldric Vane", "Bo"]);
    expect(map.mates[1]).toMatchObject({ name: "Bo", continentId: null, cx: null });
    expect(map.continents[0]!.cells).toEqual([[0, 0, 2], [3, 4, 5]]);
    expect(map.continents[0]!.zones).toHaveLength(1);
    expect(map.calls[0]!.attackers).toEqual([{ name: "Thug", class: "ROGUE", level: 60 }]);
    expect(() => parseGuildMap({ nope: true })).toThrow("not understood");
  });

  it("offers a tab for every continent with heat, a dot or a pin", () => {
    expect(continentTabs(parseGuildMap(body))).toEqual([{ id: 1415, name: "Eastern Kingdoms" }, { id: 1430, name: "Map 1430" }]);
  });

  it("formats times, attackers, heat and class colours", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    expect(timeAgo("2026-11-07T11:58:00Z", now, "en")).toBe("2 min ago");
    expect(timeAgo("2026-11-07T09:00:00Z", now, "fr")).toBe("il y a 3 h");
    expect(timeAgo("2026-11-04T12:00:00Z", now, "en")).toBe("3 d ago");
    expect(attackersLine(parseGuildMap(body).calls[0]!)).toBe("Thug (60 Rogue)");
    expect(heatLevel(4, 16)).toBe(0.5);
    expect(heatLevel(0, 16)).toBe(0);
    expect(classColor("Death Knight")).toBe("#c41e3a");
    expect(classColor(null)).toBe("#d5ad57");
  });

  it("has a sample map that parses like a real answer", () => {
    const sample = sampleGuildMap(Date.parse("2026-11-07T12:00:00Z"));
    expect(parseGuildMap(JSON.parse(JSON.stringify(sample)))).toEqual(sample);
  });
});

describe("guild map requests", () => {
  it("asks for this guild with the companion credential and posts the sharing switch", async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST" ? { ok: true, share: false, deleted: 3, map: { ...body, sharing: false } } : body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GuildedClient("https://guilded.kcaron.top", "c".repeat(40));
    expect((await client.guildMap("123456")).mates).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://guilded.kcaron.top/api/v1/companion/guild-map?guild=123456");
    expect((init?.headers as Record<string, string>)["x-companion-credential"]).toBe("c".repeat(40));
    expect((await client.setMapSharing("123456", false)).sharing).toBe(false);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({ guildDiscordId: "123456", share: false });
  });
});
