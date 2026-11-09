import { describe, expect, it } from "vitest";
import { crafterLine, professionEmoji, professionLegend, professionName, professionTitle, seenDot, skillBar, skillCap } from "../src/services/profession-style.js";
import { itemDetailLines, itemDetails, itemDetailsEmbed } from "../src/services/item-details.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe("profession display", () => {
  it("gives every profession an icon and a name in both languages, accepting either spelling", () => {
    expect(professionTitle("alchemy")).toBe("🧪 Alchemy");
    expect(professionTitle("Alchimie", "fr")).toBe("🧪 Alchimie");
    expect(professionName("Leatherworking", "fr")).toBe("Travail du cuir");
    expect(professionEmoji("Something New")).toBe("📚");
    expect(professionName("Something New", "fr")).toBe("Something New");
  });
  it("draws a skill bar against the cap and never an empty bar for a real skill", () => {
    expect(skillBar(300)).toBe("▰▰▰▰▰▰▰▰▰▰");
    expect(skillBar(150)).toBe("▰▰▰▰▰▱▱▱▱▱");
    expect(skillBar(1)).toBe("▰▱▱▱▱▱▱▱▱▱");
    expect(skillBar(null)).toBe("▱▱▱▱▱▱▱▱▱▱");
    expect(skillCap(250)).toBe(300);
    expect(skillCap(330)).toBe(375);
  });
  it("marks recency with a dot and prints one legend line", () => {
    expect([seenDot(ago(1), NOW), seenDot(ago(15), NOW), seenDot(ago(90), NOW), seenDot(null, NOW)]).toEqual(["🟢", "🟡", "⚪", "⚪"]);
    expect(professionLegend("en")).toContain("seen this week");
    expect(professionLegend("fr")).toContain("vu cette semaine");
    expect(crafterLine({ character: "Ann", skill: 225, lastSeen: ago(1) }, "yesterday", NOW)).toBe("🟢 **Ann** ▰▰▰▰▰▰▱▱ 225 · yesterday");
  });
});

describe("item Details (shared by the Discord button and the gallery)", () => {
  it("says only what is known: id, a Wowhead link and an honest note without an item source", async () => {
    const view = await itemDetails(7, "Elixir");
    expect(view.hasStats).toBe(false);
    expect(view.url).toBe("https://www.wowhead.com/classic/item=7");
    expect(itemDetailLines(view, "en").join(" ")).toContain("Stats are not available here yet");
    expect(itemDetailLines(view, "fr").join(" ")).toContain("Objet n° 7");
  });
  it("shows quality and summary when a provider vouches for them, and only an https link", async () => {
    const provider = { lookup: async () => ({ name: "Elixir of Power", quality: 3, summary: "Consumable", url: "http://evil.example/x", iconUrl: "https://cdn.example/i.png" }) };
    const view = await itemDetails(7, "Elixir", provider);
    expect(view.url).toBe("https://www.wowhead.com/classic/item=7");
    const json = itemDetailsEmbed(view, "en").toJSON();
    expect(json.description).toContain("Rare");
    expect(json.description).toContain("Consumable");
    expect(json.color).toBe(0x0070dd);
    expect(json.thumbnail?.url).toBe("https://cdn.example/i.png");
  });
  it("survives a failing provider", async () => {
    const view = await itemDetails(7, "Elixir", { lookup: async () => { throw new Error("down"); } });
    expect(view.name).toBe("Elixir");
  });
});
