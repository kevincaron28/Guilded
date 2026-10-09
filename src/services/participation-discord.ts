import { ChannelType, MessageType, PermissionFlagsBits, type Guild, type GuildMember, type Message, type MessageReaction, type PartialMessage, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { hasPermission } from "../permissions.js";
import { createParticipationService } from "./participation.js";
import { MAX_VOICE_GAP_MS, memberEligible, messageFingerprint, normalizeEmoji, participationRules, type ParticipationRules } from "./participation-rules.js";

export function eligibleParticipationMember(member: GuildMember, season: { audienceRoleId: string | null; channelId: string }, rules: ParticipationRules, now: Date): boolean {
  return memberEligible({ bot: member.user.bot, createdAt: member.user.createdTimestamp, joinedAt: member.joinedTimestamp,
    audience: !season.audienceRoleId || member.roles.cache.has(season.audienceRoleId) || hasPermission(member, "officer"),
    canView: !!member.guild.channels.cache.get(season.channelId)?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) }, rules, now);
}

export type VoiceParticipant = { id: string; channelId: string; eligible: boolean; deaf: boolean };
// `channels` null means every voice channel counts.
export function eligibleVoiceUsers(states: VoiceParticipant[], channels: string[] | null, afkId: string | null): Set<string> {
  const groups = new Map<string, string[]>();
  for (const state of states) {
    if (!state.eligible || state.deaf || state.channelId === afkId || channels && !channels.includes(state.channelId)) continue;
    const group = groups.get(state.channelId) ?? [];
    group.push(state.id); groups.set(state.channelId, group);
  }
  return new Set([...groups.values()].filter(group => group.length >= 2).flat());
}

