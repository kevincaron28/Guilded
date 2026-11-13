import { describe, expect, it } from "vitest";
import { weeklyHonorsMessage, weeklyRookieCardExtra } from "../src/services/community-honors.js";
import { weeklyRookieCard } from "../src/services/rookie-card.js";
import { cardAltText } from "../src/services/card-alt.js";
import { scoreCardPng } from "../src/services/score-card.js";

const board = [{ userId: "11111111111111111", points: 120, balance: 120 }, { userId: "22222222222222222", points: 40, balance: 40 }];
const recap = { points: 160, members: 2, messages: 50, reactions: 9, voiceHours: 0, activities: 0, raids: 0, bossKills: 0, dungeonRuns: 0, newMembers: 1 };
const names = new Map([["11111111111111111", "Aldric"], ["22222222222222222", "Brenna"]]);
const message = () => weeklyHonorsMessage("en", { week: "2026-12-07", board, mvps: ["11111111111111111"], recap, rookie: board[1]!, names } as never);

describe("rookie of the week card", () => {
  it("draws the card with the member's place and points", async () => {
    const card = weeklyRookieCard("en", { name: "Brenna", points: 40, place: 2, ranked: 2, week: "2026-12-07" });
    expect(card.backdrop).toEqual({ kind: "board", key: "rookie-of-the-week", fallbackKey: "activity" });
    expect(card.stats.map(s => s.value)).toEqual(["40", "2/2", "2026-12-07"]);
    expect(cardAltText(card)).toContain("Rookie of the week");
    expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
    expect(weeklyRookieCard("fr", { name: "B", points: 1, place: 1, ranked: 1, week: "w" }).title).toBe("Recrue de la semaine");
  });

  it("moves the rookie line from the text to the card, keeps the rest, adds the avatar request", () => {
    const m = message();
    expect(JSON.stringify(m.embeds)).toContain("Rookie of the week");
    const extra = weeklyRookieCardExtra("en", m, "2026-12-07", board, board[1], names) as { card: { subtitle: string }; cardOnly: { content?: string; embeds: { fields?: { name: string }[]; title?: string }[] }; cardMember: string };
    expect(extra.card.subtitle).toBe("Brenna");
    expect(extra.cardMember).toBe("22222222222222222");
    const text = JSON.stringify(extra.cardOnly.embeds);
    expect(text).not.toContain("Rookie of the week");
    expect(text).toContain("Top of the week");
    expect(extra.cardOnly.content).toContain("Congratulations");
    expect(extra.cardOnly.embeds.at(-1)).toEqual({ color: 0x9b59b6 });
  });

  it("adds nothing when nobody qualifies as rookie", () => {
    expect(weeklyRookieCardExtra("en", message(), "2026-12-07", board, null, names)).toEqual({});
  });
});
