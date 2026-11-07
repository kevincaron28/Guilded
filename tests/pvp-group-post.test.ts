import { describe, expect, it } from "vitest";
import { pvpBracket, pvpExpiresAt, pvpGroupCard, pvpGroupEmbed, pvpPostPayload, type PvpPostData } from "../src/services/pvp-group-post.js";
import { scoreCardPng } from "../src/services/score-card.js";

const data = (over: Partial<PvpPostData> = {}): PvpPostData => ({
  id: "grp1", title: "Warsong Gulch push", size: 10, status: "OPEN", createdAt: new Date("2026-11-07T18:00:00Z"), minLevel: 20, maxLevel: 29,
  leaderDiscordId: "42", voiceChannelId: null,
  members: [{ name: "Aria", role: "TANK", color: "#c79c6e" }, { name: "Brom", role: "HEALER" }, { name: "Cleo", role: "DPS" }, { name: "Dax", role: "DPS" }],
  waiting: [{ name: "Eli", role: "DPS" }, { name: "Fay", role: "HEALER" }],
  ...over
});

describe("pvpBracket", () => {
  it("names a battleground bracket when the range sits inside one", () => {
    expect(pvpBracket(20, 29, "en")).toBe("Bracket 20-29");
    expect(pvpBracket(20, 25, "en")).toBe("Bracket 20-29");
    expect(pvpBracket(20, 29, "fr")).toBe("Tranche 20-29");
  });
  it("lists the levels otherwise, and handles none, one level and open ended", () => {
    expect(pvpBracket(null, null, "en")).toBe("Any level");
    expect(pvpBracket(null, null, "fr")).toBe("Tous niveaux");
    expect(pvpBracket(55, 55, "en")).toBe("Level 55");
    expect(pvpBracket(15, 34, "en")).toBe("Levels 15-34");
    expect(pvpBracket(60, 80, "en")).toBe("Levels 60+");
    expect(pvpBracket(60, 80, "fr")).toBe("Niveaux 60+");
  });
});

describe("PvP group post", () => {
  it("expires 24 hours after posting", () => {
    expect(pvpExpiresAt(new Date("2026-11-07T18:00:00Z")).toISOString()).toBe("2026-11-08T18:00:00.000Z");
  });

  it("builds the card with size, roles, queue, expiry and the party with role icons", () => {
    const card = pvpGroupCard(data(), "en");
    expect(card.title).toBe("Warsong Gulch push");
    expect(card.subtitle).toBe("Bracket 20-29 · Open");
    expect(card.stats.map(stat => [stat.label, stat.value])).toEqual([["Players", "4/10"], ["Roles", "T1  H1  D2"], ["Open until", "18:00 UTC"]]);
    expect(card.stats[0]!.note).toBe("2 in the queue");
    expect(card.dungeon!.party.map(p => [p.name, p.role])).toEqual([["Aria", "TANK"], ["Brom", "HEALER"], ["Cleo", "DPS"], ["Dax", "DPS"]]);
    expect(card.dungeon!.party[0]!.color).toBe("#c79c6e");
  });

  it("draws the picture", async () => {
    expect((await scoreCardPng(pvpGroupCard(data(), "en")))?.length ?? 0).toBeGreaterThan(1000);
  });

  it("lists the roster by role, the queue in order, the leader and the expiry in the embed", () => {
    const json = pvpGroupEmbed(data(), "en", "pvp-group.png").toJSON();
    expect(json.description).toContain("**Bracket 20-29** · 4/10 · Open");
    expect(json.description).toContain("<t:1794160800:R>");
    const field = (name: string) => json.fields!.find(f => f.name.startsWith(name))!.value;
    expect(field("🛡️ Tank")).toBe("Aria");
    expect(field("⚔️ DPS")).toBe("Cleo, Dax");
    expect(field("Queue (2)")).toBe("1. Eli ⚔️\n2. Fay 💚");
    expect(field("Leader")).toBe("<@42>");
    expect(json.image!.url).toBe("attachment://pvp-group.png");
  });

  it("shows the voice channel once started, and greys out a closed group", () => {
    const started = pvpGroupEmbed(data({ status: "STARTED", voiceChannelId: "77", waiting: [] }), "en").toJSON();
    expect(started.fields!.some(f => f.name === "Voice" && f.value.includes("<#77>"))).toBe(true);
    expect(started.fields!.some(f => f.name.startsWith("Queue"))).toBe(false);
    const closed = pvpGroupEmbed(data({ status: "CLOSED" }), "fr").toJSON();
    expect(closed.color).toBe(0x808080);
    expect(closed.description).not.toContain("Se ferme");
  });

  it("is fully in French", () => {
    const json = pvpGroupEmbed(data(), "fr").toJSON();
    expect(json.fields!.map(f => f.name)).toEqual(["🛡️ Tank (1)", "💚 Soigneur (1)", "⚔️ DPS (2)", "Responsable", "File d'attente (2)"]);
    const card = pvpGroupCard(data(), "fr");
    expect(card.eyebrow).toBe("Guilded · Groupe JcJ");
    expect(card.stats[0]!.label).toBe("Joueurs");
  });

  it("loads the group, colours by main character class, and returns picture + embed", async () => {
    const db = {
      dungeonGroup: { findUniqueOrThrow: async () => ({ id: "grp1", title: "BG night", maxSize: 10, status: "OPEN", createdAt: new Date(), minLevel: null, maxLevel: null, leaderId: "ml", voiceChannelId: null }) },
      dungeonGroupSignup: { findMany: async () => [
        { memberId: "m1", role: "TANK", status: "SIGNED_UP", member: { displayName: "Aria" } },
        { memberId: "m2", role: "DPS", status: "WAITLISTED", member: { displayName: "Brom" } }
      ] },
      member: { findUnique: async () => ({ discordUserId: "99" }) },
      character: { findMany: async () => [{ memberId: "m1", className: "Warrior" }] }
    };
    const payload = await pvpPostPayload(db as never, "grp1", "en");
    expect(payload.embeds).toHaveLength(1);
    expect(payload.files).toHaveLength(1);
    const json = payload.embeds[0]!.toJSON();
    expect(json.fields!.find(f => f.name.startsWith("Queue"))!.value).toBe("1. Brom ⚔️");
  });
});
