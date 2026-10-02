import { EpgpTransactionType, type PrismaClient } from "@prisma/client";
import { requireCorePool } from "./core-loot-policy.js";

export interface CreateEpgpTransaction {
  guildId: string;
  memberId: string;
  epAmount?: number;
  gpAmount?: number;
  type: EpgpTransactionType;
  reason: string;
  createdBy: string;
  sourceRef?: string;
  // A raid core's own point pool; leave out for the guild pool.
  coreId?: string | null;
}

export interface EpgpStanding {
  ep: number;
  gp: number;
  pr: number;
}

function validateAmount(value: number | undefined, name: string): number {
  const amount = value ?? 0;
  if (!Number.isInteger(amount)) {
    throw new Error(`${name} must be an integer`);
  }
  return amount;
}

// PR = EP / (GP + base GP). The base GP (guild setting, standard in EPGP)
// keeps someone with 1 GP from topping the list on a tiny denominator.
export function priority(ep: number, gp: number, baseGp = 0): number {
  const denominator = gp + Math.max(0, baseGp);
  return denominator > 0 ? ep / denominator : 0;
}

export function createEpgpService(database: PrismaClient) {
  const createTransaction = async (input: CreateEpgpTransaction) => {
    const epAmount = validateAmount(input.epAmount, "EP amount");
    const gpAmount = validateAmount(input.gpAmount, "GP amount");
    if (epAmount === 0 && gpAmount === 0) {
      throw new Error("EPGP transaction must change EP or GP");
    }
    const reason = input.reason.trim();
    if (reason.length < 3) {
      throw new Error("EPGP transaction reason must be at least 3 characters");
    }
    // Historical corrections keep the original pool, including a retired guild pool.
    if (input.type !== EpgpTransactionType.REVERSAL) await requireCorePool(database, input.guildId, input.coreId);

    // The ledger is append-only: corrections use reverseTransaction rather than updates/deletes.
    return database.epgpTransaction.create({
      data: {
        guildId: input.guildId,
        memberId: input.memberId,
        epAmount,
        gpAmount,
        type: input.type,
        reason,
        createdBy: input.createdBy,
        sourceRef: input.sourceRef ?? null,
        coreId: input.coreId ?? null
      }
    });
  };

  // `coreId` picks a core's own pool; the default (null) is the guild pool.
  const getStanding = async (memberId: string, baseGp = 0, coreId: string | null = null): Promise<EpgpStanding> => {
    const result = await database.epgpTransaction.aggregate({
      where: { memberId, coreId },
      _sum: { epAmount: true, gpAmount: true }
    });
    const ep = result._sum.epAmount ?? 0;
    const gp = result._sum.gpAmount ?? 0;
    return { ep, gp, pr: priority(ep, gp, baseGp) };
  };

  return {
    createTransaction,

    awardEP(input: Omit<CreateEpgpTransaction, "epAmount" | "gpAmount" | "type"> & { amount: number }) {
      return createTransaction({ ...input, epAmount: input.amount, type: EpgpTransactionType.EP_AWARD });
    },

    awardItem(input: Omit<CreateEpgpTransaction, "epAmount" | "gpAmount" | "type"> & { gp: number }) {
      return createTransaction({ ...input, gpAmount: input.gp, type: EpgpTransactionType.ITEM_AWARD });
    },

    getStanding,

    // One row per linked character, carrying its member's EP/GP/PR, so the
    // addon can look standings up by the character name it sees in game.
    async getGuildStandings(guildId: string, baseGp = 0, coreId: string | null = null) {
      const [sums, characters] = await Promise.all([
        database.epgpTransaction.groupBy({
          by: ["memberId"],
          where: { guildId, coreId },
          _sum: { epAmount: true, gpAmount: true }
        }),
        database.character.findMany({
          where: { member: { guildId, status: "ACTIVE" } },
          select: { name: true, memberId: true, isMain: true }
        })
      ]);
      const byMember = new Map(sums.map((row) => [row.memberId, row._sum]));
      return characters.map((character) => {
        const sum = byMember.get(character.memberId);
        const ep = sum?.epAmount ?? 0;
        const gp = sum?.gpAmount ?? 0;
        return { character: character.name, main: character.isMain, ep, gp, pr: priority(ep, gp, baseGp) };
      });
    },

    async getHistory(memberId: string, limit = 10, coreId: string | null = null) {
      return database.epgpTransaction.findMany({
        where: { memberId, coreId },
        orderBy: { createdAt: "desc" },
        take: limit
      });
    },

    // Decays one pool: the guild pool, or a core's own pool when `coreId` is given. Everyone
    // decays together or nobody does: one transaction, behind the same per-guild lock as addon
    // imports, so points cannot move while the amounts are worked out. With `ref` (automatic
    // decay passes the week) a second run of the same decay adds nothing.
    async applyDecay(guildId: string, percent: number, createdBy: string, coreId: string | null = null, ref?: string) {
      if (!Number.isFinite(percent) || percent < 0 || percent > 1) {
        throw new Error("Decay percent must be between 0 and 1");
      }
      await requireCorePool(database, guildId, coreId);
      const reason = `EPGP decay (${Math.round(percent * 1000) / 10}%)`;
      return database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
        const [members, sums] = await Promise.all([
          tx.member.findMany({ where: { guildId, status: "ACTIVE" }, select: { id: true } }),
          tx.epgpTransaction.groupBy({ by: ["memberId"], where: { guildId, coreId }, _sum: { epAmount: true, gpAmount: true } })
        ]);
        const byMember = new Map(sums.map((row) => [row.memberId, row._sum]));
        const rows = members.flatMap((member) => {
          const sum = byMember.get(member.id);
          const ep = -Math.floor((sum?.epAmount ?? 0) * percent) || 0;
          const gp = -Math.floor((sum?.gpAmount ?? 0) * percent) || 0;
          if (ep === 0 && gp === 0) return [];
          return [{
            guildId, memberId: member.id, epAmount: ep, gpAmount: gp, type: EpgpTransactionType.DECAY, reason, createdBy, coreId,
            sourceRef: ref ? `${ref}:${member.id}` : null
          }];
        });
        if (rows.length === 0) return [];
        return tx.epgpTransaction.createManyAndReturn({ data: rows, skipDuplicates: true });
      }, { timeout: 60_000, maxWait: 15_000 });
    },

    async reverseTransaction(transactionId: string, createdBy: string, reason: string, guildId?: string) {
      const original = await database.epgpTransaction.findUnique({ where: { id: transactionId } });
      if (!original || (guildId && original.guildId !== guildId)) {
        throw new Error("EPGP transaction not found");
      }
      // A correction is itself a ledger entry; undo a mistaken correction
      // with a new award rather than stacking reversals.
      if (original.type === EpgpTransactionType.REVERSAL) {
        throw new Error("That entry is already a reversal and can't be reversed again.");
      }
      const existing = await database.epgpTransaction.findFirst({ where: { sourceRef: `reversal:${original.id}` } });
      if (existing) {
        throw new Error("That entry has already been reversed.");
      }
      return createTransaction({
        guildId: original.guildId,
        memberId: original.memberId,
        epAmount: -original.epAmount || 0,
        gpAmount: -original.gpAmount || 0,
        type: EpgpTransactionType.REVERSAL,
        reason,
        createdBy,
        sourceRef: `reversal:${original.id}`,
        // A correction lands in the same pool as the entry it undoes.
        coreId: original.coreId
      });
    }
  };
}
