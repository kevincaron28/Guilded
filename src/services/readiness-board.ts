import { escapeMarkdown, type Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../database.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob } from "./discord-jobs.js";
import { participationDay } from "./participation-rules.js";

import { assessRaidReadiness, raidLevel, type RaidReadinessStatus } from "./readiness.js";

const guildService = createGuildService(prisma);

type Db = Pick<PrismaClient, "member" | "inspectedCharacterSnapshot"> & Partial<Pick<PrismaClient, "consumableCheck" | "characterAttunement">>;

// A scan older than this is stale (flasks last about two hours).
export const CONSUMABLE_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const ICON: Record<RaidReadinessStatus, string> = { READY: "✅", PARTIAL: "⚠️", NOT_READY: "❌", LEVELLING: "🌱", UNKNOWN: "❔" };
const LABEL: Record<RaidReadinessStatus, string> = { READY: "Gear ready", PARTIAL: "Needs attention", NOT_READY: "Not ready", LEVELLING: "Levelling", UNKNOWN: "Needs sync" };
const safe = (text: string) => escapeMarkdown(text.replace(/[\r\n]/g, " ").slice(0, 160));

export interface BoardOptions {
  attunement?: string | undefined;
  now?: Date;
}

// Latest uploaded character per active member. Gear readiness is distinct
// from level eligibility and from attunements/consumables not checked here.
export async function buildReadinessLines(database: Db, guildId: string, options: BoardOptions = {}): Promise<string[]> {
  const members = await database.member.findMany({ where: { guildId, status: "ACTIVE", isTest: false }, orderBy: { displayName: "asc" } });
  if (!members.length) return [];
  const rows: { name: string; status: RaidReadinessStatus; text: string }[] = [];
  const noData: string[] = [];
  for (const member of members) {
    const snapshot = await database.inspectedCharacterSnapshot.findFirst({
      where: { memberId: member.id }, orderBy: { inspectedAt: "desc" }, include: { findings: true, character: true }
    });
    if (!snapshot) { noData.push(safe(member.displayName)); continue; }
    const assessment = assessRaidReadiness(snapshot, options.now);
    let status = assessment.status;
    const messages = assessment.reason ? [assessment.reason] : snapshot.findings.filter(f => f.severity !== "INFO").map(f => f.message);
    if (options.attunement && status !== "LEVELLING" && status !== "UNKNOWN") {
      const attuned = await database.characterAttunement?.findFirst({
        where: { characterId: snapshot.characterId, completed: true, name: { equals: options.attunement, mode: "insensitive" } }
      });
      if (!database.characterAttunement) { messages.unshift("Attunement could not be verified."); status = "UNKNOWN"; }
      else if (!attuned) { messages.unshift(`Not attuned: ${options.attunement}.`); status = "NOT_READY"; }
    }
    const level = snapshot.character.level;
    const details = status === "LEVELLING" ? "" : `${level ? ` · lvl ${level}` : ""}${snapshot.character.className ? ` ${safe(snapshot.character.className)}` : ""}`;
    const ilvl = status !== "LEVELLING" && status !== "UNKNOWN" && snapshot.itemLevel && Number.isFinite(snapshot.itemLevel) ? ` · ilvl ${snapshot.itemLevel}` : "";
    const checked = Number.isFinite(snapshot.inspectedAt.getTime()) ? ` · checked <t:${Math.floor(snapshot.inspectedAt.getTime() / 1000)}:R>` : "";
    const head = `${ICON[status]} **${safe(snapshot.character.name)}** — ${LABEL[status]}${details}${ilvl}${checked}`;
    const shown = messages.map(message => `  • ${safe(message)}`);
    rows.push({ name: snapshot.character.name, status, text: [head, ...shown].join("\n") });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const count = (status: RaidReadinessStatus) => rows.filter(row => row.status === status).length;
  const summary = `**${count("READY")} gear ready · ${count("PARTIAL") + count("NOT_READY")} need attention · ${count("LEVELLING")} levelling · ${count("UNKNOWN") + noData.length} need sync**`;
  const lines = [summary, `Level ${raidLevel()} required · latest uploaded character per member · gear checks valid for 24h.`,
    options.attunement ? `Target attunement: **${safe(options.attunement)}**.` : "Attunements are not checked unless a target is selected; consumables are listed separately when scanned."];
  for (const [title, statuses] of [
    ["Raid candidates — action needed", ["NOT_READY", "PARTIAL"]],
    ["Raid candidates — gear ready", ["READY"]],
    ["Levelling — not raid eligible", ["LEVELLING"]],
    ["Needs a fresh check", ["UNKNOWN"]]
  ] as [string, RaidReadinessStatus[]][]) {
    const group = rows.filter(row => statuses.includes(row.status));
    if (group.length) lines.push(`\n**${title} (${group.length})**`, ...group.map(row => row.text));
  }
  if (noData.length) lines.push(`\n**No gear check uploaded (${noData.length})**`, noData.join(", "));
  if (noData.length || count("UNKNOWN")) lines.push("Refresh: run `/guilded inspect`, then `/reload` in WoW with the companion running.");
  return lines;
}

// "Consumables (scanned 12 min ago)": who lacks a flask/elixir or food in the
// latest group scan. Empty when there is no fresh scan.
export async function buildConsumableLines(database: Db, guildId: string, now = new Date()): Promise<string[]> {
  if (!database.consumableCheck) return [];
  const rows = await database.consumableCheck.findMany({
    where: { guildId, scannedAt: { gte: new Date(now.getTime() - CONSUMABLE_MAX_AGE_MS) } },
    orderBy: { character: "asc" }
  });
  if (rows.length === 0) return [];
  const newest = rows.reduce((latest, row) => (row.scannedAt > latest ? row.scannedAt : latest), rows[0]!.scannedAt);
  const minutes = Math.max(0, Math.round((now.getTime() - newest.getTime()) / 60_000));
  const noFlask = rows.filter((row) => !row.flask && row.elixirs.length === 0).map((row) => row.character);
  const noFood = rows.filter((row) => !row.food).map((row) => row.character);
  return [
    `🧪 **Consumables** — ${rows.length} scanned ${minutes} min ago`,
    `   No flask/elixir: ${noFlask.length ? noFlask.join(", ") : "nobody ✅"}`,
    `   No food: ${noFood.length ? noFood.join(", ") : "nobody ✅"}`
  ];
}

// Packs lines into messages under Discord's 2000-character limit.
export function chunkLines(lines: string[], limit = 1900): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > limit) { chunks.push(current); current = ""; }
    let rest = line;
    while (rest.length > limit) { chunks.push(rest.slice(0, limit)); rest = rest.slice(limit); }
    current = current ? `${current}\n${rest}` : rest;
  }
  if (current) chunks.push(current);
  return chunks;
}

