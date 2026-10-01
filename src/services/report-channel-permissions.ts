import { PermissionFlagsBits as F } from "discord.js";

type Overwrite = { id: string; type?: 0 | 1; allow: bigint; deny: bigint };
const POSTING = F.SendMessages | F.SendMessagesInThreads | F.CreatePublicThreads | F.CreatePrivateThreads;

// Preserve the game's visibility gate while making the report a read-only board.
export function reportChannelOverwrites(source: Overwrite[], everyoneId: string, writerIds: string[]): Overwrite[] {
  const entries = new Map(source.map(entry => [entry.id, { ...entry, allow: entry.allow & ~POSTING }]));
  const everyone = entries.get(everyoneId) ?? { id: everyoneId, type: 0, allow: 0n, deny: 0n };
  entries.set(everyoneId, { ...everyone, deny: everyone.deny | POSTING });
  for (const id of writerIds) {
    const entry = entries.get(id) ?? { id, allow: 0n, deny: 0n };
    entries.set(id, { ...entry, allow: entry.allow | F.SendMessages, deny: entry.deny & ~F.SendMessages });
  }
  return [...entries.values()];
}
