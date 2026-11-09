import { afterEach, describe, expect, it, vi } from "vitest";
import { ClashClient, duelAsMatch, duelDriver, parseDuelResponse, parseLadder, parseRankedStatus } from "./api";
import { MockClash, sampleRank } from "./mock";
import {
  attentionCount, bucketDuels, busyOpponents, challengeReducer, challengeStart, divisionPips, filterPartners, formatLeft, ladderRows, lossesCostStars, msUntil,
  rankedReducer, rankedStart, urgent
} from "./pvp";
import type { DuelInfo, LadderBoard, RankedStatus } from "./types";
import { rankLabel, rankLabelText } from "./words";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const NOW = Date.parse("2026-11-08T20:00:00.000Z");
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();
const duel = (over: Partial<DuelInfo>): DuelInfo => ({
  id: "d", kind: "friendly", status: "active", reason: null, live: false, direction: "match", seat: 0, yourTurn: false,
  you: { id: "me", cls: "warrior" }, opponent: { id: "o", name: "Borin", cls: "rogue" }, season: null, round: 2, version: 3, turnSeconds: 86_400,
  turnDeadlineAt: null, expiresAt: null, createdAt: at(-30), finishedAt: null, rated: false, ...over
});

describe("clocks", () => {
  it("reads the time left in days, hours or minutes", () => {
    expect(msUntil(at(2), NOW)).toBe(7_200_000);
    expect(msUntil(null, NOW)).toBeNull();
    expect(msUntil("not a date", NOW)).toBeNull();
    expect(formatLeft(30_000, "en")).toBe("<1 min");
    expect(formatLeft(45 * 60_000, "en")).toBe("45 min");
    expect(formatLeft(23.5 * 3_600_000, "en")).toBe("23 h");
    expect(formatLeft(5 * 86_400_000, "fr")).toBe("5 j");
    expect(formatLeft(-1, "en")).toBe("0 min");
  });

  it("marks the last hour (the last 20 s of a live turn) as urgent", () => {
    expect(urgent(50 * 60_000, false)).toBe(true);
    expect(urgent(2 * 3_600_000, false)).toBe(false);
    expect(urgent(30_000, true)).toBe(false);
    expect(urgent(15_000, true)).toBe(true);
    expect(urgent(null, false)).toBe(false);
  });
});

describe("the matches list", () => {
  const list = [
    duel({ id: "in-late", status: "pending", direction: "incoming", expiresAt: at(20) }),
    duel({ id: "in-soon", status: "pending", direction: "incoming", expiresAt: at(1) }),
    duel({ id: "in-gone", status: "pending", direction: "incoming", expiresAt: at(-1), createdAt: at(-25) }),
    duel({ id: "out", status: "pending", direction: "outgoing", expiresAt: at(10), opponent: { id: "o2", name: "Fenn", cls: null } }),
    duel({ id: "turn-late", yourTurn: true, turnDeadlineAt: at(20) }),
    duel({ id: "turn-soon", yourTurn: true, turnDeadlineAt: at(3) }),
    duel({ id: "wait", yourTurn: false, turnDeadlineAt: at(5), opponent: { id: "o3", name: "Doran", cls: "druid" } }),
    duel({ id: "won", status: "won", finishedAt: at(-2) }),
    duel({ id: "lost", status: "lost", finishedAt: at(-1) })
  ];

  it("sorts challenges and matches by their clocks and shows an expired challenge as finished", () => {
    const b = bucketDuels(list, NOW);
    expect(b.incoming.map((d) => d.id)).toEqual(["in-soon", "in-late"]);
    expect(b.outgoing.map((d) => d.id)).toEqual(["out"]);
    expect(b.yourTurn.map((d) => d.id)).toEqual(["turn-soon", "turn-late"]);
    expect(b.waiting.map((d) => d.id)).toEqual(["wait"]);
    expect(b.finished.map((d) => [d.id, d.status])).toEqual([["lost", "lost"], ["won", "won"], ["in-gone", "expired"]]);
  });

  it("counts what needs you: challenges to answer and your turns", () => {
    expect(attentionCount(list, NOW)).toBe(4);
    expect(attentionCount([], NOW)).toBe(0);
  });

  it("keeps finished matches to the 10 newest", () => {
    const many = Array.from({ length: 14 }, (_, i) => duel({ id: `f${i}`, status: "won", finishedAt: at(-i) }));
    expect(bucketDuels(many, NOW).finished.map((d) => d.id)).toEqual(["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9"]);
  });
});

