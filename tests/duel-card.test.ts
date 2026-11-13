import { describe, expect, it, vi } from "vitest";
import { WINDOW_CARDS, duelResultCard, duelSummaryCard, queueDuelCards, standingsAfterEach, withStandings } from "../src/services/duel-card.js";
import { cardAltText } from "../src/services/card-alt.js";
import { emptyNameBook } from "../src/services/character-display.js";
import { scoreCardPng } from "../src/services/score-card.js";

const duel = (n: number, extra = {}) => ({ reportKey: `k${n}`, winnerId: "w", loserId: "l", winnerCharacter: "Aldric", loserCharacter: "Brenna", winnerLevel: 58, loserLevel: 60, reason: "knockout", endedAt: new Date(Date.UTC(2026, 10, 13, 12, n)), ...extra });
const history = (n: number) => Array.from({ length: n }, (_, i) => ({ reportKey: `k${i + 1}`, winnerId: "w", loserId: "l", winnerLevel: 58, loserLevel: 60 }));
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
