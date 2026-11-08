import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { publicPictures } from "../src/services/public-pictures.js";
import { createPlayerProfiles, type ProfileStore } from "../src/services/player-profiles.js";
import { createLeaderboardPages, type LeaderboardStore, type LeaderRun } from "../src/services/public-leaderboard.js";
import { createWebApp } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

// Character pictures on pages anyone can open: only Public pictures, only while the server switch is on,
// only for served servers, and none when a name is ambiguous.

interface Row { characterId: string; version: number; thumb: Buffer; visibility: string; status: string; updatedAt: Date;
  character: { name: string; displayName: string | null; realm: string; isMain: boolean; member: { discordUserId: string; status: string; isTest: boolean; guild: { discordId: string; settings: { characterPicturesEnabled: boolean } | null } } } }

const lower = (text: string | null) => (text ?? "").toLowerCase();
function fakeDb(rows: Row[], accounts: Array<{ id: string; discordUserId: string }> = []) {
  type Where = { status?: string; visibility?: string; character: { OR?: Array<{ name?: { equals: string }; displayName?: { equals: string } }>; realm?: { equals: string }; member: { status: string; isTest: boolean; discordUserId?: string | { in: string[] } } } };
  const matches = (row: Row, where: Where) => {
    const c = row.character, m = where.character.member;
    if (where.status && row.status !== where.status) return false;
    if (where.visibility && row.visibility !== where.visibility) return false;
    if (c.member.status !== m.status || c.member.isTest !== m.isTest) return false;
    if (typeof m.discordUserId === "string" && c.member.discordUserId !== m.discordUserId) return false;
    if (m.discordUserId && typeof m.discordUserId === "object" && !m.discordUserId.in.includes(c.member.discordUserId)) return false;
    if (where.character.realm && lower(c.realm) !== lower(where.character.realm.equals)) return false;
    if (where.character.OR && !where.character.OR.some(o => (o.name && lower(c.name) === lower(o.name.equals)) || (o.displayName && lower(c.displayName) === lower(o.displayName.equals)))) return false;
    return true;
  };
  return {
    characterPicture: { findMany: vi.fn(async ({ where }: { where: Where }) => rows.filter(row => matches(row, where)).sort((a, b) => Number(b.character.isMain) - Number(a.character.isMain))) },
    webAccount: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => accounts.filter(a => where.id.in.includes(a.id))) }
  };
}
const thumb = Buffer.from("thumb-bytes");
function row(over: Partial<Row> & { name?: string; user?: string; guild?: string; enabled?: boolean; main?: boolean } = {}): Row {
  return { characterId: over.characterId ?? "char1", version: over.version ?? 3, thumb: over.thumb ?? thumb, visibility: over.visibility ?? "public", status: over.status ?? "ok", updatedAt: new Date(0),
    character: { name: over.name ?? "Kevin", displayName: null, realm: "Forever", isMain: over.main ?? false,
      member: { discordUserId: over.user ?? "u1", status: "ACTIVE", isTest: false, guild: { discordId: over.guild ?? "g1", settings: { characterPicturesEnabled: over.enabled ?? true } } } } };
}
const allows = (id: string) => id !== "blocked";

