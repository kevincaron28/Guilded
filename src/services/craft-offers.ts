import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { findCharacter } from "./character-match.js";
import { currentEdition } from "./edition-context.js";

type Db = Pick<PrismaClient, "craftOffer" | "guildSettings" | "recipeKnown" | "character" | "craftRequest">;

// Crafter offers: a crafter lists something they can make, members answer it, and the answer
// becomes an ordinary craft request (claim, status and completion stay as they are). Off until an
// officer turns it on for the Discord server. Guilded never handles gold: the price is free text
// and the trade happens in game.

export const OFFER_LIMITS = { activePerCrafter: 3, perDay: 6, maxDays: 30, defaultDays: 7 } as const;

export interface RecipeMatch { itemKey: number; itemName: string; profession: string; character: string; realm: string }

// Forever characters have no realm in their name; other editions keep Name-Realm.
export const characterLabel = (name: string, realm: string): string => (currentEdition() === "forever" || !realm ? name : `${name}-${realm}`);

export function createCraftOfferService(database: Db) {
  async function find(guildId: string, offerId: string) {
    const offer = await database.craftOffer.findFirst({ where: { id: offerId, guildId }, include: { crafter: true } });
    if (!offer) throw new Error("Craft offer not found.");
    return offer;
  }

  // Recipes recorded for the member's own characters whose name matches the text (exact names first).
  async function ownRecipes(guildId: string, memberId: string, query: string, take = 25): Promise<RecipeMatch[]> {
    const text = query.trim();
    if (!text) return [];
    const characters = await database.character.findMany({ where: { memberId, member: { guildId } }, select: { name: true, realm: true } });
    if (characters.length === 0) return [];
    const rows = await database.recipeKnown.findMany({
      where: { guildId, ...(/^-?\d+$/.test(text) ? { itemKey: Number(text) } : { itemName: { contains: text, mode: "insensitive" as const } }) },
      orderBy: [{ itemName: "asc" }, { character: "asc" }], take: 400
    });
    const own = rows.filter((row) => !!findCharacter(characters, row.character, row.realm));
    const exact = own.filter((row) => row.itemName.toLowerCase() === text.toLowerCase());
    return (exact.length ? exact : own).slice(0, take)
      .map((row) => ({ itemKey: row.itemKey, itemName: row.itemName, profession: row.profession, character: row.character, realm: row.realm }));
  }

  return {
    ownRecipes,

    async isEnabled(guildId: string): Promise<boolean> {
      return !!(await database.guildSettings.findUnique({ where: { guildId }, select: { craftOffersEnabled: true } }))?.craftOffersEnabled;
    },

    async setEnabled(guildId: string, enabled: boolean): Promise<void> {
      await database.guildSettings.updateMany({ where: { guildId }, data: { craftOffersEnabled: enabled } });
    },

    async create(input: {
      guildId: string; crafterId: string; item: string; profession?: string | undefined; price?: string | undefined;
      materialsProvided: boolean; note?: string | undefined; days?: number | undefined; allowUnverified: boolean; now?: Date;
    }) {
      if (!(await this.isEnabled(input.guildId))) throw new Error("Crafter offers are off on this server. An officer can turn them on with /craft offer-setting.");
      const item = input.item.trim();
      if (item.length < 2) throw new Error("Name the item you can craft.");
      const days = Math.min(OFFER_LIMITS.maxDays, Math.max(1, Math.floor(input.days ?? OFFER_LIMITS.defaultDays)));
      const now = input.now ?? new Date();
      const active = await database.craftOffer.count({ where: { guildId: input.guildId, crafterId: input.crafterId, status: "ACTIVE", expiresAt: { gt: now } } });
      if (active >= OFFER_LIMITS.activePerCrafter) throw new Error(`You already have ${OFFER_LIMITS.activePerCrafter} active offers. Withdraw one with /craft withdraw first.`);
      const recent = await database.craftOffer.count({ where: { guildId: input.guildId, crafterId: input.crafterId, createdAt: { gt: new Date(now.getTime() - 24 * 3_600_000) } } });
      if (recent >= OFFER_LIMITS.perDay) throw new Error("You have posted a lot of offers today. Try again tomorrow.");

      const matches = await ownRecipes(input.guildId, input.crafterId, item, 5);
      const recipe = matches[0];
      if (!recipe && !input.allowUnverified) {
        throw new Error(`None of your characters has "${item}" recorded. Open your profession window with Guilded so the recipe is scanned, or set unverified:true to post it labelled as unverified.`);
      }
      const name = (recipe?.itemName ?? item).slice(0, 100);
      const duplicate = await database.craftOffer.count({ where: { guildId: input.guildId, crafterId: input.crafterId, status: "ACTIVE", expiresAt: { gt: now }, item: { equals: name, mode: "insensitive" } } });
      if (duplicate) throw new Error("You already have an active offer for that item.");
      return database.craftOffer.create({
        data: {
          guildId: input.guildId, crafterId: input.crafterId, item: name,
          itemKey: recipe?.itemKey ?? null, character: recipe ? characterLabel(recipe.character, recipe.realm) : null,
          profession: (recipe?.profession ?? input.profession)?.trim().slice(0, 40) || null,
          verified: !!recipe, price: input.price?.trim().slice(0, 100) || null,
          materialsProvided: input.materialsProvided, note: input.note?.trim().slice(0, 300) || null,
          expiresAt: new Date(now.getTime() + days * 86_400_000)
        },
        include: { crafter: true }
      });
    },

    find,

    // Active, unexpired offers of one server only.
    active(guildId: string, now = new Date(), profession?: string) {
      return database.craftOffer.findMany({
        where: { guildId, status: "ACTIVE", expiresAt: { gt: now }, ...(profession ? { profession } : {}) },
        include: { crafter: true }, orderBy: { createdAt: "asc" }, take: 25
      });
    },

    async withdraw(guildId: string, offerId: string, memberId: string, isOfficer: boolean) {
      const offer = await find(guildId, offerId);
      if (offer.status !== "ACTIVE") throw new Error("That offer is already closed.");
      if (offer.crafterId !== memberId && !isOfficer) throw new Error("Only the crafter or an officer can withdraw it.");
      await database.craftOffer.update({ where: { id: offer.id }, data: { status: "WITHDRAWN" } });
      return find(guildId, offerId);
    },

    // The offer a member answers; refuses closed, expired or own offers and a second answer.
    async answerable(guildId: string, offerId: string, buyerId: string, now = new Date()) {
      const offer = await find(guildId, offerId);
      if (offer.status !== "ACTIVE" || offer.expiresAt <= now) throw new Error("That offer has ended.");
      if (offer.crafterId === buyerId) throw new Error("That is your own offer.");
      const pending = await database.craftRequest.count({ where: { guildId, offerId, requesterId: buyerId, status: { in: ["OPEN", "CLAIMED"] } } });
      if (pending) throw new Error("You already answered this offer: see /craft mine.");
      return offer;
    },

    // Marks offers past their time as expired and returns them so their posts can be closed.
    async expireDue(now = new Date()) {
      const due = await database.craftOffer.findMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, include: { guild: true }, take: 100 });
      if (due.length === 0) return [];
      await database.craftOffer.updateMany({ where: { id: { in: due.map((offer) => offer.id) }, status: "ACTIVE" }, data: { status: "EXPIRED" } });
      return due;
    }
  };
}

