import { describe, expect, it } from "vitest";
import { createLeaderboardPages, rankCharacters, readLeaderFilters, type LeaderboardStore, type LeaderRun } from "../src/services/public-leaderboard.js";
import { exchangePersonalCode, isPersonalCode, issuePersonalCode, personalAccess, type PersonalStore } from "../src/services/personal-pairing.js";
import { createWebApp, type WebRequest, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const SITE = "https://guilded.kcaron.top";
const NOW = new Date("2026-11-10T20:00:00Z");
const player = (character: string, className: string, role: string, level = 16) => ({ character, realm: "Doomhowl", className, role, level });
const leaderRun = (id: string, durationSec: number, players = [player("Kev", "Warrior", "TANK"), player("Amy", "Priest", "HEALER")], over: Partial<LeaderRun> = {}): LeaderRun => ({
  runId: id, instanceId: 389, dungeonName: "Ragefire Chasm", durationSec, endedAt: new Date(NOW.getTime() - durationSec * 1000), deaths: 1, bracket: "15-29", season: "2026-Q4", confirmations: 1, players, ...over
});

describe("leaderboard ranking", () => {
  const runs = [leaderRun("a", 1500), leaderRun("b", 1300, [player("Kev", "Warrior", "TANK"), player("Bob", "Mage", "DPS")], { confirmations: 2 }), leaderRun("c", 1400, [player("Amy", "Priest", "HEALER")])];

  it("keeps each character's best run, fastest first", () => {
    expect(rankCharacters(runs, { className: null, role: null, confirmed: false }).map((entry) => `${entry.player.character}:${entry.run.durationSec}`)).toEqual(["Kev:1300", "Bob:1300", "Amy:1400"]);
  });

  it("filters by class, role and party confirmation", () => {
    expect(rankCharacters(runs, { className: "Priest", role: null, confirmed: false }).map((entry) => entry.player.character)).toEqual(["Amy"]);
    expect(rankCharacters(runs, { className: null, role: "TANK", confirmed: false }).map((entry) => entry.player.character)).toEqual(["Kev"]);
    expect(rankCharacters(runs, { className: null, role: null, confirmed: true }).map((entry) => entry.player.character)).toEqual(["Kev", "Bob"]);
  });

  it("reads filters, defaulting to the current season", () => {
    expect(readLeaderFilters(new URLSearchParams("dungeon=389&bracket=60&class=prêtre&role=healer"), NOW)).toEqual({ instanceId: 389, season: "2026-Q4", bracket: "60", className: "Priest", role: "HEALER", confirmed: false });
    expect(readLeaderFilters(new URLSearchParams("season=all&bracket=99&dungeon=x"), NOW)).toMatchObject({ instanceId: null, season: null, bracket: null });
  });
});

function memoryPersonalStore() {
  const pairings = new Map<string, { accountId: string; expiresAt: Date; used: boolean }>();
  const credentials: { accountId: string; tokenHash: string; revoked: boolean }[] = [];
  const store: PersonalStore = {
    async savePairing(accountId, codeHash, expiresAt) { for (const [hash, row] of pairings) if (row.accountId === accountId) pairings.delete(hash); pairings.set(codeHash, { accountId, expiresAt, used: false }); },
    async consumePairing(codeHash, now) { const row = pairings.get(codeHash); if (!row || row.used || row.expiresAt <= now) return null; row.used = true; return row.accountId; },
    async replaceCredential(accountId, tokenHash) { for (const row of credentials) if (row.accountId === accountId) row.revoked = true; credentials.push({ accountId, tokenHash, revoked: false }); },
    async credentialAccount(tokenHash) { const row = credentials.find((entry) => entry.tokenHash === tokenHash && !entry.revoked); return row ? { accountId: row.accountId, username: "kev" } : null; },
    async revokeCredentials(accountId) { for (const row of credentials) if (row.accountId === accountId) row.revoked = true; },
    async hasCredential(accountId) { return credentials.some((row) => row.accountId === accountId && !row.revoked); }
  };
  return { store, credentials };
}

describe("personal companion codes", () => {
  it("pairs once, replaces the old credential and can be revoked", async () => {
    const { store } = memoryPersonalStore();
    const { code } = await issuePersonalCode(store, "acc1", NOW);
    expect(isPersonalCode(code)).toBe(true);
    expect(isPersonalCode("A1B2C3D4E5F6")).toBe(false);
    const first = await exchangePersonalCode(store, code.toLowerCase(), NOW);
    expect(first?.companionCredential.length).toBeGreaterThanOrEqual(32);
    expect(await exchangePersonalCode(store, code, NOW)).toBeNull();
    expect(await personalAccess(store, first!.companionCredential)).toEqual({ accountId: "acc1", username: "kev" });
    const second = await exchangePersonalCode(store, (await issuePersonalCode(store, "acc1", NOW)).code, NOW);
    expect(await personalAccess(store, first!.companionCredential)).toBeNull();
    await store.revokeCredentials("acc1");
    expect(await personalAccess(store, second!.companionCredential)).toBeNull();
    const late = await issuePersonalCode(store, "acc1", NOW);
    expect(await exchangePersonalCode(store, late.code, new Date(NOW.getTime() + 16 * 60_000))).toBeNull();
  });
});

describe("leaderboard and personal pages", () => {
  function setup() {
    const runs = [leaderRun("a", 1500), leaderRun("b", 1300, [player("Kev", "Warrior", "TANK"), player("<b>Bad</b>", "Mage", "DPS")], { confirmations: 2 })];
    const store: LeaderboardStore = {
      async dungeons() { return [{ instanceId: 389, dungeonName: "Ragefire Chasm", bestSec: 1300, runs: 2 }]; },
      async runs(instanceId) { return instanceId === 389 ? runs : []; },
      async characterRuns(character) { return runs.filter((run) => run.players.some((p) => p.character.toLowerCase() === character.toLowerCase())); },
      async seasons() { return ["2026-Q4"]; }
    };
    const personal = memoryPersonalStore();
    const pages = createLeaderboardPages({ store, personal: personal.store, now: () => NOW });
    const memory = memoryWebStore();
    const app = createWebApp({
      store: memory.store, auth: { clientId: "1", clientSecret: "x", siteUrl: SITE, sessionSecret: "s".repeat(40) }, allows: () => true, postApplication: async () => null,
      routes: [pages.route], meSections: [pages.meSection], now: () => NOW,
      fetch: (async (url: string) => String(url).endsWith("/token") ? Response.json({ access_token: "t" }) : Response.json({ id: "222222222222222222", username: "kev" })) as unknown as typeof fetch
    });
    const request = (method: string, target: string, headers: WebRequest["headers"] = {}, body?: string) => {
      const url = new URL(target, SITE);
      return app.respond({ method, path: url.pathname, query: url.searchParams, headers, ...(body !== undefined ? { body } : {}) }) as Promise<WebResponse>;
    };
    return { request, personal };
  }

  it("lists dungeons, ranks a dungeon and shows a character page", async () => {
    const { request } = setup();
    const home = await request("GET", "/leaderboards/");
    expect(home.status).toBe(200);
    expect(home.body).toContain("Ragefire Chasm");
    expect(home.body).toContain("21:40");
    const dungeon = await request("GET", "/leaderboards/?dungeon=389&lang=fr");
    expect(dungeon.body).toContain("Classements des donjons");
    expect(dungeon.body.indexOf(">Kev<")).toBeLessThan(dungeon.body.indexOf(">Amy<"));
    expect(dungeon.body).not.toContain("<b>Bad</b>");
    expect(dungeon.body).toContain("✔ 2");
    const priests = await request("GET", "/leaderboards/?dungeon=389&class=Priest");
    expect(priests.body).toContain(">Amy<");
    expect(priests.body.match(/<tr><td>\d+<\/td>/g)).toHaveLength(1);
    const kev = await request("GET", "/leaderboards/character/Kev-Doomhowl");
    expect(kev.status).toBe(200);
    expect(kev.body).toContain("Best time per dungeon");
    expect((await request("GET", "/leaderboards/character/Nobody")).status).toBe(404);
  });

  it("gives a signed-in player a one-time companion code", async () => {
    const { request, personal } = setup();
    const login = await request("GET", "/auth/login");
    const state = new URL(String(login.headers["location"])).searchParams.get("state");
    const callback = await request("GET", `/auth/callback?code=c&state=${state}`, { cookie: String((login.headers["set-cookie"] as string[])[0]).split(";")[0] });
    const cookie = (callback.headers["set-cookie"] as string[]).find((c) => c.startsWith("__Host-guilded_session="))!.split(";")[0]!;
    const me = await request("GET", "/me/", { cookie });
    expect(me.body).toContain("Get a companion code");
    const csrf = /action="\/me\/pair"><input type="hidden" name="csrf" value="([^"]+)"/.exec(me.body)![1]!;
    const form = { cookie, origin: SITE, "content-type": "application/x-www-form-urlencoded" };
    expect((await request("POST", "/me/pair", { ...form, origin: "https://evil.example" }, `csrf=${csrf}`)).status).toBe(403);
    const page = await request("POST", "/me/pair", form, `csrf=${encodeURIComponent(csrf)}`);
    const code = /<p class="code">(P[0-9A-F]{11})<\/p>/.exec(page.body)![1]!;
    expect(await exchangePersonalCode(personal.store, code, NOW)).not.toBeNull();
    expect((await request("GET", "/me/", { cookie })).body).toContain("A companion is connected");
    expect((await request("POST", "/me/pair/revoke", form, `csrf=${encodeURIComponent(csrf)}`)).status).toBe(303);
    expect(personal.credentials.every((row) => row.revoked)).toBe(true);
  });
});