describe("the challenge form", () => {
  const partners = [{ discordUserId: "1", name: "Élise Marchand" }, { discordUserId: "2", name: "Borin Ashguard" }, { discordUserId: "3", name: "Elsa Thornwood" }];

  it("finds guildmates ignoring case and accents, without those you already play", () => {
    expect(filterPartners(partners, "eli").map((p) => p.name)).toEqual(["Élise Marchand"]);
    expect(filterPartners(partners, "  EL ").map((p) => p.discordUserId)).toEqual(["1", "3"]);
    expect(filterPartners(partners, "", new Set(["2"])).map((p) => p.discordUserId)).toEqual(["1", "3"]);
    const busy = busyOpponents([duel({ opponent: { id: "2", name: "Borin", cls: null } }), duel({ status: "won", opponent: { id: "3", name: "Elsa", cls: null } }),
      duel({ kind: "ranked", opponent: { id: "1", name: "x", cls: null } })], NOW);
    expect([...busy]).toEqual(["2"]);
  });

  it("picks, sends and starts fresh, keeping the class and the live choice", () => {
    let s = challengeStart("mage");
    s = challengeReducer(s, { type: "sending" });
    expect(s.busy).toBe(false);
    s = challengeReducer(s, { type: "query", query: "bor" });
    s = challengeReducer(s, { type: "pick", partner: partners[1]! });
    expect(s).toMatchObject({ query: "", to: partners[1] });
    s = challengeReducer(challengeReducer(s, { type: "live", live: true }), { type: "sending" });
    expect(s.busy).toBe(true);
    s = challengeReducer(s, { type: "failed", message: "There is already a challenge waiting between you two." });
    expect(s).toMatchObject({ busy: false, error: "There is already a challenge waiting between you two.", to: partners[1] });
    s = challengeReducer(challengeReducer(s, { type: "sending" }), { type: "sent", duel: duel({ id: "new" }) });
    expect(s).toMatchObject({ busy: false, to: null, cls: "mage", live: true, error: null });
    expect(s.sent?.id).toBe("new");
  });
});

describe("the ranked waiting room", () => {
  const status = (over: Partial<RankedStatus> = {}): RankedStatus => ({
    season: "2026-11", seasonEndsAt: "2026-12-01T00:00:00.000Z", queue: null, matched: null, active: [],
    standing: { stars: 17, rank: sampleRank(17), streak: 0, wins: 3, losses: 2, games: 5 }, ...over
  });
  const queue = { cls: "mage", since: at(0), expiresAt: at(0.25) };

  it("goes idle, searching, matched and back, and keeps a found match until it is opened", () => {
    let s = rankedReducer(rankedStart, { type: "loaded", status: status() });
    expect(s.phase).toBe("idle");
    s = rankedReducer(rankedReducer(s, { type: "sending" }), { type: "loaded", status: status({ queue }) });
    expect(s.phase).toBe("searching");
    const found = { duel: duel({ id: "r1", kind: "ranked" }), view: null, events: [], rewards: null, ranked: null };
    s = rankedReducer(s, { type: "loaded", status: status({ matched: found }) });
    expect(s).toMatchObject({ phase: "matched", matched: { duel: { id: "r1" } } });
    s = rankedReducer(s, { type: "loaded", status: status() });
    expect(s.phase).toBe("matched");
    s = rankedReducer(s, { type: "opened" });
    expect(s).toMatchObject({ phase: "idle", matched: null });
  });

  it("leaves the queue and reports a refusal", () => {
    let s = rankedReducer(rankedStart, { type: "loaded", status: status({ queue }) });
    s = rankedReducer(s, { type: "left" });
    expect(s.phase).toBe("idle");
    expect(s.status?.queue).toBeNull();
    s = rankedReducer(s, { type: "failed", message: "You already have 5 matches in progress." });
    expect(s).toMatchObject({ busy: false, error: "You already have 5 matches in progress." });
  });

  it("shows the division's stars and whether losses cost a star", () => {
    expect(sampleRank(0)).toMatchObject({ label: "Initiate IV", starsInDivision: 0, starsToNext: 3 });
    expect(sampleRank(17)).toMatchObject({ label: "Adept III", starsInDivision: 2 });
    expect(sampleRank(60)).toMatchObject({ label: "Legend", legend: true });
    expect(divisionPips(sampleRank(17))).toEqual({ filled: 2, total: 3 });
    expect(divisionPips(sampleRank(30))).toEqual({ filled: 2, total: 4 });
    expect(divisionPips(sampleRank(60))).toEqual({ filled: 0, total: 0 });
    expect(lossesCostStars(sampleRank(20))).toBe(false);
    expect(lossesCostStars(sampleRank(30))).toBe(true);
  });

  it("names ranks in French", () => {
    expect(rankLabel(sampleRank(30), "fr")).toBe("Vétéran III");
    expect(rankLabelText("Elite I", "fr")).toBe("Élite I");
    expect(rankLabelText("Legend", "fr")).toBe("Légende");
  });
});

