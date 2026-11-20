import { describe, expect, it, vi } from "vitest";
import { WINDOW_CARDS, duelResultCard, duelSummaryCard, queueDuelCards, standingsAfterEach, withStandings } from "../src/services/duel-card.js";
import { cardAltText } from "../src/services/card-alt.js";
import { emptyNameBook } from "../src/services/character-display.js";
import { scoreCardPng } from "../src/services/score-card.js";
import sharp from "sharp";

const duel = (n: number, extra = {}) => ({ reportKey: `k${n}`, winnerId: "w", loserId: "l", winnerCharacter: "Aldric", loserCharacter: "Brenna", winnerLevel: 58, loserLevel: 60, reason: "knockout", endedAt: new Date(Date.UTC(2026, 10, 13, 12, n)), ...extra });
const history = (n: number) => Array.from({ length: n }, (_, i) => ({ reportKey: `k${i + 1}`, winnerId: "w", loserId: "l", winnerLevel: 58, loserLevel: 60, endedAt: new Date(Date.UTC(2026, 10, 13, 11, i)) }));
const classes = new Map([["aldric", "Warrior"], ["brenna", "Mage"]]);

function fakeDb(existingOne = 0, existingMore: { status: string; payload: unknown } | null = null, rows = history(5)) {
  const jobs = new Map<string, Record<string, unknown> & { payload: Record<string, unknown> }>();
  const database = { duelResult: { findMany: vi.fn().mockResolvedValue(rows) },
    discordJob: { count: vi.fn().mockResolvedValue(existingOne), findUnique: vi.fn().mockResolvedValue(existingMore),
      upsert: vi.fn(async ({ where, create }: { where: { guildId_key: { key: string } }; create: { payload: Record<string, unknown> } }) => { jobs.set(where.guildId_key.key, create as never); return { id: where.guildId_key.key }; }) } } as never;
  return { database, jobs };
}

describe("duel cards", () => {
  it("shows the standing after EACH duel, not the end-of-upload standing", () => {
    const after = standingsAfterEach(history(3), new Set(["k1", "k2", "k3"]));
    expect([...after.values()].map(s => `${s.score}/${s.streak}`)).toEqual(["14/1", "28/2", "42/3"]);
    const cards = withStandings([duel(1), duel(2), duel(3)], after).map(d => duelResultCard(d, "en", classes, emptyNameBook));
    expect(cards[0]!.stats[0]!.note).toBe("14 in total");
    expect(cards[2]!.stats[2]!.value).toBe("W3");
  });

  it("hides the streak stat when there is no streak", () => {
    const [d] = withStandings([duel(1)], new Map());
    const card = duelResultCard(d!, "en", classes, emptyNameBook);
    expect(card.stats.map(s => s.label)).toEqual(["Points", "Levels"]);
    const streaking = withStandings([duel(1), duel(2)], standingsAfterEach(history(2), new Set(["k1", "k2"])));
    expect(duelResultCard(streaking[1]!, "en", classes, emptyNameBook).stats.map(s => s.label)).toEqual(["Points", "Levels", "Streak"]);
  });

  it("scores by level, speaks French and marks a fled duel", () => {
    const [d] = withStandings([duel(1, { reason: "retreat" })], new Map());
    expect(d).toMatchObject({ points: 14 });
    const card = duelResultCard(d!, "fr", classes, emptyNameBook);
    expect(card.title).toBe("Résultat du duel");
    expect(card.subtitle).toBe("Adversaire en fuite");
    expect(card.footer).toContain("guildedwow.com");
    expect(card.backdrop).toEqual({ kind: "board", key: "duel" });
    expect(cardAltText(card)).toContain("Résultat du duel");
  });

  it("draws both cards", async () => {
    const ds = withStandings([duel(1), duel(2)], new Map());
    expect((await scoreCardPng(duelResultCard(ds[0]!, "en", classes, emptyNameBook)))?.subarray(1, 4).toString()).toBe("PNG");
    expect((await scoreCardPng(duelSummaryCard(ds, "en", classes, emptyNameBook)))?.subarray(1, 4).toString()).toBe("PNG");
  });

  it("queues singles through the duelCard route, delayed, with picture retries and the text fallback", async () => {
    const { database, jobs } = fakeDb();
    const now = new Date("2026-11-13T12:00:00Z");
    expect(await queueDuelCards(database, "g", "forever", "en", [duel(1), duel(2)], classes, emptyNameBook, now)).toBe(2);
    const job = jobs.get("duel-card:one:k1")!;
    expect(job.payload).toMatchObject({ route: "duelCard", retryCard: true, cardOnly: { embeds: [{ color: 0xb91c1c }] } });
    expect(job.payload["channelId"]).toBeUndefined();
    expect((job["nextAttemptAt"] as Date).getTime()).toBeGreaterThan(now.getTime());
    expect(JSON.stringify(job.payload["message"])).toContain("Aldric");
  });

  it("limits a SERVER to WINDOW_CARDS singles per window across uploads and folds the rest into one summary", async () => {
    const { database, jobs } = fakeDb(WINDOW_CARDS - 1);
    const n = await queueDuelCards(database, "g", "forever", "en", [duel(1), duel(2), duel(3)], classes, emptyNameBook, new Date("2026-11-13T12:00:00Z"));
    expect(n).toBe(2);
    expect([...jobs.keys()].filter(k => k.startsWith("duel-card:one:"))).toEqual(["duel-card:one:k1"]);
    const summary = [...jobs.entries()].find(([k]) => k.startsWith("duel-card:more:"))!;
    expect((summary[1].payload["duels"] as unknown[]).length).toBe(2);
  });

  it("adds later overflow to the summary still waiting, and starts a new one once it has posted", async () => {
    const earlier = [duel(1), duel(2)].map(d => ({ ...d, points: 14, winnerScore: 0, winnerStreak: 0, winnerBest: 0 }));
    const now = new Date("2026-11-13T12:00:00Z");
    const waiting = fakeDb(WINDOW_CARDS, { status: "PENDING", payload: { duels: earlier } });
    await queueDuelCards(waiting.database, "g", "forever", "en", [duel(3)], classes, emptyNameBook, now);
    expect([...waiting.jobs.values()][0]!.payload["duels"]).toHaveLength(3);
    const posted = fakeDb(WINDOW_CARDS, { status: "DONE", payload: { duels: earlier } });
    await queueDuelCards(posted.database, "g", "forever", "en", [duel(3)], classes, emptyNameBook, now);
    expect([...posted.jobs.keys()][0]).toMatch(/^duel-card:more:\d+:k3$/);
    expect([...posted.jobs.values()][0]!.payload["duels"]).toHaveLength(1);
    expect(await queueDuelCards(posted.database, "g", "forever", "en", [], classes, emptyNameBook, now)).toBe(0);
  });
});

