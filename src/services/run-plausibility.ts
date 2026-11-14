// Run checks driven by the server settings (run-integrity-config.ts). Pure functions; the database reads are in companion-device.ts.

/** Every value comes from the server settings; a value that is not set switches its check off. */
export interface PlausibilityLimits {
  levelCap?: number; minSecondsPerBoss?: number; killSlackSec?: number; recordShare?: number; recordSample?: number; travelSec?: number; overlapSlackSec?: number;
  reachSec?: number; sharedPlayers?: number; endSpreadSec?: number;
}

export interface Anomaly { code: string; detail: string }

export interface PlausibilityRun {
  instanceId: number;
  startedAt: number | null;
  endedAt: number | null;
  players: { character: string; level?: number | null }[];
  kills: { id: number; at: number | null }[];
}

/** Another stored run (any rows may be passed). */
export interface NeighbourRun { runRef: string; instanceId: number; startedAt: number | null; endedAt: number | null; characters: string[] }

export interface PlausibilityContext {
  fastest?: { seconds: number | null; count: number };
  neighbours?: readonly NeighbourRun[];
  deviceRuns?: readonly NeighbourRun[];
  runRef: string;
  limits?: PlausibilityLimits;
}

const fullName = (name: string): string => name.normalize("NFC").trim().toLowerCase();

const overlap = (a: { startedAt: number | null; endedAt: number | null }, b: { startedAt: number | null; endedAt: number | null }): number => {
  if (!a.startedAt || !a.endedAt || !b.startedAt || !b.endedAt) return 0;
  return Math.min(a.endedAt, b.endedAt) - Math.max(a.startedAt, b.startedAt);
};

const set = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** Check results for one run, one entry per category. */
export function plausibilityFlags(run: PlausibilityRun, context: PlausibilityContext): Anomaly[] {
  const limit = context.limits;
  if (!limit) return [];
  const found = new Set<string>();
  const { startedAt, endedAt } = run;
  const duration = startedAt && endedAt ? endedAt - startedAt : null;

  const timed = run.kills.filter((kill): kill is { id: number; at: number } => typeof kill.at === "number" && kill.at > 0);
  if (startedAt && endedAt && set(limit.killSlackSec) && timed.some((kill) => kill.at < startedAt - limit.killSlackSec! || kill.at > endedAt + limit.killSlackSec!)) found.add("timing");
  if (timed.some((kill, index) => index > 0 && kill.at < timed[index - 1]!.at)) found.add("sequence");
  if (duration !== null && run.kills.length > 0 && set(limit.minSecondsPerBoss) && duration < run.kills.length * limit.minSecondsPerBoss) found.add("timing");
  const fastest = context.fastest;
  if (duration !== null && fastest?.seconds && set(limit.recordSample) && set(limit.recordShare) && fastest.count >= limit.recordSample && duration < fastest.seconds * limit.recordShare) found.add("timing");
  if (set(limit.levelCap) && run.players.some((player) => typeof player.level === "number" && player.level > limit.levelCap!)) found.add("profile");

  const mine = new Set(run.players.map((player) => fullName(player.character)));
  for (const other of context.neighbours ?? []) {
    if (other.runRef === context.runRef) continue;
    if (!other.characters.some((name) => mine.has(fullName(name)))) continue;
    if (other.instanceId === run.instanceId && overlap(run, other) > 0) continue;
    const together = overlap(run, other);
    if (set(limit.overlapSlackSec) && together > limit.overlapSlackSec) found.add("identity");
    else if (set(limit.travelSec) && other.instanceId !== run.instanceId && startedAt && endedAt && other.startedAt && other.endedAt) {
      const gap = startedAt >= other.endedAt ? startedAt - other.endedAt : other.startedAt >= endedAt ? other.startedAt - endedAt : null;
      if (gap !== null && gap < limit.travelSec) found.add("identity");
    }
  }
  for (const other of context.deviceRuns ?? []) {
    if (other.runRef === context.runRef) continue;
    if (other.instanceId === run.instanceId && overlap(run, other) > 0) continue;
    if (set(limit.overlapSlackSec) && overlap(run, other) > limit.overlapSlackSec) found.add("device");
  }
  return [...found].map((code) => ({ code, detail: code }));
}
