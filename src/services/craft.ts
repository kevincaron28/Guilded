import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "craftRequest">;

// Crafting requests: a member asks, any guild crafter claims it, then marks
// it done. Requesters can cancel; crafters (or officers) can release a
// claim back to the open list.
export function createCraftService(database: Db) {
  async function find(guildId: string, requestId: string) {
    const request = await database.craftRequest.findFirst({
      where: { id: requestId, guildId },
      include: { requester: true, crafter: true }
    });
    if (!request) throw new Error("Craft request not found.");
    return request;
  }

  return {
    async request(input: {
      guildId: string; requesterId: string; item: string; profession?: string | undefined;
      quantity: number; note?: string | undefined; materialsProvided: boolean;
    }) {
      const item = input.item.trim();
      if (item.length < 2) throw new Error("Name the item you want crafted.");
      if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 200) throw new Error("Quantity must be 1-200.");
      const open = await database.craftRequest.count({
        where: { guildId: input.guildId, requesterId: input.requesterId, status: { in: ["OPEN", "CLAIMED"] } }
      });
      if (open >= 10) throw new Error("You already have 10 open craft requests.");
      return database.craftRequest.create({
        data: {
          guildId: input.guildId,
          requesterId: input.requesterId,
          item: item.slice(0, 100),
          profession: input.profession?.trim().slice(0, 40) || null,
          quantity: input.quantity,
          note: input.note?.trim().slice(0, 300) || null,
          materialsProvided: input.materialsProvided
        }
      });
    },

    // Open requests, optionally for one profession (partial, case-insensitive).
    list(guildId: string, profession?: string) {
      return database.craftRequest.findMany({
        where: {
          guildId,
          status: "OPEN",
          ...(profession?.trim() ? { profession: { contains: profession.trim(), mode: "insensitive" as const } } : {})
        },
        include: { requester: true },
        orderBy: { createdAt: "asc" },
        take: 25
      });
    },

    mine(guildId: string, memberId: string) {
      return database.craftRequest.findMany({
        where: { guildId, OR: [{ requesterId: memberId }, { crafterId: memberId }], status: { in: ["OPEN", "CLAIMED"] } },
        include: { requester: true, crafter: true },
        orderBy: { createdAt: "asc" }
      });
    },

    async claim(guildId: string, requestId: string, crafterId: string) {
      const request = await find(guildId, requestId);
      if (request.status !== "OPEN") throw new Error(`That request is already ${request.status.toLowerCase()}.`);
      if (request.requesterId === crafterId) throw new Error("You can't claim your own request.");
      // Conditional update so two crafters clicking at once can't both win.
      const updated = await database.craftRequest.updateMany({
        where: { id: request.id, status: "OPEN" },
        data: { status: "CLAIMED", crafterId, claimedAt: new Date() }
      });
      if (updated.count !== 1) throw new Error("Someone else just claimed it.");
      return find(guildId, requestId);
    },

    async release(guildId: string, requestId: string, memberId: string, isOfficer: boolean) {
      const request = await find(guildId, requestId);
      if (request.status !== "CLAIMED") throw new Error("Only claimed requests can be released.");
      if (request.crafterId !== memberId && !isOfficer) throw new Error("Only the crafter or an officer can release it.");
      await database.craftRequest.update({ where: { id: request.id }, data: { status: "OPEN", crafterId: null, claimedAt: null } });
      return find(guildId, requestId);
    },

    async complete(guildId: string, requestId: string, memberId: string, isOfficer: boolean) {
      const request = await find(guildId, requestId);
      if (request.status !== "CLAIMED") throw new Error("Claim the request before marking it done.");
      if (request.crafterId !== memberId && !isOfficer) throw new Error("Only the crafter or an officer can mark it done.");
      await database.craftRequest.update({ where: { id: request.id }, data: { status: "DONE", doneAt: new Date() } });
      return find(guildId, requestId);
    },

    async cancel(guildId: string, requestId: string, memberId: string, isOfficer: boolean) {
      const request = await find(guildId, requestId);
      if (request.status === "DONE" || request.status === "CANCELLED") throw new Error("That request is already closed.");
      if (request.requesterId !== memberId && !isOfficer) throw new Error("Only the requester or an officer can cancel it.");
      await database.craftRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } });
      return find(guildId, requestId);
    }
  };
}
