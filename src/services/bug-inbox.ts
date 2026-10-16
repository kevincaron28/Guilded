import type { PrismaClient } from "@prisma/client";
import { reportRef } from "./error-report.js";

// The developer's bug inbox (npm run bugs): open /report bug reports from every guild, and the bot's own
// failures grouped by cause, written as one Markdown file a person or an agent can work from.
// Fixed items are marked resolved and drop out of the next inbox.

type Db = Pick<PrismaClient, "errorReport" | "guild">;
type Row = { id: string; source: string; guildId: string | null; userId: string | null; message: string; stack: string | null; context: string | null; version: string | null; createdAt: Date };

export interface InboxBug { ref: string; at: Date; guild: string; version: string | null; userId: string | null; description: string; screenshot: string | null }
export interface InboxError { ref: string; source: string; message: string; count: number; first: Date; last: Date; versions: string[]; guilds: string[]; stack: string | null }
export interface Inbox { since: Date; bugs: InboxBug[]; errors: InboxError[] }

const groupKey = (row: Pick<Row, "source" | "message">) => `${row.source}\u0000${row.message.slice(0, 200)}`;

export async function loadInbox(database: Db, options: { days?: number; now?: Date } = {}): Promise<Inbox> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.days ?? 30) * 86_400_000);
  const rows: Row[] = await database.errorReport.findMany({
    where: { createdAt: { gte: since }, resolvedAt: null },
    orderBy: { createdAt: "desc" },
    take: 1_000,
    select: { id: true, source: true, guildId: true, userId: true, message: true, stack: true, context: true, version: true, createdAt: true }
  });
  const ids = [...new Set(rows.map((row) => row.guildId).filter((id): id is string => !!id))];
  const names = new Map((ids.length ? await database.guild.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, name: true } }) : [])
    .map((guild) => [guild.discordId, guild.name]));
  const guildLabel = (id: string | null) => (id ? `${names.get(id) ?? "unknown server"} (${id})` : "no server");

  const bugs = rows.filter((row) => row.source === "bug-report").map((row) => ({
    ref: reportRef(row.id), at: row.createdAt, guild: guildLabel(row.guildId), version: row.version,
    userId: row.userId, description: row.message, screenshot: row.context
  }));
  const groups = new Map<string, InboxError>();
  for (const row of rows.filter((r) => r.source !== "bug-report")) {
    const key = groupKey(row);
    const group = groups.get(key);
    if (!group) {
      // Rows come newest first: the first one seen is the latest, so its stack is the freshest.
      groups.set(key, { ref: reportRef(row.id), source: row.source, message: row.message, count: 1, first: row.createdAt, last: row.createdAt,
        versions: row.version ? [row.version] : [], guilds: [guildLabel(row.guildId)], stack: row.stack });
      continue;
    }
    group.count++;
    group.first = row.createdAt;
    if (row.version && !group.versions.includes(row.version)) group.versions.push(row.version);
    const label = guildLabel(row.guildId);
    if (!group.guilds.includes(label)) group.guilds.push(label);
  }
  const errors = [...groups.values()].sort((a, b) => b.count - a.count || b.last.getTime() - a.last.getTime());
  return { since, bugs, errors };
}

const day = (date: Date) => date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
const quote = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");

export function renderInbox(inbox: Inbox): string {
  const out = [
    "# Guilded bug inbox",
    "",
    `Open items since ${day(inbox.since)}: ${inbox.bugs.length} bug report(s), ${inbox.errors.length} kind(s) of bot error.`,
    "Mark fixed ones with `npm run bugs -- resolve REF [REF...] --note \"what changed\"`.",
    "This file holds members' Discord IDs and messages: keep it private (it is not committed).",
    "",
    "## Bug reports from members (/report bug)",
    ""
  ];
  if (!inbox.bugs.length) out.push("None open.", "");
  for (const bug of inbox.bugs) {
    out.push(`### ${bug.ref} · ${day(bug.at)}`, "", `- Server: ${bug.guild}`, `- Bot version: ${bug.version ?? "unknown"}`, `- Reporter: ${bug.userId ? `Discord user ${bug.userId}` : "unknown"}`);
    if (bug.screenshot) out.push(`- Screenshot: ${bug.screenshot}`);
    out.push("", quote(bug.description), "");
  }
  out.push("## Bot errors (grouped by cause, most frequent first)", "");
  if (!inbox.errors.length) out.push("None open.", "");
  for (const error of inbox.errors) {
    out.push(`### ${error.ref} · ${error.source} · ${error.count}×`, "",
      `- First ${day(error.first)}, last ${day(error.last)}`,
      `- Versions: ${error.versions.join(", ") || "unknown"}`,
      `- Servers: ${error.guilds.join("; ")}`, "", quote(error.message), "");
    if (error.stack) out.push("```", error.stack.slice(0, 1500), "```", "");
  }
  return out.join("\n");
}

// Marks reports fixed by their short reference. An error's reference resolves every open report
// of the same cause, so the whole group leaves the inbox. Returns how many reports changed.
export async function resolveReports(database: Pick<PrismaClient, "errorReport">, refs: string[], note: string | null, now = new Date()): Promise<number> {
  let changed = 0;
  for (const ref of refs) {
    if (!/^[A-Za-z0-9]{6,32}$/.test(ref)) throw new Error(`Not a report reference: ${ref}`);
    const row = await database.errorReport.findFirst({ where: { id: { endsWith: ref.toLowerCase() }, resolvedAt: null }, select: { source: true, message: true } });
    if (!row) throw new Error(`No open report ${ref.toUpperCase()} (already resolved, or older than the retention period).`);
    const data = { resolvedAt: now, resolution: note?.slice(0, 500) ?? null };
    const where = row.source === "bug-report"
      ? { id: { endsWith: ref.toLowerCase() }, resolvedAt: null }
      : { source: row.source, message: { startsWith: row.message.slice(0, 200) }, resolvedAt: null };
    changed += (await database.errorReport.updateMany({ where, data })).count;
  }
  return changed;
}
