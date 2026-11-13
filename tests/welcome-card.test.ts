import { describe, expect, it, vi } from "vitest";
import { sendWelcome } from "../src/services/housekeeping.js";
import { welcomeCard, welcomeCardFile } from "../src/services/welcome-card.js";
import { cardAltText } from "../src/services/card-alt.js";

const member = { id: "123456789012345678", displayName: "Brenna", user: { username: "brenna", bot: false }, send: vi.fn().mockResolvedValue({}), roles: { highest: { id: "1", name: "Member", color: 0, hexColor: "#000000" } }, displayAvatarURL: () => "https://example.invalid/a.png" };
const makeGuild = (channelSend: ReturnType<typeof vi.fn>) => ({ id: "g1", name: "Québec Gold", memberCount: 41,
  members: { fetch: vi.fn().mockResolvedValue(member) }, channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send: channelSend }) } });

describe("welcome card", () => {
  it("names the member, the server and the first steps, in both languages", () => {
    const card = welcomeCard("en", { name: "Brenna", guildName: "Québec Gold", memberCount: 41 });
    expect(card.subtitle).toBe("Welcome to Québec Gold!");
    expect(card.backdrop).toEqual({ kind: "board", key: "member-welcome", fallbackKey: "activity" });
    expect(card.rows).toHaveLength(3);
    expect(cardAltText(card)).toContain("Brenna");
    expect(welcomeCard("fr", { name: "B", guildName: "G", memberCount: 1 }).subtitle).toBe("Bienvenue dans G !");
  });

  it("draws an attachment with alt text, and the existing welcome keeps its text and buttons beside it", async () => {
    const guild = makeGuild(vi.fn().mockResolvedValue({}));
    const file = await welcomeCardFile(guild as never, member as never, "en");
    expect(file?.name).toBe("welcome.png");
    expect(file?.description).toContain("Brenna");
    const send = vi.fn().mockResolvedValue({});
    const settings = { welcomeDelivery: "CHANNEL", welcomeChannelId: "c1", welcomeMessageTemplate: "Hi {mention}", welcomeRoleIds: [], rulesChannelId: null, language: "en" };
    const result = await sendWelcome(makeGuild(send) as never, member as never, settings as never);
    expect(result.channel).toBe(true);
    const sent = send.mock.calls[0]![0];
    expect(sent.content).toContain("Hi <@123456789012345678>");
    expect(sent.components.length).toBeGreaterThan(0);
    expect(sent.files).toHaveLength(1);
    expect(sent.allowedMentions).toEqual({ users: ["123456789012345678"] });
  });

  it("sends nothing at all when welcome is not configured (no new automatic message)", async () => {
    const send = vi.fn();
    const result = await sendWelcome(makeGuild(send) as never, member as never, { welcomeDelivery: "CHANNEL", welcomeChannelId: null, language: "en" } as never);
    expect(result).toEqual({ channel: false, dm: false });
    expect(send).not.toHaveBeenCalled();
  });
});
