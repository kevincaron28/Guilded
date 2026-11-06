import { describe, expect, it, vi } from "vitest";
import { firstLinkMessage, tellFirstCompanionLink } from "../src/services/companion-link-dm.js";

// Owner decision (8.5 track F3): one DM after a member's first companion link, silently skipped when DMs are closed.
function fakes(characters: { name: string; displayName: string | null }[], send = vi.fn(async () => undefined)) {
  const database = {
    character: { findMany: vi.fn(async () => characters), count: vi.fn(async () => characters.length) },
    member: { findUnique: vi.fn(async () => ({ discordUserId: "111" })) }
  };
  const client = { users: { send }, guilds: { fetch: vi.fn(async () => ({ name: "Quebec Gold" })) } };
  return { database, client, send };
}
const run = (f: ReturnType<typeof fakes>, before: number) =>
  tellFirstCompanionLink(f.client as never, f.database as never, { guildDiscordId: "999", memberId: "m1", lang: "en", before });

describe("first companion link DM", () => {
  it("lists the linked characters by full name, once, when the member had none before", async () => {
    const f = fakes([{ name: "Aran", displayName: "Aran Dawnfield" }, { name: "Bel", displayName: null }]);
    expect(await run(f, 0)).toBe(true);
    expect(f.send).toHaveBeenCalledOnce();
    const [user, message] = f.send.mock.calls[0] as unknown as [string, { content: string; allowedMentions: unknown }];
    expect(user).toBe("111");
    expect(message.content).toContain("You're linked on **Quebec Gold**: **Aran Dawnfield**, **Bel**");
    expect(message.allowedMentions).toEqual({ parse: [] });
  });

  it("says nothing when the member already had a linked character, or nothing was linked", async () => {
    const already = fakes([{ name: "Aran", displayName: null }]);
    expect(await run(already, 1)).toBe(false);
    const none = fakes([]);
    expect(await run(none, 0)).toBe(false);
    expect(already.send).not.toHaveBeenCalled();
    expect(none.send).not.toHaveBeenCalled();
  });

  it("never throws when DMs are closed", async () => {
    const f = fakes([{ name: "Aran", displayName: null }], vi.fn(async () => { throw new Error("Cannot send messages to this user"); }));
    await expect(run(f, 0)).resolves.toBe(false);
  });

  it("caps the list, escapes names and speaks French", () => {
    const names = Array.from({ length: 12 }, (_, index) => `Name${index}`);
    expect(firstLinkMessage("en", "Guild", names)).toContain(" and 2 more");
    expect(firstLinkMessage("en", "Guild", ["Bad*Name"])).toContain("**Bad\\*Name**");
    expect(firstLinkMessage("fr", "Guilde", ["Aran"])).toContain("Tu es lié sur **Guilde**");
  });
});
