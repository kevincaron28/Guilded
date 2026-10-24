import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { scoreCardResponse } from "../src/services/score-card.js";
import { createLeaderboardPages, prismaLeaderboardStore, type LeaderboardStore, type LeaderRun } from "../src/services/public-leaderboard.js";
import { createWebApp } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-11-10T20:00:00Z");
const run: LeaderRun = { runId: "r1", instanceId: 389, dungeonName: "Ragefire <Chasm>", durationSec: 1200, endedAt: NOW, deaths: 0,
  bracket: "15-29", season: "s1", confirmations: 2, routeKey: null, difficultyId: 0,
  players: [{ character: "Kévin", realm: "Forever", className: "Warrior", role: "TANK", level: 16 }] };

function fixture() {
  let visible = true;
  const store: LeaderboardStore = { run: async id => visible && id === run.runId ? run : null, runs: async () => [run],
    characterRuns: async name => visible && name === "Kévin" ? [run] : [], guilds: async () => [], guildRuns: async () => [], guildRoster: async () => [] };
  const pages = createLeaderboardPages({ store, personal: null, now: () => NOW, cacheMs: 0 });
  const app = createWebApp({ store: memoryWebStore().store, auth: null, allows: () => true, postApplication: async () => null, routes: [pages.route], now: () => NOW });
  return { hide: () => { visible = false; }, request: (path: string, method = "GET") => {
    const url = new URL(path, "https://guilded.kcaron.top");
    return app.respond({ method, path: url.pathname, query: url.searchParams, headers: {} });
  } };
}

describe("shareable dungeon cards", () => {
  it("renders a real 1200x630 PNG with bundled font and escaped user text; changed facts change pixels", async () => {
    const card = { title: '<span foreground="red">Kévin & friends</span>', subtitle: "Saison 1 · Niveau 15–29", value: "200", detail: "20:00 · Confirmé par le groupe", footer: "Rapport communautaire" };
    const first = await scoreCardResponse(card);
    expect(first.status).toBe(200);
    expect(await sharp(first.binaryBody).metadata()).toMatchObject({ width: 1200, height: 630, format: "png" });
    expect((await scoreCardResponse(card)).binaryBody).toEqual(first.binaryBody);
    expect((await scoreCardResponse({ ...card, value: "240" })).binaryBody).not.toEqual(first.binaryBody);
  });
  it("adds image metadata and download links to public character and run pages in both languages", async () => {
    const f = fixture();
    const character = await f.request("/leaderboards/character/K%C3%A9vin-Forever?lang=fr");
    expect(character?.status).toBe(200);
    expect(character?.body).toContain('/leaderboards/character/K%C3%A9vin-Forever/card.png?lang=fr');
    expect(character?.body).toContain('content="summary_large_image"');
    expect(character?.body).toContain('/leaderboards/run/r1?lang=fr');
    const detail = await f.request("/leaderboards/run/r1");
    expect(detail?.body).toContain("Ragefire &lt;Chasm&gt;");
    expect(detail?.body).toContain("20:00");
    expect(detail?.body).toContain("older check");
    expect(detail?.body).toContain("/leaderboards/run/r1/card.png?lang=en");
    for (const path of ["/leaderboards/run/r1/card.png", "/leaderboards/character/K%C3%A9vin-Forever/card.png?lang=fr"]) {
      const png = await f.request(path);
      expect(png?.headers["content-type"]).toBe("image/png");
      expect(png?.binaryBody?.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect((await f.request(path, "HEAD"))?.binaryBody).toBeUndefined();
    }
    f.hide();
    expect((await f.request("/leaderboards/run/r1/card.png"))?.status).toBe(404);
    expect((await f.request("/leaderboards/run/r1/card.png", "HEAD"))?.status).toBe(404);
    expect((await f.request("/leaderboards/character/K%C3%A9vin-Forever/card.png"))?.status).toBe(404);
  });
  it("returns no image for unknown routes and uses the unrated label instead of a fabricated score", async () => {
    const f = fixture();
    expect((await f.request("/leaderboards/run/missing/card.png"))?.status).toBe(404);
    expect((await f.request("/leaderboards/character/Nobody/card.png"))?.status).toBe(404);
    const old = run.instanceId;
    try {
      run.instanceId = 999999;
      expect((await f.request("/leaderboards/run/r1"))?.body).toContain("Unrated");
    } finally { run.instanceId = old; }
  });
  it("queries only accepted public data for a direct run URL", async () => {
    const findFirst = vi.fn(async () => null);
    expect(await prismaLeaderboardStore({ publicRun: { findFirst } } as never).run!("rejected")).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "rejected", status: "ACCEPTED" } }));
  });
});
