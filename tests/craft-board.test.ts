import { describe, expect, it, vi } from "vitest";
import { boardTagNames, craftEmbed, ensureBoardTags, threadTitle } from "../src/commands/craft-board.js";

const request = (extra: Record<string, unknown> = {}) => ({
  id: "r1", item: "Flask of the Titans", quantity: 2, profession: "Alchemy", note: "I have the herbs", materialsProvided: true,
  status: "OPEN" as const, createdAt: new Date("2026-10-01T20:00:00Z"),
  requester: { discordUserId: "u1", displayName: "Kev" }, crafter: null, ...extra
});

describe("craft board", () => {
  it("titles a post with its status and item, within Discord's 100 characters", () => {
    expect(threadTitle(request())).toBe("🟢 2× Flask of the Titans");
    expect(threadTitle(request({ status: "CLAIMED" }))).toBe("🟡 2× Flask of the Titans");
    expect(threadTitle(request({ status: "DONE" }))).toBe("✅ 2× Flask of the Titans");
    expect(threadTitle(request({ item: "x".repeat(300) })).length).toBeLessThanOrEqual(100);
  });

  it("fits a forum's 20-tag limit: four statuses plus professions", () => {
    const tags = boardTagNames();
    expect(tags.length).toBeLessThanOrEqual(20);
    expect(tags.slice(0, 4)).toEqual(["🟢 Open", "🟡 Claimed", "✅ Done", "⛔ Cancelled"]);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("shows who asked, who crafts it, the note and the guild crafters while it is open", () => {
    const embed = craftEmbed(request(), ["Amy (300)", "Bob (275)"]).toJSON();
    expect(embed.title).toContain("2× Flask of the Titans");
    expect(embed.description).toBe("I have the herbs");
    const fields = Object.fromEntries((embed.fields ?? []).map((f) => [f.name, f.value]));
    expect(fields["Asked by"]).toBe("<@u1>");
    expect(fields["Crafter"]).toBe("nobody yet");
    expect(fields["Guild Alchemy crafters"]).toBe("Amy (300), Bob (275)");
    const claimed = craftEmbed(request({ status: "CLAIMED", crafter: { discordUserId: "u2", displayName: "Amy" } }), []).toJSON();
    expect(claimed.fields?.find((f) => f.name === "Crafter")?.value).toBe("<@u2>");
    // Finished posts drop the crafter suggestions.
    const done = craftEmbed(request({ status: "DONE" }), ["Amy (300)"]).toJSON();
    expect(done.fields?.some((f) => f.name.startsWith("Guild "))).toBe(false);
  });

  it("adds only the tags a forum is missing and never exceeds 20", async () => {
    const existing = [{ id: "1", name: "🟢 Open" }, { id: "2", name: "Custom" }];
    const setAvailableTags = vi.fn(async () => undefined);
    await ensureBoardTags({ availableTags: existing, setAvailableTags } as never);
    const sent = (setAvailableTags.mock.calls[0] as unknown as [{ name: string }[]])[0];
    expect(sent.length).toBeLessThanOrEqual(20);
    expect(sent.slice(0, 2)).toEqual(existing);
    expect(sent.filter((tag) => tag.name === "🟢 Open")).toHaveLength(1);
    // A forum that already has everything is left alone.
    const complete = vi.fn(async () => undefined);
    await ensureBoardTags({ availableTags: boardTagNames().map((name, i) => ({ id: String(i), name })), setAvailableTags: complete } as never);
    expect(complete).not.toHaveBeenCalled();
  });
});
