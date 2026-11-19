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
  card: { title: string; eyebrow: string; weekly: { mvp: { name: string; points: string }; top: { rank: number; name: string }[]; rookie?: { name: string; place: string }; stats: { icon: string }[] } };
  cardOnly: { content?: string; embeds: Record<string, unknown>[] };
  cardMember: string;
  extraCard?: unknown;
};
const run = (lang: "fr" | "en", over: Record<string, unknown>, mvps: string[], rookie: typeof board[number] | null, withRecap = true) =>
  weeklyPostCardExtra(lang, post(lang, over), "2026-11-09", mvps.length || rookie ? board : [], mvps, rookie, names, withRecap ? recap : undefined, new Map([[A, 2]])) as unknown as Extra;

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

  it("the whole weekly post is ONE card: week, MVP, top three, rookie and the guild's week; the text tags the MVP", async () => {
    for (const lang of ["fr", "en"] as const) {
      const extra = run(lang, {}, [A], board[3]!);
      expect(extra.card.title).toBe(lang === "fr" ? "La semaine du 9 novembre au 15 novembre" : "The week of November 9 to November 15");
      expect(extra.card.eyebrow).not.toMatch(/Guilded/);
      expect(extra.card.weekly.mvp.name).toBe("haraz5093");
      expect(extra.card.weekly.top.map(row => row.name)).toEqual(["haraz5093", "Bubble bubble", "Simon"]);
      expect(extra.card.weekly.rookie).toMatchObject({ name: "Newbie", place: "4/4" });
      expect(extra.card.weekly.stats.length).toBeGreaterThan(3);
      expect(extra.cardMember).toBe(A);
      // One picture-less embed, no second card, and the text line tags the MVP.
      expect(extra.extraCard).toBeUndefined();
      expect(extra.cardOnly.embeds).toEqual([{ color: 0x9b59b6 }]);
      expect(extra.cardOnly.content).toContain(`<@${A}>`);
      expect((await scoreCardPng(extra.card as never))?.subarray(1, 4).toString()).toBe("PNG");
    }
  });

  it("MVP only (no rookie): the same single card without a rookie panel", () => {
    const extra = run("en", { rookie: null }, [A], null);
    expect(extra.card.weekly.rookie).toBeUndefined();
    expect(extra.cardOnly.embeds).toHaveLength(1);
  });

  it("rookie only (no MVP): the rookie card is the post's card", () => {
    const extra = weeklyPostCardExtra("en", post("en", { mvps: [] }), "2026-11-09", board, [], board[3]!, names, recap) as unknown as { card: { title: string } };
    expect(extra.card.title).toBe("Newbie");
  });

  it("an MVP alone still gets the card", () => {
    const solo = weeklyPostCardExtra("en", post("en", { board: [board[0]!] }), "2026-11-09", [board[0]!], [A], null, names, recap) as unknown as Extra;
    expect(solo.card.weekly.top).toHaveLength(1);
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
