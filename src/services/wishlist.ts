import type { PrismaClient } from "@prisma/client";

export const PRIORITY_LABELS: Record<number, string> = { 1: "High", 2: "Medium", 3: "Low" };

export function itemKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function createWishlistService(database: PrismaClient) {
  return {
    add(characterId: string, itemName: string, priority: number) {
      const name = itemName.trim();
      if (name.length < 2 || name.length > 100) throw new Error("Item name must be 2-100 characters.");
      if (!Number.isInteger(priority) || priority < 1 || priority > 3) {
        throw new Error("Priority must be 1 (high), 2 (medium), or 3 (low).");
      }
      const key = itemKey(name);
      return database.wishlistEntry.upsert({
        where: { characterId_itemKey: { characterId, itemKey: key } },
        create: { characterId, itemKey: key, itemName: name, priority },
        update: { itemName: name, priority }
      });
    },

    async remove(characterId: string, itemName: string) {
      const result = await database.wishlistEntry.deleteMany({ where: { characterId, itemKey: itemKey(itemName) } });
      if (result.count === 0) throw new Error("That item is not on this character's wishlist.");
    },

    list(characterId: string) {
      return database.wishlistEntry.findMany({ where: { characterId }, orderBy: [{ priority: "asc" }, { itemName: "asc" }] });
    },

    whoWants(guildId: string, itemName: string) {
      return database.wishlistEntry.findMany({
        where: { itemKey: itemKey(itemName), character: { member: { guildId } } },
        include: { character: true },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
      });
    },

    countWanting(guildId: string, itemName: string) {
      return database.wishlistEntry.count({
        where: { itemKey: itemKey(itemName), character: { member: { guildId } } }
      });
    }
  };
}
