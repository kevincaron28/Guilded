import { textlessEmbed } from "./card-only.js";
import { EmbedBuilder } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { dateAfter, dayStart, participationDay } from "./participation-rules.js";
import { dayGain, LEVEL_CAP } from "./race-board.js";
import { highlightText, type HighlightKind } from "./dungeon-records.js";
import { classColor, type ScoreCard } from "./score-card.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import type { DungeonScene } from "./dungeon-art.js";

// 9.1 daily recap (docs/plans/RECORDS_AND_RECAPS.md): one card per server day, posted after midnight in the server's
// timezone for the day that ended, only when something happened. On by default (rule 5), officers switch it off; it posts to
// the weekly-report channel, else the notify channel, and never before one exists.

export interface RecapLeveler { name: string; className: string; gain: number; level: number }
export interface RecapHighlight { kind: HighlightKind; label?: string; valueSec?: number; previousSec?: number; dungeonName: string }
export interface DailyRecap {
  day: string;
  race: { gained: number; top: RecapLeveler[]; new60: { name: string; className: string }[] } | null;
  dungeons: { clears: number; dungeons: number; mostRuns: { name: string; runs: number } | null; highlights: RecapHighlight[] } | null;
  pvp: { duels: number; topDueler: { name: string; wins: number } | null; bgPlayed: number; bgWon: number } | null;
}

type RecapDb = Pick<PrismaClient, "levelRaceEntry" | "raceHallEntry" | "dungeonRun" | "dungeonHighlight" | "duelResult" | "battlegroundReport">
  & Partial<Pick<PrismaClient, "character" | "unclaimedCharacter" | "guildRosterEntry">>;

/** The server day that ended most recently before `now` (yesterday, in the server's timezone). */
export function recapDay(now: Date, timezone: string): string { return dateAfter(participationDay(now, timezone), -1); }

export function recapIsEmpty(recap: DailyRecap): boolean { return !recap.race && !recap.dungeons && !recap.pvp; }

const GUILD_PLAYER = { OR: [{ memberId: { not: null } }, { inGuild: true }] };

/** What the guild did during the server day `day` (YYYY-MM-DD). Sections with nothing in them are null. */
export async function dailyRecap(db: RecapDb, guildId: string, day: string, timezone: string, options: { race?: boolean } = {}): Promise<DailyRecap> {
  const from = dayStart(day, timezone), to = dayStart(dateAfter(day, 1), timezone), window = { gte: from, lt: to };
  const [entries, sixties, runs, highlights, duels, bgs] = await Promise.all([
    options.race === false ? Promise.resolve([]) : db.levelRaceEntry.findMany({ where: { guildId, OR: [{ dayStartedAt: from }, { lastDayStartedAt: from }] },
      select: { name: true, className: true, level: true, dayStartLevel: true, dayStartedAt: true, lastDayGain: true, lastDayStartedAt: true } }),
    options.race === false ? Promise.resolve([]) : db.raceHallEntry.findMany({ where: { guildId, reachedAt: window, removed: false, backfilled: false }, select: { name: true, className: true }, orderBy: { order: "asc" }, take: 10 }),
    db.dungeonRun.findMany({ where: { guildId, valid: true, state: "COMPLETED", durationSec: { not: null }, endedAt: window, NOT: { runRef: { startsWith: "SIM-" } }, players: { some: GUILD_PLAYER } },
      select: { instanceId: true, players: { where: GUILD_PLAYER, select: { memberId: true, character: true, member: { select: { displayName: true } } } } }, take: 2000 }),
    db.dungeonHighlight.findMany({ where: { guildId, createdAt: window }, select: { kind: true, label: true, valueSec: true, previousSec: true, dungeonName: true }, orderBy: { createdAt: "asc" }, take: 30 }),
    db.duelResult.findMany({ where: { guildId, counted: true, endedAt: window }, select: { winnerId: true, winnerCharacter: true }, take: 2000 }),
    db.battlegroundReport.findMany({ where: { guildId, endedAt: window, status: { notIn: ["WITHDRAWN", "CONFLICT"] }, member: { status: "ACTIVE", battlegroundConsent: { guildStats: true } } },
      select: { outcome: true }, take: 2000 })
  ]);

  const levelers = entries.map(entry => ({ name: entry.name, className: entry.className, level: entry.level, gain: dayGain(entry, from) })).filter(row => row.gain > 0)
    .sort((a, b) => b.gain - a.gain || b.level - a.level || a.name.localeCompare(b.name));
  const race = levelers.length || sixties.length ? { gained: levelers.reduce((sum, row) => sum + row.gain, 0), top: levelers.slice(0, 5), new60: sixties } : null;

  let dungeons: DailyRecap["dungeons"] = null;
  if (runs.length || highlights.length) {
    const perMember = new Map<string, { name: string; runs: number }>();
    for (const run of runs) for (const id of new Set(run.players.flatMap(player => player.memberId ? [player.memberId] : []))) {
      const player = run.players.find(row => row.memberId === id)!;
      // The character who ran (its full name below), not the member's Discord name.
      const row = perMember.get(id) ?? { name: player.character || player.member?.displayName || "?", runs: 0 };
      row.runs++; perMember.set(id, row);
    }
    const best = [...perMember.values()].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))[0];
    dungeons = { clears: runs.length, dungeons: new Set(runs.map(run => run.instanceId)).size, mostRuns: best && best.runs >= 2 ? best : null,
      highlights: highlights.map(row => ({ kind: row.kind as HighlightKind, dungeonName: row.dungeonName,
        ...(row.label ? { label: row.label } : {}), ...(row.valueSec !== null ? { valueSec: row.valueSec } : {}), ...(row.previousSec !== null ? { previousSec: row.previousSec } : {}) })) };
  }

  let pvp: DailyRecap["pvp"] = null;
  if (duels.length || bgs.length) {
    const wins = new Map<string, { name: string; wins: number }>();
    for (const duel of duels) { const row = wins.get(duel.winnerId) ?? { name: duel.winnerCharacter, wins: 0 }; row.wins++; wins.set(duel.winnerId, row); }
    const top = [...wins.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))[0] ?? null;
    pvp = { duels: duels.length, topDueler: top, bgPlayed: bgs.length, bgWon: bgs.filter(row => row.outcome === "win").length };
  }

  // Full "First Last" names where only a first name is stored.
  if ((race || dungeons?.mostRuns) && db.character) {
    const book = await loadFullNameBook(db, guildId, dungeons?.mostRuns ? [dungeons.mostRuns.name] : []).catch(() => null);
    if (book) for (const row of [...(race?.top ?? []), ...(race?.new60 ?? []), ...(dungeons?.mostRuns ? [dungeons.mostRuns] : [])]) row.name = displayCharacterName(row.name, book);
  }
  return { day, race, dungeons, pvp };
}

