import { describe, expect, it } from "vitest";
import { communityBadgeIcon, communityBadgeLook, communityFinalCard, communityMilestoneCard, communitySeasonStartCard, communityShelfCard } from "../src/services/community-cards.js";
import { monthlyHonorsPost } from "../src/services/community-honors.js";
import { guildBankWeekCard } from "../src/services/guild-bank-card.js";
import { weeklyBankText } from "../src/services/guild-bank.js";
import { cardAltText } from "../src/services/card-alt.js";
import { scoreCardPng } from "../src/services/score-card.js";

const isPng = (png: Buffer | null) => png?.subarray(1, 4).toString() === "PNG";
const A = "11111111111111111", B = "22222222222222222", C = "33333333333333333";
const names = new Map([[A, "Simon"], [B, "Aldric"], [C, "Mira"]]);

describe("community badge art", () => {
  it("gives every badge code a painted emblem that exists on disk", () => {
    for (const code of ["community-100", "community-300", "community-500", "legacy-50", "legacy-150", "legacy-300", "helper", "attendee", "organizer"]) {
      expect(communityBadgeLook(code), code).not.toBeNull();
      expect(communityBadgeIcon(code), code).toContain("<badge-art ");
    }
    expect(communityBadgeLook("community-200")).toBeNull();
    expect(communityBadgeIcon("mystery")).toBe("");
  });
});

describe("community cards", () => {
  it("draws the milestone badge card in both languages", async () => {
    for (const lang of ["en", "fr"] as const) {
      const card = communityMilestoneCard(lang, "Simon", 300, "Season 4");
      expect(card.unlocks).toHaveLength(1);
      expect(card.unlocks![0]!.icon).toContain("guild-pouch");
      expect(cardAltText(card)).not.toBe("");
      expect(isPng(await scoreCardPng(card))).toBe(true);
    }
  });

  it("draws a badge shelf with several badges and a count of the rest", async () => {
    const badges = Array.from({ length: 10 }, (_, i) => ({ code: i < 3 ? ["community-100", "helper", "organizer"][i]! : `legacy-${[50, 150, 300][i % 3]}`, earnedAt: new Date(Date.UTC(2026, 10, i + 1)) }));
    const card = communityShelfCard("fr", "Simon", "Saison 4", badges);
    expect(card.unlocks).toHaveLength(8);
    expect(card.unlocksMore).toBe(2);
    expect(isPng(await scoreCardPng(card))).toBe(true);
    expect(isPng(await scoreCardPng(communityShelfCard("en", "Simon", "Season 4", badges.slice(0, 1))))).toBe(true);
  });

  it("draws the new season card", async () => {
    const card = communitySeasonStartCard("fr", "Saison de novembre", "Saison d'octobre");
    expect(card.title).toBe("Saison de novembre commence");
    expect(isPng(await scoreCardPng(card))).toBe(true);
  });

  it("draws the final top as a podium", async () => {
    const card = communityFinalCard("en", "November", [{ userId: A, points: 300 }, { userId: B, points: 250 }, { userId: C, points: 100 }], names, new Date("2026-11-30T12:00:00Z"));
    expect(card.ladder!.boards[0]!.rows.map(r => r.name)).toEqual(["Simon", "Aldric", "Mira"]);
    expect(card.ladder!.boards[0]!.rows[0]!.values).toEqual(["300", "0", "0", "300"]);
    expect(isPng(await scoreCardPng(card))).toBe(true);
  });

  it("queues the monthly post with its card and a reduced text", () => {
    const board = [{ userId: A, points: 300, balance: 0 }, { userId: B, points: 250, balance: 0 }];
    const post = monthlyHonorsPost("en", { name: "November", number: 4 }, board as never, names, null);
    expect(post.message.embeds).toHaveLength(1);
    expect(post.card.ladder!.boards[0]!.rows).toHaveLength(2);
    // The reduced message keeps the congratulations line and the notes but not the podium lines the card carries.
    expect(post.cardOnly.content).toContain("Simon");
    expect(post.cardOnly.embeds.length).toBe(2);
    expect(JSON.stringify(post.cardOnly.embeds)).not.toContain("🥇");
  });
});

describe("guild bank weekly card", () => {
  const rows = [
    { kind: "money", type: "deposit", actor: "Aldric", count: null, amount: 500000n },
    { kind: "item", type: "deposit", actor: "Mira", count: 12, amount: null },
    { kind: "item", type: "withdraw", actor: "Simon", count: 3, amount: null }
  ];
  const low = [{ itemId: 1, itemName: "Linen Cloth", have: 2, min: 20 }];
  it("draws figures, depositors and a low-stock pill", async () => {
    const card = guildBankWeekCard("fr", { goldNow: "500g", change: "+500g", changeTone: "green", logLines: 3, openRequests: 1, low, givers: [{ name: "Aldric", gift: "+50g" }] });
    expect(card.stats).toHaveLength(3);
    expect(card.badges![0]!.text).toContain("1 sous le minimum");
    expect(isPng(await scoreCardPng(card))).toBe(true);
    expect(isPng(await scoreCardPng(guildBankWeekCard("en", { goldNow: null, change: "", changeTone: null, logLines: 0, openRequests: 0, low: [], givers: [] })))).toBe(true);
  });
  it("keeps only the member lines and the low-stock list in the compact text", () => {
    const full = weeklyBankText(rows, 0n, 5_000_000n, "en", { low, openRequests: 2 })!;
    const compact = weeklyBankText(rows, 0n, 5_000_000n, "en", { low, openRequests: 2, compact: true })!;
    expect(full).toContain("Gold now");
    expect(full).toContain("Top depositors");
    expect(compact).not.toContain("Gold now");
    expect(compact).not.toContain("Top depositors");
    expect(compact).not.toContain("Open bank requests");
    expect(compact).toContain("Below minimum");
    expect(compact).toContain("**Aldric**");
  });
});
