import type { PrismaClient } from "../generated/prisma/client.js";

/**
 * Class by character name, for leaderboards whose rows only carry a name (duels, battlegrounds, dungeon season): lowercase full
 * name and lowercase first name both map to the class. Linked characters win over unclaimed ones; an ambiguous first name (two
 * classes) is dropped rather than guessed.
 */
export type ClassBook = ReadonlyMap<string, string>;

export function buildClassBook(rows: readonly { name: string; displayName?: string | null; className: string | null }[]): ClassBook {
  const book = new Map<string, string>(), ambiguous = new Set<string>();
  for (const row of rows) {
    if (!row.className) continue;
    for (const raw of [row.displayName, row.name]) {
      const full = (raw ?? "").trim().toLowerCase();
      if (!full) continue;
      if (!book.has(full)) book.set(full, row.className);
      const first = full.split(/\s+/)[0]!;
      if (first === full) continue;
      if (book.has(first) && book.get(first) !== row.className) ambiguous.add(first);
      else if (!book.has(first)) book.set(first, row.className);
    }
  }
  for (const first of ambiguous) book.delete(first);
  return book;
}

/** The class for a shown name (full name first, then its first word); undefined when the guild does not know it. */
export const classOf = (book: ClassBook, name: string): string | undefined => {
  const key = name.trim().toLowerCase();
  return book.get(key) ?? book.get(key.split(/\s+/)[0] ?? "");
};

export async function loadClassBook(db: Pick<PrismaClient, "character" | "unclaimedCharacter">, guildId: string): Promise<ClassBook> {
  const [linked, unclaimed] = await Promise.all([
    db.character.findMany({ where: { guildId }, select: { name: true, displayName: true, className: true } }),
    db.unclaimedCharacter.findMany({ where: { guildId }, select: { name: true, displayName: true, className: true } })
  ]);
  return buildClassBook([...linked, ...unclaimed]);
}
