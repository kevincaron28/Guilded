import type { Guild } from "discord.js";
import { drawable, type ScoreCard } from "./score-card.js";

const MAX_AVATAR_BYTES = 1_000_000;

/**
 * Adds a member's server look to a card at delivery: their server display name, Discord avatar and highest role
 * (name and colour). Best effort: any failure (member left, Discord or CDN unreachable) returns the card unchanged.
 * The stored card definition never holds the image, only what this adds in memory.
 */
export async function withDiscordMember(guild: Guild, card: ScoreCard, userId: string, fetchImage: (url: string) => Promise<Buffer | null> = downloadImage): Promise<ScoreCard> {
  try {
    const member = await guild.members.fetch(userId);
    const url = member.displayAvatarURL({ extension: "png", size: 128, forceStatic: true });
    const image = await fetchImage(url).catch(() => null);
    const role = member.roles.highest;
    const rank = role && role.id !== guild.id ? { label: role.name, color: role.color ? role.hexColor : "#b9a77f" } : undefined;
    return { ...card, title: drawable(member.displayName) ? member.displayName : member.user?.username || card.title, ...(image ? { portrait: image.toString("base64") } : {}), ...(rank ? { rank } : {}) };
  } catch { return card; }
}

async function downloadImage(url: string): Promise<Buffer | null> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "cdn.discordapp.com") return null;
  const response = await fetch(parsed, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length <= MAX_AVATAR_BYTES ? bytes : null;
}
