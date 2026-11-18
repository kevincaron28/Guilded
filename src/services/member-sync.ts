import type { Guild, GuildMember, PartialGuildMember } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { forEachGuildScope } from "./guild-scope.js";
import type { MemberChange, MemberSyncWhat } from "./member-sync-events.js";
import { isOwnNickname, syncMemberNickname } from "./nickname-sync.js";
import { syncMemberRankRole } from "./rank-roles.js";

// Event-driven refresh of ONE member's Discord nickname and rank role (owner, 17 November 2026: "sync more than hourly without
// overcharging our limits"). A link, unlink, move, new main, roster rank change, join or an outside nickname/role change asks for it
// (member-sync-events.ts); the hourly full pass in main.ts stays as the safety net and catches anything dropped here.
//  - Debounce: a member already waiting is not queued again; the sync reads the latest data when its 5 s are up.
//  - Token bucket per Discord server: at most MEMBER_SYNC_MAX_PER_WINDOW member syncs start in any MEMBER_SYNC_WINDOW_MS, the rest
//    wait in a queue (capped; beyond the cap the hourly pass takes over), so a mass import cannot fire hundreds of calls.

export const MEMBER_SYNC_DEBOUNCE_MS = 5_000;
export const MEMBER_SYNC_MAX_PER_WINDOW = 10;
export const MEMBER_SYNC_WINDOW_MS = 10_000;
export const MEMBER_SYNC_QUEUE_MAX = 500;

export interface MemberSyncOptions {
  prisma: PrismaClient;
  /** The Discord server, from the bot's cache (null: not in it). */
  getGuild: (discordGuildId: string) => Guild | null | undefined;
  /** The hosted-pilot gate: false for a server the bot only waits in. */
  allows?: (discordGuildId: string) => boolean;
  report?: (error: unknown) => void;
  debounceMs?: number;
  maxPerWindow?: number;
  windowMs?: number;
  queueMax?: number;
}

interface Task { who: string | { memberId: string }; what: MemberSyncWhat }
interface Lane { queue: Map<string, Task>; started: number[]; timer: NodeJS.Timeout | null; running: boolean }

const merge = (a: MemberSyncWhat | undefined, b: MemberSyncWhat | undefined): MemberSyncWhat => !a ? (b ?? "both") : a === (b ?? "both") ? a : "both";

