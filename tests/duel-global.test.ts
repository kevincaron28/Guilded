/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory stand-in for the few Prisma calls the import makes */
import { describe, expect, it } from "vitest";
import { CHAIN_START, DEFAULT_INTEGRITY, chainHash, checkRecord, issueDuelChallenge, loadIntegrityConfig } from "../src/services/duel-integrity.js";
import { buildGlobalBoard, characterKey, duelAnomalies, duelSig, externalDuelSchema, implausible, mirrorGuildDuels, recordGlobalDuels, sequenceProblems, splitName, type ExternalDuelInput, type GlobalDuel } from "../src/services/duel-global.js";
import { RATING_START, ratingSeasonIds, ratingSeasonName, seasonOf } from "../src/services/duel-rating.js";
import { createLeaderboardPages, type LeaderboardStore } from "../src/services/public-leaderboard.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

// Global duel ladder: the plausibility rules, the import (dedupe, caps, confirmation, exclusions, replays), the board and the page.

interface Report { reporterKey: string; reporterCharacterKey: string; deviceId: string | null; seq: number | null; chain: string | null; nonce: string | null; dayKey: string; duelId?: string; [k: string]: any }
interface Duel { id: string; winnerKey: string; loserKey: string; endedAt: Date; pairKey: string; dayKey: string; counted: boolean; confirmations: number; held: boolean; holdFlags: string[]; reports: Report[]; [k: string]: any }
/** The few Prisma calls recordGlobalDuels makes, over arrays. */
function fakeTx() {
  const duels: Duel[] = [];
  const excluded = new Set<string>();
  const challenges: { deviceId: string; nonce: string; issuedAt: Date }[] = [];
  let n = 0;
  const reports = () => duels.flatMap((d) => d.reports.map((r) => ({ ...r, duel: d })));
  const within = (d: Duel, where: any) => d.endedAt >= where.endedAt.gte && d.endedAt <= where.endedAt.lte;
  const tx = {
    publicDuelExclusion: { findUnique: async ({ where }: any) => excluded.has(where.deviceId) ? { deviceId: where.deviceId } : null },
    duelChallenge: { findFirst: async ({ where }: any) => challenges.find((c) => c.deviceId === where.deviceId && c.nonce === where.nonce) ?? null },
    publicDuelReport: {
      findFirst: async ({ where }: any) => {
        if (where.seq !== undefined) return reports().find((r) => r.deviceId === where.deviceId && r.seq === where.seq) ?? null;
        const withChain = reports().filter((r) => r.deviceId === where.deviceId && r.chain);
        return withChain.length ? { chain: withChain[withChain.length - 1]!.chain } : null;
      },
      count: async ({ where }: any) => where.duel?.held !== undefined
        ? reports().filter((r) => r.deviceId === where.deviceId && r.duel.held === where.duel.held).length
        : reports().filter((r) => r.reporterKey === where.reporterKey && r.dayKey === where.dayKey && r.duel.counted === where.duel.counted).length,
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const row of data) { const duel = duels.find((d) => d.id === row.duelId)!; if (!duel.reports.some((r) => r.reporterKey === row.reporterKey)) { duel.reports.push(row); count++; } }
        return { count };
      }
    },
    publicDuel: {
      findFirst: async ({ where }: any) => duels.find((d) => d.winnerKey === where.winnerKey && d.loserKey === where.loserKey && within(d, where)) ?? null,
      count: async ({ where }: any) => duels.filter((d) => d.pairKey === where.pairKey && d.dayKey === where.dayKey && d.counted === where.counted).length,
      create: async ({ data }: any) => { const { reports: r, ...rest } = data; duels.push({ held: false, holdFlags: [], ...rest, id: `d${++n}`, confirmations: 1, reports: r.create.map((x: any) => ({ ...x })) }); return null; },
      update: async ({ where, data }: any) => {
        const d = duels.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries<any>(data)) {
          if (k === "confirmations") d.confirmations += v.increment;
          else if (k === "holdFlags" && v?.push) d.holdFlags.push(v.push);
          else d[k] = v;
        }
        return d;
      }
    }
  };
  return { tx: tx as never, duels, excluded, challenges };
}

