import { describe, expect, it } from "vitest";
import { communityLeaderboardCard } from "../src/services/community-leaderboard.js";
import { weeklyHonorsMessage } from "../src/services/community-honors.js";
import { weeklyRookieCard } from "../src/services/rookie-card.js";
import { pvpGroupEmbed, type PvpPostData } from "../src/services/pvp-group-post.js";
import { ratingEmbed, type RatingRow } from "../src/services/dungeon-rating.js";

// The principle (16 Nov 2026): a post that carries a card says each fact once. The card has the table and the figures; the text keeps
// what the card does not show. Without the card (not drawn, cards off) the text carries everything.

describe("rookie of the week card", () => {
  it("repeats neither the points nor the place in its rows", () => {
    for (const lang of ["fr", "en"] as const) {
      const card = weeklyRookieCard(lang, { name: "El Pirata", points: 211, place: 4, ranked: 37, week: "2026-11-09" });
      const rows = JSON.stringify(card.rows);
      expect(rows).not.toContain("211");
      expect(rows).not.toMatch(/\b4(e|th)\b|rang|Place/i);
      expect(card.rows).toHaveLength(1);
      expect(card.rows![0]!.name).toBe(lang === "fr" ? "Devant 33 membres" : "Ahead of 33 members");
      expect(card.stats.map(s => s.value)).toContain("211");
      expect(card.stats.map(s => s.value)).toContain("4/37");
    }
  });
  it("still says something when the rookie is first", () => {
    const card = weeklyRookieCard("en", { name: "A", points: 9, place: 3, ranked: 3, week: "w" });
    expect(card.rows![0]!.name).toBe("Among everyone who scored");
  });
});

describe("community podium post", () => {
  const board = [{ userId: "a", points: 532, balance: 0, discord: 357, dungeons: 175, pvp: 0 }, { userId: "b", points: 100, balance: 0, discord: 100, dungeons: 0, pvp: 0 }];
  const input = { lang: "fr" as const, discordId: "g", season: { id: "s", name: "Season 1", status: "ACTIVE" }, board, names: new Map([["a", "Kevin"], ["b", "Brenna"]]) };
  it("with the card: no top list in the text, only the gang's total", () => {
    const embed = communityLeaderboardCard({ ...input, image: "c.png" }).embeds[0]!;
    const text = JSON.stringify(embed);
    expect(text).not.toContain("Kevin");
    expect(text).not.toContain("🥇");
    expect(embed.fields).toHaveLength(1);
    expect(embed.fields![0]!.value).toBe("**632 pts**");
    expect(embed.footer!.text).toContain("Ex æquo");
    expect(embed.image!.url).toBe("attachment://c.png");
  });
  it("without the card: the full top list and the participants line", () => {
    const embed = communityLeaderboardCard(input).embeds[0]!;
    expect(embed.fields![0]!.value).toContain("**Kevin** — **532 pts** · 💬 357 · 🏰 175 · ⚔️ 0");
    expect(embed.fields![1]!.value).toBe("2 participants · **632 pts**");
    expect(embed.image).toBeUndefined();
  });
});

describe("weekly honors post", () => {
  it("says the MVP's points once, in the top of the week", () => {
    const board = [{ userId: "1", points: 120, balance: 0 }, { userId: "2", points: 40, balance: 0 }];
    const recap = { points: 160, members: 2, messages: 0, reactions: 0, voiceHours: 0, activities: 0, raids: 0, bossKills: 0, dungeonRuns: 0, newMembers: 0 };
    const message = weeklyHonorsMessage("fr", { week: "2026-11-09", board, mvps: ["1"], recap, names: new Map([["1", "Haraz"]]) } as never);
    expect(message.embeds[0]!.description).not.toContain("120");
    expect(message.embeds[0]!.fields![0]!.value).toContain("**120 pts**");
  });
});

describe("PvP group post", () => {
  const data: PvpPostData = { id: "g", title: "WSG", size: 10, status: "OPEN", createdAt: new Date("2026-11-07T18:00:00Z"), minLevel: 20, maxLevel: 29, leaderDiscordId: "42", voiceChannelId: null,
    members: [{ name: "Aria", role: "TANK" }], waiting: [{ name: "Eli", role: "DPS" }] };
  it("with the picture: no roster by role, no size and bracket line", () => {
    const json = pvpGroupEmbed(data, "en", "p.png").toJSON();
    expect(JSON.stringify(json)).not.toContain("Aria");
    expect(json.description).toContain("Closes");
    expect(json.description).not.toContain("Bracket");
    expect(json.fields!.map(f => f.name)).toEqual(["Leader", "Queue (1)"]);
  });
  it("without the picture: the full text", () => {
    const json = pvpGroupEmbed(data, "en").toJSON();
    expect(json.description).toContain("Bracket 20-29");
    expect(json.fields!.map(f => f.name)).toContain("🛡️ Tank (1)");
  });
});

describe("dungeon rating embed", () => {
  const rows = [{ memberId: "m", name: "Hero", points: 321, dungeons: 3 }] as unknown as RatingRow[];
  it("keeps its rows without the picture and drops them with it", () => {
    expect(ratingEmbed(rows, "Season 1", "en").toJSON().description).toContain("Hero");
    expect(ratingEmbed(rows, "Season 1", "en", undefined, undefined, true).toJSON().description).not.toContain("Hero");
  });
});
