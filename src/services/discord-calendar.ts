import { PermissionFlagsBits, Routes, type Client, type APIGuildScheduledEvent } from "discord.js";

export interface CalendarExportEvent { id: string; title: string; at: string; core: string | null; note: string }

// Discord's scheduled events and bot raid signups share the existing companion format.
export function mergeCalendarEvents(raids: CalendarExportEvent[], events: APIGuildScheduledEvent[], now = new Date()): CalendarExportEvent[] {
  const end = now.getTime() + 21 * 86_400_000;
  const merged = [...raids];
  for (const event of events) {
    const at = Date.parse(event.scheduled_start_time);
    if (event.status !== 1 || !Number.isFinite(at) || at < now.getTime() || at > end) continue;
    // Managed raid events carry the exact Guilded raid identity. They are already
    // exported above; even a renamed/moved event must not become another raid.
    if (/\nGuilded event [^:\n]+:raid:[^:\n]+$/.test(event.description ?? "")) continue;
    const title = event.name.slice(0, 30);
    if (merged.some((raid) => raid.title.toLowerCase() === title.toLowerCase() && Math.abs(Date.parse(raid.at) - at) <= 30 * 60_000)) continue;
    merged.push({ id: `discord:${event.id}`, title, at: new Date(at).toISOString(), core: null,
      note: `${(event.description ?? "").replace(/\s+/g, " ").trim().slice(0, 200)}\nhttps://discord.com/events/${event.guild_id}/${event.id}` });
  }
  return merged.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 50);
}

export async function discordCalendarEvents(client: Client | undefined, guildDiscordId: string, memberDiscordId: string): Promise<APIGuildScheduledEvent[]> {
  if (!client) return [];
  const events = await client.rest.get(Routes.guildScheduledEvents(guildDiscordId)) as APIGuildScheduledEvent[];
  const guild = await client.guilds.fetch(guildDiscordId);
  const member = await guild.members.fetch({ user: memberDiscordId, force: true });
  // The bot can see private events that the paired member cannot. A bot-wide
  // REST response must never become a private gaming calendar in another addon.
  const visibility = new Map<string, Promise<boolean>>();
  const visible = await Promise.all(events.map(async event => {
    if (event.guild_id !== guildDiscordId) return false;
    if (!event.channel_id) return true;
    if (!visibility.has(event.channel_id)) visibility.set(event.channel_id, guild.channels.fetch(event.channel_id).then(channel =>
      !!channel?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)));
    return await visibility.get(event.channel_id)!;
  }));
  return events.filter((_event, index) => visible[index]);
}
