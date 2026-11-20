import { describe, expect, it } from "vitest";
import { postPromotionCongrats, promotionCongratsText } from "../src/services/promotion.js";
import { promotionCard, promotionTier, PROMOTION_TIERS } from "../src/services/card-promotion.js";
import { renderNextCard } from "../src/services/card-next.js";

const USER = "123456789012345678";
function fakeDb(over: { settings?: Record<string, unknown> | null; season?: string | null; honors?: string | null } = {}) {
  const jobs = new Map<string, { kind: string; payload: Record<string, unknown> }>();
  const db = {
    guildSettings: { findUnique: async () => over.settings === undefined ? { language: "fr", promotionCongratsEnabled: true } : over.settings },
    communitySeason: { findFirst: async () => over.season ? { announcementChannelId: over.season } : null },
    communityHonors: { findUnique: async () => over.honors === undefined ? { channelId: "chan-honors" } : over.honors ? { channelId: over.honors } : null },
    member: { findMany: async () => [{ id: "m1", discordUserId: USER, displayName: "Simon" }] },
    discordJob: {
      findUnique: async ({ where }: { where: { guildId_key: { key: string } } }) => jobs.has(where.guildId_key.key) ? { id: "x" } : null,
      upsert: async ({ where, create }: { where: { guildId_key: { key: string } }; create: { kind: string; payload: Record<string, unknown> } }) => { jobs.set(where.guildId_key.key, create); return create; }
    }
  };
  return { db: db as never, jobs };
}
const guild = { members: {} } as never;
const promo = { name: "Halidor Galemorne", rankName: "Membre", memberId: "m1" };

describe("promotion congratulations", () => {
  it("queues one French post that pings only the linked member", async () => {
    const { db, jobs } = fakeDb();
    expect(await postPromotionCongrats(db, guild, "g1", [promo])).toBe(1);
    const [job] = [...jobs.values()];
    expect(job!.kind).toBe("MESSAGE");
    expect(job!.payload["channelId"]).toBe("chan-honors");
    expect(job!.payload["mentionUsers"]).toEqual([USER]);
    expect(JSON.stringify(job!.payload["message"])).toContain(`Félicitations à <@${USER}> (Halidor Galemorne), promu·e **Membre** !`);
    expect(job!.payload["card"]).toMatchObject({ promotion: { tier: "member", name: "Simon", character: "Halidor Galemorne", rank: "Membre", kicker: "Félicitations !" } });
  });
  it("prefers the announcements channel", async () => {
    const { db, jobs } = fakeDb({ season: "chan-announce" });
    await postPromotionCongrats(db, guild, "g1", [promo]);
    expect([...jobs.values()][0]!.payload["channelId"]).toBe("chan-announce");
  });
  it("posts nothing when the officer switch is off or no channel exists", async () => {
    const off = fakeDb({ settings: { language: "fr", promotionCongratsEnabled: false } });
    expect(await postPromotionCongrats(off.db, guild, "g1", [promo])).toBe(0);
    const none = fakeDb({ honors: null });
    expect(await postPromotionCongrats(none.db, guild, "g1", [promo])).toBe(0);
    expect(off.jobs.size + none.jobs.size).toBe(0);
  });
  it("skips the Alt rank and unlinked characters", async () => {
    const { db, jobs } = fakeDb();
    expect(await postPromotionCongrats(db, guild, "g1", [{ ...promo, rankName: "Alt" }, { ...promo, rankName: "Reroll" }, { name: "Nobody Here", rankName: "Membre", memberId: null }])).toBe(0);
    expect(jobs.size).toBe(0);
  });
  it("posts the same promotion once when two uploads show it", async () => {
    const { db, jobs } = fakeDb();
    const now = new Date("2026-11-19T10:00:00Z");
    expect(await postPromotionCongrats(db, guild, "g1", [promo], now)).toBe(1);
    expect(await postPromotionCongrats(db, guild, "g1", [promo], new Date("2026-11-19T10:05:00Z"))).toBe(0);
    expect(jobs.size).toBe(1);
  });
  it("words it in English too", () => {
    expect(promotionCongratsText("<@1>", "Halidor", "Member", "en")).toBe("🎉 Congratulations to <@1> (Halidor), promoted to **Member**!");
  });
  it("maps rank names to tiers, unknown ones to neutral", () => {
    expect(["Initiate", "Membre", "Officier", "Co-GM", "Guild Master", "Ambassadeur"].map(promotionTier)).toEqual(["initiate", "member", "officer", "leader", "leader", "neutral"]);
  });
  it("draws a different picture per tier, in French and English", async () => {
    const pngs = await Promise.all([...PROMOTION_TIERS.map((tier) => ({ tier, rank: { initiate: "Initiate", member: "Membre", officer: "Officier", leader: "Co-GM", neutral: "Ambassadeur" }[tier] })).map(({ rank }) => renderNextCard(promotionCard("fr", { name: "Simon", character: "Halidor Galemorne", rank }))), renderNextCard(promotionCard("en", { name: "Simon", character: "Halidor", rank: "Member" }))]);
    expect(pngs.every((png) => png && png.length > 5000)).toBe(true);
    expect(new Set(pngs.slice(0, 5).map((png) => png!.toString("base64"))).size).toBe(5);
  });
});