const NOW = new Date("2026-12-10T12:00:00Z");
const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const rec = (over: Partial<ExternalDuelInput> = {}): ExternalDuelInput => ({ winner: "Aldric", winnerRealm: "Kronos", loser: "Brenna", loserRealm: "Kronos", at: at("2026-12-09T10:00:00Z"), reason: "knockout", side: "winner", ...over });
const src = { reporterKey: "install:a", deviceId: "dev-a" };

describe("global duels: names, keys and plausibility", () => {
  it("splits and keys characters by name and realm", () => {
    expect(splitName("Aldric-Kronos")).toEqual({ name: "Aldric", realm: "Kronos" });
    expect(splitName("Aldric", "Mirage Raceway")).toEqual({ name: "Aldric", realm: "Mirage Raceway" });
    expect(characterKey("Aldric", "Mirage Raceway")).toBe(characterKey("aldric", "MirageRaceway"));
    expect(characterKey("Aldric", "A")).not.toBe(characterKey("Aldric", "B"));
  });
  it("accepts a normal record and rejects the impossible ones", () => {
    expect(implausible(rec(), NOW)).toBeNull();
    expect(implausible(rec({ at: at("2026-12-11T12:00:00Z") }), NOW)).toBe("future");
    expect(implausible(rec({ at: at("2026-11-14T12:00:00Z") }), new Date("2026-12-20T12:00:00Z"))).toBe("old");
    expect(implausible(rec({ durationSec: 1 }), NOW)).toBe("duration");
    expect(implausible(rec({ durationSec: 4000 }), NOW)).toBe("duration");
    expect(implausible(rec({ durationSec: 40 }), NOW)).toBeNull();
    expect(implausible(rec({ loser: "Aldric" }), NOW)).toBe("same-character");
  });
  it("is strict about the shape and level range", () => {
    expect(externalDuelSchema.safeParse(rec()).success).toBe(true);
    expect(externalDuelSchema.safeParse({ ...rec(), extra: 1 }).success).toBe(false);
    expect(externalDuelSchema.safeParse(rec({ winnerLevel: 61 })).success).toBe(false);
    expect(externalDuelSchema.safeParse(rec({ sig: "xyz" })).success).toBe(false);
  });
  it("signs a record with the install secret and the sequence number", () => {
    const base = rec({ seq: 5 });
    expect(duelSig("secret", base)).toMatch(/^[0-9a-f]{16}$/);
    expect(duelSig("secret", base)).toBe(duelSig("secret", { ...base }));
    expect(duelSig("secret", base)).not.toBe(duelSig("other", base));
    expect(duelSig("secret", base)).not.toBe(duelSig("secret", { ...base, loser: "Corvin" }));
    expect(duelSig("secret", base)).not.toBe(duelSig("secret", { ...base, seq: 6 }));
  });
});

