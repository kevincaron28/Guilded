/**
 * (17 Nov 2026) Companion uploads repeat: 61% of the uploads in the 15-16 Nov audit were byte-identical to the previous one from the same
 * uploader, and each still ran the whole side-effect chain (about 12 s at the median, against the companion's 20 s limit).
 *
 * Two parts, both used only by the upload handler in companion-api.ts:
 * - A short memory of the last upload whose payload-driven side effects all ran without a failure, per guild and uploader. The same
 *   payload (its checksum covers everything except the roster, event log and MOTD, which stay applied every time) arriving again within
 *   `REPEAT_MEMORY_MS` skips those phases. The memory is in process, so a restart or the TTL simply applies once more; nothing is stored.
 * - A runner that executes the remaining phases as independent lanes (in parallel), each lane's steps in order.
 */

import { createHash } from "node:crypto";

export const REPEAT_MEMORY_MS = 10 * 60_000;
const MAX_REMEMBERED = 2_000;
const applied = new Map<string, { checksum: string; at: number }>();

/** One lane per uploader in a guild; an officer's upload and a member's never share an entry. */
export function uploadRepeatKey(guildId: string, uploader: string, officer: boolean): string {
  return `${guildId}:${uploader}:${officer ? 1 : 0}`;
}

/** True when this uploader's last fully applied upload carried this exact payload checksum, recently. */
export function isRepeatUpload(key: string, checksum: string, now = Date.now()): boolean {
  const last = applied.get(key);
  return !!last && last.checksum === checksum && now - last.at < REPEAT_MEMORY_MS;
}

export function rememberAppliedUpload(key: string, checksum: string, now = Date.now()): void {
  applied.delete(key);
  applied.set(key, { checksum, at: now });
  while (applied.size > MAX_REMEMBERED) { const oldest = applied.keys().next().value; if (oldest === undefined) break; applied.delete(oldest); }
}

export function forgetAppliedUploads(): void { applied.clear(); guildDataApplied.clear(); }

// The same idea for the guild roster / events / MOTD (guild-data), which are outside the payload checksum: an upload whose guild data is
// identical (digest of exactly those blocks) to the last one applied for this guild, uploader kind and uploader, within the memory window,
// has nothing new to store, so its transaction (about a second of round trips on an unchanged roster) is skipped.
const guildDataApplied = new Map<string, { digest: string; at: number }>();
export function guildDataDigest(data: { guildRoster?: unknown; guildEvents?: unknown; guildInfo?: unknown }): string {
  return createHash("sha256").update(JSON.stringify([data.guildRoster ?? null, data.guildEvents ?? null, data.guildInfo ?? null])).digest("hex");
}
export function isRepeatGuildData(key: string, digest: string, now = Date.now()): boolean {
  const last = guildDataApplied.get(key);
  return !!last && last.digest === digest && now - last.at < REPEAT_MEMORY_MS;
}
export function rememberGuildData(key: string, digest: string, now = Date.now()): void {
  guildDataApplied.delete(key);
  guildDataApplied.set(key, { digest, at: now });
  while (guildDataApplied.size > MAX_REMEMBERED) { const oldest = guildDataApplied.keys().next().value; if (oldest === undefined) break; guildDataApplied.delete(oldest); }
}
/** Forgets a guild's remembered guild data (something outside the upload changed what a re-application would store). */
export function forgetGuildData(): void { guildDataApplied.clear(); }

/** Production's pool is 5 connections shared by every job: at most this many lanes of one upload hold the database at once (UPLOAD_LANE_CONCURRENCY overrides). */
export const UPLOAD_LANE_CONCURRENCY = Math.max(1, Math.floor(Number(process.env["UPLOAD_LANE_CONCURRENCY"])) || 2);

export interface UploadStep {
  name: string;
  /** Does the work; may throw (the runner reports it through `onError` and the upload carries on). */
  run: () => Promise<unknown>;
  /** The step's own failure line (the same text the handler logged before). */
  onError?: (error: unknown) => void;
  /** Applies what the upload's payload carries; skipped for a repeated payload. Without it the step runs every time. */
  payload?: boolean;
}

export interface UploadRun { ran: string[]; skipped: string[]; failed: boolean }

/**
 * Runs the lanes at the same time, the steps of one lane one after the other. A failed step never stops its lane or the upload.
 * `track` wraps each lane (the phase timer records its time without disturbing the gap-free main timeline).
 */
export async function runUploadLanes(lanes: Array<{ name: string; steps: UploadStep[] }>, options: { repeat: boolean; concurrency?: number; track?: <T>(lane: string, task: () => Promise<T>) => Promise<T> }): Promise<UploadRun> {
  const result: UploadRun = { ran: [], skipped: [], failed: false };
  const track = options.track ?? (<T>(_lane: string, task: () => Promise<T>) => task());
  // Lanes start in the order given (the guild lane first); a lane that finishes lets the next queued one start.
  const queue = [...lanes];
  const runLane = (lane: { name: string; steps: UploadStep[] }) => track(lane.name, async () => {
    for (const step of lane.steps) {
      if (options.repeat && step.payload) { result.skipped.push(step.name); continue; }
      result.ran.push(step.name);
      try { await step.run(); } catch (error) { result.failed = true; step.onError?.(error); }
    }
  });
  const worker = async () => { for (let lane = queue.shift(); lane; lane = queue.shift()) await runLane(lane); };
  const width = Math.max(1, Math.min(lanes.length, Math.floor(options.concurrency ?? UPLOAD_LANE_CONCURRENCY)));
  await Promise.all(Array.from({ length: width }, worker));
  return result;
}
