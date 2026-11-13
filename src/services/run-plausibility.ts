import { firstNameKey } from "./dungeon-import.js";

// Plausibility flags for a dungeon run (docs/plans/SINGLE_WITNESS_2026-11-13.md). With one witness enough, nothing makes a
// run cheat-proof: the addon runs on the player's PC, so a modified addon can produce anything a real one can. These checks
// catch what a careless or lazy forgery gets wrong, and what a broken clock or addon bug produces. They only FLAG: the run
// still counts, and officers and the owner see the flags (anomaly report). Pure functions; the database reads live in
// companion-device.ts (storeDeviceRuns).

export const PLAUSIBILITY = {
  /** WoW Forever's level cap (the race to 60). */
  levelCap: 60,
  /** A boss fight plus the walk to it: a clear with N kills cannot take less than N times this. */
  minSecondsPerBoss: 30,
  /** Slack around the run for a kill time (the addon's clock against the run's own start and end). */
  killSlackSec: 30,
  /** A clear faster than this share of the fastest known clear of the same dungeon and difficulty is flagged. */
  recordShare: 0.5,
  /** Known clears needed before the fastest one means anything. */
  recordSample: 5,
  /** The same character cannot start a clear in another dungeon sooner than this after the previous one ended. */
  travelSec: 60,
  /** Overlap shorter than this between two runs of one character or one PC is a clock difference, not a second run. */
  overlapSlackSec: 120
} as const;

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
}

const overlap = (a: { startedAt: number | null; endedAt: number | null }, b: { startedAt: number | null; endedAt: number | null }): number => {
  if (!a.startedAt || !a.endedAt || !b.startedAt || !b.endedAt) return 0;
  return Math.min(a.endedAt, b.endedAt) - Math.max(a.startedAt, b.startedAt);
};

/** Flags for one run. An empty list is the normal case. */
export function plausibilityFlags(run: PlausibilityRun, context: PlausibilityContext): Anomaly[] {
  const flags: Anomaly[] = [];
  const add = (code: string, detail: string) => flags.push({ code, detail });
  const { startedAt, endedAt } = run;
  const duration = startedAt && endedAt ? endedAt - startedAt : null;

  const timed = run.kills.filter((kill): kill is { id: number; at: number } => typeof kill.at === "number" && kill.at > 0);
  if (startedAt && endedAt) {
    const outside = timed.filter((kill) => kill.at < startedAt - PLAUSIBILITY.killSlackSec || kill.at > endedAt + PLAUSIBILITY.killSlackSec);
    if (outside.length) add("kill-outside-run", `${outside.length} boss kill time(s) fall outside the run's start and end`);
  }
  if (timed.some((kill, index) => index > 0 && kill.at < timed[index - 1]!.at)) add("kills-out-of-order", "boss kills are not in time order");
  if (duration !== null && run.kills.length > 0 && duration < run.kills.length * PLAUSIBILITY.minSecondsPerBoss) {
    add("too-fast-per-boss", `${run.kills.length} boss kill(s) in ${duration}s (under ${PLAUSIBILITY.minSecondsPerBoss}s each)`);
  }
  const fastest = context.fastest;
  if (duration !== null && fastest?.seconds && fastest.count >= PLAUSIBILITY.recordSample && duration < fastest.seconds * PLAUSIBILITY.recordShare) {
    add("faster-than-record", `${duration}s against a fastest known clear of ${fastest.seconds}s (${fastest.count} clears)`);
  }
  const high = run.players.filter((player) => typeof player.level === "number" && player.level > PLAUSIBILITY.levelCap);
  if (high.length) add("level-above-cap", `${high.map((player) => player.character).join(", ")} above level ${PLAUSIBILITY.levelCap}`);

  const mine = new Set(run.players.map((player) => firstNameKey(player.character)));
  for (const other of context.neighbours ?? []) {
    if (other.runRef === context.runRef) continue;
    const shared = other.characters.filter((name) => mine.has(firstNameKey(name)));
    if (!shared.length) continue;
    if (other.instanceId === run.instanceId && overlap(run, other) > 0) continue; // the same clear under another id: copy matching handles it
    const together = overlap(run, other);
    if (together > PLAUSIBILITY.overlapSlackSec) add("character-in-two-runs", `${shared[0]} is in another run (${other.runRef}) at the same time`);
    else if (other.instanceId !== run.instanceId && startedAt && endedAt && other.startedAt && other.endedAt) {
      const gap = startedAt >= other.endedAt ? startedAt - other.endedAt : other.startedAt >= endedAt ? other.startedAt - endedAt : null;
      if (gap !== null && gap < PLAUSIBILITY.travelSec) add("back-to-back", `${shared[0]} starts a clear ${gap}s after leaving another dungeon (${other.runRef})`);
    }
  }
  for (const other of context.deviceRuns ?? []) {
    if (other.runRef === context.runRef) continue;
    if (other.instanceId === run.instanceId && overlap(run, other) > 0) continue;
    if (overlap(run, other) > PLAUSIBILITY.overlapSlackSec) add("device-overlap", `this PC also sent run ${other.runRef}, which overlaps in time`);
  }
  // One flag per code: a long list of the same thing is noise.
  return flags.filter((flag, index) => flags.findIndex((other) => other.code === flag.code) === index);
}
