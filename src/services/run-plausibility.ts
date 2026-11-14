// Run checks that need the server's settings (run-integrity-config.ts). Pure functions; the database reads are in companion-device.ts.

/** Every value comes from the server configuration; a value that is not set switches its check off. */
export interface PlausibilityLimits {
  levelCap?: number; minSecondsPerBoss?: number; killSlackSec?: number; recordShare?: number; recordSample?: number; travelSec?: number; overlapSlackSec?: number;
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

const TIMING = new Set(["kill-outside-run", "too-fast-per-boss", "faster-than-record"]);
const fullName = (name: string): string => name.normalize("NFC").trim().toLowerCase();

const overlap = (a: { startedAt: number | null; endedAt: number | null }, b: { startedAt: number | null; endedAt: number | null }): number => {
  if (!a.startedAt || !a.endedAt || !b.startedAt || !b.endedAt) return 0;
  return Math.min(a.endedAt, b.endedAt) - Math.max(a.startedAt, b.startedAt);
};

const set = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** Check results for one run. */
export function plausibilityFlags(run: PlausibilityRun, context: PlausibilityContext): Anomaly[] {
  const limit = context.limits;
  if (!limit) return [];
  const flags: Anomaly[] = [];
  const add = (code: string, detail: string) => flags.push({ code, detail });
  const { startedAt, endedAt } = run;
  const duration = startedAt && endedAt ? endedAt - startedAt : null;

  const timed = run.kills.filter((kill): kill is { id: number; at: number } => typeof kill.at === "number" && kill.at > 0);
  if (startedAt && endedAt && set(limit.killSlackSec)) {
    const outside = timed.filter((kill) => kill.at < startedAt - limit.killSlackSec! || kill.at > endedAt + limit.killSlackSec!);
    if (outside.length) add("kill-outside-run", `${outside.length} boss kill time(s) fall outside the run's start and end`);
  }
  if (timed.some((kill, index) => index > 0 && kill.at < timed[index - 1]!.at)) add("kills-out-of-order", "boss kills are not in time order");
  if (duration !== null && run.kills.length > 0 && set(limit.minSecondsPerBoss) && duration < run.kills.length * limit.minSecondsPerBoss) {
    add("too-fast-per-boss", `${run.kills.length} boss kill(s) in ${duration}s`);
  }
  const fastest = context.fastest;
  if (duration !== null && fastest?.seconds && set(limit.recordSample) && set(limit.recordShare) && fastest.count >= limit.recordSample && duration < fastest.seconds * limit.recordShare) {
    add("faster-than-record", `${duration}s against a fastest known clear of ${fastest.seconds}s (${fastest.count} clears)`);
  }
  if (set(limit.levelCap)) {
    const high = run.players.filter((player) => typeof player.level === "number" && player.level > limit.levelCap!);
    if (high.length) add("level-above-cap", `${high.map((player) => player.character).join(", ")} above level ${limit.levelCap}`);
  }

  const mine = new Set(run.players.map((player) => fullName(player.character)));
  for (const other of context.neighbours ?? []) {
    if (other.runRef === context.runRef) continue;
    const shared = other.characters.filter((name) => mine.has(fullName(name)));
    if (!shared.length) continue;
    if (other.instanceId === run.instanceId && overlap(run, other) > 0) continue; // copy matching handles the same clear
    const together = overlap(run, other);
    if (set(limit.overlapSlackSec) && together > limit.overlapSlackSec) add("character-in-two-runs", `${shared[0]} is in another run (${other.runRef}) at the same time`);
    else if (set(limit.travelSec) && other.instanceId !== run.instanceId && startedAt && endedAt && other.startedAt && other.endedAt) {
      const gap = startedAt >= other.endedAt ? startedAt - other.endedAt : other.startedAt >= endedAt ? other.startedAt - endedAt : null;
      if (gap !== null && gap < limit.travelSec) add("back-to-back", `${shared[0]} starts a clear ${gap}s after leaving another dungeon (${other.runRef})`);
    }
  }
  for (const other of context.deviceRuns ?? []) {
    if (other.runRef === context.runRef) continue;
    if (other.instanceId === run.instanceId && overlap(run, other) > 0) continue;
    if (set(limit.overlapSlackSec) && overlap(run, other) > limit.overlapSlackSec) add("device-overlap", `this PC also sent run ${other.runRef}, which overlaps in time`);
  }
  const unique = flags.filter((flag, index) => flags.findIndex((other) => other.code === flag.code) === index);
  const timing = unique.filter((flag) => TIMING.has(flag.code));
  if (timing.length < 2) return unique;
  return unique.filter((flag) => !TIMING.has(flag.code) || flag === timing[0]).map((flag) => flag === timing[0] ? { ...flag, detail: timing.map((item) => item.detail).join("; ") } : flag);
}
