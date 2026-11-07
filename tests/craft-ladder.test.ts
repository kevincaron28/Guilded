import { describe, expect, it, vi } from "vitest";
import { craftLadderCard, craftLadderEmbed, crafterStandings, recordCraftCompletion } from "../src/services/craft-ladder.js";
import { scoreCardPng } from "../src/services/score-card.js";
import { channelNames } from "../src/setup-names.js";

// 9.1 (owner, 7 November 2026): craft history, one point per finished craft, Top crafters card.
const NOW = new Date("2026-12-20T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const names = new Map([["a", { name: "Walter Sobchak", className: "Warrior" }], ["b", { name: "Dude Lebowski", className: "Mage" }], ["c", { name: "Donny Kerabatsos", className: null }]]);

describe("crafter standings", () => {
  const rows = [
    { crafterId: "a", points: 1, profession: "Blacksmithing", doneAt: day(40) },
    { crafterId: "a", points: 1, profession: "Blacksmithing", doneAt: day(2) },
    { crafterId: "a", points: 1, profession: "Mining", doneAt: day(1) },
    { crafterId: "b", points: 1, profession: "Tailoring", doneAt: day(3) },
    { crafterId: "b", points: 1, profession: "Tailoring", doneAt: day(5) },
    { crafterId: "c", points: 1, profession: null, doneAt: day(1) },
    { crafterId: "gone", points: 1, profession: null, doneAt: day(1) }
  ];

  it("counts a point per finished craft, ranks by points then this month, skips members who left", () => {
    const standings = crafterStandings(rows, names, NOW);
    expect(standings.map((s) => `${s.name} ${s.points}/${s.month} ${s.topProfession}`)).toEqual([
      "Walter Sobchak 3/2 Blacksmithing", "Dude Lebowski 2/2 Tailoring", "Donny Kerabatsos 1/1 null"
    ]);
  });

  it("draws the shared ladder layout with medals, class colours and French labels", async () => {
    const card = craftLadderCard(crafterStandings(rows, names, NOW), 7, "fr", NOW);
    expect(card.title).toBe("Meilleurs artisans");
    expect(card.ladder?.columns.map((c) => c.label)).toEqual(["Points", "30 j", "Métier"]);
    expect(card.ladder?.boards[0]?.rows[0]).toMatchObject({ rank: 1, name: "Walter Sobchak", values: ["3", "2", "Forge", ""] });
    expect(card.ladder?.boards[0]?.rows[2]?.values[2]).toBe("—");
    const png = await scoreCardPng(card);
    expect(png?.subarray(1, 4).toString()).toBe("PNG");
  });

  it("keeps the embed to the top 3 under a card and marks it for adoption", () => {
    const embed = craftLadderEmbed(crafterStandings(rows, names, NOW), "en", "g1", "top-crafters.png").toJSON();
    expect(embed.description?.split("\n")).toHaveLength(3);
    expect(embed.description).toContain("🥇 Walter Sobchak — 3 pt · 2 in 30 days");
    expect(embed.footer?.text).toBe("Guilded craft ladder • g1");
    expect(craftLadderEmbed([], "en", "g1").toJSON().description).toContain("No finished crafts yet");
  });
});

describe("craft history", () => {
  it("records a board request once, whoever marks it done again", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "x" });
    const create = vi.fn();
    const db = { craftCompletion: { upsert, create } } as never;
    await recordCraftCompletion(db, { guildId: "g", crafterId: "a", item: "Arcanite Reaper", quantity: 1, profession: "Blacksmithing", requestId: "r1", doneAt: NOW });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { requestId: "r1" }, update: {} }));
    expect(upsert.mock.calls[0]![0].create).toMatchObject({ points: 1, source: "board", requestId: "r1" });
    await recordCraftCompletion(db, { guildId: "g", crafterId: "a", item: "Flask", quantity: 1, profession: "Alchemy", source: "game" });
    expect(create.mock.calls[0]![0].data).toMatchObject({ source: "game", requestId: null });
  });

  it("has its own channel in the crafting category", () => {
    expect(channelNames("craftLadderChannelId")).toEqual(["top-crafters", "meilleurs-artisans"]);
  });
});
