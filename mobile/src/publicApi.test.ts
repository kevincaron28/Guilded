import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getJsonBounded } from "./api";
import { fetchBoards, fetchDuels, parseBoards, parseDuels, parseSeasons } from "./publicApi";

afterEach(() => (vi.unstubAllGlobals(), vi.useRealTimers()));
const answer = (body: unknown, status = 200) => vi.fn().mockImplementation(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

describe("public boards and duels", () => {
  it("reads the seasons the server lists and ignores malformed ones", () => {
    expect(parseSeasons([{ id: "s1", label: "Season 1" }, { id: "s2" }, { label: "no id" }, null, "x"])).toEqual([{ id: "s1", label: "Season 1" }, { id: "s2", label: "s2" }]);
    expect(parseSeasons(undefined)).toEqual([]);
  });
  it("keeps the season fields of the boards and works with an older server that sends none", () => {
    const boards = parseBoards({ season: "Season 1", seasonId: "season-1", seasons: [{ id: "season-1", label: "Season 1" }], brackets: [{ key: "60", name: "Level 60", characters: [], guilds: [] }] });
    expect(boards).toMatchObject({ season: "Season 1", seasonId: "season-1", seasons: [{ id: "season-1", label: "Season 1" }] });
    expect(parseBoards({ season: "S", brackets: [] })).toMatchObject({ seasonId: "", seasons: [] });
  });
  it("asks the server for the chosen season", async () => {
    const fetchMock = answer({ season: "S", brackets: [] });
    vi.stubGlobal("fetch", fetchMock);
    await fetchBoards("https://guildedwow.com", "fr", "season-1");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://guildedwow.com/leaderboards/boards.json?lang=fr&season=season-1");
    await fetchBoards("https://guildedwow.com", "en");
    expect(String(fetchMock.mock.calls[1]![0])).toBe("https://guildedwow.com/leaderboards/boards.json?lang=en");
  });
  it("reads the duel ladder and asks for a season with ?when=", async () => {
    const body = { season: "2026-12", seasons: [{ id: "2026-12", label: "December 2026" }], duels: 12, players: [
      { rank: 1, name: "Aldric", realm: "Kronos", className: "Warrior", level: 60, guild: "QG", rating: 1620, ranked: true, wins: 9, losses: 3, winRate: 0.75, streak: 2 }, { name: "" }, { rank: null, name: "Newbie", rating: 1500, ranked: false }
    ] };
    expect(parseDuels(body).players.map((p) => [p.rank, p.name, p.ranked])).toEqual([[1, "Aldric", true], [null, "Newbie", false]]);
    const fetchMock = answer(body);
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchDuels("https://guildedwow.com", "en", "2026-11"))?.duels).toBe(12);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://guildedwow.com/leaderboards/duels.json?lang=en&when=2026-11");
  });
  it("returns null while the ladder is closed (404) and throws for other failures", async () => {
    vi.stubGlobal("fetch", answer({ error: "not found" }, 404));
    expect(await fetchDuels("https://guildedwow.com", "en")).toBeNull();
    vi.stubGlobal("fetch", answer({ error: "down" }, 503));
    await expect(fetchDuels("https://guildedwow.com", "en")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("bounded public requests", () => {
  it("turns an error status or a body that is not JSON into an ApiError", async () => {
    vi.stubGlobal("fetch", answer("nope", 500));
    await expect(getJsonBounded("https://x/y.json")).rejects.toMatchObject({ status: 500 });
    vi.stubGlobal("fetch", answer("<html>", 200));
    await expect(getJsonBounded("https://x/y.json")).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal("fetch", answer({ ok: true }));
    expect(await getJsonBounded("https://x/y.json")).toEqual({ ok: true });
  });
  it("gives up on a stalled connection instead of spinning forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => { init.signal?.addEventListener("abort", () => reject(new Error("aborted"))); })));
    const pending = expect(getJsonBounded("https://x/y.json")).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(15_001);
    await pending;
  });
});
