import { describe, expect, it, vi } from "vitest";
import { channelIsGone, clearDanglingChannels } from "../src/services/dangling-channels.js";
import { setupChecks, formatChecks, type SetupFacts } from "../src/services/setup-status.js";

const guildWith = (live: string[], failing: string[] = []) => ({
  channels: {
    fetch: async (id: string) => {
      if (failing.includes(id)) throw Object.assign(new Error("Missing Access"), { code: 50001 });
      if (live.includes(id)) return { id };
      throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
    }
  }
}) as never;

describe("saved channel ids that no longer exist", () => {
  it("counts only a confirmed deletion as gone, never a permission error", async () => {
    expect(await channelIsGone(guildWith([]), "x")).toBe(true);
    expect(await channelIsGone(guildWith(["x"]), "x")).toBe(false);
    expect(await channelIsGone(guildWith([], ["x"]), "x")).toBe(false);
  });

  it("clears the deleted #bot-faq id and the message ids stored with it, and keeps live channels", async () => {
    const update = vi.fn(async () => undefined);
    const cleared = await clearDanglingChannels(guildWith(["log"], ["hidden"]), {
      answerChannelId: "faq", logChannelId: "log", raceBoardChannelId: "race", raceBoardMessageId: "m", craftChannelId: "hidden", guideChannelId: null
    }, update);
    expect(cleared.sort()).toEqual(["answerChannelId", "raceBoardChannelId"]);
    expect(update).toHaveBeenCalledWith({ answerChannelId: null, raceBoardChannelId: null, raceBoardMessageId: null });
  });

  it("writes nothing when every saved channel exists", async () => {
    const update = vi.fn(async () => undefined);
    expect(await clearDanglingChannels(guildWith(["a"]), { logChannelId: "a" }, update)).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("final checklist after the 9.0 FAQ retirement", () => {
  const facts = (extra: Partial<SetupFacts> = {}): SetupFacts => ({
    existingRoleNames: [], requiredRoleNames: [], notifyChannel: null, raidChannel: null, logChannel: null, autoRoles: [], welcomeChannel: null,
    epgpConfigured: false, remindersOn: false, weeklyReportOn: false, companionPaired: false, linkedCharacters: 0, ...extra
  }) as SetupFacts;

  it("never lists a Bot FAQ channel or its message-reading warning", () => {
    for (const lang of ["en", "fr"] as const) {
      const text = formatChecks(setupChecks(facts({
        extraChannels: [{ field: "answerChannelId", fact: { name: "bot-faq", exists: true, botCanPost: true } }, { field: "guideChannelId", fact: null }] as never,
        messageContentIntent: false
      }), lang));
      expect(text).not.toMatch(/FAQ/i);
      expect(text).toMatch(/guide/i);
    }
  });
});
