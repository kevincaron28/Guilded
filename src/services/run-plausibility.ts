
// Plausibility checks for a dungeon run. Pure functions; the database reads live in companion-device.ts (storeDeviceRuns). The
// limits below are safe defaults only: the live values come from the server's private configuration (run-integrity-config.ts).

export interface PlausibilityLimits {
  levelCap: number; minSecondsPerBoss: number; killSlackSec: number; recordShare: number; recordSample: number; travelSec: number; overlapSlackSec: number;
}

export const PLAUSIBILITY: PlausibilityLimits = {
  levelCap: 60,
  minSecondsPerBoss: 10,
  killSlackSec: 60,
  recordShare: 0.35,
  recordSample: 8,
  travelSec: 30,
  overlapSlackSec: 300
};

const DEFAULT_LIMITS = PLAUSIBILITY;

export interface Anomaly { code: string; detail: string }

export interface PlausibilityRun {
  instanceId: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Party characters with the level the addon recorded, when it did. */
  players: { character: string; level?: number | null }[];
  /** Boss kills in the order the addon recorded them. */
  kills: { id: number; at: number | null }[];
}

/** Another stored run, for the overlap checks (any rows may be passed: the function keeps only the relevant ones). */
export interface NeighbourRun { runRef: string; instanceId: number; startedAt: number | null; endedAt: number | null; characters: string[] }

export interface PlausibilityContext {
  /** Fastest known valid clear of this dungeon and difficulty, with how many clears that is based on. */
  fastest?: { seconds: number | null; count: number };
  /** Stored runs near this one in time (any server member's). */
  neighbours?: readonly NeighbourRun[];
  /** Other runs the same PC (device key) sent. */
  deviceRuns?: readonly NeighbourRun[];
  /** This run's own reference, never compared with itself. */
  runRef: string;
  /** Server configuration; the defaults apply when absent. */
  limits?: PlausibilityLimits;
}

const TIMING = new Set(["kill-outside-run", "too-fast-per-boss", "faster-than-record"]);
const fullName = (name: string): string => name.normalize("NFC").trim().toLowerCase();

const overlap = (a: { startedAt: number | null; endedAt: number | null }, b: { startedAt: number | null; endedAt: number | null }): number => {
  if (!a.startedAt || !a.endedAt || !b.startedAt || !b.endedAt) return 0;
  return Math.min(a.endedAt, b.endedAt) - Math.max(a.startedAt, b.startedAt);
};

/** Flags for one run. An empty list is the normal case. */
export function plausibilityFlags(run: PlausibilityRun, context: PlausibilityContext): Anomaly[] {
  const flags: Anomaly[] = [];
  const limit = context.limits ?? DEFAULT_LIMITS;
  const add = (code: string, detail: string) => flags.push({ code, detail });
  const { startedAt, endedAt } = run;
  const duration = startedAt && endedAt ? endedAt - startedAt : null;

  const timed = run.kills.filter((kill): kill is { id: number; at: number } => typeof kill.at === "number" && kill.at > 0);
  if (startedAt && endedAt) {
    const outside = timed.filter((kill) => kill.at < startedAt - limit.killSlackSec || kill.at > endedAt + limit.killSlackSec);
    if (outside.length) add("kill-outside-run", `${outside.length} boss kill time(s) fall outside the run's start and end`);
  }
  if (timed.some((kill, index) => index > 0 && kill.at < timed[index - 1]!.at)) add("kills-out-of-order", "boss kills are not in time order");
  if (duration !== null && run.kills.length > 0 && duration < run.kills.length * limit.minSecondsPerBoss) {
    add("too-fast-per-boss", `${run.kills.length} boss kill(s) in ${duration}s (under ${limit.minSecondsPerBoss}s each)`);
  }
  const fastest = context.fastest;
  if (duration !== null && fastest?.seconds && fastest.count >= limit.recordSample && duration < fastest.seconds * limit.recordShare) {
    add("faster-than-record", `${duration}s against a fastest known clear of ${fastest.seconds}s (${fastest.count} clears)`);
  }
  const high = run.players.filter((player) => typeof player.level === "number" && player.level > limit.levelCap);
  if (high.length) add("level-above-cap", `${high.map((player) => player.character).join(", ")} above level ${limit.levelCap}`);

  const mine = new Set(run.players.map((player) => fullName(player.character)));
  for (const other of context.neighbours ?? []) {
    if (other.runRef === context.runRef) continue;
    const shared = other.characters.filter((name) => mine.has(fullName(name)));
    if (!shared.length) continue;
    if (other.instanceId === run.instanceId && overlap(run, other) > 0) continue; // the same clear under another id: copy matching handles it
    const together = overlap(run, other);
    if (together > limit.overlapSlackSec) add("character-in-two-runs", `${shared[0]} is in another run (${other.runRef}) at the same time`);
    else if (other.instanceId !== run.instanceId && startedAt && endedAt && other.startedAt && other.endedAt) {
      const gap = startedAt >= other.endedAt ? startedAt - other.endedAt : other.startedAt >= endedAt ? other.startedAt - endedAt : null;
      if (gap !== null && gap < limit.travelSec) add("back-to-back", `${shared[0]} starts a clear ${gap}s after leaving another dungeon (${other.runRef})`);
    }
  }
  for (const other of context.deviceRuns ?? []) {
    if (other.runRef === context.runRef) continue;
    if (other.instanceId === run.instanceId && overlap(run, other) > 0) continue;
    if (overlap(run, other) > limit.overlapSlackSec) add("device-overlap", `this PC also sent run ${other.runRef}, which overlaps in time`);
  }
  const unique = flags.filter((flag, index) => flags.findIndex((other) => other.code === flag.code) === index);
  // Results that come from the same measurement (the run's start, end and kill times) are one finding.
  const timing = unique.filter((flag) => TIMING.has(flag.code));
  if (timing.length < 2) return unique;
  return unique.filter((flag) => !TIMING.has(flag.code) || flag === timing[0]).map((flag) => flag === timing[0] ? { ...flag, detail: timing.map((item) => item.detail).join("; ") } : flag);
}