function dayLabel(day: string, lang: Lang): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}
// The painted scene changes with the day (dungeon-art.ts scenes, never game art).
const RECAP_SCENES: DungeonScene[] = ["stratholme", "scarlet", "blackrock", "forest", "dalaran", "wailing", "sunken", "shadowfang", "uldaman", "zulfarrak"];
const seedOf = (text: string) => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.codePointAt(0)!, 16777619); return h >>> 0; };

/** The recap card: painted fortress scene, a stats strip and one frosted panel per section (recap layout in score-card.ts). */
export function dailyRecapCard(recap: DailyRecap, lang: Lang, guildName: string): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const stats: ScoreCard["stats"] = [];
  if (recap.race) stats.push({ label: t("Levels gained", "Niveaux gagnés"), value: String(recap.race.gained), accent: "gold" });
  if (recap.race?.new60.length) stats.push({ label: t(`New level ${LEVEL_CAP}s`, `Nouveaux ${LEVEL_CAP}`), value: String(recap.race.new60.length), accent: "gold" });
  if (recap.dungeons) stats.push({ label: t("Dungeon clears", "Donjons terminés"), value: String(recap.dungeons.clears), accent: "green" });
  if (recap.dungeons?.highlights.length) stats.push({ label: t("Records & challenges", "Records et défis"), value: String(recap.dungeons.highlights.length), accent: "gold" });
  if (recap.pvp?.duels) stats.push({ label: t("Duels", "Duels"), value: String(recap.pvp.duels), accent: "red" });
  if (recap.pvp?.bgPlayed && stats.length < 4) stats.push({ label: t("Battlegrounds won", "Champs de bataille gagnés"), value: `${recap.pvp.bgWon}/${recap.pvp.bgPlayed}`, accent: "red" });

  const sections: NonNullable<ScoreCard["recap"]>["sections"] = [];
  if (recap.race) sections.push({ title: t("Race to 60 · levels", "Course au 60 · niveaux"), rows: [
    ...recap.race.new60.slice(0, 3).map(row => ({ name: row.name, color: classColor(row.className), sub: row.className, right: `${LEVEL_CAP} ★`, rightTone: "gold" as const })),
    ...recap.race.top.slice(0, 5 - Math.min(3, recap.race.new60.length)).map(row => ({ name: row.name, color: classColor(row.className), sub: `${row.className} · ${t("level", "niveau")} ${row.level}`, right: `+${row.gain}`, rightTone: "green" as const }))
  ] });
  if (recap.dungeons) {
    const order: HighlightKind[] = ["clear", "boss", "first", "deathless", "guild5"];
    const items = [...recap.dungeons.highlights].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    sections.push({ title: t("Dungeons · records", "Donjons · records"), rows: [
      ...items.slice(0, recap.dungeons.mostRuns ? 4 : 5).map(item => ({ name: plainHighlight(item, lang), sub: item.kind === "boss" ? t(`Fastest kill · ${item.dungeonName}`, `Kill le plus rapide · ${item.dungeonName}`) : item.dungeonName, right: item.valueSec !== undefined && (item.kind === "clear" || item.kind === "boss") ? clock(item.valueSec) : undefined, rightTone: "gold" as const })),
      ...(recap.dungeons.mostRuns ? [{ name: recap.dungeons.mostRuns.name, sub: t("Most runs today", "Le plus de donjons aujourd'hui"), right: `×${recap.dungeons.mostRuns.runs}`, rightTone: "green" as const }] : []),
      ...(!items.length && !recap.dungeons.mostRuns ? [{ name: t(`${recap.dungeons.clears} clear(s)`, `${recap.dungeons.clears} parcours`), sub: t(`${recap.dungeons.dungeons} different dungeon(s)`, `${recap.dungeons.dungeons} donjon(s) différent(s)`) }] : [])
    ] });
  }
  if (recap.pvp) sections.push({ title: t("PvP", "JcJ"), rows: [
    ...(recap.pvp.topDueler ? [{ name: recap.pvp.topDueler.name, sub: t("Most duel wins", "Le plus de duels gagnés"), right: `×${recap.pvp.topDueler.wins}`, rightTone: "red" as const }] : []),
    ...(recap.pvp.duels ? [{ name: t(`${recap.pvp.duels} duel(s)`, `${recap.pvp.duels} duel(s)`), sub: t("Counted in the ladder", "Comptés au classement") }] : []),
    ...(recap.pvp.bgPlayed ? [{ name: t(`${recap.pvp.bgWon}/${recap.pvp.bgPlayed} won`, `${recap.pvp.bgWon}/${recap.pvp.bgPlayed} gagnés`), sub: t("Battlegrounds · shared stats", "Champs de bataille · stats partagées") }] : [])
  ] });

  return {
    eyebrow: t("Guilded · Daily recap", "Guilded · Bilan du jour"),
    title: guildName,
    subtitle: dayLabel(recap.day, lang),
    stats: stats.slice(0, 4),
    footer: t("Guilded · from the guild's addon uploads · /stats recap:true", "Guilded · d'après les envois de l'addon de la guilde · /stats recap:true"),
    recap: { theme: { a: "#1e1236", b: "#6a4aa8", motif: "keep", seed: seedOf(recap.day), scene: RECAP_SCENES[seedOf(recap.day) % RECAP_SCENES.length]! }, sections: sections.slice(0, 3) }
  };
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
/** A highlight's text for the card (no markdown, no emoji: the card font draws neither). */
function plainHighlight(item: RecapHighlight, lang: Lang): string {
  const fr = lang === "fr";
  switch (item.kind) {
    case "clear": return fr ? "Record de guilde" : "Guild record";
    case "boss": return item.label ?? (fr ? "Record de boss" : "Boss record");
    case "first": return fr ? "Premier parcours" : "First guild clear";
    case "deathless": return fr ? "Sans mort" : "Flawless clear";
    case "guild5": return fr ? "Groupe 100 % guilde" : "All-guild party";
  }
}

