import { EpgpTransactionType, type PrismaClient } from "@prisma/client";
import { effectiveRules, poolFor } from "./core-rules.js";

// Proposed EP for one raid, built from recorded attendance and boss kills
// using the guild's settings. Nothing is written until an officer approves.
export interface EpProposalRow {
  memberId: string;
  name: string;
  status: "PRESENT" | "LATE" | "BENCHED";
  ep: number;
}

export interface EpProposal {
  raidId: string;
  title: string;
  bossesKilled: number;
  bossesPlanned: number;
  perBoss: number;
  completionBonus: number;
  rows: EpProposalRow[];
  // The core's own pool the EP goes to; null = the guild pool.
  poolCoreId: string | null;
  coreName: string | null;
}

type Db = Pick<PrismaClient, "raid" | "guildSettings" | "epgpTransaction">;

// Stable per raid + member, so approving twice (or two officers clicking
// Approve) can never award the same raid's EP twice.
export const raidEpRef = (raidId: string, memberId: string) => `raid-ep:${raidId}:${memberId}`;

export async function computeRaidEpProposal(database: Db, guildId: string, raidId: string): Promise<EpProposal> {
  const raid = await database.raid.findFirst({
    where: { id: raidId, guildId },
    include: { bosses: true, attendance: { include: { member: true } }, core: true }
  });
  if (!raid) throw new Error("Raid not found in this guild.");
  const settings = await database.guildSettings.findUnique({ where: { guildId } });
  // A raid made for a core uses that core's EP rules where it has set them
  // (everything else follows the guild), and pays into its pool if it has one.
  const core = raid.core;
  if (settings?.coreLootOnly && (!core || !core.separatePool)) throw new Error("Choisis un raid de core : chaque core garde ses propres EP/GP.");
  const rules = effectiveRules(settings, core);
  const presentEp = rules.attendanceEp;
  const lateEp = rules.lateEp;
  const perBoss = rules.bossEp;
  const bossesKilled = raid.bosses.filter((boss) => boss.status === "KILLED").length;
  const fullClear = raid.bosses.length > 0 && bossesKilled === raid.bosses.length;
  const completionBonus = fullClear ? rules.completionEp : 0;

  const rows: EpProposalRow[] = raid.attendance
    .filter((row) => row.status === "PRESENT" || row.status === "LATE" || row.status === "BENCHED")
    .map((row) => ({
      memberId: row.memberId,
      name: row.member.displayName,
      status: row.status as "PRESENT" | "LATE" | "BENCHED",
      // Bench credit: the attendance EP only, no boss or full-clear EP.
      ep: row.status === "BENCHED" ? presentEp : (row.status === "PRESENT" ? presentEp : lateEp) + bossesKilled * perBoss + completionBonus
    }))
    .filter((row) => row.ep > 0)
    .sort((a, b) => b.ep - a.ep || a.name.localeCompare(b.name));

  return {
    raidId: raid.id, title: raid.title, bossesKilled, bossesPlanned: raid.bosses.length, perBoss, completionBonus, rows,
    poolCoreId: poolFor(core), coreName: core?.name ?? null
  };
}

// Writes the approved EP. Recomputes from current data (attendance may have
// changed since the proposal was shown) and skips anyone already paid.
export async function applyRaidEpProposal(database: Db, guildId: string, raidId: string, createdBy: string) {
  const proposal = await computeRaidEpProposal(database, guildId, raidId);
  const refs = proposal.rows.map((row) => raidEpRef(raidId, row.memberId));
  const paid = new Set((await database.epgpTransaction.findMany({
    where: { guildId, sourceRef: { in: refs } },
    select: { sourceRef: true }
  })).map((row) => row.sourceRef));
  let created = 0;
  let total = 0;
  for (const row of proposal.rows) {
    const sourceRef = raidEpRef(raidId, row.memberId);
    if (paid.has(sourceRef)) continue;
    await database.epgpTransaction.create({
      data: {
        guildId,
        memberId: row.memberId,
        epAmount: row.ep,
        gpAmount: 0,
        type: EpgpTransactionType.EP_AWARD,
        reason: `Raid: ${proposal.title} (${row.status === "LATE" ? "late" : row.status === "BENCHED" ? "benched" : "present"}, ${proposal.bossesKilled} boss kill${proposal.bossesKilled === 1 ? "" : "s"})`,
        createdBy,
        sourceRef,
        coreId: proposal.poolCoreId
      }
    });
    created += 1;
    total += row.ep;
  }
  return { proposal, created, skipped: proposal.rows.length - created, total };
}
