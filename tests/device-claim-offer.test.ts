import { beforeEach, describe, expect, it, vi } from "vitest";

const linkCalls: { memberId: string; name: string; options: unknown }[] = [];
let guildCharacters: { name: string; realm: string; gameEdition: string; memberId: string; detachedAt: Date | null }[] = [];
vi.mock("../src/services/character-pairing.js", () => ({
  linkPairedCharacter: vi.fn(async (_db: unknown, _guildId: string, memberId: string, self: { name: string; realm: string }, options: unknown) => {
    linkCalls.push({ memberId, name: self.name, options });
    guildCharacters.push({ name: self.name, realm: self.realm, gameEdition: "forever", memberId, detachedAt: null });
    return "linked";
  })
}));

const { offersFor, claimOffer, snoozeOffer, offerByDm, offerByDmToUsers, answerOfferButton, offerMessage, OFFER_SNOOZE_MS, OFFER_DM_GAP_MS } = await import("../src/services/device-claim-offer.js");

const NOW = new Date("2026-11-16T12:00:00Z");
const DAY = 86_400_000;
type DeviceChar = { name: string; realm: string; className: string | null; level: number | null; displayName?: string | null; race?: string | null };
interface Device { id: string; guildId: string; claimedMemberId: string | null; revokedAt: Date | null; characters: DeviceChar[] }

function world(devices: Device[], declined: { nameKey: string; status: string }[] = []) {
  const offers = new Map<string, { snoozedUntil: Date | null; dmAt: Date | null; doneAt: Date | null }>();
  const sent: { to: string; payload: { content: string; components: { components: { data: { custom_id: string } }[] }[] } }[] = [];
  const db = {
    member: {
      findUnique: async ({ where }: { where: { id?: string; guildId_discordUserId?: { guildId: string; discordUserId: string } } }) => {
        if (where.id === "m1" || where.guildId_discordUserId?.discordUserId === "u1") return { id: "m1", guildId: "g1", discordUserId: "u1", status: "ACTIVE", guild: { discordId: "d1" }, characters: guildCharacters.filter((c) => c.memberId === "m1" && !c.detachedAt) };
        return null;
      },
      findMany: async () => [{ id: "m1" }]
    },
    companionDevice: {
      findMany: async ({ where }: { where: { id?: string } }) => devices.filter((d) => d.guildId === "g1" && !d.revokedAt && (!where.id || d.id === where.id) && (d.claimedMemberId === null || d.claimedMemberId === "m1"))
        .map((d) => ({ id: d.id, claimedMemberId: d.claimedMemberId, characters: d.characters, claimOffers: offers.has(`m1:${d.id}`) ? [offers.get(`m1:${d.id}`)] : [] })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const d = devices.find((x) => x.id === where.id);
        return d ? { claimedMemberId: d.claimedMemberId, guildId: d.guildId, guild: { name: "Quebec Gold", settings: { language: "en" } } } : null;
      }
    },
    character: { findMany: async () => guildCharacters },
    characterVerifyClaim: { findMany: async () => declined },
    deviceCharacter: { findMany: async ({ where }: { where: { deviceId: string } }) => devices.find((d) => d.id === where.deviceId)?.characters ?? [] },
    deviceClaimOffer: {
      upsert: async ({ where, create, update }: { where: { memberId_deviceId: { memberId: string; deviceId: string } }; create: Record<string, Date>; update: Record<string, Date> }) => {
        const key = `${where.memberId_deviceId.memberId}:${where.memberId_deviceId.deviceId}`;
        const row = offers.get(key);
        offers.set(key, row ? { ...row, ...update } : { snoozedUntil: null, dmAt: null, doneAt: null, ...create });
      }
    },
    guildSettings: { findUnique: async () => ({ language: "en" }) }
  };
  const client = {
    guilds: { fetch: async () => ({ name: "Quebec Gold" }) },
    users: { send: async (to: string, payload: never) => { sent.push({ to, payload }); } }
  };
  return { db: db as never, client: client as never, sent, offers };
}

const char = (name: string, className: string | null = "Mage", level: number | null = 20): DeviceChar => ({ name, realm: "Forever", className, level });
const owned = (name: string, memberId: string, detachedAt: Date | null = null) => ({ name, realm: "Forever", gameEdition: "forever", memberId, detachedAt });

beforeEach(() => {
  linkCalls.length = 0;
  guildCharacters = [owned("Ray Smith", "m1")];
});