describe("global duels: the import", () => {
  it("stores a duel once, with its report, and counts it", async () => {
    const { tx, duels } = fakeTx();
    const r = await recordGlobalDuels(tx, src, [rec({ winnerLevel: 60, loserLevel: 58, winnerGuild: "  Quebec   Gold ", zone: "Orgrimmar", durationSec: 40 })], NOW);
    expect(r).toMatchObject({ recorded: 1, counted: 1, rejected: 0 });
    expect(duels).toHaveLength(1);
    expect(duels[0]).toMatchObject({ winnerName: "Aldric", loserName: "Brenna", winnerGuild: "Quebec Gold", zone: "Orgrimmar", counted: true });
    expect(duels[0]!.reports[0]).toMatchObject({ reporterKey: "install:a", reporterCharacterKey: characterKey("Aldric", "Kronos"), seq: null });
  });
  it("merges the other side's report into the same duel and marks it confirmed", async () => {
    const { tx, duels } = fakeTx();
    await recordGlobalDuels(tx, src, [rec()], NOW);
    const second = await recordGlobalDuels(tx, { reporterKey: "install:b", deviceId: "dev-b" }, [rec({ side: "loser", at: at("2026-12-09T10:00:30Z"), loserClass: "Priest", loserLevel: 59 })], NOW);
    expect(second).toMatchObject({ recorded: 0, confirmed: 1 });
    expect(duels).toHaveLength(1);
    expect(duels[0]).toMatchObject({ confirmations: 2, loserClass: "Priest", loserLevel: 59 });
    // The same reporter again adds nothing.
    await recordGlobalDuels(tx, { reporterKey: "install:b", deviceId: "dev-b" }, [rec({ side: "loser" })], NOW);
    expect(duels[0]!.confirmations).toBe(2);
  });
  it("caps a pair at 5 counted duels a day and stores the rest as not counted", async () => {
    const { tx, duels } = fakeTx();
    const rows = Array.from({ length: 7 }, (_, i) => rec({ at: at("2026-12-09T10:00:00Z") + i * 600 }));
    const r = await recordGlobalDuels(tx, src, rows, NOW);
    expect(r).toMatchObject({ recorded: 7, counted: 5, capped: 2 });
    expect(duels.filter((d) => d.counted)).toHaveLength(5);
  });
  it("caps a reporter at 25 counted duels a day", async () => {
    const { tx } = fakeTx();
    const rows = Array.from({ length: 30 }, (_, i) => rec({ loser: `Player${i}`, at: at("2026-12-09T10:00:00Z") + i * 200 }));
    expect(await recordGlobalDuels(tx, src, rows, NOW)).toMatchObject({ recorded: 30, counted: 25, capped: 5 });
  });
  it("rejects implausible and malformed rows without storing them", async () => {
    const { tx, duels } = fakeTx();
    const r = await recordGlobalDuels(tx, src, [rec({ at: at("2026-12-20T00:00:00Z") }), rec({ durationSec: 2 }), { nope: true }, rec()], NOW);
    expect(r).toMatchObject({ recorded: 1, rejected: 3 });
    expect(duels).toHaveLength(1);
  });
  it("ignores everything from an excluded device", async () => {
    const { tx, duels, excluded } = fakeTx();
    excluded.add("dev-a");
    const r = await recordGlobalDuels(tx, src, [rec()], NOW);
    expect(r).toMatchObject({ recorded: 0, rejected: 1, excluded: true });
    expect(duels).toHaveLength(0);
  });
  it("refuses a sequence number reused for a different duel, and accepts the same record again", async () => {
    const { tx, duels } = fakeTx();
    await recordGlobalDuels(tx, src, [rec({ seq: 1 })], NOW);
    const replay = await recordGlobalDuels(tx, src, [rec({ seq: 1, loser: "Corvin" })], NOW);
    expect(replay).toMatchObject({ replays: 1, recorded: 0 });
    const again = await recordGlobalDuels(tx, src, [rec({ seq: 1 })], NOW);
    expect(again.replays).toBe(0);
    expect(duels).toHaveLength(1);
  });
  it("finds gaps and repeats in a device's sequence", () => {
    expect(sequenceProblems([1, 2, 3])).toEqual({ gaps: 0, repeats: 0 });
    expect(sequenceProblems([1, 2, 5, 5])).toEqual({ gaps: 2, repeats: 1 });
  });
  it("mirrors a counted guild duel, skipping hidden members and non-participants", async () => {
    const { tx, duels } = fakeTx();
    const base = { winnerCharacter: "Aldric", loserCharacter: "Brenna", winnerLevel: 60, loserLevel: 60, reason: "knockout", endedAt: new Date("2026-12-09T10:00:00Z") };
    const info = { guildId: "g1", guildName: "Quebec Gold", realm: "Kronos", reporterMemberId: "m1", hidden: new Set(["m9"]), classOf: (_m: string, name: string) => name === "Aldric" ? "Warrior" : null };
    const r = await mirrorGuildDuels(tx, info, [{ ...base, winnerId: "m1", loserId: "m2" }, { ...base, winnerId: "m1", loserId: "m9" }, { ...base, winnerId: "m3", loserId: "m4" }], NOW);
    expect(r).toMatchObject({ recorded: 1, rejected: 2 });
    expect(duels[0]).toMatchObject({ winnerClass: "Warrior", winnerGuild: "Quebec Gold", winnerMemberId: "m1", loserMemberId: "m2" });
    expect(duels[0]!.reports[0]).toMatchObject({ reporterKey: "member:m1", guildId: "g1" });
  });
});

