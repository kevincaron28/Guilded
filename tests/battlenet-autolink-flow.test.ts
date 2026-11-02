import { describe, expect, it } from "vitest";
import { autoLinkBattleNet, recentBattleNetLinks, undoBattleNetLinks } from "../src/services/battlenet-autolink.js";
import type { DiscoveredCharacter } from "../src/services/battlenet.js";

// A small in-memory stand-in for the tables the link and undo touch, so the whole flow
// (link unclaimed, add alts on the same realm, remember claims, undo) runs end to end.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
function memoryDb(seed: { unclaimed?: Row[]; characters?: Row[]; claims?: Row[] } = {}) {
  let n = 0;
  const id = () => `id${++n}`;
  const members: Row[] = [{ id: "m1", guildId: "g1", discordUserId: "u1", status: "ACTIVE", isTest: false, guild: { name: "Gold", gameEdition: "retail" } }];
  const unclaimed: Row[] = (seed.unclaimed ?? []).map(r => ({ id: id(), gameEdition: "retail", lastSeenAt: new Date(), professionsUpdatedAt: null, ...r }));
  const characters: Row[] = (seed.characters ?? []).map(r => ({ id: id(), isMain: false, gameEdition: "retail", ...r }));
  const claims: Row[] = (seed.claims ?? []).map(r => ({ updatedAt: new Date(), ...r }));
  const claim = (w: Row) => claims.find(c => c.guildId === w.guildId && c.memberId === w.memberId && c.nameKey === w.nameKey);
  const db = {
    member: {
      findMany: async () => members,
      findUniqueOrThrow: async ({ where }: Row) => members.find(m => m.id === where.id)
    },
    unclaimedCharacter: {
      findMany: async ({ where }: Row) => unclaimed.filter(r => r.guildId === where.guildId && where.OR.some((o: Row) => r.nameKey.startsWith(o.nameKey.startsWith))),
      delete: async ({ where }: Row) => { unclaimed.splice(unclaimed.findIndex(r => r.id === where.id), 1); }
    },
    character: {
      count: async ({ where }: Row) => characters.filter(c => c.memberId === where.memberId && (where.isMain === undefined || c.isMain === where.isMain)).length,
      findMany: async ({ where }: Row) => characters.filter(c => (!where.memberId || c.memberId === where.memberId) && (!where.member || c.guildId === where.member.guildId)),
      findFirst: async ({ where }: Row) => characters.find(c => c.memberId === where.memberId && c.name === where.name && c.realm === where.realm) ?? null,
      create: async ({ data }: Row) => { const row = { id: id(), ...data }; characters.push(row); return row; },
      update: async ({ where, data }: Row) => Object.assign(characters.find(c => c.id === where.id)!, data),
      updateMany: async ({ where, data }: Row) => { for (const c of characters.filter(c => c.memberId === where.memberId)) Object.assign(c, data); },
      delete: async ({ where }: Row) => { characters.splice(characters.findIndex(c => c.id === where.id), 1); }
    },
    professionSkill: { upsert: async () => ({}) },
    characterVerifyClaim: {
      findMany: async ({ where }: Row) => claims.filter(c => (!where.guildId || c.guildId === where.guildId) && (!where.memberId || c.memberId === where.memberId)
        && (!where.status || (where.status.in ? where.status.in.includes(c.status) : c.status === where.status))
        && (!where.updatedAt || c.updatedAt > where.updatedAt.gt)).map(c => ({ ...c, guild: { name: "Gold" } })),
      upsert: async ({ where, create, update }: Row) => { const w = where.guildId_memberId_nameKey; const hit = claim(w); if (hit) Object.assign(hit, update, { updatedAt: new Date() }); else claims.push({ ...create, updatedAt: new Date() }); },
      update: async ({ where, data }: Row) => { Object.assign(claim(where.guildId_memberId_nameKey)!, data); }
    }
  };
  return { db: db as never, characters, unclaimed, claims };
}
const bnet = (name: string, realm: string, extra: Partial<DiscoveredCharacter> = {}): DiscoveredCharacter =>
  ({ region: "us", gameEdition: "retail", realmId: 1, characterId: name.length * 7, name, realm, className: "Priest", level: 80, ...extra });

describe("Battle.net auto-link end to end", () => {
  it("links the roster character, adds same-realm alts, skips other realms, then undoes", async () => {
    const { db, characters, unclaimed } = memoryDb({ unclaimed: [{ guildId: "g1", nameKey: "ray-area52", name: "Ray", realm: "Area 52", className: "Priest" }] });
    const linked = await autoLinkBattleNet(db, "u1", [bnet("Ray", "area-52"), bnet("Zed", "area-52", { className: "Rogue", race: "NightElf" }), bnet("Far", "tarren-mill")]);
    expect(linked.map(l => l.name).sort()).toEqual(["Ray", "Zed"]);
    expect(characters.map(c => c.name).sort()).toEqual(["Ray", "Zed"]);
    expect(characters.find(c => c.name === "Ray")!.isMain).toBe(true);
    expect(characters.find(c => c.name === "Zed")!).toMatchObject({ isMain: false, className: "Rogue", race: "Night Elf", realm: "Area 52" });
    expect(unclaimed).toHaveLength(0);
    expect((await recentBattleNetLinks(db, "u1")).map(l => l.name).sort()).toEqual(["Ray", "Zed"]);
    // Running it again changes nothing.
    expect(await autoLinkBattleNet(db, "u1", [bnet("Ray", "area-52"), bnet("Zed", "area-52", { className: "Rogue" })])).toEqual([]);
    expect(await undoBattleNetLinks(db, "u1")).toBe(2);
    expect(characters).toHaveLength(0);
    // After undo they never come back by themselves.
    expect(await autoLinkBattleNet(db, "u1", [bnet("Zed", "area-52", { className: "Rogue" })])).toEqual([]);
  });
  it("never takes a character another member already owns", async () => {
    const { db, characters } = memoryDb({ characters: [{ guildId: "g1", memberId: "someone-else", name: "Zed", realm: "Area 52" }, { guildId: "g1", memberId: "m1", name: "Ray", realm: "Area 52" }] });
    expect(await autoLinkBattleNet(db, "u1", [bnet("Zed", "area-52")])).toEqual([]);
    expect(characters.find(c => c.name === "Zed")!.memberId).toBe("someone-else");
  });
  it("adds nothing for a realm the guild has never seen this member on", async () => {
    const { db, characters } = memoryDb();
    expect(await autoLinkBattleNet(db, "u1", [bnet("Zed", "area-52")])).toEqual([]);
    expect(characters).toHaveLength(0);
  });
  it("skips a character the member unlinked before", async () => {
    const { db } = memoryDb({ unclaimed: [{ guildId: "g1", nameKey: "ray-area52", name: "Ray", realm: "Area 52", className: "Priest" }],
      claims: [{ guildId: "g1", memberId: "m1", nameKey: "ray-area52", status: "BLOCKED" }] });
    expect(await autoLinkBattleNet(db, "u1", [bnet("Ray", "area-52")])).toEqual([]);
  });
});
