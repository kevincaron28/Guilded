import type { PrismaClient } from "../generated/prisma/client.js";
import { reportRef } from "./error-report.js";
import { decodeReportOrigin, reportSourceLink } from "./report-context.js";

// The developer's bug inbox (npm run bugs): open /report bug reports from every guild, and the bot's own
// failures grouped by cause, written as one Markdown file a person or an agent can work from.
// Fixed items are marked resolved and drop out of the next inbox.

type Db = Pick<PrismaClient, "errorReport" | "guild">;
type Row = { id: string; source: string; guildId: string | null; userId: string | null; message: string; stack: string | null; context: string | null; version: string | null; createdAt: Date };

export interface InboxBug { ref: string; at: Date; guild: string; version: string | null; userId: string | null; description: string; screenshot: string | null; sourceLink: string | null }
export interface InboxError { ref: string; source: string; message: string; count: number; first: Date; last: Date; versions: string[]; guilds: string[]; stack: string | null; origins: string[] }
export interface Inbox { since: Date; bugs: InboxBug[]; errors: InboxError[]; truncated?: { bugs: boolean; errors: boolean } }

const groupKey = (row: Pick<Row, "source" | "message">) => `${row.source}\u0000${row.message.slice(0, 200)}`;

export async function loadInbox(database: Db, options: { days?: number; now?: Date } = {}): Promise<Inbox> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.days ?? 30) * 86_400_000);
  // Separate budgets keep service-error bursts from hiding player submissions.
  // One extra row detects truncation without loading the entire incident history.
  const limit = 1_000;
  const read = (source: string | { not: string }) => database.errorReport.findMany({
    where: { createdAt: { gte: since }, resolvedAt: null, source },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: { id: true, source: true, guildId: true, userId: true, message: true, stack: true, context: true, version: true, createdAt: true }
  });
  const bugRows = await read("bug-report");
  const errorRows = await read({ not: "bug-report" });
  const truncated = { bugs: bugRows.length > limit, errors: errorRows.length > limit };
  const rows: Row[] = [...bugRows.slice(0, limit), ...errorRows.slice(0, limit)];
  const ids = [...new Set(rows.map((row) => row.guildId).filter((id): id is string => !!id))];
  const names = new Map((ids.length ? await database.guild.findMany({ where: { discordId: { in: ids } }, select: { discordId: true, name: true } }) : [])
    .map((guild) => [guild.discordId, guild.name]));
  const guildLabel = (id: string | null) => (id ? `${names.get(id) ?? "unknown server"} (${id})` : "unknown source server");

  const bugs = rows.filter((row) => row.source === "bug-report").map((row) => ({
    ref: reportRef(row.id), at: row.createdAt, guild: guildLabel(row.guildId), version: row.version,
    userId: row.userId, description: row.message, screenshot: decodeReportOrigin(row.context).extra,
    sourceLink: reportSourceLink(row.guildId, decodeReportOrigin(row.context))
  }));
  const groups = new Map<string, InboxError>();
  for (const row of rows.filter((r) => r.source !== "bug-report")) {
    const key = groupKey(row);
    const origin = decodeReportOrigin(row.context);
    const label = `${origin.operation ?? row.source} · ${reportSourceLink(row.guildId, origin) ?? "source channel/message not recorded"}`;
    const group = groups.get(key);
    if (!group) {
      // Rows come newest first: the first one seen is the latest, so its stack is the freshest.
      groups.set(key, { ref: reportRef(row.id), source: row.source, message: row.message, count: 1, first: row.createdAt, last: row.createdAt,
        versions: row.version ? [row.version] : [], guilds: [guildLabel(row.guildId)], stack: row.stack, origins: [label] });
      continue;
    }
    group.count++;
    group.first = row.createdAt;
    if (row.version && !group.versions.includes(row.version)) group.versions.push(row.version);
    const guild = guildLabel(row.guildId);
    if (!group.guilds.includes(guild)) group.guilds.push(guild);
    if (!group.origins.includes(label)) group.origins.push(label);
  }
  const errors = [...groups.values()].sort((a, b) => b.count - a.count || b.last.getTime() - a.last.getTime());
  return { since, bugs, errors, truncated };
}

const day = (date: Date) => date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
const quote = (text: string) => text.split("\n").map((line) => `> ${line}`).join("\n");

export function renderInbox(inbox: Inbox): string {
  const out = [
    "# Guilded bug inbox",
    "",
    `Displayed open items since ${day(inbox.since)}: ${inbox.bugs.length} bug report(s), ${inbox.errors.length} kind(s) of bot error.`,
    "Mark fixed ones with `npm run bugs -- resolve REF [REF...] --note \"what changed\"`.",
    "This file holds members' Discord IDs and messages: keep it private (it is not committed).",
    "",
    ...(inbox.truncated?.bugs || inbox.truncated?.errors ? [
      "WARNING: This inbox is incomplete. Only the newest 1,000 rows per category are displayed.",
      ...(inbox.truncated.bugs ? ["Older member reports are omitted; do not treat this list as the full player backlog."] : []),
      ...(inbox.truncated.errors ? ["Older automatic errors are omitted; displayed counts and first-seen times cover this sample only."] : []),
      "Resolve verified fixes, then refresh to reveal older open items. Do not bulk-resolve unverified reports.",
      ""
    ] : []),
    "## Bug reports from members (/report bug)",
    ""
  ];
  if (!inbox.bugs.length) out.push("None open.", "");
  for (const bug of inbox.bugs) {
    out.push(`### ${bug.ref} · ${day(bug.at)}`, "", `- Server: ${bug.guild}`, `- Bot version: ${bug.version ?? "unknown"}`, `- Reporter: ${bug.userId ? `Discord user ${bug.userId}` : "unknown"}`);
    if (bug.screenshot) out.push(`- Screenshot: ${bug.screenshot}`);
    if (bug.sourceLink) out.push(`- Source: ${bug.sourceLink}`);
    out.push("", quote(bug.description), "");
  }
  out.push("## Bot errors (grouped by cause, most frequent first)", "");
  if (!inbox.errors.length) out.push("None open.", "");
  for (const error of inbox.errors) {
    out.push(`### ${error.ref} · ${error.source} · ${error.count}×`, "",
      `- First ${day(error.first)}, last ${day(error.last)}`,
      `- Versions: ${error.versions.join(", ") || "unknown"}`,
      `- Servers: ${error.guilds.join("; ")}`, `- Origins: ${error.origins.join("; ")}`, "", quote(error.message), "");
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
