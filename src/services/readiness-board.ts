import { displayCharacterName, localClassName } from "./character-display.js";
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
const LABEL: Record<"en" | "fr", Record<RaidReadinessStatus, string>> = {
  en: { READY: "Gear ready", PARTIAL: "Needs attention", NOT_READY: "Not ready", LEVELLING: "Levelling", UNKNOWN: "Needs sync" },
  fr: { READY: "Équipement prêt", PARTIAL: "À corriger", NOT_READY: "Pas prêt", LEVELLING: "En montée de niveau", UNKNOWN: "À synchroniser" }
};
const safe = (text: string) => escapeMarkdown(text.replace(/[\r\n]/g, " ").slice(0, 160));

export interface BoardOptions {
  attunement?: string | undefined;
  now?: Date;
  /** The guild's language (the board was English only before 9.0.4). Gear findings stay as the addon wrote them. */
  lang?: "en" | "fr" | undefined;
}

// Latest uploaded character per active member. Gear readiness is distinct
// from level eligibility and from attunements/consumables not checked here.
export async function buildReadinessLines(database: Db, guildId: string, options: BoardOptions = {}): Promise<string[]> {
  const members = await database.member.findMany({ where: { guildId, status: "ACTIVE", isTest: false }, orderBy: { displayName: "asc" } });
  if (!members.length) return [];
  const fr = options.lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const rows: { name: string; status: RaidReadinessStatus; text: string }[] = [];
  const noData: string[] = [];
  for (const member of members) {
    const snapshot = await database.inspectedCharacterSnapshot.findFirst({
      where: { memberId: member.id }, orderBy: { inspectedAt: "desc" }, include: { findings: true, character: true }
    });
    if (!snapshot) { noData.push(safe(member.displayName)); continue; }
    const assessment = assessRaidReadiness(snapshot, options.now, options.lang);
    let status = assessment.status;
    const messages = assessment.reason ? [assessment.reason] : snapshot.findings.filter(f => f.severity !== "INFO").map(f => f.message);
    if (options.attunement && status !== "LEVELLING" && status !== "UNKNOWN") {
      const attuned = await database.characterAttunement?.findFirst({
        where: { characterId: snapshot.characterId, completed: true, name: { equals: options.attunement, mode: "insensitive" } }
      });
      if (!database.characterAttunement) { messages.unshift(t("Attunement could not be verified.", "Accès impossible à vérifier.")); status = "UNKNOWN"; }
      else if (!attuned) { messages.unshift(t(`Not attuned: ${options.attunement}.`, `Accès manquant : ${options.attunement}.`)); status = "NOT_READY"; }
    }
    const level = snapshot.character.level;
    const details = status === "LEVELLING" ? "" : `${level ? ` · ${t("lvl", "niv.")} ${level}` : ""}${snapshot.character.className ? ` ${safe(localClassName(snapshot.character.className, fr ? "fr" : "en"))}` : ""}`;
    const ilvl = status !== "LEVELLING" && status !== "UNKNOWN" && snapshot.itemLevel && Number.isFinite(snapshot.itemLevel) ? ` · ilvl ${snapshot.itemLevel}` : "";
    const checked = Number.isFinite(snapshot.inspectedAt.getTime()) ? ` · ${t("checked", "vérifié")} <t:${Math.floor(snapshot.inspectedAt.getTime() / 1000)}:R>` : "";
    const head = `${ICON[status]} **${safe(displayCharacterName(snapshot.character))}** — ${LABEL[fr ? "fr" : "en"][status]}${details}${ilvl}${checked}`;
    const shown = messages.map(message => `  • ${safe(message)}`);
    rows.push({ name: snapshot.character.name, status, text: [head, ...shown].join("\n") });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const count = (status: RaidReadinessStatus) => rows.filter(row => row.status === status).length;
  const summary = t(`**${count("READY")} gear ready · ${count("PARTIAL") + count("NOT_READY")} need attention · ${count("LEVELLING")} levelling · ${count("UNKNOWN") + noData.length} need sync**`,
    `**${count("READY")} équipement prêt · ${count("PARTIAL") + count("NOT_READY")} à corriger · ${count("LEVELLING")} en montée de niveau · ${count("UNKNOWN") + noData.length} à synchroniser**`);
  const lines = [summary, t(`Level ${raidLevel()} required · latest uploaded character per member · gear checks valid for 24h.`, `Niveau ${raidLevel()} requis · dernier personnage envoyé par membre · vérifications d'équipement valides 24 h.`),
    options.attunement ? t(`Target attunement: **${safe(options.attunement)}**.`, `Accès visé : **${safe(options.attunement)}**.`)
      : t("Attunements are not checked unless a target is selected; consumables are listed separately when scanned.", "Les accès ne sont vérifiés que si une cible est choisie; les consommables sont listés à part quand ils sont relevés.")];
  for (const [title, statuses] of [
    [t("Raid candidates — action needed", "Candidats au raid — à corriger"), ["NOT_READY", "PARTIAL"]],
    [t("Raid candidates — gear ready", "Candidats au raid — équipement prêt"), ["READY"]],
    [t("Levelling — not raid eligible", "En montée de niveau — pas encore admissibles"), ["LEVELLING"]],
    [t("Needs a fresh check", "Vérification à refaire"), ["UNKNOWN"]]
  ] as [string, RaidReadinessStatus[]][]) {
    const group = rows.filter(row => statuses.includes(row.status));
    if (group.length) lines.push(`\n**${title} (${group.length})**`, ...group.map(row => row.text));
  }
  if (noData.length) lines.push(t(`\n**No gear check uploaded (${noData.length})**`, `\n**Aucune vérification d'équipement envoyée (${noData.length})**`), noData.join(", "));
  if (noData.length || count("UNKNOWN")) lines.push(t("Refresh: run `/guilded inspect`, then `/reload` in WoW with the companion running.", "Pour actualiser : `/guilded inspect`, puis `/reload` dans WoW avec le compagnon ouvert."));
  return lines;
}

// "Consumables (scanned 12 min ago)": who lacks a flask/elixir or food in the
// latest group scan. Empty when there is no fresh scan.
export async function buildConsumableLines(database: Db, guildId: string, now = new Date(), lang: "en" | "fr" = "en"): Promise<string[]> {
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
  return lang === "fr" ? [
    `🧪 **Consommables** — ${rows.length} relevés il y a ${minutes} min`,
    `   Sans flacon ni élixir : ${noFlask.length ? noFlask.join(", ") : "personne ✅"}`,
    `   Sans nourriture : ${noFood.length ? noFood.join(", ") : "personne ✅"}`
  ] : [
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
  timezone: string, lines: string[], now = new Date(), lang: "en" | "fr" = "en") {
  const day = participationDay(now, timezone), fr = lang === "fr";
  const chunks = chunkLines(lines.length ? lines : [fr ? "Aucun membre de la guilde trouvé." : "No guild members found."], 3600);
  const description = `${chunks[0]!}${chunks.length > 1 ? (fr ? "\n\n… D'autres membres dans le rapport complet." : "\n\n… More members in the full report.") : ""}`;
  return database.discordJob.upsert({
    where: { guildId_key: { guildId, key: `readiness:${day}` } },
    create: { guildId, key: `readiness:${day}`, kind: "MESSAGE", payload: {
      route: "readiness", day, timezone,
      message: { embeds: [{ title: fr ? `Préparation au raid · niveau ${raidLevel()}` : `Raid readiness · Level ${raidLevel()}`, color: 0xd4af37,
        description: `${description}\n\n${fr ? "Rapport complet : `/lead readiness-raid`." : "Full current report: `/lead readiness-raid`."}` }] }
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
    if (!settings?.readinessChannelId || settings.readinessPostsEnabled === false) return false;
    const timezone = settings.timezone ?? "America/Toronto";
    const now = new Date();
    const key = `readiness:${participationDay(now, timezone)}`;
    const existing = await prisma.discordJob.findUnique({ where: { guildId_key: { guildId, key } } });
    if (existing) return true;
    const lang = settings.language === "fr" ? "fr" : "en";
    const lines = [...await buildReadinessLines(prisma, guildId, { ...options, lang }), ...await buildConsumableLines(prisma, guildId, now, lang)];
    const job = await queueDailyReadiness(prisma, guildId, timezone, lines, now, lang);
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return true;
  } catch (error) {
    console.error("Failed to post readiness board", error);
    return false;
  }
}