function g(w: string, l: string, iso: string, over: Partial<GlobalDuel> = {}): GlobalDuel {
  return { winnerKey: w.toLowerCase(), loserKey: l.toLowerCase(), winner: w, loser: l, winnerRealm: "Kronos", loserRealm: "Kronos", winnerClass: null, loserClass: null, winnerLevel: 60, loserLevel: 60, winnerGuild: null, loserGuild: null,
    endedAt: new Date(iso), reason: "knockout", zone: null, durationSec: null, reporters: [w.toLowerCase()], confirmed: false, ...over };
}

describe("global duels: the board", () => {
  const eight = Array.from({ length: 8 }, (_, i) => g("Aldric", ["Brenna", "Corvin", "Dara", "Edda"][i % 4]!, `2026-12-0${2 + Math.floor(i / 2)}T1${i}:00:00Z`));
  it("ranks everyone and marks the players whose rating comes from opponents' reports", () => {
    const board = buildGlobalBoard(eight, "2026-11", RATING_START, { className: null, levels: null });
    expect(board.rows.map((row) => row.name).sort()).toEqual(["Aldric", "Brenna", "Corvin", "Dara", "Edda"]);
    expect(board.rows[0]).toMatchObject({ rank: 1, ranked: true, wins: 8, viaOpponents: false });
    expect(board.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(board.rows.slice(1).every((row) => row.ranked && row.viaOpponents)).toBe(true);
    expect(board.recent).toHaveLength(8);
    expect(board.recent[0]!.loser).toBeTruthy();
    expect(board.duels).toBe(8);
  });
  it("ranks a player from the first counted duel", () => {
    const board = buildGlobalBoard(eight.slice(0, 2), "2026-11", RATING_START, { className: null, levels: null });
    expect(board.rows[0]).toMatchObject({ rank: 1, ranked: true, placement: null });
  });
  it("only counts the month asked and applies the class filter", () => {
    const mixed = [g("Aldric", "Brenna", "2026-12-05T10:00:00Z", { winnerClass: "Warrior" }), g("Corvin", "Dara", "2026-12-06T10:00:00Z", { winnerClass: "Mage", reporters: ["corvin"] }), g("Aldric", "Brenna", "2027-01-05T10:00:00Z")];
    expect(buildGlobalBoard(mixed, "2026-11", RATING_START, { className: null, levels: null }).duels).toBe(2);
    expect(buildGlobalBoard(mixed, "2026-11", RATING_START, { className: "Mage", levels: null }).rows.map((r) => r.name)).toEqual(["Corvin"]);
    expect(buildGlobalBoard(mixed, "2027-01", RATING_START, { className: null, levels: null }).duels).toBe(1);
  });
  it("carries the latest guild text and realm", () => {
    const board = buildGlobalBoard([g("Aldric", "Brenna", "2026-12-05T10:00:00Z", { winnerGuild: "Old Guild" }), g("Aldric", "Corvin", "2026-12-06T10:00:00Z", { winnerGuild: "New Guild" })], "2026-11", RATING_START, { className: null, levels: null });
    expect(board.rows[0]).toMatchObject({ guild: "New Guild", realm: "Kronos" });
  });
});

describe("global duels: anomalies", () => {
  it("flags a one-sided pair, rapid repeats, few opponents and long streaks, and nothing in normal play", () => {
    const normal = Array.from({ length: 6 }, (_, i) => g(i % 2 ? "Aldric" : "Brenna", i % 2 ? "Brenna" : "Aldric", `2026-12-0${i + 1}T10:00:00Z`));
    expect(duelAnomalies(normal)).toEqual([]);
    const farm = Array.from({ length: DEFAULT_INTEGRITY.anomaly.pairMin }, (_, i) => g("Cato", "Dede", `2026-12-${String(i + 1).padStart(2, "0")}T10:00:00Z`));
    const kinds = duelAnomalies(farm).map((a) => a.kind);
    expect(kinds).toContain("one-sided-pair");
    expect(kinds).toContain("few-opponents");
    const rapid = Array.from({ length: DEFAULT_INTEGRITY.anomaly.rapidMin + 2 }, (_, i) => g(i % 2 ? "Brenna" : "Aldric", i % 2 ? "Aldric" : "Brenna", `2026-12-01T10:00:${String(i * 5).padStart(2, "0")}Z`));
    expect(duelAnomalies(rapid).map((a) => a.kind)).toContain("rapid-repeat");
    const streak = Array.from({ length: DEFAULT_INTEGRITY.anomaly.streak }, (_, i) => g("Eli", `Opp${i}`, `2026-12-${String(i + 1).padStart(2, "0")}T10:00:00Z`));
    expect(duelAnomalies(streak).map((a) => a.kind)).toContain("long-streak");
  });
});

describe("global duels: the page and JSON", () => {
  const rows: GlobalDuel[] = [
    ...Array.from({ length: 8 }, (_, i) => g("Aldric", ["Brenna", "Corvin", "Dara", "Edda"][i % 4]!, `2026-12-0${2 + Math.floor(i / 2)}T1${i}:00:00Z`, { winnerClass: "Warrior", winnerGuild: i < 4 ? "Quebec Gold" : "<b>Evil</b>", confirmed: i === 0, loserClass: "Mage" })),
    g("Fenn", "Aldric", "2026-12-08T10:00:00Z", { winnerGuild: "Quebec Gold", reporters: ["fenn"] })
  ];
  const get = (nowIso: string, withStore = true) => {
    const store: LeaderboardStore = { async runs() { return []; }, async characterRuns() { return []; }, async guilds() { return [{ id: "g1", name: "Quebec Gold", publicSlug: "quebec-gold" }]; }, async guildRuns() { return []; }, async guildRoster() { return []; }, async guildStats() { return []; },
      ...(withStore ? { async globalDuelRows() { return rows; } } : {}) };
    const pages = createLeaderboardPages({ store, personal: null, now: () => new Date(nowIso) });
    const app = createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guildedwow.com", sessionSecret: "s".repeat(40) }, allows: () => true, postApplication: async () => null, routes: [pages.route], now: () => new Date(nowIso), fetch: fetch });
    return (path: string) => { const url = new URL(path, "https://guildedwow.com"); return app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: {} }) as Promise<WebResponse>; };
  };
  it("does not exist before the rating start", async () => {
    expect((await get("2026-11-10T12:00:00Z")("/leaderboards/duels/")).status).toBe(404);
    expect((await get("2026-11-10T12:00:00Z")("/leaderboards/duels.json")).status).toBe(404);
    expect((await get("2026-12-10T12:00:00Z", false)("/leaderboards/duels/")).status).toBe(404);
  });
  it("shows the ranking, links a listed guild, escapes the rest and marks confirmed duels", async () => {
    const page = (await get("2026-12-10T12:00:00Z")("/leaderboards/duels/")).body;
    expect(page).toContain("Duel ladder");
    expect(page).toContain("November 13 – December 31, 2026");
    expect(page).toContain("Aldric");
    expect(page).toContain('href="/forever/leaderboards/guild/quebec-gold');
    expect(page).not.toContain("<b>Evil</b>");
    expect(page).toContain("confirmed by both");
    expect(page).not.toMatch(/cheat/i);
    expect(page).toContain("Results are reported by players' addons");
    expect(page).toContain("The in-game ladder shows the old score until the next addon update");
    expect(page).toContain("ranked from their opponents&#39; reports");
    expect(page).toContain("reported by opponents");
    expect(page).toContain("fills up as players update");
    const fr = (await get("2026-12-10T12:00:00Z")("/leaderboards/duels/?lang=fr")).body;
    expect(fr).toContain("Classement des duels");
    expect(fr).toContain("confirmé par les deux");
  });
  it("lists everyone in the JSON and opens one player from a duel history", async () => {
    const json = JSON.parse((await get("2026-12-10T12:00:00Z")("/leaderboards/duels.json")).body) as { rules: { id: string }; season: string; players: { name: string; rank: number | null; realm: string }[]; recent: { winner: string; confirmedByBoth: boolean }[] };
    expect(json.rules.id).toBe("rating-v1");
    expect(json.season).toBe("2026-11");
    expect(json.players.map((p) => p.name).sort()).toEqual(["Aldric", "Brenna", "Corvin", "Dara", "Edda", "Fenn"]);
    expect(json.players.find((p) => p.name === "Aldric")).toMatchObject({ rank: 1, realm: "Kronos" });
    expect(json.recent.some((d) => d.confirmedByBoth)).toBe(true);
    const head = (await get("2026-12-10T12:00:00Z")("/leaderboards/duels/?a=Aldric&b=Brenna")).body;
    expect(head).toContain("Aldric</strong> 2 – 0");
    const one = (await get("2026-12-10T12:00:00Z")("/leaderboards/duels/?p=brenna")).body;
    expect(one).toContain("<h2>Brenna</h2>");
    expect(one).toContain("reported by opponents");
  });
});