export function createParticipationTracker(database: PrismaClient, contentAvailable: boolean) {
  const service = createParticipationService(database);
  const load = (guild: Guild) => database.communityParticipationConfig.findFirst({ where: { enabled: true, season: { game: "DISCORD", status: "ACTIVE", guild: { discordId: guild.id } } }, include: { season: true } });
  type VoiceSnapshot = { at: Date; seasonId: string; revision: number; users: Set<string> };
  const voices = new Map<string, VoiceSnapshot>();
  const queues = new Map<string, Promise<void>>();
  const epochs = new Map<string, number>();
  let generation = 0;
  return {
    reset(guildId?: string) {
      if (guildId) { voices.delete(guildId); epochs.set(guildId, (epochs.get(guildId) ?? 0) + 1); }
      else { generation++; voices.clear(); }
    },
    async message(message: Message) {
      const guild = message.guild;
      const now = new Date();
      if (!guild || !message.inGuild() || message.author.bot || message.webhookId || ![MessageType.Default, MessageType.Reply].includes(message.type) || now.getTime() - message.createdTimestamp > 120_000 || message.createdTimestamp > now.getTime()) return;
      const cfg = await load(guild);
      if (!cfg) return;
      const rules = participationRules.parse(cfg.rules);
      // With every text channel on, ordinary text channels only: no threads, forums or voice chat.
      if (!(rules.allText ? message.channel.type === ChannelType.GuildText : rules.textChannels.includes(message.channelId)) || rules.messageDailyCap === 0) return;
      const member = await guild.members.fetch({ user: message.author.id, force: true });
      if (!eligibleParticipationMember(member, cfg.season, rules, now) || !message.channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) return;
      await service.message(cfg.season.guildId, cfg.seasonId, { userId: member.id, channelId: message.channelId, messageId: message.id, hash: contentAvailable ? messageFingerprint(message.content) : null, contentAvailable, at: message.createdAt, revision: cfg.revision });
    },
    async reaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
      const guild = reaction.message.guild;
      if (!guild || user.bot || reaction.message.author?.id === user.id) return;
      const cfg = await load(guild);
      if (!cfg) return;
      const rules = participationRules.parse(cfg.rules);
      if (!(rules.allText ? reaction.message.channel.type === ChannelType.GuildText : rules.textChannels.includes(reaction.message.channelId)) || rules.reactionDailyCap === 0 || !rules.emojis.some(emoji => normalizeEmoji(emoji) === normalizeEmoji(reaction.emoji.id ?? reaction.emoji.name ?? ""))) return;
      const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
      if (!message.inGuild()) return;
      const now = new Date(), age = now.getTime() - message.createdTimestamp;
      if (message.author.bot || message.webhookId || message.author.id === user.id || ![MessageType.Default, MessageType.Reply].includes(message.type) || age < 120_000 || age > 48 * 60 * 60_000) return;
      const author = await guild.members.fetch({ user: message.author.id, force: true });
      const reactor = await guild.members.fetch({ user: user.id, force: true });
      if (![author, reactor].every(member => eligibleParticipationMember(member, cfg.season, rules, now) && message.channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel))) return;
      await service.reaction(cfg.season.guildId, cfg.seasonId, { userId: author.id, reactorId: reactor.id, messageId: message.id, channelId: message.channelId, at: now, revision: cfg.revision });
    },
    async deleted(message: Message | PartialMessage) {
      if (!message.guild) return;
      const season = await database.communitySeason.findFirst({ where: { guild: { discordId: message.guild.id }, game: "DISCORD", status: "ACTIVE" }, include: { participation: true } });
      if (!season?.participation) return;
      const rules = participationRules.parse(season.participation.rules);
      if (!rules.allText && !rules.textChannels.includes(message.channelId) && !await database.communityPoint.findFirst({ where: { seasonId: season.id, kind: "AWARD", OR: [{ reference: `participation:message:${message.id}` }, { reference: { startsWith: `participation:reaction:${message.id}:` } }] } })) return;
      await service.deleteMessage(season.guildId, season.id, message.id);
    },
    // Capture gateway state immediately, then serialize checkpoints for this guild.
    // No voice connection or audio processing is involved.
    sampleVoice(guild: Guild, at = new Date()): Promise<void> {
      const epoch = epochs.get(guild.id) ?? 0, capturedGeneration = generation;
      const states = guild.voiceStates.cache.map(state => {
        const member = state.member;
        return { id: state.id, channelId: state.channelId, deaf: !!state.deaf, bot: member?.user.bot ?? true,
          createdAt: member?.user.createdTimestamp ?? at.getTime(), joinedAt: member?.joinedTimestamp ?? null,
          roles: new Set(member?.roles.cache.keys() ?? []), officer: member ? hasPermission(member, "officer") : false,
          visible: new Set(member ? guild.channels.cache.filter(channel => channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)).keys() : []),
          connect: !!member && state.channel?.type === ChannelType.GuildVoice && !!state.channel.permissionsFor(member)?.has(PermissionFlagsBits.Connect) };
      });
      const available = guild.available, afkId = guild.afkChannelId;
      const work = async () => {
        if (capturedGeneration !== generation || epoch !== (epochs.get(guild.id) ?? 0)) return;
        if (!available) { voices.delete(guild.id); return; }
        // No potential pair and no interval left to settle: idle guilds need no database read.
        // Keep the last occupied interval when a pair breaks up; settle it once below.
        const possible = eligibleVoiceUsers(states.filter(state => state.channelId).map(state => ({
          id: state.id, channelId: state.channelId!, deaf: state.deaf, eligible: !state.bot && state.connect
        })), null, afkId);
        if (!possible.size && !voices.get(guild.id)?.users.size) { voices.delete(guild.id); return; }
        const cfg = await load(guild);
        if (capturedGeneration !== generation || epoch !== (epochs.get(guild.id) ?? 0)) return;
        if (!cfg) { voices.delete(guild.id); return; }
        const rules = participationRules.parse(cfg.rules);
        const users = eligibleVoiceUsers(states.filter(state => state.channelId).map(state => ({ id: state.id, channelId: state.channelId!, deaf: state.deaf,
          eligible: state.connect && memberEligible({ bot: state.bot, createdAt: state.createdAt, joinedAt: state.joinedAt, audience: !cfg.season.audienceRoleId || state.roles.has(cfg.season.audienceRoleId) || state.officer, canView: state.visible.has(cfg.season.channelId) && state.visible.has(state.channelId!) }, rules, at) })), rules.allVoice ? null : rules.voiceChannels, afkId);
        const previous = voices.get(guild.id);
        // Start fresh after restarts, config changes, disconnects or long pauses.
        voices.set(guild.id, { at, seasonId: cfg.seasonId, revision: cfg.revision, users });
        if (!previous || previous.seasonId !== cfg.seasonId || previous.revision !== cfg.revision || at <= previous.at || at.getTime() - previous.at.getTime() > MAX_VOICE_GAP_MS) return;
        for (const userId of previous.users) {
          if (capturedGeneration !== generation || epoch !== (epochs.get(guild.id) ?? 0)) return;
          await service.voice(cfg.season.guildId, cfg.seasonId, userId, previous.at, at, cfg.revision);
        }
      };
      const pending = (queues.get(guild.id) ?? Promise.resolve()).catch(() => undefined).then(work);
      queues.set(guild.id, pending);
      void pending.finally(() => { if (queues.get(guild.id) === pending) queues.delete(guild.id); }).catch(() => undefined);
      return pending;
    }
  };
}
