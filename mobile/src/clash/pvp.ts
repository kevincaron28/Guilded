import type { Lang } from "../i18n";
import type { ClassKey, DuelInfo, DuelResponse, LadderBoard, LadderEntry, Partner, RankInfo, RankedStatus } from "./types";

// Pure state for the player-vs-player screens (#644): the matches list, the challenge form, the ranked waiting room and the
// ladders. The server decides everything (expiry, forfeits, pairing, stars); these only sort and remember what the member tapped.

// ---- clocks ----

/** Milliseconds until an ISO time (negative once it has passed), or null when there is no time. */
export function msUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at - now : null;
}

/** "3 d", "23 h", "45 min", "<1 min" (French uses "j" for days). Zero or less is "0 min". */
export function formatLeft(ms: number, lang: Lang): string {
  if (ms <= 0) return "0 min";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} ${lang === "fr" ? "j" : "d"}`;
}

/** A turn clock or an expiry is urgent in the last hour (the last 20 s for a live 60-second turn). */
export const urgent = (ms: number | null, live: boolean): boolean => ms !== null && ms <= (live ? 20_000 : 3_600_000);

// ---- the matches list ----

export interface DuelBuckets {
  /** Challenges sent to you, soonest expiry first. */
  incoming: DuelInfo[];
  /** Challenges you sent that wait for an answer. */
  outgoing: DuelInfo[];
  /** Matches waiting for your move, the shortest clock first. */
  yourTurn: DuelInfo[];
  /** Matches waiting for the opponent. */
  waiting: DuelInfo[];
  /** Finished, declined or expired, the newest first (at most 10). */
  finished: DuelInfo[];
}

const pendingLive = (d: DuelInfo, now: number) => d.status === "pending" && (msUntil(d.expiresAt, now) ?? 1) > 0;
const byClock = (key: "expiresAt" | "turnDeadlineAt") => (a: DuelInfo, b: DuelInfo) => (Date.parse(a[key] ?? "") || Infinity) - (Date.parse(b[key] ?? "") || Infinity);

/** Sorts the member's duels for the list. A pending challenge whose expiry has passed is shown as finished before the server says so. */
export function bucketDuels(duels: readonly DuelInfo[], now: number): DuelBuckets {
  const out: DuelBuckets = { incoming: [], outgoing: [], yourTurn: [], waiting: [], finished: [] };
  for (const d of duels) {
    if (pendingLive(d, now)) (d.direction === "incoming" ? out.incoming : out.outgoing).push(d);
    else if (d.status === "active") (d.yourTurn ? out.yourTurn : out.waiting).push(d);
    else out.finished.push(d.status === "pending" ? { ...d, status: "expired" } : d);
  }
  out.incoming.sort(byClock("expiresAt"));
  out.outgoing.sort(byClock("expiresAt"));
  out.yourTurn.sort(byClock("turnDeadlineAt"));
  out.waiting.sort(byClock("turnDeadlineAt"));
  out.finished.sort((a, b) => (Date.parse(b.finishedAt ?? b.createdAt) || 0) - (Date.parse(a.finishedAt ?? a.createdAt) || 0));
  out.finished = out.finished.slice(0, 10);
  return out;
}

/** The number on the badge: challenges to answer plus matches where it is your move. */
export const attentionCount = (duels: readonly DuelInfo[], now: number): number => {
  const b = bucketDuels(duels, now);
  return b.incoming.length + b.yourTurn.length;
};

// ---- the challenge form ----

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Guildmates whose name contains the search (accents and case ignored), without anyone you already have a challenge or match with. */
export function filterPartners(partners: readonly Partner[], query: string, busyWith: ReadonlySet<string> = new Set()): Partner[] {
  const q = fold(query);
  return partners.filter((p) => !busyWith.has(p.discordUserId) && (!q || fold(p.name).includes(q)));
}

/** Opponents you already have an open challenge or a match in progress with (the server refuses a second one). */
export const busyOpponents = (duels: readonly DuelInfo[], now: number): Set<string> =>
  new Set(duels.filter((d) => d.kind === "friendly" && (pendingLive(d, now) || d.status === "active")).map((d) => d.opponent.id));

export interface ChallengeForm { query: string; to: Partner | null; cls: ClassKey; live: boolean; busy: boolean; error: string | null; sent: DuelInfo | null }
export type ChallengeAction =
  | { type: "query"; query: string }
  | { type: "pick"; partner: Partner }
  | { type: "clear" }
  | { type: "class"; cls: ClassKey }
  | { type: "live"; live: boolean }
  | { type: "sending" }
  | { type: "sent"; duel: DuelInfo }
  | { type: "failed"; message: string };

export const challengeStart = (cls: ClassKey): ChallengeForm => ({ query: "", to: null, cls, live: false, busy: false, error: null, sent: null });

export function challengeReducer(state: ChallengeForm, action: ChallengeAction): ChallengeForm {
  switch (action.type) {
    case "query": return { ...state, query: action.query, error: null, sent: null };
    case "pick": return { ...state, to: action.partner, query: "", error: null, sent: null };
    case "clear": return { ...state, to: null, error: null };
    case "class": return { ...state, cls: action.cls };
    case "live": return { ...state, live: action.live };
    case "sending": return state.to ? { ...state, busy: true, error: null } : state;
    // A sent challenge clears the pick so the next one starts fresh; class and live stay as the member left them.
    case "sent": return { ...state, busy: false, to: null, sent: action.duel };
    case "failed": return { ...state, busy: false, error: action.message };
  }
}

// ---- the ranked waiting room ----

export type QueuePhase = "idle" | "searching" | "matched";
export interface RankedUi { status: RankedStatus | null; phase: QueuePhase; matched: DuelResponse | null; busy: boolean; error: string | null }
export type RankedAction =
  | { type: "loaded"; status: RankedStatus }
  | { type: "sending" }
  | { type: "left" }
  | { type: "failed"; message: string }
  | { type: "opened" };

export const rankedStart: RankedUi = { status: null, phase: "idle", matched: null, busy: false, error: null };

export function rankedReducer(state: RankedUi, action: RankedAction): RankedUi {
  switch (action.type) {
    case "loaded": {
      const { status } = action;
      if (status.matched) return { status, phase: "matched", matched: status.matched, busy: false, error: null };
      // A match found earlier stays on screen until the member opens it.
      if (state.phase === "matched" && state.matched) return { ...state, status, busy: false };
      return { status, phase: status.queue ? "searching" : "idle", matched: null, busy: false, error: null };
    }
    case "sending": return { ...state, busy: true, error: null };
    case "left": return { ...state, phase: "idle", busy: false, status: state.status ? { ...state.status, queue: null } : null };
    case "failed": return { ...state, busy: false, error: action.message };
    case "opened": return { ...state, phase: state.status?.queue ? "searching" : "idle", matched: null };
  }
}

/** How often the waiting room asks again: the server widens the rating window every 10 s, so every 5 s while searching. */
export const QUEUE_POLL_MS = 5_000;

/** Star pips of the current division: filled and total (none at Legend). */
export function divisionPips(rank: RankInfo): { filled: number; total: number } {
  if (rank.legend) return { filled: 0, total: 0 };
  return { filled: rank.starsInDivision, total: rank.starsInDivision + rank.starsToNext };
}

/** Losses cost no star at Initiate and Adept; from Veteran a loss costs one (never below the start of the rank). */
export const lossesCostStars = (rank: RankInfo): boolean => rank.rank !== "Initiate" && rank.rank !== "Adept";

// ---- ladders ----

export type LadderRow = { kind: "entry"; entry: LadderEntry } | { kind: "gap" };

/** The top of a board, and your own row after a gap when you are further down. */
export function ladderRows(board: LadderBoard, top = 10): LadderRow[] {
  const rows: LadderRow[] = board.entries.slice(0, top).map((entry) => ({ kind: "entry", entry }));
  const you = board.you ?? board.entries.find((e) => e.you) ?? null;
  if (you && !board.entries.slice(0, top).some((e) => e.you)) rows.push({ kind: "gap" }, { kind: "entry", entry: you });
  return rows;
}
