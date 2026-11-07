import { EmbedBuilder, escapeMarkdown, type Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { displayCharacterName } from "./character-display.js";
import { CONSUMABLE_MAX_AGE_MS } from "./readiness-board.js";
import { assessRaidReadiness, type RaidReadinessStatus } from "./readiness.js";
import { dpsKind, signupSpec } from "./dps-kind.js";
import { classColor, type CardRow, type ScoreCard } from "./score-card.js";
import { enqueueDiscordJob, runDiscordJobs } from "./discord-jobs.js";

// 9.1 raid night check (docs/plans/READINESS_UPGRADE.md): before a planned raid, who signed up, how ready their gear and
// consumables are, which roles are short against the raid's limits and who has not been seen in game. One card per raid,
// posted once to the readiness channel about four hours before the pull. On by default; officers switch it off.

export const CHECK_LEAD_MS = 4 * 60 * 60_000;
export const NOT_SEEN_DAYS = 3;
type Role = "TANK" | "HEALER" | "DPS" | "MELEE" | "RANGED";
export type CheckStatus = RaidReadinessStatus | "NO_CHECK";

export interface CheckRow {
  name: string; className: string; role: "TANK" | "HEALER" | "DPS"; status: CheckStatus;
  /** Finding codes (NO_FLASK, MISSING_ENCHANTS…) or the 24-hour/level rule ("STALE", "LEVEL"). */
  issues: string[]; late: boolean;
  /** Whole days since the character was last seen in game; null when never seen. */
  lastSeenDays: number | null;
}
export interface RaidNightCheck {
  raidId: string; title: string; scheduledAt: Date;
  slots: { role: Role; signed: number; limit: number | null }[];
  rows: CheckRow[]; maybe: number; waitlisted: number;
}

type CheckDb = Pick<PrismaClient, "raid" | "inspectedCharacterSnapshot"> & Partial<Pick<PrismaClient, "consumableCheck">>;

/** Pure: what the signed-up character's latest gear check and the fresh group scan say. */
export function checkIssues(snapshot: { status: string; inspectedAt: Date; character: { level: number | null; gameEdition?: string }; findings: { code?: string; severity: string; message: string }[] } | null,
  scan: { flask: string | null; elixirs: string[]; food: string | null } | null, now: Date): { status: CheckStatus; issues: string[] } {
  if (!snapshot) return { status: "NO_CHECK", issues: scan && !scan.flask && !scan.elixirs.length ? ["NO_FLASK"] : [] };
  const assessed = assessRaidReadiness(snapshot, now);
  const issues = new Set(snapshot.findings.filter(f => f.severity !== "INFO").map(f => f.code ?? f.message));
  if (assessed.status === "LEVELLING") return { status: "LEVELLING", issues: ["LEVEL"] };
  if (assessed.status === "UNKNOWN") issues.add("STALE");
  // A fresh group scan is newer evidence than the bag check: it settles flask and food either way.
  if (scan) {
    if (scan.flask || scan.elixirs.length) issues.delete("NO_FLASK"); else issues.add("NO_FLASK");
    if (scan.food) issues.delete("NO_FOOD"); else issues.add("NO_FOOD");
  }
  let status: CheckStatus = assessed.status;
  if (scan && status === "READY" && issues.size) status = "PARTIAL";
  if (scan && status === "PARTIAL" && !issues.size) status = "READY";
  return { status, issues: [...issues] };
}

/** The raid's check: signed-up members (late ones included), the counts and the role slots. Null for an unknown raid. */
export async function raidNightCheck(db: CheckDb, guildId: string, raidId: string, now = new Date()): Promise<RaidNightCheck | null> {
  const raid = await db.raid.findFirst({ where: { id: raidId, guildId },
    select: { id: true, title: true, scheduledAt: true, tankLimit: true, healerLimit: true, dpsLimit: true, meleeLimit: true, rangedLimit: true,
      signups: { select: { status: true, role: true, spec: true, late: true, characterName: true, memberId: true,
        character: { select: { id: true, name: true, displayName: true, className: true, spec: true, level: true, lastSeenAt: true, gameEdition: true } },
        member: { select: { displayName: true } } } } } });
  if (!raid) return null;
  const signed = raid.signups.filter(signup => signup.status === "SIGNED_UP");
  const scans = db.consumableCheck ? await db.consumableCheck.findMany({ where: { guildId, scannedAt: { gte: new Date(now.getTime() - CONSUMABLE_MAX_AGE_MS) } } }) : [];
  const rows: CheckRow[] = [];
  const kinds = { MELEE: 0, RANGED: 0 };
  for (const signup of signed) {
    const character = signup.character;
    const snapshot = await db.inspectedCharacterSnapshot.findFirst({ where: character ? { characterId: character.id } : { memberId: signup.memberId },
      orderBy: { inspectedAt: "desc" }, include: { findings: true, character: true } });
    const name = character ? displayCharacterName(character) : signup.characterName ?? signup.member.displayName;
    const plain = (character?.name ?? signup.characterName ?? "").toLowerCase();
    const scan = plain ? scans.find(row => row.character.toLowerCase() === plain) ?? null : null;
    const { status, issues } = checkIssues(snapshot, scan, now);
    const seen = character?.lastSeenAt ?? snapshot?.character.lastSeenAt ?? null;
    if (signup.role === "DPS") {
      const kind = dpsKind(character?.className ?? snapshot?.character.className, signupSpec(signup, character));
      if (kind) kinds[kind]++;
    }
    rows.push({ name, className: character?.className ?? snapshot?.character.className ?? "", role: signup.role, status, issues, late: signup.late,
      lastSeenDays: seen ? Math.max(0, Math.floor((now.getTime() - seen.getTime()) / 86_400_000)) : null });
  }
  const count = (role: CheckRow["role"]) => rows.filter(row => row.role === role).length;
  const slots: RaidNightCheck["slots"] = [
    { role: "TANK", signed: count("TANK"), limit: raid.tankLimit }, { role: "HEALER", signed: count("HEALER"), limit: raid.healerLimit },
    { role: "DPS", signed: count("DPS"), limit: raid.dpsLimit },
    ...(raid.meleeLimit !== null ? [{ role: "MELEE" as const, signed: kinds.MELEE, limit: raid.meleeLimit }] : []),
    ...(raid.rangedLimit !== null ? [{ role: "RANGED" as const, signed: kinds.RANGED, limit: raid.rangedLimit }] : [])
  ];
  return { raidId: raid.id, title: raid.title, scheduledAt: raid.scheduledAt, slots, rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
    maybe: raid.signups.filter(signup => signup.status === "MAYBE").length, waitlisted: raid.signups.filter(signup => signup.status === "WAITLISTED").length };
}

const ROLE_NAME: Record<Role, { en: string; fr: string }> = {
  TANK: { en: "Tanks", fr: "Tanks" }, HEALER: { en: "Healers", fr: "Soigneurs" }, DPS: { en: "DPS", fr: "DPS" },
  MELEE: { en: "Melee", fr: "Mêlée" }, RANGED: { en: "Ranged", fr: "Distance" }
};
/** A short localized label for a finding code; unknown codes keep the addon's own text. */
export function issueLabel(code: string, lang: Lang): string {
  const fr = lang === "fr";
  const labels: Record<string, [string, string]> = {
    NO_FLASK: ["No flask", "Pas de flacon"], NO_FOOD: ["No food buff", "Pas de nourriture"], MISSING_ENCHANTS: ["Missing enchants", "Enchantements manquants"],
    LOW_DURABILITY: ["Low durability", "Durabilité basse"], MISSING_OFFHAND: ["No off-hand", "Pas de main gauche"], STALE: ["Gear check older than 24 h", "Vérification de plus de 24 h"],
    LEVEL: ["Still levelling", "Encore en montée de niveau"], EMPTY_SLOTS_LOW_LEVEL: ["Empty slots", "Emplacements vides"], GEAR_PRESENT: ["Gear check incomplete", "Vérification incomplète"]
  };
  const known = labels[code];
  if (known) return fr ? known[1] : known[0];
  if (/^MISSING_[A-Z_]+$/.test(code)) return fr ? "Emplacement vide" : "Empty slot";
  return code.slice(0, 60);
}
const needsAttention = (row: CheckRow) => row.status === "NOT_READY" || row.status === "PARTIAL" || row.status === "UNKNOWN" || row.status === "LEVELLING";
const notSeen = (row: CheckRow) => row.status === "NO_CHECK" || row.lastSeenDays === null || row.lastSeenDays >= NOT_SEEN_DAYS;
const short = (slot: RaidNightCheck["slots"][number]) => slot.limit !== null ? Math.max(0, slot.limit - slot.signed) : 0;

function whenText(at: Date, lang: Lang, timezone: string): string {
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(at);
}
function seenText(row: CheckRow, lang: Lang): string {
  const fr = lang === "fr";
  if (row.status === "NO_CHECK" && row.lastSeenDays !== null && row.lastSeenDays < NOT_SEEN_DAYS) return fr ? "Aucune vérification d'équipement" : "No gear check uploaded";
  if (row.lastSeenDays === null) return fr ? "Jamais vu en jeu" : "Never seen in game";
  return fr ? `Pas vu depuis ${row.lastSeenDays} jours` : `Not seen for ${row.lastSeenDays} days`;
}

/** The card: stats strip, then roles, who needs attention, and who has not been seen (recap layout in score-card.ts). */
export function raidNightCard(check: RaidNightCheck, lang: Lang, timezone: string): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const ready = check.rows.filter(row => row.status === "READY").length, attention = check.rows.filter(needsAttention).length;
  const missing = check.slots.filter(slot => slot.role === "TANK" || slot.role === "HEALER" || slot.role === "DPS").reduce((sum, slot) => sum + short(slot), 0);
  const total = check.slots.filter(slot => slot.role === "TANK" || slot.role === "HEALER" || slot.role === "DPS").reduce((sum, slot) => sum + (slot.limit ?? 0), 0);
  const roleRows: CardRow[] = check.slots.map(slot => ({
    name: fr ? ROLE_NAME[slot.role].fr : ROLE_NAME[slot.role].en,
    sub: slot.limit === null ? t("No limit set", "Sans limite") : short(slot) ? t(`${short(slot)} short`, `${short(slot)} manquant(s)`) : t("Full", "Complet"),
    right: slot.limit === null ? String(slot.signed) : `${slot.signed}/${slot.limit}`, rightTone: slot.limit !== null && short(slot) ? "red" : "green"
  }));
  if (check.maybe || check.waitlisted) roleRows.push({ name: t(`${check.maybe} maybe · ${check.waitlisted} waitlist`, `${check.maybe} peut-être · ${check.waitlisted} en attente`) });
  const issueRow = (row: CheckRow): CardRow => ({ name: row.name, color: classColor(row.className),
    sub: [row.late ? t("Late", "En retard") : "", ...row.issues.map(code => issueLabel(code, lang))].filter(Boolean).join(" · ") || t("Needs a look", "À vérifier") });
  const flagged = check.rows.filter(row => needsAttention(row) && !notSeen(row));
  const absent = check.rows.filter(notSeen);
  const sections: NonNullable<ScoreCard["recap"]>["sections"] = [
    { title: t("Roles", "Rôles"), rows: roleRows.slice(0, 5) },
    { title: t("Needs attention", "À corriger"), rows: flagged.length ? [...flagged.slice(0, flagged.length > 5 ? 4 : 5).map(issueRow), ...(flagged.length > 5 ? [{ name: t(`+${flagged.length - 4} more`, `+${flagged.length - 4} autres`) }] : [])]
      : [{ name: t("Nothing to fix", "Rien à corriger"), sub: t("Every checked raider is ready", "Tous les raideurs vérifiés sont prêts") }] },
    { title: t("Not seen or no check", "Absents ou sans vérification"), rows: absent.length ? [...absent.slice(0, absent.length > 5 ? 4 : 5).map(row => ({ name: row.name, color: classColor(row.className), sub: seenText(row, lang) })),
      ...(absent.length > 5 ? [{ name: t(`+${absent.length - 4} more`, `+${absent.length - 4} autres`) }] : [])]
      : [{ name: t("Everyone was seen", "Tout le monde a été vu"), sub: t(`In game within ${NOT_SEEN_DAYS} days`, `En jeu depuis moins de ${NOT_SEEN_DAYS} jours`) }] }
  ];
  return {
    eyebrow: t("Guilded · Raid night check", "Guilded · Vérification de raid"),
    title: check.title,
    subtitle: whenText(check.scheduledAt, lang, timezone),
    stats: [
      { label: t("Signed up", "Inscrits"), value: total ? `${check.rows.length}/${total}` : String(check.rows.length), accent: "gold" },
      { label: t("Gear ready", "Équipement prêt"), value: String(ready), accent: "green" },
      { label: t("Need attention", "À corriger"), value: String(attention), accent: attention ? "red" : "green" },
      { label: t("Roles short", "Places manquantes"), value: String(missing), accent: missing ? "red" : "green" }
    ],
    footer: t("Guilded · gear checks from the addon (valid 24 h) · /lead readiness-raid", "Guilded · vérifications de l'addon (valides 24 h) · /lead readiness-raid"),
    recap: { theme: { a: "#2a1210", b: "#ff7a2a", motif: "keep", seed: hash(check.raidId), scene: "blackrock" }, sections }
  };
}
function hash(text: string): number { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.codePointAt(0)!, 16777619); return h >>> 0; }

