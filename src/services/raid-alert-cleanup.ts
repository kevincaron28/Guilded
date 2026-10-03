import type { Client, Message } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { PAST_RAID_POST_MS, UNENDED_RAID_MS } from "./raid-post-cleanup.js";

type Alert = Pick<Message, "author" | "pinned" | "createdTimestamp" | "content" | "embeds" | "components" | "attachments">;

// Only recognize Guilded's exact transient raid formats, never general bot messages,
// reports, officer records, interactive panels, attachments or pinned messages.
export function isExpiredRaidAlert(message: Alert, botId: string, now: Date): boolean {
  if (message.author.id !== botId || message.pinned || message.components.length || message.attachments.size) return false;
  const cutoff = now.getTime() - PAST_RAID_POST_MS;
  if (message.createdTimestamp > cutoff) return false;
  if (!message.embeds.length && /^(?:⏰ \*\*.+\*\* (?:starts|commence) |📣 \*\*(?:Players wanted: |Joueurs recherchés : ))/.test(message.content)) {
    const timestamp = message.content.match(/<t:(\d+):[FR]>/)?.[1];
    return !!timestamp && Number(timestamp) * 1000 + UNENDED_RAID_MS <= cutoff;
  }
  if (message.content || message.embeds.length !== 1) return false;
  const embed = message.embeds[0]!;
  if (embed.title || embed.fields.length || embed.image || embed.thumbnail || embed.url) return false;
  if (embed.footer && !/^Guilded delivery [a-zA-Z0-9-]+$/.test(embed.footer.text)) return false;
  return /^(?:⚔️ Raid (?:started:|commencé :)|🏁 Raid (?:ended:|terminé :)) \*\*[^\n]+\*\*$/.test(embed.description ?? "");
}

// Walk one page per channel per run, so older clutter is eventually reached even
// in busy channels. Individual deletion also works for messages over 14 days old.
const cursors = new Map<string, string>();
let running = false;
export async function cleanupRaidAlerts(client: Client, database: PrismaClient, now = new Date()): Promise<number> {
  if (running || !client.user) return 0;
  running = true;
  let removed = 0;
  try {
    const records = await database.guild.findMany({ select: { discordId: true,
      settings: { select: { notifyChannelId: true, raidSignupChannelId: true } },
      raidCores: { select: { signupChannelId: true } }
    } });
    for (const record of records) {
      const guild = client.guilds.cache.get(record.discordId);
      if (!guild) continue;
      const ids = new Set([record.settings?.notifyChannelId, record.settings?.raidSignupChannelId, ...record.raidCores.map(core => core.signupChannelId)]);
      for (const id of ids) {
        if (!id) continue;
        try {
          const channel = await guild.channels.fetch(id);
          if (!channel?.isTextBased()) continue;
          const before = cursors.get(id);
          const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
          for (const message of messages.values()) {
            if (isExpiredRaidAlert(message, client.user.id, now)) { await message.delete(); removed++; }
            if (removed >= 25) return removed;
          }
          const oldest = messages.last()?.id;
          if (messages.size === 100 && oldest) cursors.set(id, oldest);
          else cursors.delete(id);
        } catch (error) {
          // Keep the cursor on failure so permissions/network errors are retried.
          console.warn(`Could not clean old raid alerts in channel ${id}`, error);
        }
      }
    }
    return removed;
  } finally { running = false; }
}
