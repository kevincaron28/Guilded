import { finalBossOf } from "./dungeon-bosses.js";

// Completes a run the addon stored as ABANDONED although its group killed the final boss: the run ends at that kill, and anything the
// uploader recorded after it belongs to a new run. The result goes through the ordinary import (the stored run is upgraded once).

type Loose = Record<string, unknown>;
interface Kill { id?: unknown; success?: unknown; at?: unknown; startedAt?: unknown }

export type Recovery = { run: Loose; endedAt: number; trimmed: number; dropped: unknown[] } | { skip: string };

const record = (value: unknown): Loose | null => value && typeof value === "object" && !Array.isArray(value) ? value as Loose : null;

/** A player's observed presence cut to the new end: intervals clipped, known seconds their sum, unknown seconds never more than what is left. */
function clipIntegrity(own: Loose, endedAt: number, duration: number): Loose {
  const out: Loose = { ...own };
  const intervals = own["knownIntervals"];
  if (Array.isArray(intervals)) {
    const clipped = (intervals as unknown[]).flatMap((pair) => {
      const [a, b] = Array.isArray(pair) ? pair as number[] : [];
      if (typeof a !== "number" || typeof b !== "number" || a >= endedAt) return [];
      return [[a, Math.min(b, endedAt)] as [number, number]];
    }).filter(([a, b]) => b > a);
    out["knownIntervals"] = clipped;
    out["knownSec"] = clipped.reduce((sum, [a, b]) => sum + (b - a), 0);
  } else if (typeof own["knownSec"] === "number") out["knownSec"] = Math.min(own["knownSec"], duration);
  if (typeof own["unknownSec"] === "number") out["unknownSec"] = Math.min(own["unknownSec"], Math.max(0, duration - (out["knownSec"] as number)));
  return out;
}

/** The run completed at its final boss kill, or the reason it cannot be. */
export function completeAtFinalBoss(raw: unknown): Recovery {
  const run = record(raw);
  if (!run) return { skip: "not a run" };
  const instanceId = run["instanceId"];
  if (typeof instanceId !== "number") return { skip: "no instance" };
  const final = finalBossOf(instanceId);
  if (!final) return { skip: "no known final boss for this dungeon" };
  if (run["state"] === "COMPLETED") return { skip: "already completed" };
  const startedAt = run["startedAt"];
  if (typeof startedAt !== "number") return { skip: "no start time" };
  const encounters = Array.isArray(run["encounters"]) ? run["encounters"] as Kill[] : [];
  const kills = encounters.filter((entry) => entry && entry.id === final.id && entry.success === true && typeof entry.at === "number" && (entry.at as number) > startedAt);
  if (!kills.length) return { skip: "no successful final boss kill" };
  const endedAt = Math.min(...kills.map((entry) => entry.at as number));
  const kept = encounters.filter((entry) => !(typeof entry.at === "number" && entry.at > endedAt) && !(typeof entry.startedAt === "number" && entry.startedAt > endedAt));
  const duration = endedAt - startedAt;
  const integrity = record(run["integrity"]);
  if (typeof integrity?.["combatAt"] === "number" && integrity["combatAt"] > endedAt) return { skip: "first combat is recorded after the final boss kill" };
  const players = (Array.isArray(run["players"]) ? run["players"] : []).map((player) => {
    const entry = record(player);
    if (!entry) return player;
    const out: Loose = { ...entry };
    if (typeof entry["presentSec"] === "number") out["presentSec"] = Math.min(entry["presentSec"], duration);
    const own = record(entry["integrity"]);
    if (own) out["integrity"] = clipIntegrity(own, endedAt, duration);
    return out;
  });
  const rest: Loose = { ...run };
  delete rest["endReason"];
  delete rest["diagnostic"];
  return { run: { ...rest, state: "COMPLETED", completedBy: "final boss", endedAt, encounters: kept, players }, endedAt, trimmed: encounters.length - kept.length, dropped: encounters.filter((entry) => !kept.includes(entry)) };
}
