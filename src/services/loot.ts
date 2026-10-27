import { AuctionStatus, EpgpTransactionType, type PrismaClient } from "../generated/prisma/client.js";
import { effectiveRules, poolFor } from "./core-rules.js";
import { requireCorePool } from "./core-loot-policy.js";
import { priority } from "./epgp.js";
import { markGuildChanged } from "./standings-feed.js";

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

// Bids best first, in EPGP Classic's bidding order: bidders with at least the minimum EP before those
// without, then the highest bid, then the higher PR, then whoever bid first. The addon ranks its
// sealed bids the same way (Modules/Bidding.lua).
export function rankBids<T extends { memberId: string; amount: number; createdAt: Date }>(
  bids: T[], standings: Map<string, { ep: number; gp: number }>, minEp: number, baseGp: number
): T[] {
  const rank = (bid: T) => {
    const { ep, gp } = standings.get(bid.memberId) ?? { ep: 0, gp: 0 };
    return { below: ep < minEp ? 1 : 0, pr: priority(ep, gp, baseGp) };
  };
  return [...bids].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra.below - rb.below || b.amount - a.amount || rb.pr - ra.pr || a.createdAt.getTime() - b.createdAt.getTime();
  });
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
        // The leader before this bid (the earliest top bid, as closing picks), told when someone else overtakes them.
        const leader = auction.bids.filter((bid) => bid.amount === highest).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        const bid = await tx.auctionBid.upsert({
          where: { auctionId_memberId: { auctionId: input.auctionId, memberId: input.memberId } },
          create: { auctionId: input.auctionId, memberId: input.memberId, amount: input.amount },
          update: { amount: input.amount }
        });
        const outbid = leader && leader.memberId !== input.memberId
          ? await tx.member.findUnique({ where: { id: leader.memberId }, select: { discordUserId: true, isTest: true } })
          : null;
        return Object.assign(bid, {
          auction: { itemName: auction.itemName, closesAt: auction.closesAt },
          outbid: outbid && !outbid.isTest ? { discordUserId: outbid.discordUserId } : null
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
        const updated = await tx.auction.updateMany({
          where: { id: auctionId, status: AuctionStatus.ACTIVE },
          data: { status: AuctionStatus.CLOSED, closedAt: new Date() }
        });
        if (updated.count !== 1) throw new Error("Auction was already closed");
        if (!auction.bids.length) return { auction, award: null };
        // GP lands in the raid's core pool when that core keeps its own points.
        const raid = auction.raidId ? await tx.raid.findFirst({ where: { id: auction.raidId, guildId: auction.guildId }, include: { core: true } }) : null;
        const coreId = poolFor(raid?.core);
        await requireCorePool(tx, auction.guildId, coreId);
        let winner = auction.bids[0]!;
        if (auction.bids.length > 1) {
          // EPGP bidding order: bidders with the core's minimum EP first, then the highest bid.
          const rules = effectiveRules(await tx.guildSettings?.findUnique({ where: { guildId: auction.guildId } }), raid?.core);
          const sums = await tx.epgpTransaction.groupBy({
            by: ["memberId"], where: { memberId: { in: auction.bids.map((bid) => bid.memberId) }, coreId }, _sum: { epAmount: true, gpAmount: true }
          });
          const standings = new Map(sums.map((row) => [row.memberId, { ep: row._sum.epAmount ?? 0, gp: row._sum.gpAmount ?? 0 }]));
          winner = rankBids(auction.bids, standings, rules.minEp, rules.baseGp)[0]!;
        }
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
      }).then((result) => { if (result.award) markGuildChanged(result.award.guildId); return result; });
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
      }).then((award) => { markGuildChanged(input.guildId); return award; });
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