// The active offers as a short block for the pinned directory post ("" when off or none).
export async function offerDirectoryText(database: Db, guildId: string, lang: Lang = "en", now = new Date()): Promise<string> {
  const service = createCraftOfferService(database);
  if (!(await service.isEnabled(guildId))) return "";
  const offers = await service.active(guildId, now);
  if (offers.length === 0) return "";
  const lines = offers.slice(0, 10).map((offer) => `• ${offer.item}${offer.profession ? ` (${offer.profession})` : ""} — ${offer.crafter.displayName}${offer.price ? `, ${offer.price}` : ""}${offer.verified ? "" : lang === "fr" ? " [non vérifié]" : " [unverified]"}`);
  return `\n\n**${lang === "fr" ? "Offres d'artisans" : "Crafter offers"}**\n${lines.join("\n")}`;
}

export async function offerChoices(database: Pick<PrismaClient, "craftOffer">, guildId: string, query: string, memberId: string, isOfficer: boolean) {
  const rows = await database.craftOffer.findMany({
    where: { guildId, status: "ACTIVE", ...(isOfficer ? {} : { crafterId: memberId }), item: { contains: query.trim(), mode: "insensitive" } },
    orderBy: { createdAt: "asc" }, take: 25
  });
  return rows.map((row) => ({ name: row.item.slice(0, 100), value: row.id }));
}