describe("one-click claim offers", () => {
  it("makes one offer per install (one WoW account each), with only characters nobody owns", async () => {
    const { db } = world([
      { id: "dev1", guildId: "g1", claimedMemberId: null, revokedAt: null, characters: [char("Ray Smith"), char("Amy Jones"), char("Bob Stone")] },
      { id: "dev2", guildId: "g1", claimedMemberId: "m1", revokedAt: null, characters: [char("Cora Vale")] }
    ]);
    const offers = await offersFor(db, "m1", NOW);
    expect(offers.map((o) => [o.deviceId, o.characters.map((c) => c.name)])).toEqual([["dev1", ["Amy Jones", "Bob Stone"]], ["dev2", ["Cora Vale"]]]);
  });

  it("never offers a character someone else owns (listed as taken), a decline, a detached row, or another member's install", async () => {
    guildCharacters.push(owned("Amy Jones", "m2"), owned("Dan Fox", "m3", NOW));
    const { db } = world([
      { id: "dev1", guildId: "g1", claimedMemberId: null, revokedAt: null, characters: [char("Ray Smith"), char("Amy Jones"), char("Eve Moss"), char("Fay Lane"), char("Dan Fox"), char("Gus Hall")] },
      { id: "dev2", guildId: "g1", claimedMemberId: "m9", revokedAt: null, characters: [char("Ray Smith"), char("Hal Reed")] },
      { id: "dev3", guildId: "g1", claimedMemberId: null, revokedAt: null, characters: [char("Ivy Cole")] },
      { id: "dev4", guildId: "g1", claimedMemberId: null, revokedAt: NOW, characters: [char("Ray Smith"), char("Jon Pike")] }
    ], [{ nameKey: "eve moss", status: "BLOCKED" }, { nameKey: "fay lane", status: "REMOVED" }]);
    const offers = await offersFor(db, "m1", NOW);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.deviceId).toBe("dev1");
    expect(offers[0]!.characters.map((c) => c.name)).toEqual(["Gus Hall"]);
    expect(offers[0]!.taken).toEqual(["Amy Jones"]);
  });

  it("links with the existing link path: confirmed only through the member's own claimed install, otherwise reported", async () => {
    const { db } = world([
      { id: "dev1", guildId: "g1", claimedMemberId: null, revokedAt: null, characters: [char("Ray Smith"), char("Amy Jones")] },
      { id: "dev2", guildId: "g1", claimedMemberId: "m1", revokedAt: null, characters: [char("Cora Vale")] }
    ]);
    expect(await claimOffer(db, "m1", "dev1", NOW)).toEqual({ linked: ["Amy Jones"], skipped: [] });
    expect(await claimOffer(db, "m1", "dev2", NOW)).toEqual({ linked: ["Cora Vale"], skipped: [] });
    expect(linkCalls.map((c) => [c.name, c.options])).toEqual([["Amy Jones", { confirm: false, evidence: "named" }], ["Cora Vale", { confirm: true, evidence: "companion" }]]);
  });

  it("is idempotent: a second Link finds nothing left", async () => {
    const { db } = world([{ id: "dev1", guildId: "g1", claimedMemberId: null, revokedAt: null, characters: [char("Ray Smith"), char("Amy Jones")] }]);
    await claimOffer(db, "m1", "dev1", NOW);
    expect(await claimOffer(db, "m1", "dev1", NOW)).toBeNull();
    expect(linkCalls).toHaveLength(1);
    expect(await offersFor(db, "m1", NOW)).toEqual([]);
  });

  it("skips a character the device reported without a class instead of guessing", async () => {
    const { db } = world([{ id: "dev1", guildId: "g1", claimedMemberId: null, revokedAt: null, characters: [char("Ray Smith"), char("Amy Jones", null)] }]);
    expect(await claimOffer(db, "m1", "dev1", NOW)).toEqual({ linked: [], skipped: ["Amy Jones"] });
  });

  it("Not now snoozes that install for 7 days, then asks again", async () => {
    const { db } = world([{ id: "dev1", guildId: "g1", claimedMemberId: null, revokedAt: null, characters: [char("Ray Smith"), char("Amy Jones")] }]);
    const until = await snoozeOffer(db, "m1", "dev1", NOW);
    expect(until.getTime() - NOW.getTime()).toBe(OFFER_SNOOZE_MS);
    expect(OFFER_SNOOZE_MS).toBe(7 * DAY);
    expect(await offersFor(db, "m1", new Date(NOW.getTime() + 6 * DAY))).toEqual([]);
    expect(await offersFor(db, "m1", new Date(NOW.getTime() + 7 * DAY + 1))).toHaveLength(1);
  });
});

