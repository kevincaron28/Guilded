import { EpgpTransactionType, type PrismaClient } from "../generated/prisma/client.js";
import { requireCorePool } from "./core-loot-policy.js";
import { markGuildChanged } from "./standings-feed.js";

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
// keeps someone with 1 GP from topping the list on a tiny denominator. As in EPGP
// (Classic: EP / max(1, GP)), GP counts as at least 1, so a raider with EP and no gear
// yet ranks by their EP instead of last.
export function priority(ep: number, gp: number, baseGp = 0): number {
  return ep / Math.max(1, gp + Math.max(0, baseGp));
}

// What one decay takes from a balance: the percent, rounded up as EPGP does, so every balance
// keeps shrinking and none is stuck just under the point where it would round to nothing.
// Never more than the balance itself; a negative balance moves back towards zero.
export function decayAmount(total: number, percent: number): number {
  // 90 × 0.1 is 9.000000000000002 in floating point: without the margin that would round up to 10.
  const amount = Math.min(Math.abs(total), Math.ceil(Math.abs(total) * percent - 1e-9));
  return -Math.sign(total) * amount || 0;
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
    const created = await database.epgpTransaction.create({
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
    // Companions waiting for standings hear about it (see standings-feed).
    markGuildChanged(input.guildId);
    return created;
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
          select: { name: true, realm: true, gameEdition: true, displayName: true, memberId: true, isMain: true }
        })
      ]);
      const byMember = new Map(sums.map((row) => [row.memberId, row._sum]));
      return characters.map((character) => {
        const sum = byMember.get(character.memberId);
        const ep = sum?.epAmount ?? 0;
        const gp = sum?.gpAmount ?? 0;
        return { character: character.name, realm: character.realm, gameEdition: character.gameEdition, ...(character.displayName ? { displayName: character.displayName } : {}), main: character.isMain, ep, gp, pr: priority(ep, gp, baseGp) };
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
    // As in EPGP, every balance in the pool decays, including members who left or are inactive,
    // so a returning player does not come back with points the others lost to decay.
    async applyDecay(guildId: string, percent: number, createdBy: string, coreId: string | null = null, ref?: string) {
      if (!Number.isFinite(percent) || percent < 0 || percent > 1) {
        throw new Error("Decay percent must be between 0 and 1");
      }
      await requireCorePool(database, guildId, coreId);
      const reason = `EPGP decay (${Math.round(percent * 1000) / 10}%)`;
      return database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
        const sums = await tx.epgpTransaction.groupBy({ by: ["memberId"], where: { guildId, coreId }, _sum: { epAmount: true, gpAmount: true } });
        const rows = sums.flatMap(({ memberId, _sum: sum }) => {
          const ep = decayAmount(sum.epAmount ?? 0, percent);
          const gp = decayAmount(sum.gpAmount ?? 0, percent);
          if (ep === 0 && gp === 0) return [];
          return [{
            guildId, memberId, epAmount: ep, gpAmount: gp, type: EpgpTransactionType.DECAY, reason, createdBy, coreId,
            sourceRef: ref ? `${ref}:${memberId}` : null
          }];
        });
        if (rows.length === 0) return [];
        return tx.epgpTransaction.createManyAndReturn({ data: rows, skipDuplicates: true });
      }, { timeout: 60_000, maxWait: 15_000 }).then((rows) => { if (rows.length) markGuildChanged(guildId); return rows; });
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
      // EPGP never lets EP or GP fall below zero. An award reversed after a decay takes back at
      // most what is left in the pool (100 GP, decayed to 90, takes back 90, not 100).
      const now = await database.epgpTransaction.aggregate({ where: { memberId: original.memberId, coreId: original.coreId }, _sum: { epAmount: true, gpAmount: true } });
      const capped = (change: number, total: number) => (change < 0 ? -Math.min(-change, Math.max(0, total)) : change) || 0;
      const epAmount = capped(-original.epAmount, now._sum.epAmount ?? 0);
      const gpAmount = capped(-original.gpAmount, now._sum.gpAmount ?? 0);
      if (epAmount === 0 && gpAmount === 0) {
        throw new Error("Nothing is left to take back: decay already removed those points.");
      }
      const limited = epAmount !== (-original.epAmount || 0) || gpAmount !== (-original.gpAmount || 0);
      return createTransaction({
        guildId: original.guildId,
        memberId: original.memberId,
        epAmount,
        gpAmount,
        type: EpgpTransactionType.REVERSAL,
        reason: limited ? `${reason} (limited to the current balance)` : reason,
        createdBy,
        sourceRef: `reversal:${original.id}`,
        // A correction lands in the same pool as the entry it undoes.
        coreId: original.coreId
      });
    }
  };
}
