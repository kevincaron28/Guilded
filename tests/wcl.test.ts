import { describe, expect, it, vi } from "vitest";
import { createWclClient, parseReportRef, type WclReport } from "../src/integrations/warcraftlogs.js";
import { summarizeReport } from "../src/services/wcl.js";

const DEFAULT = "https://www.warcraftlogs.com";

describe("Warcraft Logs report references", () => {
  it("reads the code and site from a link", () => {
    expect(parseReportRef("https://classic.warcraftlogs.com/reports/aB3dE5gH7jK9mN1p#fight=3", DEFAULT))
      .toEqual({ code: "aB3dE5gH7jK9mN1p", baseUrl: "https://classic.warcraftlogs.com" });
  });

  it("accepts a bare code and uses the default site", () => {
    expect(parseReportRef("aB3dE5gH7jK9mN1p", "https://www.warcraftlogs.com/"))
      .toEqual({ code: "aB3dE5gH7jK9mN1p", baseUrl: DEFAULT });
  });

  it("refuses other hosts so credentials never leave warcraftlogs.com", () => {
    expect(() => parseReportRef("https://evil.example/reports/aB3dE5gH7jK9mN1p", DEFAULT)).toThrow(/warcraftlogs\.com/);
    expect(() => parseReportRef("https://warcraftlogs.com.evil.example/reports/aB3dE5gH7jK9mN1p", DEFAULT)).toThrow(/warcraftlogs\.com/);
    expect(() => parseReportRef("http://www.warcraftlogs.com/reports/aB3dE5gH7jK9mN1p", DEFAULT)).toThrow();
    expect(() => parseReportRef("not a link", DEFAULT)).toThrow(/report link/);
  });
});

describe("Warcraft Logs report summary", () => {
  const report: WclReport = {
    code: "abc", title: "MC night", startTime: 0, endTime: 2 * 3_600_000 + 5 * 60_000, owner: { name: "Kev" }, zone: { name: "Molten Core" },
    fights: [
      { id: 1, name: "Trash", encounterID: 0, kill: null, startTime: 0, endTime: 1000 },
      { id: 2, name: "Lucifron", encounterID: 663, kill: false, startTime: 0, endTime: 60_000 },
      { id: 3, name: "Lucifron", encounterID: 663, kill: true, startTime: 0, endTime: 125_000 },
      { id: 4, name: "Magmadar", encounterID: 664, kill: false, startTime: 0, endTime: 30_000 }
    ],
    players: [{ name: "Bob", className: "Warrior" }]
  };

  it("counts kills and wipes per boss and ignores trash", () => {
    const summary = summarizeReport(report);
    expect(summary.durationMinutes).toBe(125);
    expect(summary.bossesKilled).toBe(1);
    expect(summary.totalWipes).toBe(2);
    expect(summary.bosses).toEqual([
      { name: "Lucifron", kills: 1, wipes: 1, bestKillSec: 125 },
      { name: "Magmadar", kills: 0, wipes: 1, bestKillSec: null }
    ]);
  });
});

describe("Warcraft Logs client", () => {
  it("logs in once, then queries the report", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ data: { reportData: { report: {
        code: "abc", title: "MC night", startTime: 1, endTime: 2, owner: { name: "Kev" }, zone: { name: "Molten Core" },
        fights: [], masterData: { actors: [{ name: "Bob", subType: "Warrior" }] }
      } } } }), { status: 200 });
    });
    const client = createWclClient({ clientId: "id", clientSecret: "secret" }, fetchMock as never);
    const ref = { code: "abc", baseUrl: DEFAULT };
    const first = await client.fetchReport(ref);
    await client.fetchReport(ref);
    expect(first.players).toEqual([{ name: "Bob", className: "Warrior" }]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/oauth/token"))).toHaveLength(1);
  });

  it("explains bad credentials and missing reports", async () => {
    const bad = createWclClient({ clientId: "id", clientSecret: "x" }, (async () => new Response("no", { status: 401 })) as never);
    await expect(bad.fetchReport({ code: "abc", baseUrl: DEFAULT })).rejects.toThrow(/WCL_CLIENT_ID/);
    const missing = createWclClient({ clientId: "id", clientSecret: "x" }, (async (url: string | URL | Request) =>
      String(url).endsWith("/oauth/token")
        ? new Response(JSON.stringify({ access_token: "t" }), { status: 200 })
        : new Response(JSON.stringify({ data: { reportData: { report: null } } }), { status: 200 })) as never);
    await expect(missing.fetchReport({ code: "abc", baseUrl: DEFAULT })).rejects.toThrow(/no report/);
  });
});
