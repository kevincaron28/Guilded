import { describe, expect, it, vi } from "vitest";
import { createCraftOfferService, offerDirectoryText, OFFER_LIMITS } from "../src/services/craft-offers.js";
import { offerEmbed, offerTitle } from "../src/commands/craft-offers.js";
import { craftCommand } from "../src/commands/craft.js";

const NOW = new Date("2026-11-05T12:00:00Z");

function makeDb(over: { enabled?: boolean; active?: number; recent?: number; duplicate?: number; recipes?: unknown[]; characters?: unknown[]; offer?: unknown; pending?: number } = {}) {
  const count = vi.fn()
    .mockResolvedValueOnce(over.active ?? 0)
    .mockResolvedValueOnce(over.recent ?? 0)
    .mockResolvedValueOnce(over.duplicate ?? 0);
  return {
    guildSettings: { findUnique: vi.fn().mockResolvedValue({ craftOffersEnabled: over.enabled ?? true }), updateMany: vi.fn() },
    character: { findMany: vi.fn().mockResolvedValue(over.characters ?? [{ name: "Aria Stone", realm: "" }]) },
    recipeKnown: { findMany: vi.fn().mockResolvedValue(over.recipes ?? [{ itemKey: 11, itemName: "Flask of the Titans", profession: "Alchemy", character: "Aria Stone", realm: "", scannedAt: NOW }]) },
    craftOffer: {
      count, create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "o1", ...data, crafter: { discordUserId: "u1", displayName: "Aria" } })),
      findFirst: vi.fn().mockResolvedValue(over.offer ?? null), update: vi.fn(), findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn()
    },
    craftRequest: { count: vi.fn().mockResolvedValue(over.pending ?? 0) }
  };
}
const base = { guildId: "g1", crafterId: "m1", item: "flask of the titans", materialsProvided: false, allowUnverified: false, now: NOW };