describe("ladders", () => {
  const entry = (position: number, you = false) => ({ position, name: `P${position}`, you, wins: 10 - position, losses: position });
  it("shows the top and your own row after a gap", () => {
    const board: LadderBoard = { id: "g", title: "Global", entries: [1, 2, 3, 4].map((n) => entry(n)), you: entry(37, true) };
    expect(ladderRows(board, 3).map((r) => r.kind === "gap" ? "…" : r.entry.position)).toEqual([1, 2, 3, "…", 37]);
    expect(ladderRows({ ...board, entries: [entry(1), entry(2, true)], you: entry(2, true) }, 3)).toHaveLength(2);
    expect(ladderRows({ id: "x", title: "x", entries: [], you: null })).toEqual([]);
  });
});

describe("pvp client", () => {
  const raw = {
    duel: { id: "d1", kind: "ranked", status: "active", direction: "match", seat: 1, yourTurn: true, live: false, you: { id: "me", cls: "mage" },
      opponent: { id: "o", name: "Hollis", cls: "hunter" }, season: "2026-11", round: 4, version: 9, turnSeconds: 86400, turnDeadlineAt: at(12), createdAt: at(-1) },
    view: { phase: "main", yourTurn: true, legal: [{ t: "end" }], me: { cls: "mage", hand: [], board: [] }, opponent: { cls: "hunter", handCount: 3, board: [] } },
    events: [{ t: "turn", p: 0 }, { nope: 1 }], ranked: null
  };

  it("parses a duel, keeps a pending one without a view, and rejects a broken answer", () => {
    const res = parseDuelResponse(raw);
    expect(res.duel).toMatchObject({ id: "d1", kind: "ranked", seat: 1, yourTurn: true, opponent: { name: "Hollis" } });
    expect(res.events).toHaveLength(1);
    expect(parseDuelResponse({ duel: { ...raw.duel, status: "weird", direction: "incoming" }, view: null }).duel).toMatchObject({ status: "active", direction: "incoming" });
    expect(parseDuelResponse({ duel: raw.duel, view: null }).view).toBeNull();
    expect(() => parseDuelResponse({ duel: {} })).toThrow("not understood");
  });

  it("draws a duel on the match screen with the opponent's name and the ranked result", () => {
    const res = parseDuelResponse({ ...raw, duel: { ...raw.duel, status: "won" }, ranked: { rated: true, season: "2026-11", stars: 18, starsDelta: 1, streak: 2, rank: { rank: "Adept", division: 2, label: "Adept II" } } });
    const shown = duelAsMatch(res)!;
    expect(shown.match).toMatchObject({ id: "d1", status: "won", version: 9, duel: { kind: "ranked", opponent: "Hollis", ranked: { starsDelta: 1, rank: { label: "Adept II" } } } });
    expect(duelAsMatch({ ...res, view: null })).toBeNull();
  });

  it("parses the ranked status and the ladder with safe defaults", () => {
    const st = parseRankedStatus({ season: "2026-11", seasonEndsAt: "2026-12-01T00:00:00.000Z", queue: { cls: "mage", since: at(0) }, standing: { stars: 3, rank: { rank: "Bogus" } }, active: [raw.duel, {}] });
    expect(st).toMatchObject({ queue: { cls: "mage" }, matched: null, standing: { stars: 3, rank: { rank: "Initiate", label: "Initiate" } } });
    expect(st.active).toHaveLength(1);
    expect(() => parseRankedStatus({ season: "x" })).toThrow("not understood");
    const ladder = parseLadder({ scope: "friendly", season: "2026-11", weekStart: at(-48), boards: [{ id: "g", title: "QG", entries: [{ position: 1, name: "A", wins: 3, losses: 0 }, { bad: true }], you: null }, { title: "no id" }] });
    expect(ladder).toMatchObject({ scope: "friendly", boards: [{ id: "g", entries: [{ name: "A", wins: 3 }] }] });
    expect(ladder.boards).toHaveLength(1);
  });

  it("calls the #644 routes with the credential, ids in the query or body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ClashClient("https://guilded.kcaron.top", "c".repeat(40), "en");
    await client.challenge({ to: "123", cls: "mage", live: true });
    await client.duel("d1", 9);
    await client.duelIntent("d1", { t: "end" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ scope: "global", season: "2026-11", weekStart: null, boards: [] }), { status: 200 }));
    await client.leaderboard("global", "2026-10");
    const calls = fetchMock.mock.calls as unknown as [URL, RequestInit][];
    expect(String(calls[0]![0])).toBe("https://guilded.kcaron.top/api/v1/companion/clash/challenge?lang=en");
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ to: "123", cls: "mage", live: true });
    expect(String(calls[1]![0])).toBe("https://guilded.kcaron.top/api/v1/companion/clash/duel?id=d1&since=9&lang=en");
    expect(calls[1]![1].method).toBe("GET");
    expect(JSON.parse(String(calls[2]![1].body))).toEqual({ id: "d1", action: { t: "end" } });
    expect(String(calls[3]![0])).toBe("https://guilded.kcaron.top/api/v1/companion/clash/leaderboard?scope=global&season=2026-10&lang=en");
  });
});

