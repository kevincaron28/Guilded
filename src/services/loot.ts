import { AuctionStatus, EpgpTransactionType, type PrismaClient } from "@prisma/client";
import { poolFor } from "./core-rules.js";
import { requireCorePool } from "./core-loot-policy.js";

export interface CreateAuctionInput {
  guildId: string;
  itemName: string;
  minimumBid: number;
  bidIncrement: number;
  durationSeconds: number;
  createdBy: string;
  raidId?: string | undefined;
  bossName?: string | undefined;
}

export function createLootService(database: PrismaClient) {
  return {
    async createAuction(input: CreateAuctionInput) {
      if (!input.itemName.trim()) throw new Error("Item name is required");
      if (!Number.isInteger(input.minimumBid) || input.minimumBid < 1) throw new Error("Minimum bid must be positive");
      if (!Number.isInteger(input.bidIncrement) || input.bidIncrement < 1) throw new Error("Bid increment must be positive");
      if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 1) throw new Error("Auction duration must be positive");
      const raid = input.raidId ? await database.raid?.findFirst({ where: { id: input.raidId, guildId: input.guildId }, include: { core: true } }) : null;
      await requireCorePool(database, input.guildId, poolFor(raid?.core));
      return database.auction.create({
        data: {
          guildId: input.guildId,
          itemName: input.itemName.trim(),
          minimumBid: input.minimumBid,
          bidIncrement: input.bidIncrement,
          closesAt: new Date(Date.now() + input.durationSeconds * 1000),
          createdBy: input.createdBy,
          raidId: input.raidId?.trim() || null,
          bossName: input.bossName?.trim() || null
        }
      });
    },

    async placeBid(input: { auctionId: string; memberId: string; amount: number }) {
      if (!Number.isInteger(input.amount) || input.amount < 1) throw new Error("Bid must be a positive integer");
      return database.$transaction(async (tx) => {
        const auction = await tx.auction.findUnique({ where: { id: input.auctionId }, include: { bids: true } });
        if (!auction || auction.status !== AuctionStatus.ACTIVE || auction.closesAt <= new Date()) {
          throw new Error("Auction is not active");
        }
        const member = await tx.member.findUnique({ where: { id: input.memberId } });
        if (!member || member.guildId !== auction.guildId) throw new Error("You cannot bid in this guild");
        const raid = auction.raidId ? await tx.raid?.findFirst({ where: { id: auction.raidId, guildId: auction.guildId }, include: { core: true } }) : null;
        await requireCorePool(tx, auction.guildId, poolFor(raid?.core));
        const highest = auction.bids.reduce((max, bid) => Math.max(max, bid.amount), 0);
        const minimum = Math.max(auction.minimumBid, highest ? highest + auction.bidIncrement : auction.minimumBid);
        if (input.amount < minimum) throw new Error(`Bid must be at least ${minimum} GP`);
        return tx.auctionBid.upsert({
          where: { auctionId_memberId: { auctionId: input.auctionId, memberId: input.memberId } },
          create: { auctionId: input.auctionId, memberId: input.memberId, amount: input.amount },
          update: { amount: input.amount }
        });
      });
    },

    async closeAuction(auctionId: string, closedBy: string) {
      return database.$transaction(async (tx) => {
        const auction = await tx.auction.findUnique({
          where: { id: auctionId },
          include: { bids: { orderBy: [{ amount: "desc" }, { createdAt: "asc" }] } }
        });
        if (!auction || auction.status !== AuctionStatus.ACTIVE) throw new Error("Auction is not active");
        const winner = auction.bids[0];
        const updated = await tx.auction.updateMany({
          where: { id: auctionId, status: AuctionStatus.ACTIVE },
          data: { status: AuctionStatus.CLOSED, closedAt: new Date() }
        });
        if (updated.count !== 1) throw new Error("Auction was already closed");
        if (!winner) return { auction, award: null };
        // GP lands in the raid's core pool when that core keeps its own points.
        const raid = auction.raidId ? await tx.raid.findFirst({ where: { id: auction.raidId, guildId: auction.guildId }, include: { core: true } }) : null;
        const coreId = poolFor(raid?.core);
        await requireCorePool(tx, auction.guildId, coreId);
        // Snapshot the winner's totals before the GP lands, for loot history.
        const before = await tx.epgpTransaction.aggregate({
          where: { memberId: winner.memberId, coreId },
          _sum: { epAmount: true, gpAmount: true }
        });
        const transaction = await tx.epgpTransaction.create({
          data: {
            guildId: auction.guildId,
            memberId: winner.memberId,
            epAmount: 0,
            gpAmount: winner.amount,
            type: EpgpTransactionType.ITEM_AWARD,
            reason: `Loot auction: ${auction.itemName}`,
            sourceRef: auctionId,
            createdBy: closedBy,
            coreId
          }
        });
        const award = await tx.lootAward.create({
          data: {
            guildId: auction.guildId,
            auctionId,
            memberId: winner.memberId,
            itemName: auction.itemName,
            amount: winner.amount,
            raidId: auction.raidId,
            bossName: auction.bossName,
            awardedBy: closedBy,
            epBefore: before._sum.epAmount ?? 0,
            gpBefore: before._sum.gpAmount ?? 0
          },
          include: { member: true }
        });
        return { auction: { ...auction, status: AuctionStatus.CLOSED }, award, transaction };
      });
    },

    // Loot council / direct award: no auction. GP is charged only when gp > 0
    // (council guilds usually award for 0), and the award lands in loot history.
    async awardDirect(input: { guildId: string; memberId: string; itemName: string; gp: number; raidId?: string | undefined; bossName?: string | undefined; awardedBy: string }) {
      const itemName = input.itemName.trim();
      if (!itemName) throw new Error("Item name is required");
      if (!Number.isInteger(input.gp) || input.gp < 0) throw new Error("GP must be zero or a positive whole number");
      return database.$transaction(async (tx) => {
        const member = await tx.member.findUnique({ where: { id: input.memberId } });
        if (!member || member.guildId !== input.guildId) throw new Error("That player is not in this guild");
        const raid = input.raidId?.trim() ? await tx.raid.findFirst({ where: { id: input.raidId.trim(), guildId: input.guildId }, include: { core: true } }) : null;
        const coreId = poolFor(raid?.core);
        await requireCorePool(tx, input.guildId, coreId);
        const before = await tx.epgpTransaction.aggregate({ where: { memberId: input.memberId, coreId }, _sum: { epAmount: true, gpAmount: true } });
        if (input.gp > 0) {
          await tx.epgpTransaction.create({
            data: {
              guildId: input.guildId, memberId: input.memberId, epAmount: 0, gpAmount: input.gp,
              type: EpgpTransactionType.ITEM_AWARD, reason: `Loot award: ${itemName}`,
              sourceRef: `loot-direct:${input.memberId}:${Date.now()}:${itemName}`, createdBy: input.awardedBy, coreId
            }
          });
        }
        return tx.lootAward.create({
          data: {
            guildId: input.guildId, memberId: input.memberId, itemName, amount: input.gp,
            raidId: input.raidId?.trim() || null, bossName: input.bossName?.trim() || null, awardedBy: input.awardedBy,
            epBefore: before._sum.epAmount ?? 0, gpBefore: before._sum.gpAmount ?? 0
          },
          include: { member: true }
        });
      });
    },

    getActiveAuctions(guildId: string) {
      return database.auction.findMany({
        where: { guildId, status: AuctionStatus.ACTIVE },
        include: { bids: { orderBy: { amount: "desc" }, take: 1 } },
        orderBy: { closesAt: "asc" }
      });
    },

    async getHistory(guildId: string, limit = 20, coreId?: string) {
      const raids = coreId ? await database.raid.findMany({ where: { guildId, coreId }, select: { id: true } }) : [];
      return database.lootAward.findMany({
        where: { guildId, ...(coreId ? { raidId: { in: raids.map((raid) => raid.id) } } : {}) },
        include: { member: true, auction: true },
        orderBy: { awardedAt: "desc" },
        take: limit
      });
    }
  };
}
