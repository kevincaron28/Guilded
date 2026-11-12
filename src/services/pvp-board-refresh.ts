import type { PrismaClient } from "../generated/prisma/client.js";
import { enqueueDiscordJob } from "./discord-jobs.js";

// The world PvP panel lives on the battleground ladder message. It used to change only on the 30-minute timer; an upload that
// changed a member's counts now queues one refresh of that message about two minutes later (the duel board already queues
// its own job when a duel is recorded). The delay lets a burst of uploads (a raid logging out together) share one edit, and
// the job queue's per-server key means Discord is never asked twice for the same board.

export const PVP_REFRESH_DELAY_MS = 2 * 60_000;

type Db = Pick<PrismaClient, "guildSettings" | "discordJob">;

/** Queues the ladder refresh unless one is already waiting. Never throws. Returns whether a new refresh was queued. */
export async function scheduleBgLadderRefresh(db: Db, guildId: string, now = new Date(), delayMs = PVP_REFRESH_DELAY_MS): Promise<boolean> {
  try {
    const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { bgLadderEnabled: true, bgStatsChannelId: true, worldPvpEnabled: true } });
    if (!settings?.bgLadderEnabled || !settings.bgStatsChannelId || settings.worldPvpEnabled === false) return false;
    const key = "bg-ladder";
    const waiting = await db.discordJob.findUnique({ where: { guildId_key: { guildId, key } }, select: { status: true, nextAttemptAt: true } });
    // Already queued for later: the pending refresh will read the newest numbers when it runs.
    if (waiting?.status === "PENDING" && waiting.nextAttemptAt.getTime() > now.getTime()) return false;
    await enqueueDiscordJob(db, guildId, key, "BG_LADDER");
    await db.discordJob.update({ where: { guildId_key: { guildId, key } }, data: { nextAttemptAt: new Date(now.getTime() + delayMs) } });
    return true;
  } catch (error) {
    console.warn("World PvP board refresh was not queued", error);
    return false;
  }
}
