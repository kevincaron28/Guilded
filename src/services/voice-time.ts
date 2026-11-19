import type { Guild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { guildWhere } from "./guild-scope.js";

// Raw voice time per member and hour, for the promotion rule (services/promotion.ts, "3 h in voice over the last 7 days").
// Owner decision (19 Nov 2026): solo time counts. So this is NOT the participation or achievement rule (those need a second
// person, configured channels, undeafened members and a daily cap). Here a member counts for every minute connected to any voice
// channel except the server's AFK channel; bots never count. Numbers only (member, hour, seconds), no channel ids.
// Hourly buckets give an exact rolling 7-day window; rows older than 10 days are pruned.

export const VOICE_TIME_TICK_MS = 60_000;
export const VOICE_TIME_KEEP_DAYS = 10;
const HOUR = 3_600_000;
type Db = Pick<PrismaClient, "guild" | "memberVoiceHour">;

export const voiceHour = (at: number): Date => new Date(Math.floor(at / HOUR) * HOUR);

export function createVoiceTimeTracker(db: Db) {
  const pending = new Map<string, { guildId: string; userId: string; hour: Date; seconds: number }>();
  const lastTick = new Map<string, number>();
  const guildIds = new Map<string, { id: string | null; at: number }>();
  let lastPrune = 0;
  const guildFor = async (discordId: string, now: number): Promise<string | null> => {
    const known = guildIds.get(discordId);
    if (known && now - known.at < 10 * 60_000) return known.id;
    const row = await db.guild.findUnique({ where: guildWhere(discordId), select: { id: true } });
    guildIds.set(discordId, { id: row?.id ?? null, at: now });
    return row?.id ?? null;
  };
  const add = (guildId: string, userId: string, hour: Date, seconds: number) => {
    const key = `${guildId}:${userId}:${hour.getTime()}`;
    const row = pending.get(key);
    if (row) row.seconds += seconds; else pending.set(key, { guildId, userId, hour, seconds });
  };
  return {
    pending,
    /** Once a minute: credits the time since the last call to everyone connected to a non-AFK voice channel. A gap over two minutes (a restart) credits nothing. */
    async tick(guild: Pick<Guild, "id" | "afkChannelId" | "voiceStates">, now = Date.now()): Promise<void> {
      const last = lastTick.get(guild.id);
      lastTick.set(guild.id, now);
      if (last === undefined || now - last > 2 * VOICE_TIME_TICK_MS || now <= last) return;
      const people = guild.voiceStates.cache.filter((state) => !!state.channelId && state.channelId !== guild.afkChannelId && !(state.member?.user.bot ?? true));
      if (!people.size) return;
      const guildId = await guildFor(guild.id, now);
      if (!guildId) return;
      const seconds = Math.round((now - last) / 1000);
      // A tick that straddles the hour is credited to the hour it ends in; the error is under a minute.
      for (const id of people.keys()) add(guildId, id, voiceHour(now), seconds);
    },
    async flush(now = Date.now()): Promise<number> {
      const batch = [...pending.values()];
      pending.clear();
      let written = 0;
      for (const row of batch) {
        try {
          await db.memberVoiceHour.upsert({ where: { guildId_userId_hour: { guildId: row.guildId, userId: row.userId, hour: row.hour } }, create: row, update: { seconds: { increment: row.seconds } } });
          written++;
        } catch { add(row.guildId, row.userId, row.hour, row.seconds); }
      }
      if (now - lastPrune > 6 * HOUR) {
        lastPrune = now;
        await db.memberVoiceHour.deleteMany({ where: { hour: { lt: new Date(now - VOICE_TIME_KEEP_DAYS * 24 * HOUR) } } }).catch(() => undefined);
      }
      return written;
    }
  };
}
