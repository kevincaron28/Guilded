import type { PrismaClient } from "../generated/prisma/client.js";
import { createCraftService } from "./craft.js";
import { normalizeProfessionName } from "./profession-names.js";

// Phone app 0.6.0: crafting from the phone. Who in my guild can craft an item (the recipes their addons scanned,
// RecipeKnown), my open requests, and a new request through the same craft service as /craft request and the
// addon's Request button (craft.ts: limits, trimming), then posted to Discord like the others (craft-board.ts).
// Members of that guild only.

type Db = Pick<PrismaClient, "member" | "recipeKnown" | "craftRequest">;

const GUILD_ID = /^\d{5,30}$/;
export const SEARCH_MIN = 2;
export const SEARCH_MAX_RESULTS = 25;

export interface CraftableItem { itemKey: number; itemName: string; profession: string; crafters: string[] }
export interface MyCraftRequest { id: string; item: string; quantity: number; status: string; crafter: string | null; mine: boolean; createdAt: string }

async function memberIn(database: Pick<PrismaClient, "member">, discordUserId: string, guildDiscordId: unknown, allows: (id: string) => boolean) {
  if (typeof guildDiscordId !== "string" || !GUILD_ID.test(guildDiscordId) || !allows(guildDiscordId)) return null;
  return database.member.findFirst({ where: { discordUserId, status: "ACTIVE", isTest: false, guild: { discordId: guildDiscordId } }, select: { id: true, guildId: true } });
}

/** Items matching `query` that someone in the guild knows how to make, with who (characters, alphabetical), and my open requests. */
export async function craftingFor(database: Db, discordUserId: string, guildDiscordId: unknown, query: unknown, allows: (id: string) => boolean = () => true): Promise<{ items: CraftableItem[]; requests: MyCraftRequest[] }> {
  const member = await memberIn(database, discordUserId, guildDiscordId, allows);
  if (!member) return { items: [], requests: [] };
  const text = typeof query === "string" ? query.trim().slice(0, 60) : "";
  const known = text.length >= SEARCH_MIN ? await database.recipeKnown.findMany({
    where: { guildId: member.guildId, itemName: { contains: text, mode: "insensitive" } },
    select: { itemKey: true, itemName: true, profession: true, character: true }, orderBy: { itemName: "asc" }, take: 400
  }) : [];
  const byItem = new Map<number, CraftableItem>();
  for (const row of known) {
    const item = byItem.get(row.itemKey) ?? { itemKey: row.itemKey, itemName: row.itemName, profession: normalizeProfessionName(row.profession), crafters: [] };
    if (!item.crafters.some((name) => name.toLowerCase() === row.character.toLowerCase())) item.crafters.push(row.character);
    byItem.set(row.itemKey, item);
  }
  const items = [...byItem.values()].slice(0, SEARCH_MAX_RESULTS).map((item) => ({ ...item, crafters: item.crafters.sort((a, b) => a.localeCompare(b)).slice(0, 12) }));
  const requests = await database.craftRequest.findMany({
    where: { guildId: member.guildId, OR: [{ requesterId: member.id }, { crafterId: member.id }], status: { in: ["OPEN", "CLAIMED"] } },
    select: { id: true, item: true, quantity: true, status: true, requesterId: true, crafterCharacter: true, crafter: { select: { displayName: true } }, createdAt: true },
    orderBy: { createdAt: "desc" }, take: 20
  });
  return {
    items,
    requests: requests.map((row) => ({ id: row.id, item: row.item, quantity: row.quantity, status: row.status, crafter: row.crafterCharacter ?? row.crafter?.displayName ?? null, mine: row.requesterId === member.id, createdAt: row.createdAt.toISOString() }))
  };
}

export type CraftRequestOutcome = { status: "ok"; id: string; guildId: string; guildDiscordId: string; asked?: string } | { status: "invalid" | "gone" } | { status: "refused"; message: string };

/** A new request from the phone. The item must be one somebody in the guild can make (a known recipe), so a typo never posts. */
export async function requestCraftFor(database: Db, discordUserId: string, input: { guildDiscordId?: unknown; itemKey?: unknown; quantity?: unknown; note?: unknown; character?: unknown },
  allows: (id: string) => boolean = () => true): Promise<CraftRequestOutcome> {
  const quantity = input.quantity === undefined ? 1 : input.quantity;
  if (typeof input.itemKey !== "number" || !Number.isInteger(input.itemKey) || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 200) return { status: "invalid" };
  if (input.note !== undefined && typeof input.note !== "string") return { status: "invalid" };
  if (input.character !== undefined && typeof input.character !== "string") return { status: "invalid" };
  const member = await memberIn(database, discordUserId, input.guildDiscordId, allows);
  if (!member) return { status: "gone" };
  const recipes = await database.recipeKnown.findMany({ where: { guildId: member.guildId, itemKey: input.itemKey }, select: { itemName: true, profession: true, character: true }, take: 50 });
  const recipe = recipes[0];
  if (!recipe) return { status: "gone" };
  // Asking one crafter by name is optional; it must be one of the characters that knows the recipe.
  const asked = typeof input.character === "string" && input.character.trim()
    ? recipes.find((row) => row.character.toLowerCase() === (input.character as string).trim().toLowerCase())?.character
    : undefined;
  if (typeof input.character === "string" && input.character.trim() && !asked) return { status: "invalid" };
  try {
    const created = await createCraftService(database).request({
      guildId: member.guildId, requesterId: member.id, item: recipe.itemName, profession: recipe.profession, quantity,
      note: typeof input.note === "string" ? input.note : undefined, materialsProvided: false, itemKey: input.itemKey, askedCharacter: asked
    });
    return { status: "ok", id: created.id, guildId: member.guildId, guildDiscordId: input.guildDiscordId as string, ...(asked ? { asked } : {}) };
  } catch (error) {
    return { status: "refused", message: error instanceof Error ? error.message : "That request was not saved." };
  }
}