describe("duel face-off card (21 Nov 2026)", () => {
  const rating = { winnerDelta: 1, loserDelta: -1, winnerScore: 1001, loserScore: 999, winnerPlacement: null, loserPlacement: null, rated: true, seasonId: "2026-11", startsAt: "2026-11-04T23:00:00Z" };
  const meta = async (card: Parameters<typeof scoreCardPng>[0]) => sharp((await scoreCardPng(card))!).metadata();

  it("groups each side's change and new rating, in both languages", () => {
    const [d] = withStandings([duel(1)], new Map());
    const fr = duelResultCard({ ...d!, rating }, "fr", classes, emptyNameBook).duel!;
    expect(fr).toMatchObject({ label: "Résultat du duel", outcome: "Victoire par K.O.", levels: "Niv. 58 vs 60" });
    expect(fr.winner).toMatchObject({ delta: "+1", standing: "→ 1001", tone: "green", tag: "Gagnant" });
    expect(fr.loser).toMatchObject({ delta: "-1", standing: "→ 999", tone: "red", tag: "Vaincu" });
    expect(duelResultCard({ ...d!, rating }, "en", classes, emptyNameBook).duel!.outcome).toBe("Won by knockout");
  });

  it("draws at the unchanged card size with long names, unknown levels, no rating change and no portrait", async () => {
    const [d] = withStandings([duel(1, { winnerCharacter: "Aldric-de-la-Vallée-des-Tempêtes-Sombres-et-Brumeuses", winnerLevel: null, loserLevel: null })], new Map());
    expect(await meta(duelResultCard({ ...d!, rating }, "fr", classes, emptyNameBook))).toMatchObject({ width: 1200, height: 630 });
    expect(duelResultCard({ ...d!, rating }, "fr", classes, emptyNameBook).duel!.levels).toBeUndefined();
    expect(await meta(duelResultCard({ ...d!, rating: { ...rating, rated: false, winnerDelta: 0, loserDelta: 0 } }, "en", classes, emptyNameBook))).toMatchObject({ width: 1200, height: 630 });
    expect(await meta(duelResultCard(d!, "en", classes, emptyNameBook))).toMatchObject({ width: 1200, height: 630 });
  }, 60_000);

  it("keeps every string at 24 px or more with enough contrast on a bright painting", async () => {
    const { renderDuelFaceOff } = await import("../src/services/card-duel.js");
    const { assertCardRules } = await import("../src/services/card-kit.js");
    const [d] = withStandings([duel(1)], new Map());
    const card = duelResultCard({ ...d!, rating }, "fr", classes, emptyNameBook);
    const art = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#d98a3a" } }).jpeg().toBuffer();
    const { report } = await renderDuelFaceOff(card.duel!, art);
    expect(() => assertCardRules(report)).not.toThrow();
  }, 60_000);

  it("an older queued duel card without the face-off still draws the list layout", async () => {
    const [d] = withStandings([duel(1)], new Map());
    const { duel: gone, ...old } = duelResultCard({ ...d!, rating }, "fr", classes, emptyNameBook);
    void gone;
    expect(await meta(old)).toMatchObject({ width: 1200 });
  }, 60_000);
});
