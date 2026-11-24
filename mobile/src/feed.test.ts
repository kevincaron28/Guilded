import { describe, expect, it } from "vitest";
import { byDay, feedLine, money, parseFeed } from "./feed";

describe("guild activity feed", () => {
  it("keeps good rows and leaves out unknown kinds and broken rows", () => {
    const feed = parseFeed({ days: 14, items: [
      { kind: "join", at: "2026-11-24T18:00:00Z", actor: "Aelira" },
      { kind: "teleport", at: "2026-11-24T18:00:00Z", actor: "Borin" },
      { kind: "promote", at: "bad date", actor: "Mira", target: "Borin" },
      { kind: "donation", at: "2026-11-23T12:00:00Z", actor: "Borin", copper: 123456 },
      "nonsense"
    ] });
    expect(feed.items.map((item) => item.kind)).toEqual(["join", "donation"]);
    expect(parseFeed(null)).toEqual({ days: 14, items: [] });
  });
  it("writes gold the way the game does", () => {
    expect(money(123456)).toBe("12g 34s 56c");
    expect(money(50000)).toBe("5g");
    expect(money(0)).toBe("0c");
  });
  it("writes each event in the member's language", () => {
    expect(feedLine({ kind: "promote", at: "", actor: "Mira", target: "Borin", rank: "Officer" }, "en")).toBe("Mira promoted Borin to Officer");
    expect(feedLine({ kind: "donation", at: "", actor: "Borin", item: "Linen Cloth", count: 20 }, "fr")).toBe("Borin a donné 20 × Linen Cloth à la banque de guilde");
    expect(feedLine({ kind: "raidKill", at: "", actor: "Lucifron", boss: "Lucifron", instance: "Molten Core" }, "en")).toBe("Lucifron defeated (Molten Core)");
    expect(feedLine({ kind: "leave", at: "", actor: "Cindra" }, "fr")).toBe("Cindra a quitté la guilde");
  });
  it("groups by day, newest first", () => {
    const groups = byDay([
      { kind: "join", at: "2026-11-24T18:00:00", actor: "A" }, { kind: "join", at: "2026-11-24T08:00:00", actor: "B" }, { kind: "join", at: "2026-11-22T08:00:00", actor: "C" }
    ], "en");
    expect(groups.map((group) => group.items.length)).toEqual([2, 1]);
  });
});
