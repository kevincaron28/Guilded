import { beforeEach, describe, expect, it, vi } from "vitest";

const linkCalls: { memberId: string; name: string; options: unknown }[] = [];
interface Row { name: string; realm: string; gameEdition: string; memberId: string; detachedAt: Date | null; confirmedAt: Date | null; linkEvidence: string | null }
let guildCharacters: Row[] = [];
vi.mock("../src/services/character-pairing.js", () => ({
  linkPairedCharacter: vi.fn(async (_db: unknown, _guildId: string, memberId: string, self: { name: string; realm: string }, options: unknown) => {
    linkCalls.push({ memberId, name: self.name, options });
    guildCharacters.push({ name: self.name, realm: self.realm, gameEdition: "forever", memberId, detachedAt: null, confirmedAt: null, linkEvidence: "named" });
    return "linked";
  })
}));

const { offersFor, claimOffer, snoozeOffer, offerByDm, offerByDmToUsers, answerOfferButton, offerMessage, OFFER_SNOOZE_MS, OFFER_DM_GAP_MS } = await import("../src/services/device-claim-offer.js");

const NOW = new Date("2026-11-16T12:00:00Z");
const DAY = 86_400_000;
type DeviceChar = { name: string; realm: string; className: string | null; level: number | null; displayName?: string | null; race?: string | null };
interface Device { id: string; guildId: string; claimedMemberId: string | null; revokedAt: Date | null; characters: DeviceChar[] }
const key = (name: string) => name.toLowerCase();

/** `roster` = names the guild roster (synced from the game) lists; by default everyone the tests talk about. */
function world(devices: Device[], options: { declined?: { nameKey: string; status: string }[]; roster?: string[]; member?: { claimDmOff?: boolean }; settings?: { claimDmEnabled?: boolean } } = {}) {
  const roster = (options.roster ?? ["Ray Smith", "Amy Jones", "Bob Stone", "Cora Vale", "Eve Moss", "Fay Lane", "Dan Fox", "Gus Hall", "Hal Reed", "Ivy Cole", "Jon Pike"]).map((name) => ({ nameKey: key(name) }));
  const offers = new Map<string, { snoozedUntil: Date | null; dmAt: Date | null; doneAt: Date | null }>();
  const sent: { to: string; payload: { content: string; components: { components: { data: { custom_id: string } }[] }[] } }[] = [];
  const memberRow = { id: "m1", guildId: "g1", discordUserId: "u1", status: "ACTIVE", claimDmOff: options.member?.claimDmOff ?? false, guild: { discordId: "d1" } };
  const db = {
    member: {
      findUnique: async ({ where }: { where: { id?: string; guildId_discordUserId?: { guildId: string; discordUserId: string } } }) => {
        if (where.id === "m1" || where.guildId_discordUserId?.discordUserId === "u1") return { ...memberRow, characters: guildCharacters.filter((c) => c.memberId === "m1" && !c.detachedAt) };
        return null;
      },
      findMany: async () => [{ id: "m1" }],
      updateMany: async () => { memberRow.claimDmOff = true; return { count: 1 }; }
    },
    companionDevice: {
      findMany: async ({ where }: { where: { id?: string } }) => devices.filter((d) => d.guildId === "g1" && !d.revokedAt && (!where.id || d.id === where.id) && (d.claimedMemberId === null || d.claimedMemberId === "m1"))
        .map((d) => ({ id: d.id, claimedMemberId: d.claimedMemberId, characters: d.characters, claimOffers: offers.has(`m1:${d.id}`) ? [offers.get(`m1:${d.id}`)] : [] })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const d = devices.find((x) => x.id === where.id);
        return d ? { claimedMemberId: d.claimedMemberId, guildId: d.guildId, guild: { name: "Quebec Gold", settings: { language: "en" } } } : null;
      }
    },
    guildRosterEntry: { findMany: async () => roster },
    character: { findMany: async () => guildCharacters },
    characterVerifyClaim: { findMany: async () => options.declined ?? [] },
    deviceCharacter: { findMany: async ({ where }: { where: { deviceId: string } }) => devices.find((d) => d.id === where.deviceId)?.characters ?? [] },
    deviceClaimOffer: {
      upsert: async ({ where, create, update }: { where: { memberId_deviceId: { memberId: string; deviceId: string } }; create: Record<string, Date>; update: Record<string, Date> }) => {
        const k = `${where.memberId_deviceId.memberId}:${where.memberId_deviceId.deviceId}`;
        const row = offers.get(k);
        offers.set(k, row ? { ...row, ...update } : { snoozedUntil: null, dmAt: null, doneAt: null, ...create });
      },
      createMany: async ({ data }: { data: { memberId: string; deviceId: string }[] }) => {
        for (const d of data) { const k = `${d.memberId}:${d.deviceId}`; if (!offers.has(k)) offers.set(k, { snoozedUntil: null, dmAt: null, doneAt: null }); }
      },
      updateMany: async ({ where, data }: { where: { memberId: string; deviceId: string; OR: ({ dmAt: null } | { dmAt: { lte: Date } })[] }; data: { dmAt: Date } }) => {
        const row = offers.get(`${where.memberId}:${where.deviceId}`);
        const ok = !!row && where.OR.some((c) => c.dmAt === null ? row.dmAt === null : !!row.dmAt && row.dmAt <= (c.dmAt as { lte: Date }).lte);
        if (ok) row!.dmAt = data.dmAt;
        return { count: ok ? 1 : 0 };
      }
    },
    guildSettings: { findUnique: async () => ({ language: "en", claimDmEnabled: options.settings?.claimDmEnabled ?? true }) }
  };
  const client = {
    guilds: { fetch: async () => ({ name: "Quebec Gold" }) },
    users: { send: async (to: string, payload: never) => { sent.push({ to, payload }); } }
  };
  return { db: db as never, client: client as never, sent, offers, memberRow };
}

