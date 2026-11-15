import { anchored } from "./run-trust.js";

// Guild-only Discord (14 November 2026): a guild's own lane (run row, card, rank, points) takes a run only when at least one of its players is
// a participant of that guild. A run without one is not dropped: it goes to the public lane like any single-report run (see splitStrangerRuns).
//
// "Participant of the guild", read generously because a wrong refusal loses a real member's run:
//  - a linked character of a member who has not left, or a character on the guild's in-game roster now;
//  - a character the roster held within the last 14 days (a rename, a late roster sync, someone who left yesterday);
//  - the uploader's own exported or reported characters.
// When the guild's roster is empty or has not been read for about 7 days, nothing can be said about membership and the gate is not applied.

export const ROSTER_STALE_MS = 7 * 86_400_000;
export const RECENT_MEMBER_MS = 14 * 86_400_000;

export interface GuildMembership {
  /** False: membership is unknown (no roster, or an old one), so no run is judged a stranger's. */
  gate: boolean;
  /** Lower-case full names counted as participants. */
  names: string[];
  /** Why the gate is off, for the journal. */
  skipped?: string;
}

type Table = { findMany?: (args: unknown) => Promise<unknown[]> };

/** Reads who counts as a participant of the guild. Never throws: any doubt leaves the gate off. */
export async function guildMembership(database: unknown, guildId: string, now: Date, own: Iterable<string> = []): Promise<GuildMembership> {
  try {
    const db = database as { guildRosterEntry?: Table; character?: Table };
    if (typeof db.guildRosterEntry?.findMany !== "function") return { gate: false, names: [], skipped: "no roster table" };
    const roster = await db.guildRosterEntry.findMany({ where: { guildId, gameEdition: "forever" }, select: { nameKey: true, inGuild: true, observedAt: true, updatedAt: true }, take: 5000 }) as
      { nameKey: string; inGuild?: boolean; observedAt?: Date | null; updatedAt?: Date | null }[];
    const current = roster.filter((row) => row.inGuild !== false);
    if (!current.length) { console.info(`guild-participants guild=${guildId.slice(-6)} gate off: roster empty`); return { gate: false, names: [], skipped: "roster empty" }; }
    const seen = current.map((row) => row.observedAt?.getTime() ?? now.getTime());
    if (now.getTime() - Math.max(...seen) > ROSTER_STALE_MS) { console.info(`guild-participants guild=${guildId.slice(-6)} gate off: roster older than 7 days`); return { gate: false, names: [], skipped: "roster stale" }; }
    const names = new Set<string>();
    for (const row of roster) {
      const touched = (row.updatedAt ?? row.observedAt)?.getTime() ?? now.getTime();
      if (row.inGuild !== false || now.getTime() - touched <= RECENT_MEMBER_MS) names.add(row.nameKey.toLowerCase());
    }
    if (typeof db.character?.findMany === "function") {
      const linked = await db.character.findMany({ where: { member: { guildId, status: { not: "LEFT" } } }, select: { name: true }, take: 20_000 }) as { name: string }[];
      for (const row of linked) names.add(row.name.toLowerCase());
    }
    for (const name of own) if (name) names.add(name.toLowerCase());
    return { gate: true, names: [...names] };
  } catch (error) {
    console.error(`guild-participants: membership not read, gate off: ${error instanceof Error ? error.message : String(error)}`);
    return { gate: false, names: [], skipped: "read failed" };
  }
}

/**
 * Splits runs into the guild's own and the strangers'. The strangers come back marked `viaGroup`, which is how every lane hands a run to
 * the public relay (ranked there like any single-report run); the guild keeps nothing of them. Simulations stay with the guild.
 */
export function splitStrangerRuns(runs: readonly unknown[], membership: GuildMembership): { guild: unknown[]; strangers: unknown[] } {
  if (!membership.gate) return { guild: [...runs], strangers: [] };
  const guild: unknown[] = [];
  const strangers: unknown[] = [];
  for (const raw of runs) {
    const run = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    const id = typeof run?.["id"] === "string" ? run["id"] : "";
    if (!run || id.startsWith("SIM-") || !Array.isArray(run["players"]) || anchored(run, membership.names)) { guild.push(raw); continue; }
    strangers.push({ ...run, viaGroup: true });
  }
  return { guild, strangers };
}
