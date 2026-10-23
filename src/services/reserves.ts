import type { Prisma, PrismaClient } from "@prisma/client";
import type { AddonReserves } from "../integrations/addon.js";

// Soft reserves: the list lives in the addon (/guilded reserve) and reaches Discord with
// the companion's export. The newest export wins and replaces the whole list.

type Tx = Pick<Prisma.TransactionClient, "reserveList" | "itemReserve">;
type Db = Pick<PrismaClient, "reserveList" | "itemReserve">;

export async function applyReserves(tx: Tx, guildId: string, reserves: AddonReserves | undefined): Promise<{ applied: boolean; entries: number }> {
  if (!reserves) return { applied: false, entries: 0 };
  const existing = await tx.reserveList.findUnique({ where: { guildId } });
  if (existing && existing.syncedAt >= reserves.at) return { applied: false, entries: 0 };
  const entries = reserves.active ? reserves.entries : [];
  const data = {
    title: reserves.title.trim().slice(0, 100), perPlayer: reserves.limit, open: reserves.open && reserves.active,
    active: reserves.active, keeper: reserves.by.trim().slice(0, 40), syncedAt: reserves.at
  };
  await tx.reserveList.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
  await tx.itemReserve.deleteMany({ where: { guildId } });
  if (entries.length > 0) {
    await tx.itemReserve.createMany({
      data: entries.map((entry) => ({
        guildId, character: entry.character.trim(), realm: entry.realm.trim(), itemId: entry.itemId, itemName: entry.itemName.trim()
      })),
      skipDuplicates: true
    });
  }
  return { applied: true, entries: entries.length };
}

function ago(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

// The list as a Discord message: a line per item with who reserved it. `query` narrows
// it to items whose name contains the text, or to one character's reserves.
export async function describeReserves(database: Db, guildId: string, query?: string, now = new Date()): Promise<string> {
  const list = await database.reserveList.findUnique({ where: { guildId } });
  if (!list || !list.active) {
    return "No soft-reserve list is open. An officer starts one in game with `/guilded reserve open`; it reaches Discord when the companion uploads.";
  }
  const rows = await database.itemReserve.findMany({ where: { guildId }, orderBy: [{ itemName: "asc" }, { character: "asc" }] });
  const needle = query?.trim().toLowerCase();
  const shown = needle ? rows.filter((row) => row.itemName.toLowerCase().includes(needle) || row.character.toLowerCase() === needle) : rows;
  const head = `**Soft reserves**${list.title ? ` — ${list.title}` : ""} · ${list.perPlayer} per player · ${list.open ? "open" : "locked"}${list.keeper ? ` · kept by ${list.keeper}` : ""} · synced ${ago(list.syncedAt, now)}`;
  if (shown.length === 0) return `${head}\n${needle ? `Nothing matches "${query!.trim()}".` : "Nobody has reserved yet."}`;
  const byItem = new Map<number, { name: string; who: string[] }>();
  for (const row of shown) {
    const entry = byItem.get(row.itemId) ?? { name: row.itemName, who: [] };
    entry.who.push(row.character);
    byItem.set(row.itemId, entry);
  }
  const lines = [...byItem.values()].map((entry) => `• **${entry.name}** — ${entry.who.join(", ")}`);
  const text = `${head}\n${lines.join("\n")}`;
  if (text.length <= 1900) return text;
  let used = head.length;
  const kept: string[] = [];
  for (const line of lines) {
    if (used + line.length + 1 > 1850) break;
    kept.push(line);
    used += line.length + 1;
  }
  return `${head}\n${kept.join("\n")}\n…and ${lines.length - kept.length} more item(s). Add an item name to narrow it down.`;
}