describe("crafter offers", () => {
  it("is off by default: nothing can be posted until an officer turns it on", async () => {
    const db = makeDb({ enabled: false });
    await expect(createCraftOfferService(db as never).create(base)).rejects.toThrow("off on this server");
    expect(db.craftOffer.create).not.toHaveBeenCalled();
  });

  it("builds a verified offer from the crafter's own recorded recipe, using the recorded item name", async () => {
    const db = makeDb();
    const offer = await createCraftOfferService(db as never).create({ ...base, price: " 50g or tips ", days: 3 });
    const data = db.craftOffer.create.mock.calls[0]?.[0].data;
    expect(offer.verified).toBe(true);
    expect(data).toMatchObject({ guildId: "g1", item: "Flask of the Titans", itemKey: 11, profession: "Alchemy", verified: true, price: "50g or tips", character: "Aria Stone" });
    expect(data.expiresAt).toEqual(new Date(NOW.getTime() + 3 * 86_400_000));
  });

  it("refuses a recipe no character of theirs was seen with, unless posted unverified (and labels it)", async () => {
    const db = makeDb({ recipes: [] });
    await expect(createCraftOfferService(db as never).create(base)).rejects.toThrow("recorded");
    const db2 = makeDb({ recipes: [] });
    const offer = await createCraftOfferService(db2 as never).create({ ...base, allowUnverified: true, profession: "Alchemy" });
    expect(offer.verified).toBe(false);
    expect(offerEmbed({ ...offer, status: "ACTIVE", expiresAt: new Date(NOW.getTime() + 1000), crafter: { discordUserId: "u1", displayName: "Aria" } } as never).toJSON().fields?.find((f) => f.name === "Recipe")?.value).toContain("Unverified");
  });

  it("ignores recipes recorded for other members' characters", async () => {
    const db = makeDb({ characters: [{ name: "Someone Else", realm: "" }] });
    await expect(createCraftOfferService(db as never).create(base)).rejects.toThrow("recorded");
  });

  it("rate limits: active offers per crafter, offers per day, duplicates", async () => {
    await expect(createCraftOfferService(makeDb({ active: OFFER_LIMITS.activePerCrafter }) as never).create(base)).rejects.toThrow("active offers");
    await expect(createCraftOfferService(makeDb({ recent: OFFER_LIMITS.perDay }) as never).create(base)).rejects.toThrow("lot of offers");
    await expect(createCraftOfferService(makeDb({ duplicate: 1 }) as never).create(base)).rejects.toThrow("already have an active offer");
  });

  it("caps the lifetime to 30 days", async () => {
    const db = makeDb();
    await createCraftOfferService(db as never).create({ ...base, days: 500 });
    expect(db.craftOffer.create.mock.calls[0]?.[0].data.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 86_400_000));
  });

  it("only the crafter or an officer can withdraw, and a closed offer stays closed", async () => {
    const offer = { id: "o1", crafterId: "m1", status: "ACTIVE", crafter: {} };
    const service = createCraftOfferService(makeDb({ offer }) as never);
    await expect(service.withdraw("g1", "o1", "other", false)).rejects.toThrow("Only the crafter");
    await expect(service.withdraw("g1", "o1", "other", true)).resolves.toBeTruthy();
    await expect(createCraftOfferService(makeDb({ offer: { ...offer, status: "WITHDRAWN" } }) as never).withdraw("g1", "o1", "m1", false)).rejects.toThrow("closed");
  });

  it("an offer can be answered once, not when expired or withdrawn, and not by its own crafter", async () => {
    const offer = { id: "o1", crafterId: "m1", status: "ACTIVE", expiresAt: new Date(NOW.getTime() + 1000), crafter: {} };
    await expect(createCraftOfferService(makeDb({ offer }) as never).answerable("g1", "o1", "buyer", NOW)).resolves.toBeTruthy();
    await expect(createCraftOfferService(makeDb({ offer }) as never).answerable("g1", "o1", "m1", NOW)).rejects.toThrow("your own");
    await expect(createCraftOfferService(makeDb({ offer: { ...offer, expiresAt: NOW } }) as never).answerable("g1", "o1", "buyer", NOW)).rejects.toThrow("ended");
    await expect(createCraftOfferService(makeDb({ offer: { ...offer, status: "WITHDRAWN" } }) as never).answerable("g1", "o1", "buyer", NOW)).rejects.toThrow("ended");
    await expect(createCraftOfferService(makeDb({ offer, pending: 1 }) as never).answerable("g1", "o1", "buyer", NOW)).rejects.toThrow("already answered");
  });

  it("scopes every lookup to the guild (multi-guild isolation)", async () => {
    const db = makeDb({ offer: { id: "o1", crafterId: "m1", status: "ACTIVE", expiresAt: NOW, crafter: {} } });
    const service = createCraftOfferService(db as never);
    await service.find("g1", "o1");
    expect(db.craftOffer.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "o1", guildId: "g1" } }));
    await service.active("g1", NOW);
    expect(db.craftOffer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "g1", status: "ACTIVE" }) }));
  });

  it("expires offers past their time and reports them", async () => {
    const db = makeDb();
    db.craftOffer.findMany.mockResolvedValueOnce([{ id: "o1", guildId: "g1", guild: { discordId: "d1" } }]);
    const expired = await createCraftOfferService(db as never).expireDue(NOW);
    expect(expired).toHaveLength(1);
    expect(db.craftOffer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "EXPIRED" } }));
  });

  it("lists active offers in the directory only when switched on, and says unverified ones are", async () => {
    const offer = { item: "Flask", profession: "Alchemy", price: "tips", verified: false, crafter: { displayName: "Aria" } };
    const on = makeDb();
    on.craftOffer.findMany.mockResolvedValue([offer]);
    expect(await offerDirectoryText(on as never, "g1", "en", NOW)).toContain("[unverified]");
    expect(await offerDirectoryText(on as never, "g1", "fr", NOW)).toContain("Offres d'artisans");
    const off = makeDb({ enabled: false });
    expect(await offerDirectoryText(off as never, "g1", "en", NOW)).toBe("");
  });
});

describe("offer post", () => {
  const offer = (extra: Record<string, unknown> = {}) => ({
    id: "o1", item: "Flask of the Titans", profession: "Alchemy", price: null, verified: true, character: "Aria Stone", materialsProvided: true, note: "@everyone evenings",
    status: "ACTIVE" as const, expiresAt: new Date("2026-11-12T00:00:00Z"), crafter: { discordUserId: "u1", displayName: "Aria" }, ...extra
  });

  it("titles the post and shows the crafter, price fallback and the no-gold footer, in English and French", () => {
    expect(offerTitle(offer() as never)).toBe("💰 Offer: Flask of the Titans");
    expect(offerTitle(offer({ status: "EXPIRED" }) as never)).toContain("ended");
    const en = offerEmbed(offer() as never).toJSON();
    expect(en.fields?.find((f) => f.name === "Price")?.value).toBe("Ask the crafter");
    expect(en.footer?.text).toContain("never handles gold");
    const fr = offerEmbed(offer() as never, "fr").toJSON();
    expect(fr.fields?.find((f) => f.name === "Prix")?.value).toBe("Demandez à l'artisan");
    expect(fr.footer?.text).toContain("jamais l'or");
  });
});

describe("/craft command", () => {
  it("adds the offer subcommands under /craft and stays small", () => {
    const names = craftCommand.toJSON().options?.map((o) => o.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["offer", "offers", "withdraw", "offer-setting"]));
  });
});
