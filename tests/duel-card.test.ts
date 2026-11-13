import { describe, expect, it, vi } from "vitest";
import { DUEL_CARDS_PER_IMPORT, duelResultCard, duelSummaryCard, queueDuelCards, withStandings } from "../src/services/duel-card.js";
import { cardAltText } from "../src/services/card-alt.js";
import { emptyNameBook } from "../src/services/character-display.js";
import { scoreCardPng } from "../src/services/score-card.js";

const duel = (n: number, extra = {}) => ({ reportKey: `k${n}`, winnerId: "w", loserId: "l", winnerCharacter: "Aldric", loserCharacter: "Brenna", winnerLevel: 58, loserLevel: 60, reason: "knockout", endedAt: new Date("2026-11-13T12:00:00Z"), ...extra });
const classes = new Map([["aldric", "Warrior"], ["brenna", "Mage"]]);
const standings = [{ memberId: "w", score: 52, streak: 3, bestStreak: 4 }];

describe("duel cards", () => {
  it("scores the duel by level and shows the winner's standing", () => {
    const [d] = withStandings([duel(1)], standings);
    expect(d).toMatchObject({ points: 14, winnerScore: 52, winnerStreak: 3, winnerBest: 4 });
    const card = duelResultCard(d!, "en", classes, emptyNameBook);
    expect(card.backdrop).toEqual({ kind: "board", key: "duel" });
    expect(card.subtitle).toBe("Won by knockout");
    expect(card.stats.map(s => s.value)).toEqual(["+14", "58 vs 60", "W3"]);
    expect(card.rows?.[0]?.color).toBe("#c79c6e");
    expect(cardAltText(card)).toContain("Duel result");
  });

  it("speaks French and marks a fled duel", () => {
    const [d] = withStandings([duel(1, { reason: "retreat" })], []);
    const card = duelResultCard(d!, "fr", classes, emptyNameBook);
    expect(card.title).toBe("Résultat du duel");
    expect(card.subtitle).toBe("Adversaire en fuite");
    expect(card.footer).toContain("guildedwow.com");
  });

  it("draws both cards", async () => {
    const ds = withStandings([duel(1), duel(2)], standings);
    expect((await scoreCardPng(duelResultCard(ds[0]!, "en", classes, emptyNameBook)))?.subarray(1, 4).toString()).toBe("PNG");
    expect((await scoreCardPng(duelSummaryCard(ds, "en", classes, emptyNameBook)))?.subarray(1, 4).toString()).toBe("PNG");
  });

  it("queues one card per duel up to the limit and folds the rest into one summary", async () => {
    const jobs: { key: string; payload: Record<string, unknown> }[] = [];
    const database = { duelResult: { findMany: vi.fn().mockResolvedValue([]) },
      discordJob: { upsert: vi.fn(async ({ create }: { create: { key: string; payload: Record<string, unknown> } }) => { jobs.push(create); return { id: create.key }; }) } } as never;
    const n = await queueDuelCards(database, "g", "forever", "c1", "en", Array.from({ length: 5 }, (_, i) => duel(i)), classes, emptyNameBook);
    expect(n).toBe(DUEL_CARDS_PER_IMPORT + 1);
    expect(jobs.map(j => j.key)).toEqual(["duel-card:k0", "duel-card:k1", "duel-card:k2", "duel-card:k3:more"]);
    expect(jobs[0]!.payload).toMatchObject({ channelId: "c1", cardOnly: { embeds: [{ color: 0xb91c1c }] } });
    expect(jobs[0]!.payload["route"]).toBeUndefined();
    expect(JSON.stringify(jobs[0]!.payload["message"])).toContain("Aldric");
    expect(await queueDuelCards(database, "g", "forever", "c1", "en", [], classes, emptyNameBook)).toBe(0);
  });
});
