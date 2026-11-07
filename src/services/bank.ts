import type { BankRequestStatus, PrismaClient } from "../generated/prisma/client.js";

type Db = Pick<PrismaClient, "bankRequest">;

const OPEN: BankRequestStatus[] = ["PENDING", "APPROVED"];

// Allowed officer transitions. FULFILLED, DENIED, and CANCELLED are final.
const NEXT: Record<BankRequestStatus, BankRequestStatus[]> = {
  PENDING: ["APPROVED", "FULFILLED", "DENIED"],
  APPROVED: ["FULFILLED", "DENIED"],
  FULFILLED: [],
  DENIED: [],
  CANCELLED: []
};

export function createBankService(database: Db) {
  return {
    async request(guildId: string, memberId: string, item: string, quantity: number, note?: string, origin: { itemId?: number | null; source?: "discord" | "addon"; clientRef?: string } = {}) {
      const name = item.trim();
      if (name.length < 2) throw new Error("Name the item you need.");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error("Quantity must be 1-1000.");
      // Keeps one member from flooding the queue.
      const open = await database.bankRequest.count({ where: { guildId, memberId, status: { in: OPEN } } });
      if (open >= 10) throw new Error("You already have 10 open requests. Wait for some to be handled.");
      return database.bankRequest.create({
        data: { guildId, memberId, item: name.slice(0, 100), quantity, note: note?.trim().slice(0, 300) || null,
          itemId: origin.itemId ?? null, source: origin.source ?? "discord", clientRef: origin.clientRef ?? null },
        include: { member: true }
      });
    },

    /**
     * 9.1: requests made in game (addon db.bankRequests, uploaded by the member's own companion).
     * The addon's ref makes a re-upload the same request; a bad row or a full queue is skipped.
     */
    async fromAddon(guildId: string, memberId: string, rows: readonly { ref: string; item: string; itemId?: number | undefined; count: number; note?: string | undefined }[]) {
      const created = [];
      for (const row of rows.slice(0, 10)) {
        const known = await database.bankRequest.findFirst({ where: { guildId, clientRef: row.ref }, select: { id: true } });
        if (known) continue;
        const request = await this.request(guildId, memberId, row.item, row.count, row.note, { itemId: row.itemId ?? null, source: "addon", clientRef: row.ref }).catch(() => null);
        if (request) created.push(request);
      }
      return created;
    },

    mine(guildId: string, memberId: string) {
      return database.bankRequest.findMany({ where: { guildId, memberId }, orderBy: { createdAt: "desc" }, take: 15 });
    },

    list(guildId: string, statuses: BankRequestStatus[] = OPEN) {
      return database.bankRequest.findMany({
        where: { guildId, status: { in: statuses } },
        include: { member: true },
        orderBy: { createdAt: "asc" },
        take: 25
      });
    },

    async setStatus(guildId: string, requestId: string, status: BankRequestStatus, handledBy: string, reply?: string) {
      const existing = await database.bankRequest.findFirst({ where: { id: requestId, guildId } });
      if (!existing) throw new Error("Bank request not found.");
      if (!NEXT[existing.status].includes(status)) {
        throw new Error(`That request is ${existing.status.toLowerCase()}; it can't be marked ${status.toLowerCase()}.`);
      }
      return database.bankRequest.update({
        where: { id: existing.id },
        data: { status, handledBy, handledAt: new Date(), reply: reply?.trim().slice(0, 300) || null },
        include: { member: true }
      });
    },

    async cancel(guildId: string, memberId: string, requestId: string) {
      const existing = await database.bankRequest.findFirst({ where: { id: requestId, guildId, memberId } });
      if (!existing) throw new Error("You have no request with that ID.");
      if (!OPEN.includes(existing.status)) throw new Error("Only open requests can be cancelled.");
      return database.bankRequest.update({ where: { id: existing.id }, data: { status: "CANCELLED" } });
    }
  };
}
