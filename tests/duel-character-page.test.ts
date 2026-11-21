/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory stand-ins for the few Prisma calls the store makes */
import { describe, expect, it, onTestFinished } from "vitest";
import { seasonOf, RATING_START } from "../src/services/duel-rating.js";
import { resetSeasonCalendar, setSeasonCalendar } from "../src/services/season-calendar.js";
import type { GlobalDuel } from "../src/services/duel-global.js";
import { createLeaderboardPages, prismaLeaderboardStore, type LeaderboardStore } from "../src/services/public-leaderboard.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

// A player with duels but no dungeon run: page and search agree, a bare first name never opens a "First Last" page,
// the same full name on two realms asks which one, and only current-season, counted, visible duels count.

const side = (full: string, realm: string) => ({ key: `${full.toLowerCase()}-${realm.toLowerCase()}`, name: full, realm });
function duel(w: ReturnType<typeof side>, l: ReturnType<typeof side>, iso: string): GlobalDuel {
  return { winnerKey: w.key, loserKey: l.key, winner: w.name, loser: l.name, winnerRealm: w.realm, loserRealm: l.realm, winnerClass: "Mage", loserClass: "Rogue", winnerLevel: 60, loserLevel: 60,
    winnerGuild: null, loserGuild: null, endedAt: new Date(iso), reason: "knockout", zone: null, durationSec: 30, reporters: [w.key], confirmed: false };
}
function appFor(globalDuelRows: () => Promise<GlobalDuel[]>, nowIso: string) {
  const store: LeaderboardStore = { async runs() { return []; }, async characterRuns() { return []; }, async guilds() { return []; }, async guildRuns() { return []; }, async guildRoster() { return []; }, async guildStats() { return []; }, globalDuelRows };
  const pages = createLeaderboardPages({ store, personal: null, now: () => new Date(nowIso) });
  const app = createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guildedwow.com", sessionSecret: "s".repeat(40) }, allows: () => true, postApplication: async () => null, routes: [pages.route], now: () => new Date(nowIso), fetch: fetch });
  return (path: string) => { const url = new URL(path, "https://guildedwow.com"); return app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: {} }) as Promise<WebResponse>; };
}
const NOW = "2026-12-10T12:00:00Z";

describe("duel-only players on the web", () => {
  const brenna = side("Brenna Stormrage", "Kronos"), aldric = side("Aldric Stone", "Kronos");

  it("needs the full name: a bare first name opens nothing, the full name does", async () => {
    const get = appFor(async () => [duel(brenna, aldric, "2026-12-05T10:00:00Z")], NOW);
    expect((await get("/leaderboards/character/Brenna")).status).toBe(404);
    expect((await get("/leaderboards/character/Brenna%20Stormrage-Kronos")).status).toBe(200);
    expect((await get("/leaderboards/character/Brenna%20Stormrage")).status).toBe(200);
  });

  it("asks which realm when the same full name exists on two", async () => {
    const twin = side("Brenna Stormrage", "Mirage");
    const get = appFor(async () => [duel(brenna, aldric, "2026-12-05T10:00:00Z"), duel(twin, aldric, "2026-12-06T10:00:00Z")], NOW);
    const chooser = await get("/leaderboards/character/Brenna%20Stormrage");
    expect(chooser.status).toBe(200);
    expect(chooser.body).toContain("Brenna%20Stormrage-Kronos");
    expect(chooser.body).toContain("Brenna%20Stormrage-Mirage");
    expect(chooser.body).toContain("Which character?");
    const one = await get("/leaderboards/character/Brenna%20Stormrage-Mirage");
    expect(one.status).toBe(200);
    expect(one.body).not.toContain("Which character?");
    expect(one.body).toContain("All duels of this player");
  });

  it("lists in search only players whose page exists: a past-season duelist gets neither", async () => {
    setSeasonCalendar([{ number: 2, startsAt: new Date("2026-12-09T23:00:00Z") }]);
    onTestFinished(resetSeasonCalendar);
    const lastSeason = "2026-11-20T10:00:00Z", later = "2027-01-20T12:00:00Z";
    expect(seasonOf(new Date(lastSeason), RATING_START).id).not.toBe(seasonOf(new Date(later), RATING_START).id);
    const get = appFor(async () => [duel(brenna, aldric, lastSeason)], later);
    expect((await get("/leaderboards/character/Brenna%20Stormrage-Kronos")).status).toBe(404);
    expect((await get("/leaderboards/?q=stormrage")).body).not.toContain("Brenna%20Stormrage");
    const current = appFor(async () => [duel(brenna, aldric, "2027-01-18T10:00:00Z")], later);
    expect((await current("/leaderboards/?q=stormrage")).body).toContain("Brenna%20Stormrage");
    expect((await current("/leaderboards/character/Brenna%20Stormrage-Kronos")).status).toBe(200);
  });

  it("a held, uncounted or hidden-member duel gives neither a page nor a search hit", async () => {
    const base = (over: any) => ({ held: false, counted: true, winnerKey: brenna.key, loserKey: aldric.key, winnerName: brenna.name, loserName: aldric.name, winnerRealm: "Kronos", loserRealm: "Kronos",
      winnerClass: "Mage", loserClass: "Rogue", winnerLevel: 60, loserLevel: 60, winnerGuild: null, loserGuild: null, winnerMemberId: null, loserMemberId: null,
      endedAt: new Date("2026-12-05T10:00:00Z"), reason: "knockout", zone: null, durationSec: 30, reports: [{ reporterCharacterKey: brenna.key, deviceId: null, guildId: null }], ...over });
    const rows = [base({ held: true }), base({ counted: false }), base({ winnerMemberId: "m-hidden" })];
    const database: any = {
      publicDuel: { findMany: async ({ where }: any) => rows.filter((r) => (where.counted === undefined || r.counted === where.counted) && (where.held === undefined || r.held === where.held)) },
      publicDuelExclusion: { findMany: async () => [] },
      guildSettings: { findMany: async () => [] },
      member: { findMany: async () => [{ id: "m-hidden" }] }
    };
    const get = appFor(() => prismaLeaderboardStore(database).globalDuelRows!(), NOW);
    expect((await get("/leaderboards/character/Brenna%20Stormrage-Kronos")).status).toBe(404);
    expect((await get("/leaderboards/?q=stormrage")).body).not.toContain("Brenna%20Stormrage");
    // The same duel, counted and visible, does show.
    const visible = appFor(() => prismaLeaderboardStore({ ...database, publicDuel: { findMany: async () => [base({})] } }).globalDuelRows!(), NOW);
    expect((await visible("/leaderboards/character/Brenna%20Stormrage-Kronos")).status).toBe(200);
  });
});
