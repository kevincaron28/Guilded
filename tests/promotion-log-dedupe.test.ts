import { describe, expect, it, vi } from "vitest";
import { announcePromotions } from "../src/services/promotion.js";
import { applyGuildData } from "../src/services/guild-data.js";
import { applyDiscoveredCharacters } from "../src/services/roster-discovery.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";

// 20 Nov 2026: #journal-officiers showed the same promotion line twice, hours apart.
function fakeDb() {
  const jobs = new Map<string, { kind: string; payload: { channelId: string; message: { content: string } } }>();
  const db = {
    guildSettings: { findUnique: async () => ({ language: "fr", logChannelId: "log1", promotionCongratsEnabled: false }) },
    discordJob: {
      findMany: async ({ where }: { where: { key: { startsWith: string } } }) => [...jobs.keys()].filter((k) => k.startsWith(where.key.startsWith)).map((key) => ({ key })),
      upsert: async ({ where, create }: { where: { guildId_key: { key: string } }; create: { kind: string; payload: never } }) => { jobs.set(where.guildId_key.key, create); return create; }
    }
  };
  return { db: db as never, jobs };
}
const guild = {} as never;
const promo = { name: "Crash Hunting", rankName: "Officer", memberId: "m1" };

describe("officer-log promotion line is posted once per character and rank within 7 days", () => {
  it("queues the French line once for two uploads within hours", async () => {
    const { db, jobs } = fakeDb();
    await announcePromotions(guild, [promo], { db, guildId: "g" }, new Date("2026-11-20T16:54:00Z"));
    await announcePromotions(guild, [promo], { db, guildId: "g" }, new Date("2026-11-20T16:56:00Z"));
    await announcePromotions(guild, [promo], { db, guildId: "g" }, new Date("2026-11-20T19:10:00Z"));
    expect(jobs.size).toBe(1);
    const [job] = [...jobs.values()];
    expect(job!.kind).toBe("MESSAGE");
    expect(job!.payload.channelId).toBe("log1");
    expect(job!.payload.message.content).toBe("⬆️ Crash Hunting a été promu(e) au rang Officer.");
  });
  it("posts again for a re-promotion more than 7 days later, and for another rank", async () => {
    const { db, jobs } = fakeDb();
    await announcePromotions(guild, [promo], { db, guildId: "g" }, new Date("2026-11-01T10:00:00Z"));
    await announcePromotions(guild, [promo], { db, guildId: "g" }, new Date("2026-11-20T10:00:00Z"));
    await announcePromotions(guild, [{ ...promo, rankName: "Member" }], { db, guildId: "g" }, new Date("2026-11-20T10:00:00Z"));
    expect(jobs.size).toBe(3);
  });
});

const NOW = new Date("2026-11-20T20:00:00Z");
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
type Row = Record<string, unknown>;
function fakeTx(character: Row, rosterAt: Date) {
  const noop = async () => ({ count: 0 });
  return {
    guildRosterEntry: { findMany: async () => [{ id: "r1", nameKey: "amy smith", observedAt: rosterAt, inGuild: true }], upsert: noop, updateMany: noop },
    guildEventEntry: { findMany: async () => [], create: noop }, guildText: { findUnique: async () => null, upsert: noop },
    character: { findMany: async () => [character], update: async ({ data }: { data: Row }) => Object.assign(character, data), updateMany: noop },
    unclaimedCharacter: { findMany: async () => [], update: noop, updateMany: noop, createMany: noop }, characterRankSeen: { upsert: noop }
  } as never;
}
const roster = (at: Date, rankName: string, rankIndex: number) => parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever",
  guildRoster: { at: sec(at), complete: true, members: [{ name: "Amy Smith", level: 30, class: "MAGE", rankName, rankIndex, online: false }] } });
const amy = (rankAt: Date) => ({ id: "c1", name: "Amy Smith", realm: "Forever", gameEdition: "forever", displayName: null, level: 30, className: "Mage", lastSeenAt: null,
  guildRankName: "Officer", guildRankIndex: 2, guildRankAt: rankAt });

describe("a stale roster never moves a stored rank", () => {
  it("ignores a roster older than the stored rank date, so the next fresh roster does not promote twice", async () => {
    const row = amy(new Date("2026-11-20T18:00:00Z"));
    const first = await applyGuildData(fakeTx(row, new Date("2026-11-20T18:00:00Z")), "g", { memberId: "m", officer: true }, roster(new Date("2026-11-20T17:00:00Z"), "Member", 3), NOW);
    expect(first.skippedOlder).toBe(true);
    expect(row["guildRankName"]).toBe("Officer");
    const next = await applyGuildData(fakeTx(row, new Date("2026-11-20T18:00:00Z")), "g", { memberId: "m", officer: true }, roster(new Date("2026-11-20T19:00:00Z"), "Officer", 2), NOW);
    expect(next.promotions).toEqual([]);
  });
  it("still applies a real newer demotion", async () => {
    const row = amy(new Date("2026-11-20T10:00:00Z"));
    const res = await applyGuildData(fakeTx(row, new Date("2026-11-20T10:00:00Z")), "g", { memberId: "m", officer: true }, roster(new Date("2026-11-20T19:00:00Z"), "Member", 3), NOW);
    expect(row["guildRankName"]).toBe("Member");
    expect(res.promotions).toEqual([]);
  });
});

describe("a relayed digest never replaces a rank stored from a newer reading", () => {
  const entry = (observedAt: Date) => ({ name: "Amy Smith", realm: "Forever", class: "MAGE", race: "Human", level: 30, spec: "", professions: [], guildRankName: "Member", guildRankIndex: 3, observedAt });
  it("keeps the newer stored rank, and takes a digest that is newer", async () => {
    const client = { character: { update: vi.fn(async () => ({})), findUnique: vi.fn(async () => null) }, professionSkill: { upsert: vi.fn(async () => ({})) }, unclaimedCharacter: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) } };
    const linked = { id: "c1", name: "Amy Smith", realm: "Forever", guildRankName: "Officer", guildRankIndex: 2, guildRankAt: new Date("2026-11-20T18:00:00Z") };
    await applyDiscoveredCharacters(client as never, "g", [entry(new Date("2026-11-20T10:00:00Z"))], [linked]);
    for (const call of client.character.update.mock.calls) expect((call as unknown as [{ data: Row }])[0].data).not.toHaveProperty("guildRankName");
    await applyDiscoveredCharacters(client as never, "g", [entry(new Date("2026-11-20T19:00:00Z"))], [linked]);
    expect(client.character.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ guildRankName: "Member", guildRankAt: new Date("2026-11-20T19:00:00Z") }) }));
  });
});
