import { describe, expect, it } from "vitest";
import { createWclClient, parseGuildRef } from "../src/integrations/warcraftlogs.js";
import { buildDetails, compareAttendance, formatOfficerCheck, isFlaskBuff, isFoodBuff } from "../src/services/wcl-analysis.js";
import { matchRaid } from "../src/services/wcl-check.js";

const BASE = "https://www.warcraftlogs.com";

// Answers like the real API (shapes taken from a live report).
function fakeFetch(handlers: (query: string, variables: Record<string, unknown>) => unknown) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    return new Response(JSON.stringify({ data: handlers(body.query, body.variables) }), { status: 200 });
  }) as typeof fetch;
}
const creds = { clientId: "id", clientSecret: "secret" };

describe("guild references", () => {
  it("reads an id, a guild page by id and a guild page by name", () => {
    expect(parseGuildRef("12345", BASE)).toEqual({ id: 12345, baseUrl: BASE });
    expect(parseGuildRef("https://classic.warcraftlogs.com/guild/id/777", BASE)).toEqual({ id: 777, baseUrl: "https://classic.warcraftlogs.com" });
    expect(parseGuildRef("https://www.warcraftlogs.com/guild/us/thrall/quebec%20gold", BASE))
      .toEqual({ name: "quebec gold", serverSlug: "thrall", serverRegion: "US", baseUrl: BASE });
  });
  it("refuses other hosts and links without a guild", () => {
    expect(() => parseGuildRef("https://evil.example/guild/id/1", BASE)).toThrow(/warcraftlogs\.com/);
    expect(() => parseGuildRef("https://www.warcraftlogs.com/reports/abc", BASE)).toThrow(/guild/);
    expect(() => parseGuildRef("nonsense", BASE)).toThrow();
  });
});

describe("Warcraft Logs client additions", () => {
  it("lists a guild's reports", async () => {
    const client = createWclClient(creds, fakeFetch((query) => {
      expect(query).toContain("reports(guildID");
      return { reportData: { reports: { data: [{ code: "abcDEF123456", title: "MC", startTime: 1, endTime: 2, zone: { name: "Molten Core" } }, { code: "zzz", title: "x", startTime: 3, endTime: 4, zone: null }] } } };
    }));
    const rows = await client.listGuildReports(BASE, 55, 10);
    expect(rows).toEqual([
      { code: "abcDEF123456", title: "MC", startTime: 1, endTime: 2, zone: "Molten Core" },
      { code: "zzz", title: "x", startTime: 3, endTime: 4, zone: null }
    ]);
  });

  it("finds a guild, and says so when there is none", async () => {
    const ok = createWclClient(creds, fakeFetch(() => ({ guildData: { guild: { id: 9, name: "Guilded", server: { name: "Thrall" } } } })));
    expect(await ok.findGuild({ id: 9, baseUrl: BASE })).toEqual({ id: 9, name: "Guilded", server: "Thrall" });
    const none = createWclClient(creds, fakeFetch(() => ({ guildData: { guild: null } })));
    await expect(none.findGuild({ id: 1, baseUrl: BASE })).rejects.toThrow(/no guild/);
  });

  it("reads buffs at each pull and the deaths", async () => {
    const client = createWclClient(creds, fakeFetch((query) => query.includes("CombatantInfo")
      ? { reportData: { report: { events: { data: [
        { type: "combatantinfo", fight: 1, sourceID: 3, auras: [{ name: "Flask of Tempered Swiftness" }, { name: "Well Fed" }, { name: "Arcane Intellect" }] },
        { type: "combatantinfo", fight: 1, sourceID: 4, auras: [] },
        { type: "other", sourceID: 5 }
      ], nextPageTimestamp: null } } } }
      : { reportData: { report: { table: { data: { entries: [{ name: "Finch", fight: 1, timestamp: 5 }, { name: "Finch", fight: 2 }] } } } } }));
    const details = await client.fetchDetails({ code: "abcDEF123456", baseUrl: BASE }, [1, 2]);
    expect(details.combatants).toEqual([
      { fight: 1, actorId: 3, auras: ["Flask of Tempered Swiftness", "Well Fed", "Arcane Intellect"] },
      { fight: 1, actorId: 4, auras: [] }
    ]);
    expect(details.deaths).toEqual([{ fight: 1, name: "Finch" }, { fight: 2, name: "Finch" }]);
  });

  it("asks for nothing when there are no boss pulls", async () => {
    const client = createWclClient(creds, fakeFetch(() => { throw new Error("should not call"); }));
    expect(await client.fetchDetails({ code: "abcDEF123456", baseUrl: BASE }, [])).toEqual({ combatants: [], deaths: [] });
  });
});

describe("consumable buffs", () => {
  it("recognizes flasks, phials, elixirs and food, not other buffs", () => {
    for (const name of ["Flask of the Titans", "Phial of Tepid Versatility", "Elixir of the Mongoose"]) expect(isFlaskBuff(name)).toBe(true);
    for (const name of ["Well Fed", "Hearty Well Fed"]) expect(isFoodBuff(name)).toBe(true);
    for (const name of ["Arcane Intellect", "Power Word: Fortitude"]) { expect(isFlaskBuff(name)).toBe(false); expect(isFoodBuff(name)).toBe(false); }
  });
});