const char = (name: string, className: string | null = "Mage", level: number | null = 20, realm = "Forever"): DeviceChar => ({ name, realm, className, level });
const owned = (name: string, memberId: string, extra: Partial<Row> = {}): Row => ({ name, realm: "Forever", gameEdition: "forever", memberId, detachedAt: null, confirmedAt: null, linkEvidence: "named", ...extra });
const dev = (id: string, characters: DeviceChar[], claimedMemberId: string | null = null, revokedAt: Date | null = null): Device => ({ id, guildId: "g1", claimedMemberId, revokedAt, characters });

beforeEach(() => {
  linkCalls.length = 0;
  // The member's own character is confirmed (their signed-in companion plus the roster), which is what lets an unclaimed install count as theirs.
  guildCharacters = [owned("Ray Smith", "m1", { confirmedAt: NOW, linkEvidence: "companion" })];
});

describe("one-click claim offers", () => {
  it("makes one offer per install (one WoW account each), with only characters nobody owns", async () => {
    const { db } = world([dev("dev1", [char("Ray Smith"), char("Amy Jones"), char("Bob Stone")]), dev("dev2", [char("Cora Vale")], "m1")]);
    const offers = await offersFor(db, "m1", NOW);
    expect(offers.map((o) => [o.deviceId, o.characters.map((c) => c.name)])).toEqual([["dev1", ["Amy Jones", "Bob Stone"]], ["dev2", ["Cora Vale"]]]);
  });

  it("never offers a character someone else owns (listed as taken), a decline, a detached row, or another member's install", async () => {
    guildCharacters.push(owned("Amy Jones", "m2"), owned("Dan Fox", "m3", { detachedAt: NOW }));
    const { db } = world([
      dev("dev1", [char("Ray Smith"), char("Amy Jones"), char("Eve Moss"), char("Fay Lane"), char("Dan Fox"), char("Gus Hall")]),
      dev("dev2", [char("Ray Smith"), char("Hal Reed")], "m9"),
      dev("dev3", [char("Ivy Cole")]),
      dev("dev4", [char("Ray Smith"), char("Jon Pike")], null, NOW)
    ], { declined: [{ nameKey: "eve moss", status: "BLOCKED" }, { nameKey: "fay lane", status: "REMOVED" }] });
    const offers = await offersFor(db, "m1", NOW);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.deviceId).toBe("dev1");
    expect(offers[0]!.characters.map((c) => c.name)).toEqual(["Gus Hall"]);
    expect(offers[0]!.taken).toEqual(["Amy Jones"]);
  });

  describe("a forged install (registration is open and uploads are unsigned)", () => {
    it("reporting the member's character plus a stranger's does not offer the stranger when the guild roster does not list them", async () => {
      const { db } = world([dev("forged", [char("Ray Smith"), char("Victim Unlinked")])]);
      expect(await offersFor(db, "m1", NOW)).toEqual([]);
    });

    it("an unclaimed install counts as the member's only through a CONFIRMED character of theirs", async () => {
      guildCharacters = [owned("Ray Smith", "m1")]; // reported only: anyone could have named it
      const { db } = world([dev("dev1", [char("Ray Smith"), char("Amy Jones")])]);
      expect(await offersFor(db, "m1", NOW)).toEqual([]);
      guildCharacters = [owned("Ray Smith", "m1", { linkEvidence: "heard" })];
      expect(await offersFor(db, "m1", NOW)).toHaveLength(1);
    });

    it("matches the member's character on name AND realm", async () => {
      const { db } = world([dev("dev1", [char("Ray Smith", "Mage", 20, "Other Realm"), char("Amy Jones", "Mage", 20, "Other Realm")])]);
      expect(await offersFor(db, "m1", NOW)).toEqual([]);
    });

    it("an unclaimed install offers only names the roster lists; the member's own claimed install offers the rest as reported", async () => {
      const unclaimed = world([dev("dev1", [char("Ray Smith"), char("Amy Jones"), char("Nobody Known")])], { roster: ["Amy Jones"] });
      expect((await offersFor(unclaimed.db, "m1", NOW))[0]!.characters.map((c) => [c.name, c.corroborated])).toEqual([["Amy Jones", true]]);
      const claimed = world([dev("dev1", [char("Ray Smith"), char("Amy Jones"), char("Nobody Known")], "m1")], { roster: ["Amy Jones"] });
      expect((await offersFor(claimed.db, "m1", NOW))[0]!.characters.map((c) => [c.name, c.corroborated])).toEqual([["Amy Jones", true], ["Nobody Known", false]]);
    });
  });

  it("links with the existing link path as reported only: a device does not say which character is logged in", async () => {
    const { db } = world([dev("dev1", [char("Ray Smith"), char("Amy Jones")]), dev("dev2", [char("Cora Vale"), char("Stray Name")], "m1")], { roster: ["Amy Jones", "Cora Vale"] });
    expect(await claimOffer(db, "m1", "dev1", NOW)).toEqual({ linked: ["Amy Jones"], skipped: [] });
    expect(await claimOffer(db, "m1", "dev2", NOW)).toEqual({ linked: ["Cora Vale", "Stray Name"], skipped: [] });
    expect(linkCalls.map((c) => [c.name, c.options])).toEqual([
      ["Amy Jones", { confirm: false, evidence: "named" }],
      ["Cora Vale", { confirm: false, evidence: "named" }],
      ["Stray Name", { confirm: false, evidence: "named" }]
    ]);
  });

  it("is idempotent: a second Link finds nothing left", async () => {
    const { db } = world([dev("dev1", [char("Ray Smith"), char("Amy Jones")])]);
    await claimOffer(db, "m1", "dev1", NOW);
    expect(await claimOffer(db, "m1", "dev1", NOW)).toBeNull();
    expect(linkCalls).toHaveLength(1);
    expect(await offersFor(db, "m1", NOW)).toEqual([]);
  });

  it("skips a character the device reported without a class instead of guessing", async () => {
    const { db } = world([dev("dev1", [char("Ray Smith"), char("Amy Jones", null)])]);
    expect(await claimOffer(db, "m1", "dev1", NOW)).toEqual({ linked: [], skipped: ["Amy Jones"] });
  });

  it("Not now snoozes that install for 7 days, then asks again; an unknown install is refused", async () => {
    const { db } = world([dev("dev1", [char("Ray Smith"), char("Amy Jones")])]);
    const until = await snoozeOffer(db, "m1", "dev1", NOW);
    expect(until!.getTime() - NOW.getTime()).toBe(OFFER_SNOOZE_MS);
    expect(OFFER_SNOOZE_MS).toBe(7 * DAY);
    expect(await offersFor(db, "m1", new Date(NOW.getTime() + 6 * DAY))).toEqual([]);
    expect(await offersFor(db, "m1", new Date(NOW.getTime() + 7 * DAY + 1))).toHaveLength(1);
    expect(await snoozeOffer(db, "m1", "no-such-device", NOW)).toBeNull();
  });
});

