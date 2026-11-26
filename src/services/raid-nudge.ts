import { EmbedBuilder, type Client, type Guild } from "discord.js";
import type { DiscordJob, PrismaClient } from "../generated/prisma/client.js";
import { pilotGuildScope } from "../hosted-pilot.js";
import { asLang, t, type Lang } from "../i18n.js";
import { deliverDiscordJob } from "./discord-jobs.js";

// The day before a raid: one message in the signup channel for those who have not answered (a core raid's
// members with no answer at all) and those who answered Maybe. Once per raid; officers turn it off in
// /setup start (raid step). Members who answered "Can't come" are never mentioned.
export const NUDGE_FROM_MS = 24 * 3_600_000;
// Too close to the start there is no time to react, and the normal reminder follows.
export const NUDGE_UNTIL_MS = 3 * 3_600_000;
// A raid just announced is not chased.
export const NUDGE_MIN_AGE_MS = 2 * 3_600_000;
const MAX_MENTIONS = 100;

export function isNudgeDue(input: { now: Date; scheduledAt: Date; createdAt: Date; signupsCloseAt: Date | null; sentAt: Date | null }): boolean {
  if (input.sentAt) return false;
  const untilStart = input.scheduledAt.getTime() - input.now.getTime();
  if (untilStart > NUDGE_FROM_MS || untilStart < NUDGE_UNTIL_MS) return false;
  if (input.signupsCloseAt && input.signupsCloseAt.getTime() <= input.now.getTime()) return false;
  return input.now.getTime() - input.createdAt.getTime() >= NUDGE_MIN_AGE_MS;
}

type Answer = { status: string; member: { discordUserId: string } };
type CoreSeat = { memberId: string; member: { discordUserId: string; status: string } };

export function nudgeTargets(signups: Array<Answer & { memberId: string }>, coreMembers: CoreSeat[]): { unanswered: string[]; maybe: string[] } {
  const answered = new Set(signups.map((signup) => signup.memberId));
  // Discord ids only: placeholder rows (addon-only members) cannot be mentioned.
  const real = (id: string) => /^\d{15,22}$/.test(id);
  const unanswered = [...new Set(coreMembers
    .filter((seat) => !answered.has(seat.memberId) && seat.member.status !== "LEFT" && real(seat.member.discordUserId))
    .map((seat) => seat.member.discordUserId))].slice(0, MAX_MENTIONS);
  const maybe = [...new Set(signups.filter((signup) => signup.status === "MAYBE" && real(signup.member.discordUserId)).map((signup) => signup.member.discordUserId))]
    .slice(0, MAX_MENTIONS - unanswered.length);
  return { unanswered, maybe };
}

export function nudgeMessage(lang: Lang, input: { title: string; scheduledAt: Date; unanswered: string[]; maybe: string[]; postUrl: string | null }): { content: string; users: string[] } {
  const lines = [t(lang, "nudge.title", { raid: input.title, when: `<t:${Math.floor(input.scheduledAt.getTime() / 1000)}:R>` })];
  const users: string[] = [];
  const end = input.postUrl ? t(lang, "nudge.answerLink", { link: input.postUrl }) : t(lang, "nudge.answer");
  // Discord refuses a message over 2000 characters: mentions that do not fit are left out whole.
  let room = 1950 - lines[0]!.length - end.length;
  for (const [key, ids] of [["nudge.unanswered", input.unanswered], ["nudge.maybe", input.maybe]] as const) {
    const label = t(lang, key);
    const fitting: string[] = [];
    let used = label.length + 2;
    for (const id of ids) {
      if (used + id.length + 4 > room) break;
      fitting.push(id); used += id.length + 4;
    }
    if (!fitting.length) continue;
    lines.push(`${label} ${fitting.map((id) => `<@${id}>`).join(" ")}`);
    users.push(...fitting);
    room -= used;
  }
  lines.push(end);
  return { content: lines.join("\n"), users };
}

const include = {
  guild: { include: { settings: true } },
  signups: { include: { member: true } },
  core: { select: { members: { select: { memberId: true, member: { select: { discordUserId: true, status: true } } } } } }
} as const;