/** The text that goes with the card: every name, readable without the image. */
export function raidNightEmbed(check: RaidNightCheck, lang: Lang): EmbedBuilder {
  const fr = lang === "fr", ts = Math.floor(check.scheduledAt.getTime() / 1000);
  const names = (rows: CheckRow[]) => rows.map(row => `**${escapeMarkdown(row.name)}**`).join(", ");
  const lines = [`🕘 <t:${ts}:F> (<t:${ts}:R>)`,
    `👥 ${check.slots.map(slot => `${fr ? ROLE_NAME[slot.role].fr : ROLE_NAME[slot.role].en} ${slot.limit === null ? slot.signed : `${slot.signed}/${slot.limit}`}${short(slot) ? " ⚠️" : ""}`).join(" · ")}`
      + (check.maybe || check.waitlisted ? ` · ${fr ? "peut-être" : "maybe"} ${check.maybe} · ${fr ? "en attente" : "waitlist"} ${check.waitlisted}` : "")];
  const flagged = check.rows.filter(row => needsAttention(row) && !notSeen(row));
  if (flagged.length) lines.push(`\n⚠️ **${fr ? "À corriger" : "Needs attention"}**`, ...flagged.slice(0, 20).map(row =>
    `• **${escapeMarkdown(row.name)}**${row.late ? fr ? " (en retard)" : " (late)" : ""}: ${row.issues.map(code => issueLabel(code, lang)).join(", ") || (fr ? "à vérifier" : "needs a look")}`));
  const absent = check.rows.filter(notSeen);
  if (absent.length) lines.push(`\n👻 **${fr ? "Absents ou sans vérification" : "Not seen or no check"}**`, ...absent.slice(0, 20).map(row => `• **${escapeMarkdown(row.name)}**: ${seenText(row, lang)}`));
  const ready = check.rows.filter(row => row.status === "READY" && !notSeen(row));
  if (ready.length) lines.push(`\n✅ **${fr ? "Prêts" : "Ready"}** (${ready.length}): ${names(ready)}`);
  if (!check.rows.length) lines.push(fr ? "\nPersonne n'est encore inscrit." : "\nNobody has signed up yet.");
  return new EmbedBuilder().setColor(0xd4af37).setTitle(`🛡️ ${fr ? "Vérification de raid" : "Raid night check"} · ${check.title}`.slice(0, 256))
    .setDescription(lines.join("\n").slice(0, 3900))
    .setFooter({ text: fr ? "Une fois par raid, ~4 h avant · officiers : /lead readiness-raid posts:false" : "Once per raid, about 4 h before · officers: /lead readiness-raid posts:false" });
}

