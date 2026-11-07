import { describe, expect, it } from "vitest";
import { channelSpec } from "../src/setup-names.js";
import { formatOpenInvitePosts, openInvitePosts, pickInviteChannel } from "../src/services/invite-extras.js";

describe("invite channel placement (roadmap 16)", () => {
  it("lives in the WoW category, in both languages", () => {
    expect(channelSpec("inviteChannelId", "en").category).toBe("raid");
    expect(channelSpec("inviteChannelId", "fr").category).toBe("raid");
    expect(channelSpec("inviteChannelId", "fr").name).toBe("invitation-guilde");
  });
  it("keeps the channel already in the WoW category when a server has two, under either name", () => {
    const channels = [
      { id: "a", name: "invitation-guilde", parentName: "⚜️ Guilded", position: 1 },
      { id: "b", name: "guild-invites", parentName: "⚔️ Raids WoW", position: 9 },
      { id: "c", name: "general", parentName: "⚔️ Raids WoW", position: 0 }
    ];
    expect(pickInviteChannel(channels)?.id).toBe("b");
    expect(pickInviteChannel([channels[0]!])?.id).toBe("a"); // one channel under the other category: reuse it, never create a second
    expect(pickInviteChannel([channels[2]!])).toBeNull();
  });
});

describe("open requests in an extra invite channel", () => {
  const post = (id: string, content: string, over: Partial<Parameters<typeof openInvitePosts>[0][number]> = {}) => ({ id, authorId: `u${id}`, bot: false, content, reactions: [] as string[], url: `https://discord.com/channels/1/2/${id}`, ...over });
  it("lists names without a ✅ once each, skipping bots and unreadable posts", () => {
    const open = openInvitePosts([
      post("1", "Lebowski Holyroller"),
      post("2", "Cara Dawn", { reactions: ["👀", "✅"] }),
      post("3", "lebowski holyroller"),
      post("4", "hello"),
      post("5", "Bot Name", { bot: true })
    ]);
    expect(open.map((entry) => entry.name)).toEqual(["Lebowski Holyroller"]);
    expect(formatOpenInvitePosts(open, "99", "42")).toContain("Repost them in <#42>");
    expect(formatOpenInvitePosts([], "99", "42")).toContain("every name there has a ✅");
  });
});
