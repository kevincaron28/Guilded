import { describe, expect, it } from "vitest";
import { weeklyHonorsMessage, weeklyPostCardExtra } from "../src/services/community-honors.js";
import { weeklyMvpCard } from "../src/services/mvp-card.js";
import { cardAltText } from "../src/services/card-alt.js";
import { scoreCardPng } from "../src/services/score-card.js";

const A = "11111111111111111", B = "22222222222222222", C = "33333333333333333", D = "44444444444444444";
const board = [A, B, C, D].map((userId, i) => ({ userId, points: [241, 224, 212, 40][i]!, balance: 0 }));
const recap = { points: 717, members: 37, messages: 50, reactions: 9, voiceHours: 0, activities: 0, raids: 0, bossKills: 0, dungeonRuns: 0, newMembers: 1 };
const names = new Map([[A, "haraz5093"], [B, "Bubble bubble"], [C, "Simon"], [D, "Newbie"]]);
const post = (lang: "fr" | "en", over: Record<string, unknown> = {}) =>
  weeklyHonorsMessage(lang, { week: "2026-11-09", board, mvps: [A], recap, rookie: board[3]!, names, ...over } as never);
type Extra = {
  card: { title: string; rows?: { name: string }[]; stats: { value: string }[]; eyebrow: string };
  cardOnly: { content?: string; embeds: { description?: string; fields?: { name: string; value: string }[] }[] };
  cardMember: string;
  extraCard?: { card: { title: string; eyebrow: string; subtitle: string }; dropField: string; member?: string };
};
const run = (lang: "fr" | "en", over: Record<string, unknown>, mvps: string[], rookie: typeof board[number] | null) =>
  weeklyPostCardExtra(lang, post(lang, over), "2026-11-09", mvps.length || rookie ? board : [], mvps, rookie, names) as unknown as Extra;

describe("MVP of the week card", () => {
  it("is drawn for the MVP, with the next places as rows and the lead as a stat", async () => {
    const card = weeklyMvpCard("fr", { name: "haraz5093", points: 241, others: [{ name: "Bubble bubble", points: 224, place: 2 }, { name: "Simon", points: 212, place: 3 }], lead: 17 });
    expect(card.eyebrow).toBe("Guilded · MVP de la semaine");
    expect(card.title).toBe("haraz5093");
    expect(card.stats.map(s => s.value)).toEqual(["241", "+17"]);
    expect(card.rows!.map(r => r.name)).toEqual(["Bubble bubble", "Simon"]);
    expect(cardAltText(card)).toContain("MVP");
    expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
    expect(weeklyMvpCard("en", { name: "A", points: 1, others: [] }).rows).toBeUndefined();
  });

  it("MVP + rookie: the MVP card first, the rookie card second, each fact once across both cards and the text", () => {
    for (const lang of ["fr", "en"] as const) {
      const extra = run(lang, {}, [A], board[3]!);
      expect(extra.card.title).toBe("haraz5093");
      expect(extra.cardMember).toBe(A);
      expect(extra.extraCard!.card.title).toBe("Newbie");
      expect(extra.extraCard!.card.eyebrow).toBe(lang === "fr" ? "Guilded · Recrue de la semaine" : "Guilded · Rookie of the week");
      expect(extra.extraCard!.card.subtitle).toMatch(/MVP/);
      expect(extra.extraCard!.member).toBe(D);
      // The rookie is not repeated in the MVP card's rows.
      expect(extra.card.rows!.map(r => r.name)).toEqual(["Bubble bubble", "Simon"]);
      const embeds = extra.cardOnly.embeds;
      const text = JSON.stringify(embeds);
      expect(text).not.toMatch(/Top of the week|Le top de la semaine/);
      expect(text).not.toContain("224");
      expect(embeds[0]!.description).toMatch(/MVP/);
      expect(embeds[0]!.fields!.map(f => f.name).some(name => /guild's week|semaine de la guilde/.test(name))).toBe(true);
      // Two picture-less embeds, one per card. The rookie text line stays in the stored message; the delivery drops it when the second card drew.
      expect(embeds.slice(-2)).toEqual([{ color: 0x9b59b6 }, { color: 0x2ecc71 }]);
      const rookie = embeds[0]!.fields!.find(f => /Rookie|Recrue/.test(f.name))!;
      expect(rookie.name).toBe(extra.extraCard!.dropField);
      expect(rookie.value).toContain("Newbie");
      expect(rookie.value).toMatch(/4(th|e)/);
      expect(extra.cardOnly.content).toMatch(/Congratulations|Bravo/);
    }
  });

  it("MVP only (no rookie): one card, one picture-less embed, no rookie field", () => {
    const extra = run("en", { rookie: null }, [A], null);
    expect(extra.card.title).toBe("haraz5093");
    expect(extra.extraCard).toBeUndefined();
    expect(extra.cardOnly.embeds.filter(e => Object.keys(e).every(k => k === "color"))).toHaveLength(1);
    expect(JSON.stringify(extra.cardOnly.embeds)).not.toContain("Rookie");
  });

  it("rookie only (no MVP): the rookie card is the post's card", () => {
    const extra = run("en", { mvps: [] }, [], board[3]!);
    expect(extra.card.title).toBe("Newbie");
    expect(extra.extraCard).toBeUndefined();
  });

  it("neither: no card; the text post is unchanged", () => {
    expect(run("en", { mvps: [], rookie: null }, [], null)).toEqual({});
  });

  it("without the cards the full message keeps the top list and the rookie line", () => {
    const text = JSON.stringify(post("fr").embeds);
    expect(text).toContain("Le top de la semaine");
    expect(text).toContain("**224 pts**");
    expect(text).toContain("Recrue de la semaine");
  });
});