type QueueDb = CheckDb & Pick<PrismaClient, "guildSettings" | "discordJob">;

/**
 * Hourly: every planned (non-test) raid starting within the next four hours, in a server with readiness posts on and a
 * readiness channel, gets its check queued once (the job key is the raid; an existing job is never reset). Returns how many.
 */
export async function queueRaidNightChecks(db: QueueDb, now = new Date(), scope: Record<string, unknown> = {}): Promise<number> {
  const guilds = await db.guildSettings.findMany({ where: { ...scope, readinessPostsEnabled: true, readinessChannelId: { not: null } }, select: { guildId: true, language: true, timezone: true }, take: 500 });
  let queued = 0;
  for (const settings of guilds) {
    const raids = await db.raid.findMany({ where: { guildId: settings.guildId, status: "PLANNED", isTest: false, scheduledAt: { gt: now, lte: new Date(now.getTime() + CHECK_LEAD_MS) } }, select: { id: true }, take: 10 });
    for (const { id } of raids) {
      const key = `raid-check:${id}`;
      if (await db.discordJob.findUnique({ where: { guildId_key: { guildId: settings.guildId, key } }, select: { id: true } })) continue;
      const check = await raidNightCheck(db, settings.guildId, id, now);
      if (!check) continue;
      const lang: Lang = settings.language === "fr" ? "fr" : "en";
      await enqueueDiscordJob(db, settings.guildId, key, "MESSAGE", { route: "raidCheck", raidId: id,
        message: JSON.parse(JSON.stringify({ embeds: [raidNightEmbed(check, lang).toJSON()] })), card: JSON.parse(JSON.stringify(raidNightCard(check, lang, settings.timezone))) });
      queued++;
    }
  }
  return queued;
}

export async function runRaidNightChecks(client: Client, db: QueueDb, scope: Record<string, unknown> = {}, now = new Date()): Promise<number> {
  const queued = await queueRaidNightChecks(db, now, scope);
  if (queued) await runDiscordJobs(client);
  return queued;
}
