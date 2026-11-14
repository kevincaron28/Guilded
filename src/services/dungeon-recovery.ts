import { finalBossOf } from "./dungeon-bosses.js";

// Completes a run the addon stored as ABANDONED although its group killed the final boss: the run ends at that kill, and anything the
// uploader recorded after it belongs to a new run. The result goes through the ordinary import (the stored run is upgraded once).

type Loose = Record<string, unknown>;
interface Kill { id?: unknown; success?: unknown; at?: unknown; startedAt?: unknown }

export type Recovery = { run: Loose; endedAt: number; trimmed: number } | { skip: string };

const record = (value: unknown): Loose | null => value && typeof value === "object" && !Array.isArray(value) ? value as Loose : null;

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
  const players = (Array.isArray(run["players"]) ? run["players"] : []).map((player) => {
    const entry = record(player);
    return entry && typeof entry["presentSec"] === "number" ? { ...entry, presentSec: Math.min(entry["presentSec"], duration) } : player;
  });
  const rest: Loose = { ...run };
  delete rest["endReason"];
  delete rest["diagnostic"];
  return { run: { ...rest, state: "COMPLETED", completedBy: "final boss", endedAt, encounters: kept, players }, endedAt, trimmed: encounters.length - kept.length };
}