export function createMemberSync(options: MemberSyncOptions) {
  const debounceMs = options.debounceMs ?? MEMBER_SYNC_DEBOUNCE_MS;
  const maxPerWindow = options.maxPerWindow ?? MEMBER_SYNC_MAX_PER_WINDOW;
  const windowMs = options.windowMs ?? MEMBER_SYNC_WINDOW_MS;
  const queueMax = options.queueMax ?? MEMBER_SYNC_QUEUE_MAX;
  const pending = new Map<string, { what: MemberSyncWhat; change: MemberChange }>();
  const timers = new Set<NodeJS.Timeout>();
  const lanes = new Map<string, Lane>();
  const discordIdOf = new Map<string, string | null>();
  const stats = { marked: 0, ran: 0, dropped: 0 };

  const keyOf = (change: MemberChange) => "memberId" in change ? `m:${change.memberId}` : `u:${change.discordGuildId}:${change.discordUserId}`;

  async function discordGuildOf(change: MemberChange): Promise<string | null> {
    if ("discordGuildId" in change) return change.discordGuildId;
    if (!discordIdOf.has(change.guildId)) {
      const row = await options.prisma.guild.findUnique({ where: { id: change.guildId }, select: { discordId: true } });
      discordIdOf.set(change.guildId, row?.discordId ?? null);
    }
    return discordIdOf.get(change.guildId) ?? null;
  }

  async function runTask(discordGuildId: string, task: Task): Promise<void> {
    const guild = options.getGuild(discordGuildId);
    if (!guild) return;
    await forEachGuildScope(options.prisma, discordGuildId, async () => {
      if (task.what !== "rank") await syncMemberNickname(options.prisma, guild, task.who);
      if (task.what !== "nickname") await syncMemberRankRole(options.prisma, guild, task.who);
    });
  }

  async function drain(discordGuildId: string, lane: Lane): Promise<void> {
    if (lane.running) return;
    lane.running = true;
    try {
      while (lane.queue.size) {
        const now = Date.now();
        lane.started = lane.started.filter((at) => now - at < windowMs);
        if (lane.started.length >= maxPerWindow) {
          lane.timer = setTimeout(() => { lane.timer = null; void drain(discordGuildId, lane); }, Math.max(1, lane.started[0]! + windowMs - now));
          lane.timer.unref?.();
          return;
        }
        const [key, task] = lane.queue.entries().next().value as [string, Task];
        lane.queue.delete(key);
        lane.started.push(now);
        stats.ran++;
        await runTask(discordGuildId, task).catch((error) => options.report?.(error));
      }
    } finally {
      lane.running = false;
    }
  }

  async function fire(key: string): Promise<void> {
    const entry = pending.get(key);
    pending.delete(key);
    if (!entry) return;
    try {
      const discordGuildId = await discordGuildOf(entry.change);
      if (!discordGuildId || (options.allows && !options.allows(discordGuildId))) return;
      const lane = lanes.get(discordGuildId) ?? { queue: new Map(), started: [], timer: null, running: false };
      lanes.set(discordGuildId, lane);
      const task: Task = { who: "memberId" in entry.change ? { memberId: entry.change.memberId } : entry.change.discordUserId, what: entry.what };
      const waiting = lane.queue.get(key);
      if (waiting) task.what = merge(waiting.what, task.what);
      else if (lane.queue.size >= queueMax) { stats.dropped++; return; } // the hourly pass catches it
      lane.queue.set(key, task);
      void drain(discordGuildId, lane);
    } catch (error) { options.report?.(error); }
  }

  return {
    /** Ask for one member's refresh (debounced). */
    mark(change: MemberChange): void {
      stats.marked++;
      const key = keyOf(change);
      const waiting = pending.get(key);
      if (waiting) { waiting.what = merge(waiting.what, change.what); return; }
      pending.set(key, { what: change.what ?? "both", change });
      const timer = setTimeout(() => { timers.delete(timer); void fire(key); }, debounceMs);
      timer.unref?.();
      timers.add(timer);
    },
    stats: () => ({ ...stats, waiting: [...lanes.values()].reduce((sum, lane) => sum + lane.queue.size, 0) + pending.size }),
    /** For tests and shutdown: forget everything waiting. */
    stop(): void {
      for (const timer of timers) clearTimeout(timer);
      timers.clear(); pending.clear();
      for (const lane of lanes.values()) { if (lane.timer) clearTimeout(lane.timer); lane.timer = null; lane.queue.clear(); }
    }
  };
}
export type MemberSync = ReturnType<typeof createMemberSync>;

/** A member joined: their nickname and rank role may be waiting for them. */
export function handleMemberJoined(sync: Pick<MemberSync, "mark">, member: GuildMember): void {
  if (member.user.bot) return;
  sync.mark({ discordGuildId: member.guild.id, discordUserId: member.id });
}

/**
 * A nickname or role changed by someone else: put the bot's rule back for that member. The bot's own rename is skipped (the
 * nickname it just wrote is remembered; and a refresh that finds nothing to change makes no Discord call anyway).
 */
export function handleMemberUpdated(sync: Pick<MemberSync, "mark">, before: GuildMember | PartialGuildMember, after: GuildMember): void {
  if (after.user.bot) return;
  const discordGuildId = after.guild.id;
  if (before.nickname !== after.nickname && !isOwnNickname(discordGuildId, after.id, after.nickname)) sync.mark({ discordGuildId, discordUserId: after.id, what: "nickname" });
  const was = before.partial ? null : before.roles?.cache;
  const now = after.roles.cache;
  if (!was || was.size !== now.size || [...now.keys()].some((id) => !was.has(id))) sync.mark({ discordGuildId, discordUserId: after.id, what: "rank" });
}
