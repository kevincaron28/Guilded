import type { Prisma } from "../generated/prisma/client.js";
import { lockDungeonCalendar } from "./dungeon-calendar-lock.js";
import { reconcileEvidenceAwards } from "./dungeon-evidence-awards.js";
import { findCharacter } from "./character-match.js";

// A guildmate who was in a run but not linked to a Discord member when it was imported is stored
// with memberId null and earns nothing. Points belong to a member, so that credit is HELD: on the
// next import after they link (Forever full names matched like everywhere else), the stored player
// rows get their member and the evidence-based awards and rating are recomputed. A run already
// stored is otherwise skipped as a duplicate, so without this the credit would never arrive.

type Tx = Pick<Prisma.TransactionClient, "dungeonRun" | "dungeonRunPlayer" | "dungeonPointTransaction" | "dungeonAchievement" | "auditLog">
  & Partial<Pick<Prisma.TransactionClient, "$executeRaw">>;

/** Held rows older than this are left alone (matches the relay's 30-day window with slack). */
export const HELD_CREDIT_MAX_AGE_MS = 45 * 24 * 3600 * 1000;
const HELD_CREDIT_ROWS = 500;

export async function creditHeldRunPlayers(tx: Tx, guildId: string,
  characters: readonly { name: string; realm: string; memberId: string }[], actorId: string, now = new Date()): Promise<{ players: number; runs: number }> {
  const held = await tx.dungeonRunPlayer.findMany({
    where: { memberId: null, run: { guildId, valid: true, state: "COMPLETED", endedAt: { gte: new Date(now.getTime() - HELD_CREDIT_MAX_AGE_MS) } } },
    select: { id: true, runId: true, character: true },
    take: HELD_CREDIT_ROWS
  });
  if (!held.length) return { players: 0, runs: 0 };
  const byRun = new Map<string, Set<string>>();
  let players = 0;
  for (const row of held) {
    const found = findCharacter(characters, row.character, "");
    if (!found) continue;
    await tx.dungeonRunPlayer.update({ where: { id: row.id }, data: { memberId: found.memberId } });
    players++;
    (byRun.get(row.runId) ?? byRun.set(row.runId, new Set()).get(row.runId)!).add(found.memberId);
  }
  if (!byRun.size) return { players: 0, runs: 0 };
  await lockDungeonCalendar(tx);
  for (const [runId, memberIds] of byRun) await reconcileEvidenceAwards(tx, guildId, runId, [...memberIds], actorId, now);
  return { players, runs: byRun.size };
}

export interface CreditRun {
  dungeonName: string; state: string; valid: boolean; invalidReason: string | null;
  players: { character: string; memberId: string | null; inGuild: boolean; presentSec: number; member?: { displayName: string } | null }[];
}

/** Officer view: who got credit for a run and, for everyone else, why not. */
export function describeRunCredit(run: CreditRun, points: readonly { memberId: string; amount: number }[]): string {
  const lines = [`**${run.dungeonName}**: ${run.valid ? run.state : `not counted (${run.invalidReason ?? "invalid"})`}`];
  if (!run.valid || run.state !== "COMPLETED") lines.push("No one earns points from a run that is not a valid completion.");
  for (const player of run.players) {
    if (!player.memberId) {
      lines.push(player.inGuild
        ? `• ${player.character}: guildmate, not linked to a Discord member yet. Credit is held and applies on the next sync after they link (\`/guilded verify\` in game or \`/character claim\`).`
        : `• ${player.character}: not linked and not flagged as a guildmate by the addon (outside the guild, or no addon data).`);
      continue;
    }
    const total = points.filter((row) => row.memberId === player.memberId).reduce((sum, row) => sum + row.amount, 0);
    const who = player.member?.displayName ?? "linked";
    lines.push(total
      ? `• ${player.character} (${who}): ${total > 0 ? "+" : ""}${total} point(s)`
      : `• ${player.character} (${who}): linked, no points from this run (rules: presence under half the run, route not scoring, or the weekly budget for this dungeon was used).`);
  }
  return lines.join("\n");
}

export async function runCredit(database: { dungeonRun: Pick<Prisma.TransactionClient["dungeonRun"], "findFirst">; dungeonPointTransaction: Pick<Prisma.TransactionClient["dungeonPointTransaction"], "findMany"> },
  guildId: string, runRef: string): Promise<string | null> {
  const run = await database.dungeonRun.findFirst({ where: { guildId, runRef }, include: { players: { include: { member: { select: { displayName: true } } } } } });
  if (!run) return null;
  const points = await database.dungeonPointTransaction.findMany({ where: { guildId, runId: run.id }, select: { memberId: true, amount: true } });
  return describeRunCredit(run, points);
}
