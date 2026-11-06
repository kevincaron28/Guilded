import { describe, expect, it } from "vitest";
import { WHOS_WHO_MARKER, whoLine, whosWhoEmbeds, type WhoPerson } from "../src/services/whos-who-board.js";

const people = (n: number): WhoPerson[] => Array.from({ length: n }, (_, i) => ({ displayName: `Member ${String(i).padStart(3, "0")}`, main: `Main${i} Lastname${i}`, alts: i % 3 ? ["Alt One", "Alt Two"] : [] }));

describe("who's who board", () => {
  it("shows an empty state in one embed for 0 members", () => {
    const { embeds, shown } = whosWhoEmbeds({ people: [], members: 0 }, "fr", "g1");
    expect(embeds).toHaveLength(1);
    expect(shown).toBe(0);
    expect(embeds[0]!.toJSON().title).toBe("🪪 Qui est qui");
    expect(embeds[0]!.toJSON().footer?.text?.startsWith(`${WHOS_WHO_MARKER} • g1 •`)).toBe(true);
  });
  it("lists main in bold then alts, and escapes markdown", () => {
    expect(whoLine({ displayName: "**Kev**", main: "Halidor Galemorne", alts: ["A", "B", "C", "D", "E", "F"] })).toBe("\\*\\*Kev\\*\\* — **Halidor Galemorne** · A, B, C, D +2");
  });
  it("stays one message (at most 3 embeds, under Discord's 6000-character total) for 150 members", () => {
    const { embeds, shown } = whosWhoEmbeds({ people: people(150), members: 150 }, "en", "g1");
    expect(embeds.length).toBeLessThanOrEqual(3);
    const total = embeds.reduce((sum, e) => { const j = e.toJSON(); return sum + (j.title?.length ?? 0) + (j.description?.length ?? 0) + (j.footer?.text.length ?? 0); }, 0);
    expect(total).toBeLessThanOrEqual(6000);
    expect(shown).toBeGreaterThan(60);
    expect(embeds.at(-1)!.toJSON().footer?.text).toContain(`${shown} of 150`);
    expect(embeds.slice(0, -1).every((e) => !e.toJSON().footer)).toBe(true);
  });
});
