import { MessageType, type Guild, type Message, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { eligibleVoiceUsers } from "./participation-discord.js";

// Running Discord activity totals for the message, voice and reaction achievements. Numbers only: message text
// is never read or stored, no privileged intent is needed (a message event carries its author without the
// Message Content intent), and only guilds with achievements switched on are counted. Increments are buffered
// in memory and written about once a minute, so a busy channel costs one small upsert per active member, not
// one per message. A restart can lose the last minute; nothing here posts, awards points or blocks anything.

export interface ActivityDelta { messages: number; reactionsGiven: number; reactionsReceived: number; voiceSeconds: number }
type Db = Pick<PrismaClient, "memberActivityTotal" | "guildSettings">;

const none = (): ActivityDelta => ({ messages: 0, reactionsGiven: 0, reactionsReceived: 0, voiceSeconds: 0 });

/** In-memory increments waiting to be written. A failed write keeps its increments for the next flush. */
export class ActivityBuffer {
  private readonly pending = new Map<string, { guildId: string; userId: string; delta: ActivityDelta }>();
  get size() { return this.pending.size; }
  add(guildId: string, userId: string, delta: Partial<ActivityDelta>): void {
    const key = `${guildId}:${userId}`;
    const row = this.pending.get(key) ?? { guildId, userId, delta: none() };
    for (const field of Object.keys(delta) as (keyof ActivityDelta)[]) row.delta[field] += delta[field] ?? 0;
    this.pending.set(key, row);
  }
  async flush(db: Pick<PrismaClient, "memberActivityTotal">): Promise<number> {
    const batch = [...this.pending.values()];
    this.pending.clear();
    let written = 0;
    for (const row of batch) {
      try {
        await db.memberActivityTotal.upsert({
          where: { guildId_userId: { guildId: row.guildId, userId: row.userId } },
          create: { guildId: row.guildId, userId: row.userId, ...row.delta },
          update: { messages: { increment: row.delta.messages }, reactionsGiven: { increment: row.delta.reactionsGiven }, reactionsReceived: { increment: row.delta.reactionsReceived }, voiceSeconds: { increment: row.delta.voiceSeconds } }
        });
        written++;
      } catch { this.add(row.guildId, row.userId, row.delta); }
    }
    return written;
  }
}

const ENABLED_TTL_MS = 5 * 60_000;
const MESSAGE_SPACING_MS = 2_000;
const REACTION_MEMORY = 5_000;
export const VOICE_TICK_MS = 60_000;

export function createActivityTracker(db: Db) {
  const buffer = new ActivityBuffer();
  const enabled = new Map<string, { guildId: string | null; at: number }>();
  const lastMessage = new Map<string, number>();
  const seenReactions = new Set<string>();
  const lastVoiceTick = new Map<string, number>();
  const guildFor = async (discordGuildId: string, now: number): Promise<string | null> => {
    const known = enabled.get(discordGuildId);
    if (known && now - known.at < ENABLED_TTL_MS) return known.guildId;
    const row = await db.guildSettings.findFirst({ where: { achievementsEnabled: true, guild: { discordId: discordGuildId } }, select: { guildId: true } });
    enabled.set(discordGuildId, { guildId: row?.guildId ?? null, at: now });
    return row?.guildId ?? null;
  };
  return {
    buffer,
    /** One ordinary message by a person. Bots, webhooks and system messages never count; bursts closer than 2 s count once. */
    async message(message: Message, now = Date.now()): Promise<void> {
      if (!message.guildId || message.author.bot || message.webhookId || ![MessageType.Default, MessageType.Reply].includes(message.type)) return;
      const guildId = await guildFor(message.guildId, now);
      if (!guildId) return;
      const key = `${guildId}:${message.author.id}`;
      if (now - (lastMessage.get(key) ?? 0) < MESSAGE_SPACING_MS) return;
      lastMessage.set(key, now);
      if (lastMessage.size > 5_000) for (const [user, at] of lastMessage) if (now - at > MESSAGE_SPACING_MS) lastMessage.delete(user);
      buffer.add(guildId, message.author.id, { messages: 1 });
    },
    /** A reaction added by a person: counts as given for them and received for the message author. Toggling the same one counts once. */
    async reaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, now = Date.now()): Promise<void> {
      const discordGuildId = reaction.message.guildId;
      if (!discordGuildId || user.bot) return;
      const guildId = await guildFor(discordGuildId, now);
      if (!guildId) return;
      const seen = `${reaction.message.id}:${user.id}`;
      if (seenReactions.has(seen)) return;
      seenReactions.add(seen);
      if (seenReactions.size > REACTION_MEMORY) seenReactions.delete(seenReactions.values().next().value as string);
      buffer.add(guildId, user.id, { reactionsGiven: 1 });
      const author = reaction.message.author;
      if (author && !author.bot && author.id !== user.id) buffer.add(guildId, author.id, { reactionsReceived: 1 });
    },
    /**
     * Called every minute: credits the time since the last call to each person in a voice channel with at least
     * one other person (not the AFK channel, not deafened). Gaps over two minutes (a restart) credit nothing.
     */
    async voice(guild: Guild, now = Date.now()): Promise<void> {
      const last = lastVoiceTick.get(guild.id);
      lastVoiceTick.set(guild.id, now);
      if (last === undefined || now - last > 2 * VOICE_TICK_MS || now <= last) return;
      const states = guild.voiceStates.cache.filter(state => !!state.channelId);
      if (states.size < 2) return;
      const guildId = await guildFor(guild.id, now);
      if (!guildId) return;
      const people = eligibleVoiceUsers(states.map(state => ({ id: state.id, channelId: state.channelId!, deaf: !!state.deaf, eligible: !(state.member?.user.bot ?? true) })), null, guild.afkChannelId);
      const seconds = Math.round((now - last) / 1000);
      for (const id of people) buffer.add(guildId, id, { voiceSeconds: seconds });
    },
    flush: () => buffer.flush(db)
  };
}