describe("sample duels", () => {
  it("accepts a challenge and plays it through the duel routes, the opponent answering after a wait", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const api = new MockClash();
    const before = await api.duels();
    const incoming = before.find((d) => d.direction === "incoming")!;
    expect(attentionCount(before, NOW)).toBe(2);
    const drive = duelDriver(api);
    let res = await api.accept(incoming.id, "mage");
    expect(res.duel.status).toBe("active");
    await drive.intent(incoming.id, { t: "mulligan", replace: [] });
    let shown = await drive.intent(incoming.id, { t: "end" });
    expect(shown.view.yourTurn).toBe(false);
    expect(shown.match.duel?.opponent).toBe("Cindra Vale");
    vi.setSystemTime(NOW + 3000);
    shown = await drive.match(incoming.id);
    expect(shown.view.yourTurn).toBe(true);
    res = await api.duelConcede(incoming.id);
    expect(res.duel.status).toBe("lost");
  });

  it("refuses a second challenge to the same guildmate and finds a ranked match after a few seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const api = new MockClash();
    const partners = await api.partners();
    await api.challenge({ to: partners[0]!.discordUserId, cls: "warrior", live: false });
    await expect(api.challenge({ to: partners[0]!.discordUserId, cls: "warrior", live: false })).rejects.toMatchObject({ status: 409 });
    expect((await api.joinRanked("priest")).queue?.cls).toBe("priest");
    expect((await api.ranked()).matched).toBeNull();
    vi.setSystemTime(NOW + 7000);
    const found = await api.ranked();
    expect(found.matched?.duel).toMatchObject({ kind: "ranked", opponent: { name: "Hollis Brightwater" } });
    expect(found.queue).toBeNull();
    const id = found.matched!.duel.id;
    const lost = await api.duelConcede(id);
    expect(lost.ranked).toMatchObject({ rated: true, starsDelta: 0 });
    expect((await api.leaderboard("friendly")).weekStart).not.toBeNull();
  });
});
