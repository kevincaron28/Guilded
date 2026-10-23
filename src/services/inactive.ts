import type { PrismaClient } from "@prisma/client";

// Members nobody has seen in game for a while. Read-only: this only reports,
// it never removes anyone (kicking stays a human decision).

export interface InactiveRow {
  member: string;
  main: string | null;
  lastSeen: Date | null;
  joined: Date;
  characters: number;
}

type Db = Pick<PrismaClient, "member">;

// `lastSeenAt` comes from addon imports (a character seen in a raid group or
// a gear check). Members who joined less than `days` ago are not judged, and
// members with characters but no sighting at all are listed as "never seen".
export async function findInactive(database: Db, guildId: string, days: number, now = new Date()): Promise<InactiveRow[]> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const members = await database.member.findMany({
    where: { guildId, status: "ACTIVE", isTest: false, createdAt: { lt: cutoff } },
    include: { characters: { select: { name: true, isMain: true, lastSeenAt: true } } },
    orderBy: { displayName: "asc" }
  });
  const rows: InactiveRow[] = [];
  for (const member of members) {
    const seen = member.characters.map((character) => character.lastSeenAt).filter((date): date is Date => date !== null);
    const lastSeen = seen.length ? new Date(Math.max(...seen.map((date) => date.getTime()))) : null;
    if (lastSeen && lastSeen >= cutoff) continue;
    const main = member.characters.find((character) => character.isMain) ?? member.characters[0];
    rows.push({ member: member.displayName, main: main?.name ?? null, lastSeen, joined: member.createdAt, characters: member.characters.length });
  }
  // Longest gone first; never-seen last (their data may just be missing).
  return rows.sort((a, b) => (a.lastSeen?.getTime() ?? Infinity) - (b.lastSeen?.getTime() ?? Infinity));
}

export function formatInactive(rows: InactiveRow[], days: number): string {
  if (rows.length === 0) return `Everyone has been seen in the last ${days} days. 🎉`;
  const lines = rows.slice(0, 40).map((row) => {
    const seen = row.lastSeen ? `last seen <t:${Math.floor(row.lastSeen.getTime() / 1000)}:R>` : row.characters ? "never seen in game (no addon data yet)" : "no character linked";
    return `• **${row.member}**${row.main ? ` (${row.main})` : ""} — ${seen}`;
  });
  return `**Not seen in ${days}+ days** (${rows.length}): read-only, nobody was changed.\n${lines.join("\n")}${rows.length > 40 ? `\n…and ${rows.length - 40} more.` : ""}`;
}
