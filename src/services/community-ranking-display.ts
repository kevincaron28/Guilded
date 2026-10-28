import { escapeMarkdown, type Guild } from 'discord.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Lang } from '../i18n.js';
import { discordNames } from './community-honors.js';
import type { Standing } from './community-rules.js';

// A mobile reader may never have loaded the ranked members. Resolve names on
// the server so the full list works without Discord's per-device mention cache.
export async function communityRankingLines(database: PrismaClient, guild: Guild, guildId: string,
  board: Standing[], rows: Standing[], lang: Lang): Promise<string> {
  if (!rows.length) return lang === 'fr' ? 'Aucun point pour le moment.' : 'No points yet.';
  const names = await discordNames(guild)(rows.map(row => row.userId));
  const missing = rows.filter(row => !names.has(row.userId)).map(row => row.userId);
  const resolved = new Map(names);
  if (missing.length) {
    const saved = await database.member.findMany({ where: { guildId, discordUserId: { in: missing } },
      select: { discordUserId: true, displayName: true } });
    for (const member of saved) resolved.set(member.discordUserId, member.displayName);
  }
  return rows.map(row => {
    const rank = 1 + board.filter(other => other.points > row.points).length;
    const fallback = `${lang === 'fr' ? 'Membre' : 'Member'} …${row.userId.slice(-4)}`;
    const name = (resolved.get(row.userId) || fallback).replace(/[\r\n]/g, ' ').slice(0, 32)
      .replace(/@/g, '@\u200b').replace(/</g, '‹');
    return `${rank}. **${escapeMarkdown(name)}** · ${row.points} pts`;
  }).join('\n');
}
