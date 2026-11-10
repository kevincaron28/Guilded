import { describe, expect, it } from "vitest";
import { createLeaderboardPages, filterGuildOverview, GUILD_COUNT, guildDungeonSummary, guildOverview, pageNumbers, rankCharacters, rankGuilds, readGuildOverviewFilters, readLeaderFilters, type GuildStats, type LeaderboardStore, type LeaderRun } from "../src/services/public-leaderboard.js";
import { exchangePersonalCode, isPersonalCode, issuePersonalCode, personalAccess, type PersonalStore } from "../src/services/personal-pairing.js";
import { createWebApp, type WebRequest, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const SITE = "https://guilded.kcaron.top";
const NOW = new Date("2026-11-10T20:00:00Z");
const player = (character: string, className: string, role: string, level = 16) => ({ character, realm: "Doomhowl", className, role, level });
const leaderRun = (id: string, durationSec: number, players: LeaderRun["players"] = [player("Kev", "Warrior", "TANK"), player("Amy", "Priest", "HEALER")], over: Partial<LeaderRun> = {}): LeaderRun => ({
  runId: id, instanceId: 389, dungeonName: "Ragefire Chasm", durationSec, endedAt: new Date(NOW.getTime() - durationSec * 1000), deaths: 1, bracket: "15-29", season: "2026-Q4", confirmations: 1, routeKey: null, difficultyId: 0,
  evidence: { startedAt: new Date((over.endedAt?.getTime() ?? NOW.getTime() - durationSec * 1000) - durationSec * 1000), completedBy: "final boss", encounters: [] },
  players: players.map(p => ({ ...p, minLevel:p.level, presentSec:durationSec })), ...over
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

  it("reads filters, defaulting to the current monthly season (beta before 4 November)", () => {
    expect(readLeaderFilters(new URLSearchParams("dungeon=389&bracket=60&class=prêtre&role=healer&realm=Doomhowl"), NOW)).toEqual({ instanceId: 389, season: "s1", week: false, bracket: "60", className: "Priest", role: "HEALER", realm: "Doomhowl", confirmed: false });
    expect(readLeaderFilters(new URLSearchParams("season=all&bracket=99&dungeon=x&period=week"), NOW)).toMatchObject({ instanceId: null, season: "all", week: true, bracket: null });
    expect(readLeaderFilters(new URLSearchParams("season=2026-Q4"), new Date("2026-10-20T00:00:00Z")).season).toBe("beta");
    expect(readLeaderFilters(new URLSearchParams("season=s2"), NOW).season).toBe("s1");
  });
});

function memoryPersonalStore() {
  const pairings = new Map<string, { accountId: string; expiresAt: Date; used: boolean }>();
  const credentials: { accountId: string; tokenHash: string; revoked: boolean }[] = [];
  const store: PersonalStore = {
    async savePairing(accountId, codeHash, expiresAt) { for (const [hash, row] of pairings) if (row.accountId === accountId) pairings.delete(hash); pairings.set(codeHash, { accountId, expiresAt, used: false }); },
    async consumePairing(codeHash, now) { const row = pairings.get(codeHash); if (!row || row.used || row.expiresAt <= now) return null; row.used = true; return row.accountId; },
    async replaceCredential(accountId, tokenHash) { credentials.push({ accountId, tokenHash, revoked: false }); },
    async credentialAccount(tokenHash) { const row = credentials.find((entry) => entry.tokenHash === tokenHash && !entry.revoked); return row ? { accountId: row.accountId, username: "kev" } : null; },
    async revokeCredentials(accountId) { for (const row of credentials) if (row.accountId === accountId) row.revoked = true; },
    async hasCredential(accountId) { return credentials.some((row) => row.accountId === accountId && !row.revoked); }
  };
  return { store, credentials };
}

describe("personal companion codes", () => {
  it("pairs once, retains other devices and can be revoked", async () => {
    const { store } = memoryPersonalStore();
    const { code } = await issuePersonalCode(store, "acc1", NOW);
    expect(isPersonalCode(code)).toBe(true);
    expect(isPersonalCode("A1B2C3D4E5F6")).toBe(false);
    const first = await exchangePersonalCode(store, code.toLowerCase(), NOW);
    expect(first?.companionCredential.length).toBeGreaterThanOrEqual(32);
    expect(await exchangePersonalCode(store, code, NOW)).toBeNull();
    expect(await personalAccess(store, first!.companionCredential)).toEqual({ accountId: "acc1", username: "kev" });
    const second = await exchangePersonalCode(store, (await issuePersonalCode(store, "acc1", NOW)).code, NOW);
    expect(await personalAccess(store, first!.companionCredential)).toEqual({ accountId: "acc1", username: "kev" });
    await store.revokeCredentials("acc1");
    expect(await personalAccess(store, second!.companionCredential)).toBeNull();
    const late = await issuePersonalCode(store, "acc1", NOW);
    expect(await exchangePersonalCode(store, late.code, new Date(NOW.getTime() + 16 * 60_000))).toBeNull();
  });
});

describe("guild rankings", () => {
  it("adds up each guild's best members per bracket and leaves pickup players out", () => {
    const qg = { id: "g1", name: "Quebec Gold" }, other = { id: "g2", name: "Vanguard" };
    const shared = leaderRun("s", 1200, [player("Kev", "Warrior", "TANK"), player("Zed", "Rogue", "DPS")]);
    const ranks = rankGuilds([
      { guild: qg, runs: [shared, leaderRun("q", 1500)], roster: ["Kev", "amy"] },
      { guild: other, runs: [shared], roster: ["zed"] },
      { guild: { id: "g3", name: "Empty" }, runs: [], roster: ["nobody"] }
    ]);
    expect(ranks.map((r) => `${r.guild.name}:${r.bracket}:${r.rated}`)).toEqual(["Quebec Gold:15-29:2", "Vanguard:15-29:1"]);
    expect(ranks[0]!.best.player.character).toBe("Kev");
    expect(ranks[0]!.points).toBeGreaterThan(ranks[0]!.best.points);
    expect(ranks[1]!.best.player.character).toBe("Zed");
  });

  it("counts only the best GUILD_COUNT members", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G"];
    const runs = names.map((name, i) => leaderRun(name, 1200 + i * 60, [player(name, "Mage", "DPS")]));
    const [rank] = rankGuilds([{ guild: { id: "g", name: "Big" }, runs, roster: names }]);
    expect(rank!.rated).toBe(7);
    const single = names.map((name) => rankGuilds([{ guild: { id: name, name }, runs, roster: [name] }])[0]!.points).sort((a, b) => b - a);
    expect(rank!.points).toBe(single.slice(0, GUILD_COUNT).reduce((sum, p) => sum + p, 0));
  });
});

