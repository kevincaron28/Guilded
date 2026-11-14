import { cleanCharacterName } from "./character-display.js";
import { bossTally } from "./dungeon-boss-scoring.js";
import { routeBosses } from "./dungeon-bosses.js";
import type { BracketedRules } from "./dungeon-november-rules.js";
import { characterScores, scoreRun, type ScoreRun } from "./public-score.js";

// Read-only: what a rules change would do to the scores computed from the stored runs. Pure; nothing is written.

export interface DungeonImpact { key: number; name: string; runs: number; rated: number; changed: number; pointsLost: number; skipped: number; unreadable: number; noBossList: boolean; unlistedBossIds: Map<number, string> }
export interface RowImpact { bracket: string; character: string; before: number; after: number; rankBefore: number; rankAfter: number | null }
export interface Impact { dungeons: DungeonImpact[]; top: Map<string, RowImpact[]>; rowsChanged: number; rows: number }

const rowKey = (row: { player: { character: string; realm: string }; bracket: string }) => `${row.player.character.toLowerCase()}\0${row.player.realm.toLowerCase()}\0${row.bracket}`;

export function rulesImpact(runs: ScoreRun[], before: BracketedRules, after: BracketedRules, top = 20): Impact {
  const dungeons = new Map<number, DungeonImpact>();
  for (const run of runs) {
    const row = dungeons.get(run.instanceId) ?? { key: run.instanceId, name: run.dungeonName, runs: 0, rated: 0, changed: 0, pointsLost: 0, skipped: 0, unreadable: 0, noBossList: !routeBosses(run.instanceId), unlistedBossIds: new Map() };
    row.runs++;
    const was = scoreRun(run, before);
    const now = scoreRun(run, after);
    if (was) row.rated++;
    if ((was?.points ?? null) !== (now?.points ?? null)) { row.changed++; row.pointsLost += (was?.points ?? 0) - (now?.points ?? 0); }
    if (!row.noBossList) {
      const tally = bossTally(run.instanceId, run.evidence?.encounters);
      if (!tally) row.unreadable++; else if (tally.killed < tally.total) row.skipped++;
    } else for (const e of run.evidence?.encounters ?? []) {
      const event = e as { id?: unknown; name?: unknown; success?: unknown };
      if (event.success === true && typeof event.id === "number") row.unlistedBossIds.set(event.id, typeof event.name === "string" ? event.name : "?");
    }
    dungeons.set(run.instanceId, row);
  }
  const was = characterScores(runs, before);
  const now = characterScores(runs, after);
  const afterRows = new Map<string, { points: number; rank: number }>();
  for (const bracket of new Set(now.map((r) => r.bracket))) now.filter((r) => r.bracket === bracket).forEach((r, i) => afterRows.set(rowKey(r), { points: r.points, rank: i + 1 }));
  const topRows = new Map<string, RowImpact[]>();
  for (const bracket of [...new Set(was.map((r) => r.bracket))].sort()) {
    topRows.set(bracket, was.filter((r) => r.bracket === bracket).slice(0, top).map((r, i) => {
      const next = afterRows.get(rowKey(r));
      return { bracket, character: r.player.character, before: r.points, after: next?.points ?? 0, rankBefore: i + 1, rankAfter: next?.rank ?? null };
    }));
  }
  return { dungeons: [...dungeons.values()].sort((a, b) => a.name.localeCompare(b.name)), top: topRows,
    rowsChanged: was.filter((r) => (afterRows.get(rowKey(r))?.points ?? 0) !== r.points).length, rows: was.length };
}

/** The dry-run text: per dungeon, then the top of each bracket as "old -> new" with rank moves. */
export function impactLines(impact: Impact, top: number): string[] {
  const lines = ["| Dungeon | Runs | Rated | Runs scored differently | Points removed | Skipped bosses | Bosses unreadable |", "|---|---|---|---|---|---|---|"];
  for (const d of impact.dungeons) {
    lines.push(d.noBossList ? `| ${d.name} (${d.key}) | ${d.runs} | ${d.rated} | ${d.changed} | ${d.pointsLost} | no boss list yet | – |`
      : `| ${d.name} (${d.key}) | ${d.runs} | ${d.rated} | ${d.changed} | ${d.pointsLost} | ${d.skipped} | ${d.unreadable} |`);
  }
  const missing = impact.dungeons.filter((d) => d.noBossList && d.unlistedBossIds.size);
  if (missing.length) {
    lines.push("", "Boss ids recorded in dungeons with no boss list yet (the rule does not touch them until `src/services/dungeon-bosses.ts` lists them):");
    for (const d of missing) lines.push(`- ${d.name} (${d.key}): ${[...d.unlistedBossIds].map(([id, name]) => `${name} ${id}`).join(", ")}`);
  }
  for (const [bracket, rows] of impact.top) {
    lines.push("", `## Top ${top}, bracket ${bracket}`, "| # | Character | Score now -> new | Rank now -> new |", "|---|---|---|---|");
    for (const r of rows) {
      const move = r.rankAfter === null ? "out" : r.rankAfter === r.rankBefore ? "same" : r.rankAfter < r.rankBefore ? `up ${r.rankBefore - r.rankAfter}` : `down ${r.rankAfter - r.rankBefore}`;
      lines.push(`| ${r.rankBefore} | ${cleanCharacterName(r.character)} | ${r.before} -> ${r.after} | ${r.rankBefore} -> ${r.rankAfter ?? "–"} (${move}) |`);
    }
  }
  lines.push("", `${impact.rowsChanged} of ${impact.rows} character rows would score differently.`);
  return lines;
}
