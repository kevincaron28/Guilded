import { AttachmentBuilder, ChannelType, type Collection, type Guild, type Message, type TextBasedChannel, type TextChannel } from "discord.js";

// 8.5 batch 3 (#13): /setup can retire an old channel (Québec Gold's #wow-personnage). Three separate steps, in this order:
// the messages are archived to a text file, an officer confirms, then the channel is deleted. Nothing is deleted before the
// confirmation, and a channel Guilded itself uses is never offered.

export const MAX_ARCHIVED_MESSAGES = 20_000;

export interface RetirePlan { channelId: string; name: string; archived: number; archiveChannelId: string; at: number }
const plans = new Map<string, RetirePlan>();
const PLAN_LIFETIME_MS = 15 * 60_000;
export const retirePlan = (guildId: string, now = Date.now()): RetirePlan | undefined => {
  const plan = plans.get(guildId);
  if (plan && now - plan.at > PLAN_LIFETIME_MS) { plans.delete(guildId); return undefined; }
  return plan;
};
export const forgetRetirePlan = (guildId: string): void => { plans.delete(guildId); };

type Stored = Record<string, unknown> | null | undefined;
/** Channels Guilded itself uses (any saved setting that holds this channel's ID): these are never retired from here. */
export function isManagedChannel(settings: Stored, channelId: string): boolean {
  return Object.entries(settings ?? {}).some(([key, value]) => /ChannelId$|^bg.*Id$/.test(key) && value === channelId);
}

export function formatArchiveLine(message: Pick<Message, "createdAt" | "author" | "content" | "attachments">): string {
  const files = [...message.attachments.values()].map((file) => file.url);
  const text = (message.content ?? "").replace(/\r?\n/g, "\n    ");
  return `[${message.createdAt.toISOString()}] ${message.author.username} (${message.author.id}): ${text}${files.length ? ` ${files.join(" ")}` : ""}`;
}

/** Every message of the channel, oldest first, as text. */
export async function archiveChannelText(channel: Pick<TextBasedChannel, "messages"> & { name?: string }, limit = MAX_ARCHIVED_MESSAGES): Promise<{ text: string; count: number }> {
  const all: Message[] = [];
  let before: string | undefined;
  while (all.length < limit) {
    const page = await (channel.messages as { fetch(options: { limit: number; before?: string }): Promise<Collection<string, Message>> }).fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!page.size) break;
    all.push(...page.values());
    before = page.last()?.id ?? page.lastKey();
    if (page.size < 100) break;
  }
  all.reverse();
  return { text: `# Archive of #${channel.name ?? "channel"} (${all.length} messages)\n\n${all.map(formatArchiveLine).join("\n")}\n`, count: all.length };
}

/** Archives the channel into a file posted in `destination`, and remembers the plan for the confirmation step. */
export async function archiveForRetire(guild: Guild, channel: TextChannel, destination: { id: string; send: (options: { content: string; files: AttachmentBuilder[]; allowedMentions: { parse: [] } }) => Promise<unknown> }, now = new Date()): Promise<RetirePlan> {
  const { text, count } = await archiveChannelText(channel);
  const file = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: `archive-${channel.name}-${now.toISOString().slice(0, 10)}.txt` });
  await destination.send({ content: `Archive of **#${channel.name}**: ${count} message${count === 1 ? "" : "s"}. The channel is deleted only after an officer confirms in /setup.`, files: [file], allowedMentions: { parse: [] } });
  const plan: RetirePlan = { channelId: channel.id, name: channel.name, archived: count, archiveChannelId: destination.id, at: now.getTime() };
  plans.set(guild.id, plan);
  return plan;
}

/** Deletes the archived channel. Refuses without a fresh plan for exactly this channel. */
export async function deleteRetiredChannel(guild: Guild, settings: Stored, reason: string, now = Date.now()): Promise<{ ok: boolean; message: string; name?: string; archived?: number }> {
  const plan = retirePlan(guild.id, now);
  if (!plan) return { ok: false, message: "Nothing to confirm: pick the channel again so it is archived first." };
  if (isManagedChannel(settings, plan.channelId)) { plans.delete(guild.id); return { ok: false, message: "That channel is one Guilded uses. Nothing was deleted." }; }
  const channel = await guild.channels.fetch(plan.channelId).catch(() => null);
  plans.delete(guild.id);
  if (!channel || channel.type !== ChannelType.GuildText) return { ok: false, message: "That channel no longer exists. Nothing was deleted." };
  await channel.delete(reason);
  return { ok: true, message: `Deleted #${plan.name}. Its ${plan.archived} messages are in the archive file.`, name: plan.name, archived: plan.archived };
}
