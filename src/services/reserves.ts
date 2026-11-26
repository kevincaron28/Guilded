import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { AddonReserves } from "../integrations/addon.js";
import { pendingReserveRequests, settleReserveRequests } from "./reserve-requests.js";
import { tx as translate, type Lang } from "../i18n.js";

// Soft reserves: the list lives in the addon (/guilded reserve) and reaches Discord with
// the companion's export. The newest export wins and replaces the whole list.

type Tx = Pick<Prisma.TransactionClient, "reserveList" | "itemReserve"> & Partial<Pick<Prisma.TransactionClient, "reserveRequest">>;
type Db = Pick<PrismaClient, "reserveList" | "itemReserve"> & Partial<Pick<PrismaClient, "reserveRequest">>;

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
  // What the game now shows settles the Discord and phone requests.
  if (tx.reserveRequest) await settleReserveRequests({ reserveRequest: tx.reserveRequest }, guildId, reserves);
  return { applied: true, entries: entries.length };
}

function ago(lang: Lang, from: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return translate(lang, "{count} min ago", { count: minutes });
  if (minutes < 60 * 48) return translate(lang, "{count} h ago", { count: Math.round(minutes / 60) });
  return translate(lang, "{count} days ago", { count: Math.round(minutes / 1440) });
}

// The list as a Discord message: a line per item with who reserved it, then what is still waiting for
// the loot keeper's game. `query` narrows it to items whose name contains the text, or to one character.
export async function describeReserves(database: Db, guildId: string, query?: string, now = new Date(), lang: Lang = "en"): Promise<string> {
  const T = (english: string, values?: Record<string, string | number>) => translate(lang, english, values);
  const list = await database.reserveList.findUnique({ where: { guildId } });
  if (!list || !list.active) {
    return T("No soft-reserve list is open. An officer starts one in game with `/guilded reserve open`; it reaches Discord when the companion uploads.");
  }
  const rows = await database.itemReserve.findMany({ where: { guildId }, orderBy: [{ itemName: "asc" }, { character: "asc" }] });
  const needle = query?.trim().toLowerCase();
  const matches = (row: { itemName: string; character: string }) => !needle || row.itemName.toLowerCase().includes(needle) || row.character.toLowerCase() === needle;
  const shown = rows.filter(matches);
  const requests = database.reserveRequest ? (await pendingReserveRequests({ reserveList: database.reserveList, reserveRequest: database.reserveRequest }, guildId, now)).filter(matches) : [];
  const head = [`**${T("Soft reserves")}**${list.title ? ` — ${list.title}` : ""}`, T("{count} per player", { count: list.perPlayer }), list.open ? T("open") : T("locked"),
    ...(list.keeper ? [T("kept by {name}", { name: list.keeper })] : []), T("synced {when}", { when: ago(lang, list.syncedAt, now) })].join(" · ");
  const waiting = requests.length ? [`**${T("Waiting for the loot keeper's /reload")}**`,
    ...requests.map((row) => `• ${row.remove ? `${T("Remove")}: ` : ""}**${row.itemName}** — ${row.character}`)] : [];
  if (shown.length === 0 && !waiting.length) return `${head}\n${needle ? T("Nothing matches \"{query}\".", { query: query!.trim() }) : T("Nobody has reserved yet.")}`;
  const byItem = new Map<number, { name: string; who: string[] }>();
  for (const row of shown) {
    const entry = byItem.get(row.itemId) ?? { name: row.itemName, who: [] };
    entry.who.push(row.character);
    byItem.set(row.itemId, entry);
  }
  const lines = [...[...byItem.values()].map((entry) => `• **${entry.name}** — ${entry.who.join(", ")}`), ...waiting];
  const text = `${head}\n${lines.join("\n")}`;
  if (text.length <= 1900) return text;
  let used = head.length;
  const kept: string[] = [];
  for (const line of lines) {
    if (used + line.length + 1 > 1800) break;
    kept.push(line);
    used += line.length + 1;
  }
  return `${head}\n${kept.join("\n")}\n${T("…and {count} more item(s). Add an item name to narrow it down.", { count: lines.length - kept.length })}`;
}