describe("public picture lookup", () => {
  it("finds a character's Public picture by name and realm, case-insensitively", async () => {
    const lookup = publicPictures(fakeDb([row()]) as never, allows);
    expect(await lookup.byCharacter("kevin", "forever")).toEqual({ characterId: "char1", version: 3, thumb });
  });
  it("never uses a guild-only, removed, switched-off or unserved picture", async () => {
    for (const hidden of [row({ visibility: "guild" }), row({ status: "removed" }), row({ enabled: false }), row({ guild: "blocked" })]) {
      expect(await publicPictures(fakeDb([hidden]) as never, allows).byCharacter("Kevin", "Forever")).toBeNull();
    }
  });
  it("shows none when two different characters answer to the same name", async () => {
    const lookup = publicPictures(fakeDb([row(), row({ characterId: "char2", user: "u2" })]) as never, allows);
    expect(await lookup.byCharacter("Kevin", "Forever")).toBeNull();
  });
  it("picks the main character for a share image; the owner's own card may use a guild-only picture", async () => {
    const rows = [row({ characterId: "alt" }), row({ characterId: "main", main: true, visibility: "guild" })];
    const lookup = publicPictures(fakeDb(rows) as never, allows);
    expect((await lookup.byAccount("u1"))?.characterId).toBe("alt");
    expect((await lookup.byAccount("u1", true))?.characterId).toBe("main");
  });
  it("matches each search card to its account's character, and fails quietly", async () => {
    const db = fakeDb([row(), row({ characterId: "other", user: "u2", name: "Other" })], [{ id: "acc1", discordUserId: "u1" }, { id: "acc2", discordUserId: "u2" }]);
    const found = await publicPictures(db as never, allows).forCards([{ id: "acc1", character: "Kevin", realm: "Forever" }, { id: "acc2", character: "Kevin", realm: "Forever" }]);
    expect([...found]).toEqual([["acc1", { characterId: "char1", version: 3 }]]);
    db.webAccount.findMany.mockRejectedValueOnce(new Error("down"));
    expect((await publicPictures(db as never, allows).forCards([{ id: "acc1", character: "Kevin", realm: "Forever" }])).size).toBe(0);
  });
});

describe("pictures on public pages", () => {
  it("puts a thumb on the /players/ search card that has one", async () => {
    const store: ProfileStore = {
      list: async () => [{ id: "acc1", character: "Kevin", realm: "Forever", className: "Mage", role: null, level: 60, guild: "QG", sortKey: "kevin" },
        { id: "acc2", character: "Nopic", realm: "Forever", className: null, role: null, level: null, guild: null, sortKey: "nopic" }],
      get: async () => null
    };
    const profiles = createPlayerProfiles(store, undefined, undefined, { forCards: async () => new Map([["acc1", { characterId: "char1", version: 3 }]]) });
    const app = createWebApp({ store: memoryWebStore().store, auth: null, allows: () => true, postApplication: async () => null, routes: [profiles.route] });
    const page = await app.respond({ method: "GET", path: "/players/", query: new URLSearchParams(), headers: {} });
    expect(page!.body.match(/\/players\/pictures\/char1\/3-thumb\.webp/g)).toHaveLength(1);
  });
  it("shows the Public picture on the leaderboard character page and draws it on its card", async () => {
    const NOW = new Date("2026-11-10T20:00:00Z");
    const run: LeaderRun = { runId: "r1", instanceId: 389, dungeonName: "Ragefire Chasm", durationSec: 1200, endedAt: NOW, deaths: 0, bracket: "15-29", season: "s1", confirmations: 2, routeKey: null, difficultyId: 0,
      players: [{ character: "Kevin", realm: "Forever", className: "Warrior", role: "TANK", level: 16 }] };
    const store: LeaderboardStore = { run: async () => run, runs: async () => [run], characterRuns: async () => [run], guilds: async () => [], guildRuns: async () => [], guildRoster: async () => [] };
    const face = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#3366cc" } }).webp().toBuffer();
    const make = (picture?: () => Promise<{ characterId: string; version: number; thumb: Buffer } | null>) => {
      const pages = createLeaderboardPages({ store, personal: null, now: () => NOW, cacheMs: 0, ...(picture ? { picture } : {}) });
      const app = createWebApp({ store: memoryWebStore().store, auth: null, allows: () => true, postApplication: async () => null, routes: [pages.route], now: () => NOW });
      return (path: string) => app.respond({ method: "GET", path, query: new URLSearchParams(), headers: {} });
    };
    const withPicture = make(async () => ({ characterId: "char1", version: 3, thumb: face }));
    expect((await withPicture("/leaderboards/character/Kevin-Forever"))!.body).toContain("/players/pictures/char1/3-thumb.webp");
    const without = make();
    expect((await without("/leaderboards/character/Kevin-Forever"))!.body).not.toContain("/players/pictures/");
    const drawn = (await withPicture("/leaderboards/character/Kevin-Forever/card.png"))!.binaryBody;
    const plain = (await without("/leaderboards/character/Kevin-Forever/card.png"))!.binaryBody;
    expect(drawn).toBeDefined();
    expect(Buffer.compare(drawn!, plain!)).not.toBe(0);
  });
});