describe("details from a log", () => {
  const report = { actors: [{ id: 3, name: "Lebowsski", className: "Shaman" }, { id: 4, name: "Finch", className: "Warrior" }] };
  it("counts pulls with a flask and food, and deaths, per player", () => {
    const details = buildDetails(report, {
      combatants: [
        { fight: 1, actorId: 3, auras: ["Flask of X", "Well Fed"] }, { fight: 2, actorId: 3, auras: ["Flask of X"] },
        { fight: 1, actorId: 4, auras: [] }, { fight: 2, actorId: 4, auras: ["Well Fed"] },
        { fight: 2, actorId: 99, auras: [] } // not a known player: ignored
      ],
      deaths: [{ fight: 1, name: "Finch" }, { fight: 2, name: "Finch" }]
    });
    expect(details.pulls).toBe(2);
    expect(details.players).toEqual([
      { name: "Finch", pulls: 2, flaskPulls: 0, foodPulls: 1, deaths: 2 },
      { name: "Lebowsski", pulls: 2, flaskPulls: 2, foodPulls: 1, deaths: 0 }
    ]);
  });
});

describe("attendance against the log", () => {
  const characters = [
    { name: "Amy", realm: "R", memberId: "m1", memberName: "Amy#1" },
    { name: "Bob", realm: "R", memberId: "m2", memberName: "Bob" },
    { name: "Cy", realm: "R", memberId: "m3", memberName: "Cy" },
    { name: "Dee", realm: "R", memberId: "m4", memberName: "Dee" }
  ];
  const attendance = [
    { memberId: "m1", memberName: "Amy#1", status: "PRESENT" },
    { memberId: "m3", memberName: "Cy", status: "PRESENT" },
    { memberId: "m4", memberName: "Dee", status: "BENCHED" },
    { memberId: "m2", memberName: "Bob", status: "ABSENT" }
  ];
  it("finds who is in the log but not credited, credited but missing, unlinked, and unpaid EP", () => {
    const check = compareAttendance({ logPlayers: ["Amy", "Bob", "Pugguy"], characters, attendance, epPaidMemberIds: new Set() });
    expect(check.inLogNotPresent).toEqual(["Bob (marked absent)"]);
    expect(check.presentNotInLog).toEqual(["Cy"]); // the bench player Dee may be absent from the log
    expect(check.unlinked).toEqual(["Pugguy"]);
    expect(check.epMissing).toBe(true);
    expect(check.presentCount).toBe(3);
  });
  it("is clean when everything matches and EP was paid", () => {
    const check = compareAttendance({ logPlayers: ["Amy", "Cy"], characters, attendance, epPaidMemberIds: new Set(["m1"]) });
    expect(check.inLogNotPresent).toEqual([]);
    expect(check.presentNotInLog).toEqual([]);
    expect(check.epMissing).toBe(false);
  });
  it("writes a short officer text", () => {
    const check = compareAttendance({ logPlayers: ["Amy", "Bob"], characters, attendance, epPaidMemberIds: new Set() });
    const text = formatOfficerCheck({
      title: "MC night", attendance: check,
      details: { pulls: 3, players: [{ name: "Amy", pulls: 3, flaskPulls: 3, foodPulls: 2, deaths: 0 }, { name: "Bob", pulls: 3, flaskPulls: 1, foodPulls: 3, deaths: 2 }] }
    });
    expect(text).toContain("In the log, not credited: Bob (marked absent)");
    expect(text).toContain("Missing a flask: Bob (1/3)");
    expect(text).toContain("Missing food: Amy (2/3)");
    expect(text).toContain("Deaths in boss fights:** Bob (2)");
    expect(text.length).toBeLessThanOrEqual(1900);
  });
  it("says so when the log is not linked to a raid", () => {
    expect(formatOfficerCheck({ title: "x", attendance: null, details: null })).toContain("Not linked to a raid");
  });
});

describe("matching a log to a raid", () => {
  const h = 3_600_000;
  const day = Date.UTC(2026, 9, 1, 0, 0, 0);
  const raid = (id: string, at: number, started?: number, ended?: number) => ({ id, title: id, scheduledAt: new Date(at), startedAt: started ? new Date(started) : null, endedAt: ended ? new Date(ended) : null });
  it("prefers the raid whose recorded time overlaps the log", () => {
    const raids = [raid("tuesday", day + 1 * h), raid("wednesday", day + 24 * h, day + 24 * h, day + 27 * h)];
    expect(matchRaid(raids, { startTime: day + 24.5 * h, endTime: day + 26.5 * h })?.id).toBe("wednesday");
  });
  it("uses the scheduled time when the raid was never started in the bot", () => {
    expect(matchRaid([raid("a", day), raid("b", day + 48 * h)], { startTime: day + 1 * h, endTime: day + 3 * h })?.id).toBe("a");
  });
  it("finds nothing when no raid is near", () => {
    expect(matchRaid([raid("a", day)], { startTime: day + 30 * h, endTime: day + 32 * h })).toBeNull();
  });
});