describe("the DM fallback", () => {
  const install = () => [dev("dev1", [char("Ray Smith"), char("Amy Jones"), char("Bob Stone")])];

  it("sends one DM per install with Link, Not now and Don't send these buttons and the taken names", async () => {
    guildCharacters.push(owned("Bob Stone", "m2"));
    const { db, client, sent } = world(install());
    expect(await offerByDm(client, db, "m1", NOW)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("u1");
    expect(sent[0]!.payload.content).toContain("Amy Jones");
    expect(sent[0]!.payload.content).toContain("Link them to you?");
    expect(sent[0]!.payload.content).toContain("Already linked to someone else");
    expect(sent[0]!.payload.content).toContain("Bob Stone");
    expect(sent[0]!.payload.components[0]!.components.map((b) => b.data.custom_id)).toEqual(["linked:dclaim:dev1", "linked:dsnooze:dev1", "linked:dcoff"]);
  });

  it("does not repeat inside 7 days, and two racing calls send one DM", async () => {
    const { db, client, sent } = world(install());
    await Promise.all([offerByDm(client, db, "m1", NOW), offerByDm(client, db, "m1", NOW)]);
    expect(sent).toHaveLength(1);
    expect(await offerByDm(client, db, "m1", new Date(NOW.getTime() + DAY))).toBe(0);
    expect(await offerByDm(client, db, "m1", new Date(NOW.getTime() + OFFER_DM_GAP_MS + 1))).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it("is quiet when nothing is offered, after Not now, and when it is switched off by the officers or the member", async () => {
    const none = world([dev("dev9", [char("Ray Smith")])]);
    expect(await offerByDm(none.client, none.db, "m1", NOW)).toBe(0);
    const snoozed = world(install());
    await snoozeOffer(snoozed.db, "m1", "dev1", NOW);
    expect(await offerByDm(snoozed.client, snoozed.db, "m1", new Date(NOW.getTime() + DAY))).toBe(0);
    const officersOff = world(install(), { settings: { claimDmEnabled: false } });
    expect(await offerByDm(officersOff.client, officersOff.db, "m1", NOW)).toBe(0);
    const memberOff = world(install(), { member: { claimDmOff: true } });
    expect(await offerByDm(memberOff.client, memberOff.db, "m1", NOW)).toBe(0);
    expect(officersOff.sent.length + memberOff.sent.length + none.sent.length + snoozed.sent.length).toBe(0);
  });

  it("the Don't send these button stores the member's own off switch", async () => {
    const { db, client, sent, memberRow } = world(install());
    expect(await answerOfferButton(db, "u1", "linked:dcoff", NOW)).toContain("no more of these");
    expect(memberRow.claimDmOff).toBe(true);
    expect(await offerByDm(client, db, "m1", NOW)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("is marked before sending: a closed DM never makes it repeat", async () => {
    const { db, offers } = world(install());
    const closed = { guilds: { fetch: async () => ({ name: "Quebec Gold" }) }, users: { send: async () => { throw new Error("Cannot send messages to this user"); } } };
    expect(await offerByDm(closed as never, db, "m1", NOW)).toBe(0);
    expect(offers.get("m1:dev1")?.dmAt).toEqual(NOW);
  });

  it("after /guilded verify, each verified Discord user gets the offer", async () => {
    const { db, client, sent } = world(install());
    await offerByDmToUsers(client, db, "g1", ["u1", "u1"], NOW);
    expect(sent).toHaveLength(1);
  });

  it("Link answers with the linked names; Not now snoozes; an unknown member or install gets a polite refusal", async () => {
    const { db, offers } = world(install());
    expect(await answerOfferButton(db, "u1", "linked:dclaim:dev1", NOW)).toContain("Amy Jones");
    expect(await answerOfferButton(db, "u1", "linked:dclaim:dev1", NOW)).toContain("Nothing left to link");
    guildCharacters = [owned("Ray Smith", "m1", { confirmedAt: NOW, linkEvidence: "companion" })];
    const snooze = world(install());
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
