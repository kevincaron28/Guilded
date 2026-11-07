import type { PrismaClient } from "../generated/prisma/client.js";
import { bracketedVerdict, presentEnough } from "./dungeon-rating.js";
import { leniencyOf, validBracketedRules } from "./dungeon-november-rules.js";
import { participationMode, unmappedMap } from "./dungeon-participation.js";
import { withIntegrityWindow } from "./dungeon-integrity.js";
import { formatDuration } from "./dungeon-rules.js";

// Officer view (`/dungeon-admin audit why:true`): for a run or a player, every reason a run does or does not count on this
// guild's boards, using the very functions the importer and the boards use. Read only; changes nothing.

type Db = Pick<PrismaClient, "dungeonRun" | "dungeonSeason" | "character">;
const PARTICIPATION: Record<string, string> = {
  full: "full participation points", completion: "completion points only (no records or bonuses)",
  helper: "helper points (completion only)", none: "no participation points"
};

export async function explainDungeonRuns(database: Db, guildId: string, filter: { run?: string | null; character?: string | null; limit?: number }): Promise<string[]> {
  const needle = filter.character?.trim();
  const runs = await database.dungeonRun.findMany({
    where: { guildId, ...(filter.run ? { runRef: { contains: filter.run.trim(), mode: "insensitive" as const } } : {}),
      ...(needle ? { players: { some: { character: { contains: needle, mode: "insensitive" as const } } } } : {}) },
    orderBy: { endedAt: "desc" }, take: Math.min(Math.max(filter.limit ?? 5, 1), 10),
    include: { players: true }
  });
  if (!runs.length) return ["No stored run matches. Runs only appear here after a companion upload imported them."];
  const out: string[] = [];
  for (const run of runs) {
    const season = run.seasonId ? await database.dungeonSeason.findUnique({ where: { id: run.seasonId } }) : null;
    const rules = season && validBracketedRules(season.ratingRules) ? withIntegrityWindow(season.ratingRules, season.startsAt, season.endsAt) : null;
    const lines = [`**${run.dungeonName}** · ${run.durationSec ? formatDuration(run.durationSec) : "no time"} · \`${run.runRef}\` · ${season?.name ?? "no season"}`];
    const why: string[] = [];
    if (!run.valid) why.push(`rejected: ${run.invalidReason ?? "invalid"}`);
    if (run.state !== "COMPLETED") why.push(`state ${run.state}, not completed`);
    if (run.completedBy !== "final boss") why.push(`ended by "${run.completedBy ?? "unknown"}", not a detected final boss`);
    if (run.runRef.startsWith("SIM-")) why.push("simulation run");
    if (season && run.startedAt && run.startedAt < season.startsAt) why.push(`started before ${season.name} began (${season.startsAt.toISOString().slice(0, 10)})`);
    if (season?.endsAt && run.endedAt && run.endedAt >= season.endsAt) why.push(`ended after ${season.name} ended`);
    const evidence = { instanceId: run.instanceId, difficultyId: run.difficultyId, durationSec: run.durationSec, completedBy: run.completedBy,
      competitionData: run.competitionData, startedAt: run.startedAt, endedAt: run.endedAt, createdAt: run.createdAt,
      players: run.players.map(p => ({ character: p.character, memberId: p.memberId, presentSec: p.presentSec })) };
    if (rules) {
      if (unmappedMap(run, rules)) why.push(`map ${run.instanceId} has no route in ${season!.name}: no time rating (completion points still count)`);
      else {
        const verdict = bracketedVerdict({ ...evidence, players: evidence.players.map(p => ({ ...p, member: null })) }, rules);
        if (verdict.reason) why.push(`time rating: ${verdict.reason}`);
        else {
          const estimate = rules.catalog.find(d => d.dungeonKey === verdict.key)?.provisional;
          why.push(`rated on route ${verdict.key}, target ${verdict.targetSec ? formatDuration(verdict.targetSec) : "none"}${estimate ? " (an estimate: it scales points, it never hides a run)" : ""}${verdict.penaltyPercent ? `, over-level penalty ${verdict.penaltyPercent}%` : ""}`);
        }
      }
    }
    lines.push(`Run: ${why.length ? why.join("; ") : "counts"}`);
    for (const p of run.players.filter(p => !needle || p.character.toLowerCase().includes(needle.toLowerCase()))) {
      const bits: string[] = [];
      const percent = run.durationSec ? Math.round(100 * p.presentSec / run.durationSec) : 0;
      bits.push(p.inGuild ? "in guild" : "outside the guild");
      bits.push(p.memberId ? "linked" : "NOT linked to a member: not on the time board, no points");
      bits.push(`present ${percent}%${run.durationSec && !presentEnough(p.presentSec, run.durationSec, rules ? leniencyOf(rules).presence : undefined) ? ` (time board needs ${Math.round((rules ? leniencyOf(rules).presence : 0.8) * 100)}%)` : ""}`);
      if (rules && p.memberId) bits.push(PARTICIPATION[participationMode(evidence, p.character, rules.levelBands[bracketedVerdict({ ...evidence, players: evidence.players.map(q => ({ ...q, member: null })) }, rules).key], rules)] ?? "?");
      lines.push(`• **${p.character}** — ${bits.join(" · ")}`);
    }
    out.push(lines.join("\n"));
  }
  return out;
}