describe("the DM fallback", () => {
  const install = [{ id: "dev1", guildId: "g1", claimedMemberId: null, revokedAt: null, characters: [char("Ray Smith"), char("Amy Jones"), char("Bob Stone")] }];

  it("sends one DM per install with Link and Not now buttons and the taken names", async () => {
    guildCharacters.push(owned("Bob Stone", "m2"));
    const { db, client, sent } = world(install);
    expect(await offerByDm(client, db, "m1", NOW)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("u1");
    expect(sent[0]!.payload.content).toContain("Amy Jones");
    expect(sent[0]!.payload.content).toContain("Link them to you?");
    expect(sent[0]!.payload.content).toContain("Already linked to someone else");
    expect(sent[0]!.payload.content).toContain("Bob Stone");
    expect(sent[0]!.payload.components[0]!.components.map((b) => b.data.custom_id)).toEqual(["linked:dclaim:dev1", "linked:dsnooze:dev1"]);
  });

  it("does not repeat inside 7 days, never after Not now, and tells nobody when nothing is offered", async () => {
    const { db, client, sent } = world(install);
    await offerByDm(client, db, "m1", NOW);
    expect(await offerByDm(client, db, "m1", new Date(NOW.getTime() + DAY))).toBe(0);
    expect(await offerByDm(client, db, "m1", new Date(NOW.getTime() + OFFER_DM_GAP_MS + 1))).toBe(1);
    await snoozeOffer(db, "m1", "dev1", new Date(NOW.getTime() + 8 * DAY));
    expect(await offerByDm(client, db, "m1", new Date(NOW.getTime() + 20 * DAY))).toBe(1); // snooze over, DM gap over
    expect(sent).toHaveLength(3);
    const none = world([{ id: "dev9", guildId: "g1", claimedMemberId: null, revokedAt: null, characters: [char("Ray Smith")] }]);
    expect(await offerByDm(none.client, none.db, "m1", NOW)).toBe(0);
  });

  it("is marked before sending: a closed DM never makes it repeat", async () => {
    const { db, offers } = world(install);
    const closed = { guilds: { fetch: async () => ({ name: "Quebec Gold" }) }, users: { send: async () => { throw new Error("Cannot send messages to this user"); } } };
    expect(await offerByDm(closed as never, db, "m1", NOW)).toBe(0);
    expect(offers.get("m1:dev1")?.dmAt).toEqual(NOW);
  });

  it("after /guilded verify, each verified Discord user gets the offer", async () => {
    const { db, client, sent } = world(install);
    await offerByDmToUsers(client, db, "g1", ["u1", "u1"], NOW);
    expect(sent).toHaveLength(1);
  });

  it("Link answers with the linked names; Not now snoozes; an unknown member or install gets a polite refusal", async () => {
    const { db, offers } = world(install);
    expect(await answerOfferButton(db, "u1", "linked:dclaim:dev1", NOW)).toContain("Amy Jones");
    expect(await answerOfferButton(db, "u1", "linked:dclaim:dev1", NOW)).toContain("Nothing left to link");
    const snooze = world(install);
    expect(await answerOfferButton(snooze.db, "u1", "linked:dsnooze:dev1", NOW)).toContain("7 days");
    expect(snooze.offers.get("m1:dev1")?.snoozedUntil?.getTime()).toBe(NOW.getTime() + 7 * DAY);
    expect(await answerOfferButton(db, "u-stranger", "linked:dclaim:dev1", NOW)).toContain("not available");
    expect(await answerOfferButton(db, "u1", "linked:dclaim:nope", NOW)).toContain("not available");
    expect(await answerOfferButton(db, "u1", "something:else", NOW)).toBeNull();
    expect(offers.get("m1:dev1")?.doneAt).toEqual(NOW);
  });

  it("writes the French DM for a French server", () => {
    const message = offerMessage("fr", "Québec Gold", { deviceId: "d", guildId: "g1", characters: [{ name: "Amy Jones", realm: "Forever", className: "Mage", level: 20 }], taken: [], snoozedUntil: null, dmAt: null });
    expect(message.content).toContain("Les lier à toi ?");
  });
});
