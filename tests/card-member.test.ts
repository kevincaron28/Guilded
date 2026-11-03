import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { Guild } from "discord.js";
import { achievementUnlockedCard } from "../src/services/end-cards.js";
import { withDiscordMember } from "../src/services/card-member.js";
import { scoreCardPng } from "../src/services/score-card.js";
import { ACTIVE_ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";

const guildWith = (member: unknown, fail = false) => ({ id: "g1", members: { fetch: async () => { if (fail) throw new Error("Unknown Member"); return member; } } }) as unknown as Guild;
const member = { displayName: "🔥 Frumpy", displayAvatarURL: () => "https://cdn.discordapp.com/a.png", roles: { highest: { id: "r1", name: "Officier", color: 0x1abc9c, hexColor: "#1abc9c" } } };

describe("Discord member on a card", () => {
  const card = achievementUnlockedCard("frumpytm", [ACTIVE_ACHIEVEMENTS[0]!.id], 6, "fr");
  const avatar = () => sharp({ create: { width: 128, height: 128, channels: 3, background: "#3366cc" } }).png().toBuffer();
  it("adds the server name, avatar and highest role, and renders", async () => {
    const png = Buffer.from(await avatar());
    const rich = await withDiscordMember(guildWith(member), card, "123456789012345678", async () => png);
    expect(rich).toMatchObject({ title: "🔥 Frumpy", rank: { label: "Officier", color: "#1abc9c" } });
    expect(rich.portrait).toBe(png.toString("base64"));
    expect(card.portrait).toBeUndefined();
    expect(await sharp((await scoreCardPng(rich))!).metadata()).toMatchObject({ width: 1200, height: 630 });
  });
  it("ignores @everyone, survives a broken image, and returns the plain card when the member is gone", async () => {
    const plain = await withDiscordMember(guildWith({ ...member, roles: { highest: { id: "g1", name: "@everyone", color: 0, hexColor: "#000000" } } }), card, "1", async () => null);
    expect(plain.rank).toBeUndefined();
    expect(plain.portrait).toBeUndefined();
    const broken = { ...card, portrait: Buffer.from("not an image").toString("base64"), rank: { label: "Raider", color: "#000000" } };
    expect(await sharp((await scoreCardPng(broken))!).metadata()).toMatchObject({ width: 1200 });
    expect(await withDiscordMember(guildWith(null, true), card, "1")).toBe(card);
  });
});
