import type { PrismaClient } from "../generated/prisma/client.js";
import { sanitizeProbes } from "../../companion/probes-content.mjs";

// Client probes uploaded by companions (docs/plans/AH_ACHIEVEMENTS.md): the latest result per kind, client build and edition.
// The companion sanitizes before sending and the bot does it again; a hostile body can only ever store small, name-free JSON.

export const PROBE_EDITION = "forever";
/** Probe kinds stored per upload are capped inside sanitizeProbes; the builds kept per kind are capped here. */
export const MAX_BUILDS_PER_KIND = 12;

type ProbeStore = Pick<PrismaClient, "clientProbe">;

const text = (value: unknown, max: number): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** Stores the probes of one upload (any shape is accepted: junk is dropped). Returns how many probe rows were written. */
export async function storeClientProbes(store: ProbeStore, raw: unknown, companionVersion: string | null = null): Promise<number> {
  const probes = sanitizeProbes(raw) as Record<string, Record<string, unknown>>;
  let written = 0;
  for (const [kind, data] of Object.entries(probes)) {
    const build = typeof data["build"] === "number" && Number.isSafeInteger(data["build"]) && data["build"] >= 0 ? String(data["build"]) : "unknown";
    const at = typeof data["at"] === "number" && Number.isFinite(data["at"]) && data["at"] > 1_000_000_000 ? new Date(data["at"] * 1000) : null;
    const probedAt = at && Number.isFinite(at.getTime()) ? at : null;
    const version = text(companionVersion, 32);
    const where = { kind_build_edition: { kind, build, edition: PROBE_EDITION } };
    const existing = await store.clientProbe.findUnique({ where, select: { probedAt: true } });
    // An older probe never replaces a newer one for the same build (a stale saved file uploaded late).
    if (existing?.probedAt && probedAt && existing.probedAt.getTime() > probedAt.getTime()) continue;
    if (!existing) {
      const builds = await store.clientProbe.count({ where: { kind, edition: PROBE_EDITION } });
      if (builds >= MAX_BUILDS_PER_KIND) continue;
    }
    await store.clientProbe.upsert({ where, create: { kind, build, edition: PROBE_EDITION, data: data as never, probedAt, companionVersion: version }, update: { data: data as never, probedAt, companionVersion: version } });
    written += 1;
  }
  return written;
}

export interface ProbeSummary { kind: string; build: string; edition: string; probedAt: Date | null; receivedAt: Date; companionVersion: string | null; data: unknown }

/** The latest stored probe per kind and build, newest first; `kind` narrows to one kind. */
export async function latestClientProbes(store: ProbeStore, kind?: string): Promise<ProbeSummary[]> {
  const rows = await store.clientProbe.findMany({ where: kind ? { kind } : {}, orderBy: { updatedAt: "desc" }, take: 60 });
  return rows.map((row) => ({ kind: row.kind, build: row.build, edition: row.edition, probedAt: row.probedAt, receivedAt: row.updatedAt, companionVersion: row.companionVersion, data: row.data }));
}

const stamp = (date: Date | null) => (date ? `<t:${Math.floor(date.getTime() / 1000)}:f>` : "unknown time");

/** One short line per probe for the list view. */
export function probeLine(summary: ProbeSummary): string {
  return `**${summary.kind}** - build ${summary.build} (${summary.edition}), probed ${stamp(summary.probedAt)}, received ${stamp(summary.receivedAt)}${summary.companionVersion ? `, companion ${summary.companionVersion}` : ""}`;
}

/** The probe's data as a code block that fits one Discord message (cut with a note when longer). */
export function probeDetail(summary: ProbeSummary, limit = 1700): string {
  const json = JSON.stringify(summary.data, null, 1);
  const body = json.length > limit ? `${json.slice(0, limit)}\n... (cut: ${json.length} characters)` : json;
  return `${probeLine(summary)}\n\`\`\`json\n${body}\n\`\`\``;
}