describe("guild leaderboard table", () => {
  const stats = (guildId: string, extra: Partial<GuildStats> = {}): GuildStats => ({ guildId, faction: null, realm: null, members: 0, linked: 0, levelled: 0, at60: 0, levelSum: 0, duels: 0, ...extra });
  it("lists every guild with its best bracket score, runs and the dungeon records its members hold", () => {
    const qg = { id: "g1", name: "Québec Gold" }, vg = { id: "g2", name: "Vanguard" }, empty = { id: "g3", name: "Empty" };
    const fast = leaderRun("fast", 1200, [player("Kev", "Warrior", "TANK")]);
    const slow = leaderRun("slow", 1500, [player("Zed", "Rogue", "DPS")]);
    const entries = [{ guild: qg, runs: [fast], roster: ["kev"] }, { guild: vg, runs: [slow], roster: ["zed"] }, { guild: empty, runs: [], roster: [] }];
    const rows = guildOverview(entries, rankGuilds(entries), [stats("g1", { faction: "ALLIANCE", realm: "Doomhowl", members: 10, at60: 2, levelled: 4, levelSum: 200 }), stats("g2", { faction: "HORDE", members: 30 })], [fast, slow]);
    expect(rows.map((r) => `${r.guild.id}:${r.points !== null}:${r.runs}:${r.records}`)).toEqual(["g1:true:1:1", "g2:true:1:0", "g3:false:0:0"]);
    const base = readGuildOverviewFilters(new URLSearchParams(""));
    expect(base).toEqual({ q: "", faction: null, realm: null, sort: "score", page: 1 });
    expect(filterGuildOverview(rows, base).map((r) => r.guild.id)).toEqual(["g1", "g2", "g3"]);
    expect(filterGuildOverview(rows, { ...base, sort: "members" }).map((r) => r.guild.id)).toEqual(["g2", "g1", "g3"]);
    expect(filterGuildOverview(rows, readGuildOverviewFilters(new URLSearchParams("q=quebec")))).toHaveLength(1);
    expect(filterGuildOverview(rows, readGuildOverviewFilters(new URLSearchParams("faction=horde"))).map((r) => r.guild.id)).toEqual(["g2"]);
    expect(filterGuildOverview(rows, readGuildOverviewFilters(new URLSearchParams("realm=doomhowl"))).map((r) => r.guild.id)).toEqual(["g1"]);
    expect(readGuildOverviewFilters(new URLSearchParams("sort=hack&page=-3&faction=elf"))).toMatchObject({ sort: "score", page: 1, faction: null });
  });
  it("numbers pages around the current one", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(5, 10)).toEqual([1, null, 3, 4, 5, 6, 7, null, 10]);
    expect(pageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
  });
});