export async function runRaidNudges(client: Client, database: PrismaClient, now = new Date()): Promise<number> {
  const raids = await database.raid.findMany({
    where: { ...pilotGuildScope, status: "PLANNED", isTest: false, nudgeSentAt: null,
      scheduledAt: { gte: new Date(now.getTime() + NUDGE_UNTIL_MS), lte: new Date(now.getTime() + NUDGE_FROM_MS) } },
    include
  });
  let sent = 0;
  for (const raid of raids) {
    const settings = raid.guild.settings;
    if (settings?.raidNudge === false) continue;
    if (!isNudgeDue({ now, scheduledAt: raid.scheduledAt, createdAt: raid.createdAt, signupsCloseAt: raid.signupsCloseAt, sentAt: raid.nudgeSentAt })) continue;
    if (!(raid.signupChannelId ?? settings?.raidSignupChannelId)) continue;
    try {
      const targets = nudgeTargets(raid.signups, raid.core?.members ?? []);
      // Nobody to chase when the window opens: done, so a later Maybe is not pinged minutes after answering.
      if (!targets.unanswered.length && !targets.maybe.length) {
        await database.raid.update({ where: { id: raid.id }, data: { nudgeSentAt: now } });
        continue;
      }
      const key = `raid-nudge:${raid.id}:${raid.scheduledAt.toISOString()}`;
      const job = await database.discordJob.upsert({ where: { guildId_key: { guildId: raid.guildId, key } },
        create: { guildId: raid.guildId, key, kind: "RAID_NUDGE", payload: { raidId: raid.id, scheduledAt: raid.scheduledAt.toISOString() } }, update: {} });
      const discordGuild = await client.guilds.fetch(raid.guild.discordId);
      await deliverDiscordJob(database, job.id, current => deliverRaidNudge(discordGuild, database, current, now), now);
      if ((await database.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE") sent += 1;
    } catch (error) {
      console.error(`Raid nudge failed for raid ${raid.id}`, error);
    }
  }
  return sent;
}

export async function deliverRaidNudge(guild: Guild, database: PrismaClient, job: DiscordJob, now = new Date()): Promise<void> {
  const payload = job.payload as { raidId?: string; scheduledAt?: string };
  const raid = await database.raid.findFirst({ where: { id: payload.raidId ?? "", guildId: job.guildId }, include });
  if (!raid || raid.status !== "PLANNED" || raid.guild.discordId !== guild.id || raid.scheduledAt.toISOString() !== payload.scheduledAt) return;
  const settings = raid.guild.settings;
  if (settings?.raidNudge === false) return;
  if (!isNudgeDue({ now, scheduledAt: raid.scheduledAt, createdAt: raid.createdAt, signupsCloseAt: raid.signupsCloseAt, sentAt: raid.nudgeSentAt })) return;
  const channelId = raid.signupChannelId ?? settings?.raidSignupChannelId;
  const targets = nudgeTargets(raid.signups, raid.core?.members ?? []);
  if (!channelId || (!targets.unanswered.length && !targets.maybe.length)) return;
  const channel = await guild.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error("Reminder channel unavailable");
  const marker = `Guilded nudge ${job.id}`;
  const recent = await channel.messages.fetch({ limit: 100 });
  const delivered = recent.some(message => message.author.id === guild.client.user?.id && message.embeds.some(embed => embed.footer?.text === marker));
  if (!delivered) {
    const postUrl = raid.signupMessageId && raid.signupChannelId ? `https://discord.com/channels/${guild.id}/${raid.signupChannelId}/${raid.signupMessageId}` : null;
    const message = nudgeMessage(asLang(settings?.language), { title: raid.title, scheduledAt: raid.scheduledAt, ...targets, postUrl });
    await channel.send({ content: message.content, embeds: [new EmbedBuilder().setFooter({ text: marker })],
      allowedMentions: { parse: [], users: message.users }, nonce: job.id.slice(-25), enforceNonce: true });
  }
  await database.raid.update({ where: { id: raid.id }, data: { nudgeSentAt: now } });
}
