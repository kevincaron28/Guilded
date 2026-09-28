import { describe, expect, it, vi } from "vitest";
import {
  DUNGEON_GUIDE_CREATE_ID, DUNGEON_GUIDE_KIND_ID, dungeonSignupGuideComponents, dungeonSignupGuideText, ensureDungeonSignupGuide
} from "../src/services/dungeon-guide.js";

describe("dungeon signup guide", () => {
  it("explains the group finder and offers a menu of every kind in both languages", () => {
    expect(dungeonSignupGuideText("en")).toContain("Group finder");
    expect(dungeonSignupGuideText("fr")).toContain("Recherche de groupe");
    for (const lang of ["en", "fr"] as const) {
      const component = dungeonSignupGuideComponents(lang)[0]!.toJSON().components[0]! as { custom_id?: string; options?: { value: string }[] };
      expect(component.custom_id).toBe(DUNGEON_GUIDE_KIND_ID);
      expect(component.options?.map((option) => option.value)).toEqual(["DUNGEON", "LEVELING", "PVP", "WORLDPVP", "WORLD", "OTHER"]);
    }
  });

  it("posts and pins only one guide when run repeatedly", async () => {
    const pins: Array<{
      author: { id: string };
      components: Array<{ components: Array<{ customId?: string }> }>;
      pinned: boolean;
      edit: ReturnType<typeof vi.fn>;
      pin: ReturnType<typeof vi.fn>;
    }> = [];
    const posted = {
      author: { id: "bot" },
      components: [{ components: [{ customId: DUNGEON_GUIDE_CREATE_ID }] }],
      pinned: false,
      edit: vi.fn(async () => posted),
      pin: vi.fn(async () => { posted.pinned = true; })
    };
    const channel = {
      client: { user: { id: "bot" } },
      messages: {
        fetchPinned: vi.fn(async () => pins),
        fetch: vi.fn(async () => pins)
      },
      send: vi.fn(async () => {
        pins.push(posted);
        return posted;
      })
    };

    await ensureDungeonSignupGuide(channel as never, "en");
    await ensureDungeonSignupGuide(channel as never, "fr");

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(posted.pin).toHaveBeenCalledTimes(1);
    expect(posted.edit).toHaveBeenCalledTimes(1);
    expect(posted.edit).toHaveBeenCalledWith(expect.objectContaining({ content: dungeonSignupGuideText("fr") }));
  });
});