/** The text that goes with the card: the same facts, readable without the image. */
export function dailyRecapEmbed(recap: DailyRecap, lang: Lang): EmbedBuilder {
  const fr = lang === "fr";
  const lines: string[] = [];
  if (recap.race) {
    lines.push(`📈 **${fr ? "Course au 60" : "Race to 60"}** · ${recap.race.gained} ${fr ? "niveau(x) gagné(s)" : "level(s) gained"}`);
    if (recap.race.new60.length) lines.push(`⭐ ${fr ? `Nouveaux ${LEVEL_CAP}` : `New level ${LEVEL_CAP}s`}: ${recap.race.new60.map(row => row.name).join(", ")}`);
    if (recap.race.top[0]) lines.push(`🥇 ${fr ? "Le plus de niveaux" : "Most levels"}: ${recap.race.top.slice(0, 3).map(row => `${row.name} (+${row.gain})`).join(", ")}`);
  }
  if (recap.dungeons) {
    lines.push(`🏰 **${fr ? "Donjons" : "Dungeons"}** · ${recap.dungeons.clears} ${fr ? "parcours" : "clear(s)"}, ${recap.dungeons.dungeons} ${fr ? "donjon(s)" : "dungeon(s)"}`);
    for (const item of recap.dungeons.highlights.slice(0, 8)) lines.push(highlightText(item, lang, true));
    if (recap.dungeons.mostRuns) lines.push(`🔁 ${fr ? "Le plus de donjons" : "Most runs"}: ${recap.dungeons.mostRuns.name} (×${recap.dungeons.mostRuns.runs})`);
  }
  if (recap.pvp) {
    const parts = [recap.pvp.duels ? `${recap.pvp.duels} duel(s)` : "", recap.pvp.bgPlayed ? `${recap.pvp.bgWon}/${recap.pvp.bgPlayed} ${fr ? "champs de bataille gagnés" : "battlegrounds won"}` : ""].filter(Boolean);
    lines.push(`⚔️ **${fr ? "JcJ" : "PvP"}** · ${parts.join(" · ")}`);
    if (recap.pvp.topDueler) lines.push(`🤺 ${fr ? "Le plus de duels gagnés" : "Most duel wins"}: ${recap.pvp.topDueler.name} (×${recap.pvp.topDueler.wins})`);
  }
  return new EmbedBuilder().setColor(0xd4a017).setTitle(`${fr ? "🗓️ Bilan du" : "🗓️ Recap for"} ${dayLabel(recap.day, lang)}`.slice(0, 256))
    .setDescription(lines.join("\n").slice(0, 3800)).setFooter({ text: fr ? "Un bilan par jour, seulement s'il s'est passé quelque chose · officiers : /stats recap-posts:false" : "One recap per day, only when something happened · officers: /stats recap-posts:false" });
}

