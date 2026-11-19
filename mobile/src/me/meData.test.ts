import { afterEach, describe, expect, it, vi } from "vitest";
import { GuildedClient } from "../api";
import { parseRaids } from "../publicApi";
import { raidOpenDate, raidsView } from "../stats/raidsView";
import { formatMinutes, parseMeCharacters, parsePromotion, promotionChecklist, type PromotionServer } from "./meData";

afterEach(() => vi.unstubAllGlobals());

const progress = (extra: Partial<PromotionServer> = {}): PromotionServer => ({
  serverName: "Québec Gold", guildDiscordId: "1", state: "progress", rank: null, linked: true, character: "Aria Stone", fromRank: "Initiate", minDays: 7, minLevel: null,
  requireLink: true, minVoiceMinutes: 180, voiceDays: 7, days: 3, level: 42, voiceMinutes: 60, ready: false, ...extra
});

describe("my characters data", () => {
  it("keeps server, guild rank, main and trust, and skips malformed rows", () => {
    const list = parseMeCharacters({ characters: [
      { id: "a", name: "Aria Stone", isMain: true, trust: "confirmed", level: 42, className: "Mage", race: "Human", serverName: "Québec Gold", inGuild: true, guildRank: "Initiate" },
      { id: "b", name: "Bram", isMain: false, trust: "reported", level: null, className: "Rogue", serverName: "Québec Gold", inGuild: false, guildRank: null },
      { name: "no id" }, null, 7
    ] });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "a", isMain: true, trusted: true, guildRank: "Initiate", serverName: "Québec Gold", level: 42 });
    expect(list[1]).toMatchObject({ id: "b", isMain: false, trusted: false, inGuild: false, level: null });
    expect(parseMeCharacters(null)).toEqual([]);
  });

  it("calls the member routes with the credential and the character id in the body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, characters: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GuildedClient("https://guilded.kcaron.top", "c".repeat(43));
    await client.meCharacters();
    await client.changeCharacter("main", "abc");
    await client.changeCharacter("unlink", "abc");
    await client.mePromotion();
    const calls = fetchMock.mock.calls as unknown as [URL, { method: string; headers: Record<string, string>; body?: string }][];
    expect(calls.map((c) => `${c[1].method} ${c[0].pathname}`)).toEqual(["GET /api/v1/me/characters", "POST /api/v1/me/characters/main", "POST /api/v1/me/characters/unlink", "GET /api/v1/me/promotion"]);
    expect(JSON.parse(calls[1]![1].body!)).toEqual({ character: "abc" });
    for (const c of calls) expect(c[1].headers["x-companion-credential"]).toBe("c".repeat(43));
  });

  it("turns a refusal into an error with the server's words", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "That character is not one of yours." }), { status: 403 })));
    await expect(new GuildedClient("https://guilded.kcaron.top", "c".repeat(43)).changeCharacter("unlink", "x")).rejects.toThrow("not one of yours");
  });
});

describe("promotion status", () => {
  it("parses per-server numbers", () => {
    const [server] = parsePromotion({ servers: [{ serverName: "Québec Gold", guildDiscordId: "1", state: "progress", linked: true, character: "Aria", fromRank: "Initiate", minDays: 7, minLevel: null, requireLink: true, minVoiceMinutes: 180, voiceDays: 7, days: 3, level: 42, voiceMinutes: 60, ready: false }, { nope: 1 }] });
    expect(parsePromotion({ servers: [{ nope: 1 }] })).toEqual([]);
    expect(server).toMatchObject({ days: 3, minDays: 7, voiceMinutes: 60, minVoiceMinutes: 180, state: "progress" });
  });

  it("lists what is still missing, in English and French", () => {
    const en = promotionChecklist(progress(), "en");
    expect(en.map((l) => [l.key, l.done])).toEqual([["link", true], ["days", false], ["voice", false]]);
    expect(en[1]!.value).toBe("3 / 7");
    expect(en[2]!.value).toBe("1 h / 3 h");
    const fr = promotionChecklist(progress({ days: null }), "fr");
    expect(fr[1]).toMatchObject({ label: "Jours comme Initiate", done: false });
    expect(fr[1]!.value).toContain("pas encore");
    expect(promotionChecklist(progress({ days: 8, voiceMinutes: 200, ready: true }), "en").every((l) => l.done)).toBe(true);
  });

  it("adds a level line only when the rule has one, and nothing when the rule is off or the member is already above", () => {
    expect(promotionChecklist(progress({ minLevel: 20, level: 12 }), "en").find((l) => l.key === "level")).toMatchObject({ value: "12 / 20", done: false });
    expect(promotionChecklist(progress(), "en").some((l) => l.key === "level")).toBe(false);
    expect(promotionChecklist(progress({ state: "off" }), "en")).toEqual([]);
    expect(promotionChecklist(progress({ state: "above", rank: "Raider" }), "en")).toEqual([]);
  });

  it("formats voice time", () => {
    expect([formatMinutes(0), formatMinutes(45), formatMinutes(180), formatMinutes(90)]).toEqual(["0 min", "45 min", "3 h", "1 h 30 min"]);
  });
});

describe("raid progress", () => {
  it("parses the public board and skips malformed rows", () => {
    const board = parseRaids({ opensAt: "2026-12-09T17:00:00.000Z", open: false, totalKills: 0, guilds: [{ rank: 1, name: "Quebec Gold", slug: "qg", bosses: 3, worldFirsts: 1, lastKillAt: "2026-12-10T00:00:00Z" }, { rank: 2 }],
      firsts: [{ instance: "Molten Core", boss: "Lucifron", difficulty: "Normal", guild: "Quebec Gold", killedAt: "2026-12-10T00:00:00Z" }, { boss: "x" }] });
    expect(board.guilds).toHaveLength(1);
    expect(board.firsts).toEqual([expect.objectContaining({ boss: "Lucifron", guild: "Quebec Gold" })]);
    expect(() => parseRaids(null)).toThrow();
  });

  it("shows the opens-9-December note until a kill is recorded, in both languages", () => {
    const empty = parseRaids({ opensAt: "2026-12-09T00:00:00.000Z", open: false, totalKills: 0, guilds: [], firsts: [] });
    expect(raidsView(empty)).toBe("opens");
    expect(raidOpenDate(empty.opensAt, "en")).toBe("9 December");
    expect(raidOpenDate(empty.opensAt, "fr")).toBe("9 décembre");
    expect(raidsView({ ...empty, open: true })).toBe("none");
    expect(raidsView({ ...empty, guilds: [{ rank: 1, name: "G", slug: null, bosses: 1, worldFirsts: 0, lastKillAt: null }] })).toBe("boards");
    expect(raidOpenDate(null, "en")).toBe("9 December");
  });
});
