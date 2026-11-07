import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { Guild } from "discord.js";
import { achievementUnlockedCard } from "../src/services/end-cards.js";
import { withDiscordMember } from "../src/services/card-member.js";
import { drawable, scoreCardPng } from "../src/services/score-card.js";
import { ACTIVE_ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";

const guildWith = (member: unknown, fail = false) => ({ id: "g1", members: { fetch: async () => { if (fail) throw new Error("Unknown Member"); return member; } } }) as unknown as Guild;
const member = { displayName: "🔥 Frumpy", displayAvatarURL: () => "https://cdn.discordapp.com/a.png", roles: { highest: { id: "r1", name: "Officier", color: 0x1abc9c, hexColor: "#1abc9c" } } };

describe("Discord member on a card", () => {
  it("draws a styled display name as plain letters, and falls back to the username when nothing is drawable", async () => {
    const card = achievementUnlockedCard("frumpytm", [ACTIVE_ACHIEVEMENTS[0]!.id], 6, "fr");
    const styled = { ...member, displayName: "\u{1D4D5}\u{1D4FB}\u{1D4FE}\u{1D4F6}\u{1D4F9}\u{1D502}\u2122\u{1F3B2}", user: { username: "frumpy" } };
    const named = await withDiscordMember(guildWith(styled), card, "1", async () => null);
    expect(drawable(named.title)).toBe("FrumpyTM");
    const empty = await withDiscordMember(guildWith({ ...styled, displayName: "\u{1F3B2}\u{1F3B2}" }), card, "1", async () => null);
    expect(empty.title).toBe("frumpy");
    expect(await scoreCardPng(named)).toBeInstanceOf(Buffer);
  });
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