// One durable job per guild-local day. Imports never reset a completed job or
// its retry lease, including concurrent imports and bot restarts.
export async function queueDailyReadiness(database: Pick<PrismaClient, "discordJob">, guildId: string,
  timezone: string, lines: string[], now = new Date()) {
  const day = participationDay(now, timezone);
  const chunks = chunkLines(lines.length ? lines : ["No guild members found."], 3600);
  const description = `${chunks[0]!}${chunks.length > 1 ? "\n\n… More members in the full report." : ""}`;
  return database.discordJob.upsert({
    where: { guildId_key: { guildId, key: `readiness:${day}` } },
    create: { guildId, key: `readiness:${day}`, kind: "MESSAGE", payload: {
      route: "readiness", day, timezone,
      message: { embeds: [{ title: `Raid readiness · Level ${raidLevel()}`, color: 0xd4af37, description: `${description}\n\nFull current report: \`/lead readiness-raid\`.` }] }
    } },
    update: {}
  });
}

// Posts the daily board in the readiness channel. False when none is set. Never
// throws: a failed post must not undo the import or command that triggered it.
export async function postReadinessBoard(discordGuild: DiscordGuild | null, guildId: string, options: BoardOptions = {}): Promise<boolean> {
  if (!discordGuild) return false;
  try {
    const settings = await guildService.getSettings(guildId);
    if (!settings?.readinessChannelId) return false;
    const timezone = settings.timezone ?? "America/Toronto";
    const now = new Date();
    const key = `readiness:${participationDay(now, timezone)}`;
    const existing = await prisma.discordJob.findUnique({ where: { guildId_key: { guildId, key } } });
    if (existing) return true;
    const lines = [...await buildReadinessLines(prisma, guildId, options), ...await buildConsumableLines(prisma, guildId)];
    const job = await queueDailyReadiness(prisma, guildId, timezone, lines, now);
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return true;
  } catch (error) {
    console.error("Failed to post readiness board", error);
    return false;
  }
}