describe("global duels: server-side checks", () => {
  const cfgOn = { ...DEFAULT_INTEGRITY, requireChallenge: true, requireChain: true };
  const NONCE = "ab12cd34ef56ab12cd34ef56";
  const chained = (prev: string, over: Partial<ExternalDuelInput> = {}) => {
    const r = rec(over);
    return { ...r, nonce: NONCE, prev, chain: chainHash(prev, NONCE, { winner: "Aldric", winnerRealm: "Kronos", loser: "Brenna", loserRealm: "Kronos", at: r.at, reason: r.reason, seq: r.seq }) };
  };
  it("keeps a record that follows the challenge and the chain", async () => {
    const { tx, duels, challenges } = fakeTx();
    challenges.push({ deviceId: "dev-a", nonce: NONCE, issuedAt: new Date("2026-12-09T00:00:00Z") });
    const r = await recordGlobalDuels(tx, src, [chained(CHAIN_START)], NOW, "forever", cfgOn);
    expect(r).toMatchObject({ recorded: 1, held: 0 });
    expect(duels[0]).toMatchObject({ held: false, holdFlags: [] });
  });
  it("holds a record that trips two checks, and does not say which", async () => {
    const { tx, duels } = fakeTx();
    // No challenge issued and an edited chain: two flags.
    const bad = { ...chained(CHAIN_START), chain: "0123456789abcdef" };
    const r = await recordGlobalDuels(tx, src, [bad], NOW, "forever", cfgOn);
    expect(r).toMatchObject({ recorded: 1, held: 1 });
    expect(duels[0]!.held).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/nonce|chain|flag/);
  });
  it("one flag alone is recorded for the reviewer but does not hold", async () => {
    const { tx, duels } = fakeTx();
    const r = await recordGlobalDuels(tx, src, [rec({ evidence: { startAt: at("2026-12-09T10:00:10Z"), endAt: at("2026-12-09T10:00:00Z") } })], NOW);
    expect(r.held).toBe(0);
    expect(duels[0]).toMatchObject({ held: false, holdFlags: ["e"] });
  });
  it("accepts consistent evidence and flags an inconsistent zone or duration", () => {
    const base = { winner: "A", loser: "B", at: 1000, reason: "knockout", durationSec: 40 };
    const ok = { countdownAt: 940, startAt: 950, endAt: 990, zoneWinner: "Orgrimmar", zoneLoser: "orgrimmar" };
    expect(checkRecord({ record: { ...base, evidence: ok }, lastChain: null, challengeIssuedAt: null, cfg: DEFAULT_INTEGRITY, now: NOW })).toEqual([]);
    expect(checkRecord({ record: { ...base, evidence: { ...ok, zoneLoser: "Stormwind" } }, lastChain: null, challengeIssuedAt: null, cfg: DEFAULT_INTEGRITY, now: NOW })).toEqual(["e"]);
    expect(checkRecord({ record: { ...base, evidence: { ...ok, endAt: 1010 } }, lastChain: null, challengeIssuedAt: null, cfg: DEFAULT_INTEGRITY, now: NOW })).toEqual(["e"]);
  });
  it("breaks the chain when the previous link does not match the device's last one", async () => {
    const { tx, duels, challenges } = fakeTx();
    challenges.push({ deviceId: "dev-a", nonce: NONCE, issuedAt: new Date("2026-12-09T00:00:00Z") });
    await recordGlobalDuels(tx, src, [chained(CHAIN_START, { seq: 1 })], NOW, "forever", cfgOn);
    await recordGlobalDuels(tx, src, [chained(CHAIN_START, { loser: "Brenna", at: at("2026-12-09T11:00:00Z"), seq: 2 })], NOW, "forever", cfgOn);
    expect(duels[1]!.holdFlags).toContain("c");
  });
  it("holds both sides when two devices report opposite winners for the same moment", async () => {
    const { tx, duels } = fakeTx();
    await recordGlobalDuels(tx, src, [rec()], NOW);
    const r = await recordGlobalDuels(tx, { reporterKey: "install:b", deviceId: "dev-b" }, [rec({ winner: "Brenna", loser: "Aldric", side: "winner", at: at("2026-12-09T10:00:20Z") })], NOW);
    expect(r.held).toBe(1);
    expect(duels.every((d) => d.held)).toBe(true);
  });
  it("holds everything from a device after enough held records", async () => {
    const { tx, duels } = fakeTx();
    const cfg = { ...DEFAULT_INTEGRITY, deviceHoldAfter: 2, holdAt: 1 };
    const flagged = (i: number) => rec({ loser: `P${i}`, at: at("2026-12-09T10:00:00Z") + i * 400, evidence: { startAt: 20, endAt: 10 } });
    await recordGlobalDuels(tx, src, [flagged(1), flagged(2)], NOW, "forever", cfg);
    await recordGlobalDuels(tx, src, [rec({ loser: "Clean", at: at("2026-12-09T12:00:00Z") })], NOW, "forever", cfg);
    expect(duels.map((d) => d.held)).toEqual([true, true, true]);
  });
  it("refuses a duel from before the ladders started", () => {
    expect(implausible(rec({ at: at("2026-11-12T23:59:00Z") }), NOW)).toBe("before-start");
    expect(implausible(rec({ at: at("2026-11-13T00:01:00Z") }), new Date("2026-11-14T00:00:00Z"))).toBeNull();
  });
  it("reads the configuration from the environment and ignores junk", () => {
    expect(loadIntegrityConfig({}).holdAt).toBe(DEFAULT_INTEGRITY.holdAt);
    const cfg = loadIntegrityConfig({ DUEL_INTEGRITY_CONFIG: JSON.stringify({ holdAt: 1, requireChain: true, anomaly: { streak: 5, pairMin: "x" }, junk: 1 }) });
    expect(cfg).toMatchObject({ holdAt: 1, requireChain: true });
    expect(cfg.anomaly.streak).toBe(5);
    expect(cfg.anomaly.pairMin).toBe(DEFAULT_INTEGRITY.anomaly.pairMin);
    expect(loadIntegrityConfig({ DUEL_INTEGRITY_CONFIG: "{nope" })).toEqual(DEFAULT_INTEGRITY);
  });
  it("issues a fresh challenge per call", async () => {
    const rows: { deviceId: string; nonce: string }[] = [];
    const db = { duelChallenge: { create: async ({ data }: any) => { rows.push(data); return null; }, deleteMany: async () => ({ count: 0 }) } } as never;
    const a = await issueDuelChallenge(db, "dev-a"), b = await issueDuelChallenge(db, "dev-a");
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
    expect(rows).toHaveLength(2);
  });
});

describe("global duels: seasons from 13 November", () => {
  it("runs the first season to 31 December, then monthly, and archives earlier duels", () => {
    expect(seasonOf(new Date("2026-11-12T23:59:59Z")).id).toBe("s0");
    expect(seasonOf(new Date("2026-11-13T00:00:00Z"))).toMatchObject({ id: "2026-11", rated: true });
    expect(seasonOf(new Date("2026-12-31T23:59:59Z")).id).toBe("2026-11");
    expect(seasonOf(new Date("2027-01-01T00:00:00Z")).id).toBe("2027-01");
    expect(ratingSeasonIds(new Date("2027-02-10T00:00:00Z"))).toEqual(["2027-02", "2027-01", "2026-11"]);
    expect(ratingSeasonName("2026-11", "en")).toBe("November 13 – December 31, 2026");
    expect(ratingSeasonName("2027-01", "en")).toBe("January 2027");
  });
});