describe("leaderboard and personal pages", () => {
  function setup(extra: LeaderRun[] = []) {
    const runs = [leaderRun("a", 1500), leaderRun("b", 1300, [player("Kev", "Warrior", "TANK"), player("<b>Bad</b>", "Mage", "DPS")], { confirmations: 2 })];
    const beta = leaderRun("old", 1000, [player("Kev", "Warrior", "TANK")], { endedAt: new Date("2026-10-30T00:00:00Z") });
    const all = [...runs, beta, ...extra];
    const store: LeaderboardStore = {
      async run(id) { return all.find(run => run.runId === id) ?? null; },
      async runs(query) { return all.filter((run) => (!query.from || run.endedAt >= query.from) && (!query.to || run.endedAt < query.to)); },
      async characterRuns(character) { return all.filter((run) => run.players.some((p) => p.character.toLowerCase() === character.toLowerCase())); },
      async guilds() { return [{ id: "g1", name: "Quebec Gold", slug: "quebec-gold" }]; },
      async guildRuns(guildId) { return guildId === "g1" ? runs : []; },
      async guildRoster(guildId) { return guildId === "g1" ? ["kev", "amy"] : []; },
      async guildStats(ids) { return ids.map((guildId) => ({ guildId, faction: "ALLIANCE", realm: "Doomhowl", members: 12, linked: 9, levelled: 8, at60: 3, levelSum: 400, duels: 7 })); }
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

  it("keeps a stored Retail keystone run readable, with no keystone board or rating (WoW Forever only)", async () => {
    const challenge = { mapId: 249, level: 10, affixIds: [3, 9], durationMs: 645123, timeLimitSec: 1980,
      onTime: true, practiceRun: false, eligibleForScore: true };
    const native = leaderRun("native-run", 600, [{ ...player("Native", "Warrior", "TANK"), presentSec: 600 }], {
      gameEdition: "retail", instanceId:1762, difficultyId: 8, challenge,
      evidence: { startedAt: new Date(NOW.getTime() - 1200000), completedBy: "challenge objectives", encounters: [] } });
    const { request } = setup([native]);
    const page = await request("GET", "/leaderboards/?edition=retail");
    expect(page.status).toBe(200);
    expect(page.body).not.toContain("Highest key finished in time");
    expect(page.body).not.toContain("Guilded Mythic+ rating");
    const character=await request("GET","/leaderboards/character/Native-Doomhowl?edition=retail");
    expect(character.body).not.toContain("Provisional Guilded Mythic+ rating");
    expect(rankCharacters([native], { className: null, role: null, confirmed: false })).toEqual([]);
    const detail = await request("GET", "/leaderboards/run/native-run?edition=retail");
    expect(detail.status).toBe(200);
    expect(detail.body).toContain("Official timer");
    expect(detail.body).toContain("+10");
  });

  // The website homepage's "This week on Guilded" strip reads this; it never carries player names.
  it("serves the weekly summary for the website homepage without player names", async () => {
    const { request } = setup();
    const summary = await request("GET", "/leaderboards/summary.json?lang=en");
    expect(summary.status).toBe(200);
    expect(summary.headers["content-type"]).toContain("application/json");
    const data = JSON.parse(summary.body) as { guilds: number; ratedRunsThisWeek: number; topRuns: { dungeon: string; score: number }[] };
    expect(data.guilds).toBe(1);
    expect(data.ratedRunsThisWeek).toBeGreaterThan(0);
    expect(data.topRuns.length).toBeLessThanOrEqual(3);
    expect(data.topRuns.map((run) => run.score)).toContain(185);
    expect(summary.body).not.toMatch(/Kev|Amy|Bad/);
    const board = await request("GET", "/leaderboards/?lang=fr");
    expect(board.body).toContain("<summary>Comment les scores sont calculés</summary>");
  });

  // The phone app's boards: public display names and scores only, same ratings as the site.
  it("serves the phone boards as JSON with the public ratings", async () => {
    const { request } = setup();
    const boards = await request("GET", "/leaderboards/boards.json?lang=en");
    expect(boards.status).toBe(200);
    expect(boards.headers["content-type"]).toContain("application/json");
    const data = JSON.parse(boards.body) as { season: string; brackets: { key: string; characters: { rank: number; points: number }[]; guilds: { rank: number; id: string }[] }[] };
    expect(typeof data.season).toBe("string");
    expect(data.brackets.length).toBeGreaterThan(0);
    for (const bracket of data.brackets) {
      expect(bracket.characters.length).toBeLessThanOrEqual(10);
      expect(bracket.characters.map((c) => c.rank)).toEqual(bracket.characters.map((_, i) => i + 1));
    }
    expect((await request("POST", "/leaderboards/boards.json")).status).not.toBe(200);
  });

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
    expect(dungeon.body).toContain("✔ Confirmé par le groupe · 2");
    const priests = await request("GET", "/leaderboards/?dungeon=389&class=Priest");
    expect(priests.body).toContain(">Amy<");
    expect(priests.body.match(/<tr><td>\d+<\/td>/g)).toHaveLength(1);
    const kev = await request("GET", "/leaderboards/character/Kev-Doomhowl");
    expect(kev.status).toBe(200);
    expect(kev.body).toContain("Best run per dungeon");
    expect((await request("GET", "/leaderboards/character/Nobody")).status).toBe(404);
  });

  it("shows scores, top runs this week, class colours, confirmation badges and history", async () => {
    const { request } = setup();
    const home = await request("GET", "/leaderboards/");
    expect(home.body).toContain("Top runs this week");
    expect(home.body).toContain("A weekly snapshot; character and guild rankings below use your selected period.");
    expect(home.body).toContain("Selected period");
    expect(home.body).toContain('name="edition" value="forever"');
    expect(home.body).not.toContain('<select id="edition"');
    expect(home.body).toContain("Guilded · Season 1</p>");
    // Ragefire Chasm: target 20:00 (provisional plan); 21:40 scores round(200 x 1200 / 1300) = 185.
    expect(home.body).toContain('<td class="num score">185</td>');
    expect(home.body).toContain('class="char c-warrior"');
    expect(home.body).toContain("Confirmed by party");
    expect(home.body).not.toContain("<script");
    const beta = await request("GET", "/leaderboards/?season=beta&lang=fr");
    expect(beta.body).toContain("Bêta (avant la saison 1)");
    expect(beta.body).toContain('<td class="num score">240</td>');
    const realm = await request("GET", "/leaderboards/?realm=Elsewhere");
    expect(realm.body).not.toContain('class="char c-warrior"');
    expect(realm.body).toContain("No rated standard dungeon run this week yet.");
    expect(realm.body).not.toContain("Top runs this week");
    const kev = await request("GET", "/leaderboards/character/Kev-Doomhowl");
    expect(kev.body).toContain("Score history");
    expect(kev.body).toContain("Beta (before Season 1)");
    expect(kev.body).toContain('class="meter"');
    // A pasted link previews the season score and the logo (Discord reads Open Graph tags).
    expect(kev.body).toMatch(/<meta property="og:description" content="Kev-Doomhowl: dungeon score \d+ \([^"]+\) · Season 1 · Guilded leaderboards\.">/);
    expect(kev.body).toContain('<meta property="og:image" content="https://guilded.kcaron.top/forever/leaderboards/character/Kev-Doomhowl/card.png?lang=en">');
    expect(home.body).toContain('<meta property="og:title" content="');
    expect(home.body).toContain("Top guilds");
    expect(home.body).toContain('class="bracket-switch"');
    expect(home.body.match(/<h2>Levels 15–29/g)).toHaveLength(1);
    expect(home.body).not.toMatch(/<h2>Levels 30–44/);
    expect(home.body).toContain('class="class-name c-warrior">Warrior</span>');
    expect(home.body).not.toContain("<th>Class</th>");
    expect(home.body).not.toContain(">WARRIOR<");
    for (const row of home.body.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) expect(row).not.toContain("WoW Forever");
    const scoreAt = home.body.indexOf('<td class="num score">');
    expect(scoreAt).toBeGreaterThan(0);
    expect(home.body.indexOf('id="season"')).toBeGreaterThan(scoreAt);
    expect(home.body.indexOf("Your player profile is public by default")).toBeGreaterThan(scoreAt);
    expect(home.body).toContain("table.rank-cards");
    expect(home.body).toContain('rel="canonical" href="https://guilded.kcaron.top/leaderboards/"');
    expect(home.body).toContain('hreflang="fr" href="https://guilded.kcaron.top/leaderboards/?lang=fr"');
    expect(home.body).toContain(">This week</a>");
    expect(home.body).toContain("position:sticky");
    expect(home.body).toContain("overflow-x:visible");
    expect(home.body).toContain('href="/forever/leaderboards/guilds/?');
    const guilds = await request("GET", "/leaderboards/guilds/?lang=fr");
    expect(guilds.status).toBe(200);
    expect(guilds.body).toContain("Classement des guildes");
    expect(guilds.body).toMatch(/<td><span class="medal m1" aria-label="#1">1<\/span><\/td><td(?: class="wrap")?><a href="\/forever\/leaderboards\/guild\/g1\?lang=fr">Quebec Gold<\/a>/);
    expect(guilds.body).toContain('href="/g/quebec-gold/"');
    expect(guilds.body).toContain('class="crumbs"');
    const season = await request("GET", "/leaderboards/guild/g1/");
    expect(season.body).toContain("#1 / 1");
    expect(season.body).toContain("Guild page →");
    expect(season.body).not.toContain("<b>Bad</b>");
    const guild = await request("GET", "/leaderboards/guild/g1?period=week");
    expect(guild.status).toBe(200);
    expect(guild.body).toContain("Quebec Gold");
    expect(guild.body).toContain(">Kev<");
    expect((await request("GET", "/leaderboards/guild/nope")).status).toBe(404);
  });

  it("shows the guild table, character rankings with medals and a run page with its party", async () => {
    const { request } = setup();
    const guilds = await request("GET", "/leaderboards/guilds/?lang=en");
    expect(guilds.body).toContain("All guilds");
    expect(guilds.body).toContain('class="fac-alliance"');
    expect(guilds.body).toContain('<td class="num">12</td>');
    expect(guilds.body).toContain("Gear score is not shown");
    expect(guilds.body).toContain('name="faction"');
    expect((await request("GET", "/leaderboards/guilds/?q=nothing")).body).toContain("No guild matches these filters.");
    const ranking = await request("GET", "/leaderboards/characters/?lang=en");
    expect(ranking.status).toBe(200);
    expect(ranking.body).toContain("Character rankings");
    expect(ranking.body).toContain('class="medal m1"');
    expect(ranking.body).toContain('href="/forever/leaderboards/run/');
    expect(ranking.body).not.toContain("<b>Bad</b>");
    expect((await request("GET", "/leaderboards/characters/?class=Priest")).body).not.toContain('class="char c-warrior"');
    const run = await request("GET", "/leaderboards/run/b?lang=en");
    expect(run.status).toBe(200);
    expect(run.body).toContain("Party");
    expect(run.body).toContain('class="run-card"');
    expect(run.body).toContain('class="tiles"');
    expect(run.body).not.toContain("<b>Bad</b>");
  });

  it("summarises a guild's top characters, recent runs and records for its page", async () => {
    const runs = [leaderRun("a", 1500), leaderRun("b", 1300, [player("Kev", "Warrior", "TANK"), player("Pug", "Mage", "DPS")])];
    const store: LeaderboardStore = { async runs() { return runs; }, async characterRuns() { return []; }, async guilds() { return []; },
      async guildRuns() { return runs; }, async guildRoster() { return ["kev"]; } };
    const summary = await guildDungeonSummary(store, "g1", undefined, NOW);
    expect(summary.top.map((row) => row.name)).toEqual(["Kev"]);
    expect(summary.recent).toHaveLength(2);
    expect(summary.records).toHaveLength(1);
    expect(summary.records[0]!.time).toBe("21:40");
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