type DeliveryDb = RecapDb & Pick<PrismaClient, "guildSettings" | "$transaction">;

/**
 * Hourly: for every server with the recap on and a channel, once the server's day has rolled over, queue the card for the day
 * that ended (or nothing on a quiet day) and remember the day. The day is claimed in the same transaction as the job, so two
 * ticks cannot post it twice. Returns how many recaps were queued.
 */
export async function queueDailyRecaps(db: DeliveryDb, now = new Date(), options: { scope?: Record<string, unknown>; onError?: (error: unknown) => void } = {}): Promise<number> {
  const onError = options.onError ?? (() => undefined);
  const guilds = await db.guildSettings.findMany({ where: { ...options.scope, dailyRecapEnabled: true, OR: [{ weeklyReportChannelId: { not: null } }, { notifyChannelId: { not: null } }] },
    select: { guildId: true, timezone: true, language: true, dailyRecapLastDay: true, raceBoardEnabled: true, guild: { select: { name: true } } }, take: 500 });
  let queued = 0;
  for (const settings of guilds) {
    try {
      const day = recapDay(now, settings.timezone);
      if (settings.dailyRecapLastDay && settings.dailyRecapLastDay >= day) continue;
      const recap = await dailyRecap(db, settings.guildId, day, settings.timezone, { race: settings.raceBoardEnabled });
      const lang: Lang = settings.language === "fr" ? "fr" : "en";
      const done = await db.$transaction(async tx => {
        const claim = await tx.guildSettings.updateMany({ where: { guildId: settings.guildId, dailyRecapEnabled: true, OR: [{ dailyRecapLastDay: null }, { dailyRecapLastDay: { lt: day } }] }, data: { dailyRecapLastDay: day } });
        if (!claim.count || recapIsEmpty(recap)) return false;
        const card = dailyRecapCard(recap, lang, settings.guild.name);
        await enqueueDiscordJob(tx, settings.guildId, `daily-recap:${day}`, "MESSAGE", { route: "wowWeekly",
          message: JSON.parse(JSON.stringify({ embeds: [dailyRecapEmbed(recap, lang).toJSON()] })), card: JSON.parse(JSON.stringify(card)), cardOnly: { embeds: [textlessEmbed(0xd4a017)] } });
        return true;
      });
      if (done) queued++;
    } catch (error) { onError(error); }
  }
  return queued;
}
