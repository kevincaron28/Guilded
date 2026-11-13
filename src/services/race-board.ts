import { cardAttachment } from "./card-alt.js";
import { armoryUrl } from "./armory-link.js";
import { AttachmentBuilder, ChannelType, EmbedBuilder, escapeMarkdown, PermissionFlagsBits, type Guild as DiscordGuild, type Message } from "discord.js";
import { characterKey, foreverNameMatches } from "../../companion/character-identity.mjs";
import { prisma } from "../database.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { fullNameOf } from "./forever-names.js";
import { localClassName, localRaceName } from "./character-display.js";
import { professionName } from "./profession-style.js";
import { dayStart, participationDay } from "./participation-rules.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { classColor, ladderMeta, scoreCardPng, type ScoreCard } from "./score-card.js";
import { moveColumn, moveFields, trackRanks, type Movements } from "./ladder-snapshots.js";
import { isOwnBoard } from "./board-identity.js";

// The live "Race to 60" leaderboard and Hall of Fame (8.5, track B1). The channel's FIRST message is the live board: the
// top N guild characters (default 50, officers pick 10-50) with class, race, level bar, professions, last seen and the
// linked Discord member, edited in place after every sync. Every character that reaches 60 then gets its own permanent
// Hall of Fame message, never edited or deleted, backed by a database row so history survives channel resets.
// Same pattern as the duel board: footer marker, pure builders, refresh through discord-jobs. On by default; officers
// switch it off. Every guild character is on the board; there is no hide option.

const guildService = createGuildService(prisma);
export const RACE_BOARD_MARKER = "Guilded race board";
export const HALL_MARKER = "Guilded hall of fame";
export const LEVEL_CAP = 60;
export const DEFAULT_TOP = 50, MIN_TOP = 10, MAX_TOP = 50;
/** With at least this many tracked characters, everyone reaching 60 switches the board to Hall of Fame mode by itself. */
const AUTO_END_MINIMUM = 3;
const CARD_ROWS = 50, SHORT_LEADERS = 3, GAINERS = 5, DESCRIPTION_BUDGET = 3800;
/** WoW Forever launched on 4 November 2026 (Season 1 opens at 23:00 UTC that day); "time to 60" counts from here. */
export const LAUNCH_AT = new Date("2026-11-04T23:00:00Z");
export const RACE_CARD_FILE = "race.png", HALL_CARD_FILE = "hall-60.png";
export const KNOWN_CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Death Knight", "Shaman", "Mage", "Warlock", "Monk", "Druid", "Demon Hunter", "Evoker"] as const;
/** The class as the board spells it, from any capitalisation; null when it is not a class. */
export const normalizeClass = (value: string | null | undefined) => KNOWN_CLASSES.find(name => name.toLowerCase() === (value ?? "").trim().replace(/\s+/g, " ").toLowerCase()) ?? null;

export interface RaceChar { aliasKeys?: string[]; key: string; name: string; className: string; race: string | null; level: number; memberId: string | null; discordId: string | null; professions: string[]; lastSeenAt: Date | null }
export interface RaceEntryState { level: number; reachedMaxAt: Date | null; weekStartLevel: number; weekStartedAt: Date;
  /** 9.1 daily recap: the level at the start of the server's day, and the last finished day's gain (kept across the rollover). */
  dayStartLevel?: number | null; dayStartedAt?: Date | null; lastDayGain?: number; lastDayStartedAt?: Date | null }
export interface RaceRow { aliasKeys?: string[]; key: string; name: string; className: string; race: string | null; level: number; reachedMaxAt: Date | null; firstSeenAt: Date; weekGain: number;
  memberId: string | null; discordId: string | null; professions: string[]; lastSeenAt: Date | null }
export interface RaceBoardData { rows: RaceRow[]; total: number; finished: number; edition: string }

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}

/**
 * Pure: the stored state after seeing a character at `level`. A level that went down means the name was
 * re-rolled, so its history restarts. First seen at the cap counts as reaching it now (the real date is unknowable).
 */
export function nextEntry(previous: RaceEntryState | null, level: number, now: Date, dayFrom?: Date): RaceEntryState {
  const monday = weekStart(now);
  if (!previous || level < previous.level) return { level, reachedMaxAt: level >= LEVEL_CAP ? now : null, weekStartLevel: level, weekStartedAt: monday,
    ...(dayFrom ? { dayStartLevel: level, dayStartedAt: dayFrom, lastDayGain: 0, lastDayStartedAt: null } : {}) };
  const rolled = previous.weekStartedAt < monday;
  // A new day: the finished day's gain is kept (measured with the last level seen that day), and today starts from it.
  // Without the server's day (a read-only caller), the day fields are kept as they are.
  const known = Boolean(previous.dayStartedAt && typeof previous.dayStartLevel === "number");
  if (!dayFrom) return { level, reachedMaxAt: previous.reachedMaxAt ?? (level >= LEVEL_CAP ? now : null),
    weekStartLevel: rolled ? previous.level : previous.weekStartLevel, weekStartedAt: rolled ? monday : previous.weekStartedAt,
    dayStartLevel: previous.dayStartLevel ?? null, dayStartedAt: previous.dayStartedAt ?? null, lastDayGain: previous.lastDayGain ?? 0, lastDayStartedAt: previous.lastDayStartedAt ?? null };
  const newDay = !known || previous.dayStartedAt! < dayFrom;
  return {
    level,
    reachedMaxAt: previous.reachedMaxAt ?? (level >= LEVEL_CAP ? now : null),
    weekStartLevel: rolled ? previous.level : previous.weekStartLevel,
    weekStartedAt: rolled ? monday : previous.weekStartedAt,
    dayStartLevel: newDay ? previous.level : previous.dayStartLevel!,
    dayStartedAt: newDay ? dayFrom : previous.dayStartedAt!,
    lastDayGain: newDay ? known ? Math.max(0, previous.level - previous.dayStartLevel!) : 0 : previous.lastDayGain ?? 0,
    lastDayStartedAt: newDay ? known ? previous.dayStartedAt! : null : previous.lastDayStartedAt ?? null
  };
}

/** Levels gained during the day that started at `dayFrom`, from a stored entry (0 when that day is unknown). */
export function dayGain(entry: Pick<RaceEntryState, "level" | "dayStartLevel" | "dayStartedAt" | "lastDayGain" | "lastDayStartedAt">, dayFrom: Date): number {
  if (entry.dayStartedAt?.getTime() === dayFrom.getTime() && typeof entry.dayStartLevel === "number") return Math.max(0, entry.level - entry.dayStartLevel);
  if (entry.lastDayStartedAt?.getTime() === dayFrom.getTime()) return Math.max(0, entry.lastDayGain ?? 0);
  return 0;
}

/** Pure: finishers first in the order they got there, then everyone else by level (ties by name). */
export function orderRace(rows: RaceRow[]): RaceRow[] {
  const done = rows.filter(row => row.level >= LEVEL_CAP).sort((a, b) => (a.reachedMaxAt?.getTime() ?? 0) - (b.reachedMaxAt?.getTime() ?? 0) || a.name.localeCompare(b.name));
  const racing = rows.filter(row => row.level < LEVEL_CAP).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  return [...done, ...racing];
}

/** Pure: the leaderboard order. Highest level first, 60s ahead by arrival, then name. */
export function leaderboardOrder(rows: RaceRow[]): RaceRow[] {
  return [...rows].sort((a, b) => b.level - a.level || (a.reachedMaxAt?.getTime() ?? 0) - (b.reachedMaxAt?.getTime() ?? 0) || a.name.localeCompare(b.name));
}

/** Pure: up to `limit` other characters within `spread` levels of `level`, closest first. */
export function nearLevel(rows: RaceRow[], level: number, own: ReadonlySet<string>, spread = 3, limit = 8): RaceRow[] {
  return rows.filter(row => row.level < LEVEL_CAP && !own.has(row.name.toLowerCase()) && Math.abs(row.level - level) <= spread)
    .sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level) || a.name.localeCompare(b.name)).slice(0, limit);
}

export const clampTop = (value: number | null | undefined) => Math.max(MIN_TOP, Math.min(MAX_TOP, Math.trunc(value ?? DEFAULT_TOP) || DEFAULT_TOP));
/** The board switches to Hall of Fame mode when an officer ends the race or everyone tracked has reached 60. */
export const hallMode = (data: RaceBoardData, ended: boolean) => ended || (data.total >= AUTO_END_MINIMUM && data.finished === data.total);

const bar = (level: number) => { const filled = Math.round(Math.min(level, LEVEL_CAP) / LEVEL_CAP * 8); return "▰".repeat(filled) + "▱".repeat(8 - filled); };
const stamp = (date: Date, style: "d" | "R") => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
const shortProfessions = (professions: string[], limit = 2) => professions.slice(0, limit).join(", ");

/**
 * Pure: the leaderboard picture, in the shared ladder layout. Top N (10-50, the officer's setting, 50 by default) in leaderboard
 * order: rank (medals for the top 3), full name in the class colour, class, race and the linked Discord member under it, a level bar,
 * the level, the levels gained this week, and (with `moves`) the rank change since yesterday as an arrow. `memberNames` maps Discord
 * ids to display names; `moves` is keyed by the row key (see ladder-snapshots.ts).
 */
export function raceCard(data: RaceBoardData, lang: Lang, top = DEFAULT_TOP, memberNames: ReadonlyMap<string, string> = new Map(), updatedAt = new Date(), moves: Movements | null = null): ScoreCard {
  const fr = lang === "fr";
  const ranked = leaderboardOrder(data.rows).slice(0, Math.min(clampTop(top), CARD_ROWS));
  return {
    eyebrow: "Guilded · WoW Forever", title: fr ? "Course au niveau 60" : "Race to 60",
    subtitle: fr ? `${data.finished} sur ${data.total} personnages au niveau ${LEVEL_CAP}` : `${data.finished} of ${data.total} characters at level ${LEVEL_CAP}`,
    backdrop: { kind: "board", key: "race-to-60" },
    stats: [], footer: fr ? `Top ${ranked.length} sur ${data.total} · mis à jour à chaque synchronisation · /character race near trouve des partenaires` : `Top ${ranked.length} of ${data.total} · updated after every sync · /character race near finds partners`,
    ladder: {
      meta: ladderMeta(lang, updatedAt), empty: fr ? "Aucun personnage avec niveau rapporté pour l'instant." : "No levelled character reported yet.",
      columns: [{ label: fr ? "Progression" : "Progress", width: 84, kind: "bar" }, { label: fr ? "Niv." : "Lvl", width: 40, primary: true },
        { label: fr ? "Sem." : "Week", width: 40 }, ...(moves ? [moveColumn(lang)] : [])],
      boards: [{ rows: ranked.map((row, index) => {
        const member = row.discordId ? memberNames.get(row.discordId) : undefined;
        return { rank: index + 1, name: row.name, color: classColor(row.className), values: ["", String(row.level), row.weekGain > 0 ? `+${row.weekGain}` : "", ""],
          bar: { value: row.level, max: LEVEL_CAP }, sub: [localClassName(row.className, lang), localRaceName(row.race, lang), member ? `@${member}` : ""].filter(Boolean).join(" · "), ...moveFields(moves, row.key, lang) };
      }) }]
    }
  };
}

/** Pure: one leaderboard line. */
export function raceLine(row: RaceRow, rank: number, lang: Lang, hall = false, edition = "forever"): string {
  const fr = lang === "fr";
  const name = escapeMarkdown(row.name).slice(0, 32);
  const kind = [localClassName(row.className, lang), localRaceName(row.race, lang)].filter(Boolean).join(" ");
  const armory = armoryUrl({ name: row.name, gameEdition: edition });
  const parts = [`**${rank}.** ${armory ? `[${name}](<${armory}>)` : name}`, kind];
  if (row.level >= LEVEL_CAP) parts.push(`**60** ✅${row.reachedMaxAt ? ` ${stamp(row.reachedMaxAt, "d")}` : ""}`);
  else parts.push(`**${row.level}** ${bar(row.level)} ${Math.round(row.level / LEVEL_CAP * 100)}%`);
  if (!hall) {
    if (row.professions.length) parts.push(shortProfessions(row.professions));
    if (row.lastSeenAt) parts.push(`${fr ? "vu" : "seen"} ${stamp(row.lastSeenAt, "R")}`);
  }
  if (row.discordId) parts.push(`<@${row.discordId}>`);
  return parts.filter(Boolean).join(" · ");
}

/** Pure: the board's embed. `image` is the attachment name the card is sent under; `hall` lists every 60 in arrival order. */
export function raceBoardEmbed(data: RaceBoardData, lang: Lang, options: { image?: string | undefined; top?: number; hall?: boolean } = {}): EmbedBuilder {
  const fr = lang === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const hall = options.hall === true;
  const embed = new EmbedBuilder().setColor(0xffd100).setTitle(hall ? t("🏆 Hall of Fame — level 60", "🏆 Temple de la renommée — niveau 60") : t("🏁 Race to 60", "🏁 Course au niveau 60"));
  if (!data.total) {
    embed.setDescription(t("No levelled character reported yet. Officers' addon uploads fill this board.", "Aucun personnage avec niveau rapporté. Les envois de l'addon des officiers remplissent ce tableau."));
  } else {
    const rows = hall ? data.rows.filter(row => row.level >= LEVEL_CAP).sort((a, b) => (a.reachedMaxAt?.getTime() ?? 0) - (b.reachedMaxAt?.getTime() ?? 0) || a.name.localeCompare(b.name))
      : leaderboardOrder(data.rows).slice(0, options.image ? SHORT_LEADERS : clampTop(options.top)); // with the card, the embed only names the leaders
    const shown = Math.min(clampTop(options.top), CARD_ROWS, data.total);
    const head = hall ? t(`**${data.finished}** characters reached level ${LEVEL_CAP}, in arrival order.`, `**${data.finished}** personnages ont atteint le niveau ${LEVEL_CAP}, par ordre d'arrivée.`)
      : options.image ? t(`Top **${shown}** of **${data.total}** characters on the card · **${data.finished}** at level ${LEVEL_CAP}. Leaders:`, `Top **${shown}** sur **${data.total}** personnages sur la carte · **${data.finished}** au niveau ${LEVEL_CAP}. En tête :`)
      : t(`Top **${rows.length}** of **${data.total}** characters · **${data.finished}** at level ${LEVEL_CAP}.`, `Top **${rows.length}** sur **${data.total}** personnages · **${data.finished}** au niveau ${LEVEL_CAP}.`);
    const lines: string[] = [];
    let used = head.length + 2;
    // Armory links make every line about 110 characters longer: use them only when no row is cut off by them.
    const linked = rows.map((row, index) => raceLine(row, index + 1, lang, hall, data.edition));
    const plain = rows.map((row, index) => raceLine(row, index + 1, lang, hall, ""));
    const useLinks = used + linked.reduce((sum, line) => sum + line.length + 1, 0) <= DESCRIPTION_BUDGET;
    for (const index of rows.keys()) {
      const line = (useLinks ? linked : plain)[index]!;
      if (used + line.length + 1 > DESCRIPTION_BUDGET) { lines.push("…"); break; }
      lines.push(line); used += line.length + 1;
    }
    // With the card (not the Hall of Fame list) the leaders and counts repeat the picture: the embed keeps its title and footer.
    if (hall || !options.image) embed.setDescription(`${head}\n\n${lines.join("\n")}`);
    const gainers = data.rows.filter(row => row.weekGain > 0).sort((a, b) => b.weekGain - a.weekGain || a.name.localeCompare(b.name)).slice(0, GAINERS);
    if (gainers.length && !hall && !options.image) embed.addFields({ name: t("Most levels this week", "Plus de niveaux cette semaine"), value: gainers.map(row => `${escapeMarkdown(row.name).slice(0, 32)} +${row.weekGain}`).join("\n").slice(0, 1024), inline: true });
    if (!options.image) embed.addFields({ name: t("Level 60", "Niveau 60"), value: String(data.finished), inline: true });
  }
  if (options.image && data.total) embed.setImage(`attachment://${options.image}`);
  return embed.setFooter({ text: t("/character race near finds partners at your level", "/character race near trouve des partenaires de ton niveau") });
}

export interface HallRecord { order: number; name: string; className: string; race: string | null; reachedAt: Date; firstSeenAt: Date; professions: string | null; memberDiscordId: string | null;
  /** True when the climb was watched (or an officer vouches for the date) and it is after launch, so the time to 60 means something. */
  sinceLaunchKnown?: boolean }

/** 1st, 2nd, 3rd, 11th... (English); 1er, 2e, 3e... (French). */
export function ordinal(n: number, lang: Lang): string {
  if (lang === "fr") return n === 1 ? "1er" : `${n}e`;
  const last = n % 100;
  if (last >= 11 && last <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** The time from launch to level 60 in milliseconds, or null when it is not known. */
export const timeToSixty = (entry: HallRecord): number | null => entry.sinceLaunchKnown ? Math.max(0, entry.reachedAt.getTime() - LAUNCH_AT.getTime()) : null;

/** 5d 4h, or 6h 20m under a day (a minute at least). */
export function formatDuration(ms: number, lang: Lang): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000)), days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
  const fr = lang === "fr";
  if (days) return fr ? `${days} j ${hours} h` : `${days}d ${hours}h`;
  return hours ? (fr ? `${hours} h ${rest} min` : `${hours}h ${rest}m`) : (fr ? `${rest} min` : `${rest}m`);
}

const MONTHS = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] } as const;
const dayText = (date: Date, lang: Lang) => `${date.getUTCDate()} ${MONTHS[lang === "fr" ? "fr" : "en"][date.getUTCMonth()]} ${date.getUTCFullYear()}`;

/** Pure: the celebratory card for a new level 60: rank, time to 60 since launch (when known), date, class, member and professions. */
export function hallCard(entry: HallRecord, lang: Lang, memberName: string | null = null): ScoreCard {
  const fr = lang === "fr";
  const took = timeToSixty(entry);
  const color = classColor(entry.className);
  const professions = (entry.professions ?? "").split(",").map(part => part.trim()).filter(Boolean).slice(0, 3).map(part => {
    const match = /^(.*?)\s+(\d+)$/.exec(part);
    return { name: professionName(match?.[1] ?? part, lang), color: "#f5e6c0", ...(match ? { right: match[2] } : {}) };
  });
  const kind = [localClassName(entry.className, lang), localRaceName(entry.race, lang)].filter(Boolean).join(" ");
  return {
    eyebrow: fr ? "Guilded · Temple de la renommée" : "Guilded · Hall of Fame", title: entry.name, subtitle: fr ? `${kind} · niveau ${LEVEL_CAP}` : `${kind} · level ${LEVEL_CAP}`,
    stats: [
      { label: fr ? `Arrivé au niveau ${LEVEL_CAP}` : `Reached level ${LEVEL_CAP}`, value: ordinal(entry.order, lang), note: fr ? `${ordinal(entry.order, lang)} à atteindre le niveau ${LEVEL_CAP}` : `${ordinal(entry.order, lang)} to reach level ${LEVEL_CAP}`, accent: "gold" },
      ...(took !== null ? [{ label: fr ? "Temps pour le 60" : "Time to 60", value: formatDuration(took, lang), note: fr ? "depuis le lancement, 4 nov. 2026" : "since launch, 4 Nov 2026", accent: "green" as const }] : []),
      { label: "Date", value: dayText(entry.reachedAt, lang), accent: "gold" }
    ],
    backdrop: { kind: "board", key: "hall-of-fame" },
    rowsLabel: fr ? "Personnage" : "Character",
    rows: [{ name: localClassName(entry.className, lang), color, sub: localRaceName(entry.race, lang), right: String(LEVEL_CAP), rightTone: "gold" },
      ...(memberName ? [{ name: `@${memberName}`, color: "#f5e6c0", sub: "Discord" }] : []), ...professions],
    badges: [{ text: fr ? "Temple de la renommée" : "Hall of Fame", tone: "ok" }],
    footer: fr ? "Guilded · WoW Forever · course au niveau 60" : "Guilded · WoW Forever · race to level 60"
  };
}

/** Pure: one permanent Hall of Fame post. `image` is the attachment name the card is sent under. */
export function hallEmbed(entry: HallRecord, lang: Lang, guildId = "", nameKey = "", image?: string): EmbedBuilder {
  const fr = lang === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const days = Math.max(0, Math.floor((entry.reachedAt.getTime() - entry.firstSeenAt.getTime()) / 86_400_000));
  const lines = [`**${escapeMarkdown(entry.name).slice(0, 40)}** — ${[entry.className, entry.race].filter(Boolean).join(" ")}`,
    t(`Reached level ${LEVEL_CAP} on ${stamp(entry.reachedAt, "d")}`, `A atteint le niveau ${LEVEL_CAP} le ${stamp(entry.reachedAt, "d")}`)];
  const took = timeToSixty(entry);
  if (took !== null) lines.push(t(`${formatDuration(took, lang)} after launch (4 Nov 2026)`, `${formatDuration(took, lang)} après le lancement (4 nov. 2026)`));
  if (entry.reachedAt.getTime() > entry.firstSeenAt.getTime()) lines.push(t(`${days} day${days === 1 ? "" : "s"} after first being seen in the guild`, `${days} jour${days === 1 ? "" : "s"} après sa première apparition dans la guilde`));
  if (entry.professions) lines.push(entry.professions);
  if (entry.memberDiscordId) lines.push(`<@${entry.memberDiscordId}>`);
  const embed = new EmbedBuilder().setColor(0xffd100).setTitle(t(`🏆 #${entry.order} to reach ${LEVEL_CAP}`, `🏆 N° ${entry.order} à atteindre le niveau ${LEVEL_CAP}`)).setDescription(lines.join("\n"))
    .setFooter({ text: `${HALL_MARKER} • ${guildId} • ${nameKey}`.slice(0, 2048) });
  return image ? embed.setImage(`attachment://${image}`) : embed;
}

/** The message payload of one Hall of Fame post: the embed and its card (no card when drawing is busy or fails). */
export async function hallPayload(entry: HallRecord, lang: Lang, guildId: string, nameKey: string, memberName: string | null = null): Promise<HallPayload> {
  const png = await scoreCardPng(hallCard(entry, lang, memberName)).catch(() => null);
  return { embeds: [hallEmbed(entry, lang, guildId, nameKey, png ? HALL_CARD_FILE : undefined)], files: png ? [cardAttachment(png, HALL_CARD_FILE)] : [], allowedMentions: { parse: [] as never[] } };
}

/** Pure: the single message that replaces individual posts for every 60 found on the first run. */
export function hallSummaryEmbed(entries: HallRecord[], lang: Lang, guildId = ""): EmbedBuilder {
  const t = (en: string, french: string) => lang === "fr" ? french : en;
  const lines: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const line = `**#${entry.order}** ${escapeMarkdown(entry.name).slice(0, 32)} · ${[entry.className, entry.race].filter(Boolean).join(" ")} · ${stamp(entry.reachedAt, "d")}`;
    if (used + line.length + 1 > DESCRIPTION_BUDGET) { lines.push("…"); break; }
    lines.push(line); used += line.length + 1;
  }
  return new EmbedBuilder().setColor(0xffd100).setTitle(t("🏆 Hall of Fame — already at level 60", "🏆 Temple de la renommée — déjà niveau 60"))
    .setDescription(`${t("Found when the Hall of Fame started, in order of their recorded date:", "Trouvés au démarrage du temple, selon la date enregistrée :")}\n\n${lines.join("\n")}`)
    .setFooter({ text: `${HALL_MARKER} • ${guildId} • summary` });
}

interface ProfessionJson { name?: unknown; skillLevel?: unknown }
const professionText = (name: string, skill: number) => `${name} ${skill}`;
const jsonProfessions = (value: unknown): string[] => Array.isArray(value)
  ? (value as ProfessionJson[]).flatMap(item => typeof item?.name === "string" && typeof item.skillLevel === "number" ? [professionText(item.name, item.skillLevel)] : []) : [];

/**
 * The best full name known for a character: a one-word Forever name whose display name is that first name plus a last name shows
 * the display name (8.4.x addons still upload first names, and old rows stay first-name keyed until `npm run names:forever`);
 * otherwise a full name from the other source with the same key, otherwise the stored name. Keys never change here.
 */
export function bestName(name: string, displayName: string | null | undefined, otherFull: string | null = null): string {
  return fullNameOf({ name, displayName: displayName ?? null }) ?? otherFull ?? name;
}

/**
 * Pure: one entry per character even when a first-name copy and a full-name copy both exist (8.4.x addons keep uploading first
 * names, and the production rename left old rows behind). A one-word key joins the full-name key when its own name is already
 * full, or when exactly one full-name character starts with it; otherwise it stays alone. The linked copy wins, then the higher
 * level; `aliasKeys` lists the first-name keys that were folded in so stored entries can be merged.
 */
export function mergeFirstNames(chars: readonly RaceChar[]): RaceChar[] {
  const fullByFirst = new Map<string, Map<string, string>>(); // first word -> full key -> full name
  for (const char of chars) {
    if (!char.key.includes(" ")) continue;
    const first = char.key.split(" ")[0]!;
    const names = fullByFirst.get(first) ?? new Map<string, string>();
    names.set(char.key, char.name); fullByFirst.set(first, names);
  }
  const out = new Map<string, RaceChar>();
  for (const char of chars) {
    let key = char.key, name = char.name;
    if (!key.includes(" ")) {
      const own = char.name.trim().replace(/\s+/g, " ");
      const candidates = [...(fullByFirst.get(key) ?? new Map<string, string>()).entries()];
      if (own.includes(" ") && own.toLowerCase().startsWith(`${key} `)) { key = own.toLowerCase(); name = own; }
      else if (candidates.length === 1) { key = candidates[0]![0]; name = candidates[0]![1]; }
    }
    const aliases = key !== char.key ? [char.key] : [];
    const have = out.get(key);
    if (!have) { out.set(key, { ...char, key, name, aliasKeys: [...(char.aliasKeys ?? []), ...aliases] }); continue; }
    const winner = have.memberId ? have : char.memberId ? { ...char, key, name } : have.level >= char.level ? have : { ...char, key, name };
    out.set(key, { ...winner, key, name: name.length > have.name.length ? name : have.name, level: Math.max(have.level, char.level),
      lastSeenAt: [have.lastSeenAt, char.lastSeenAt].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      aliasKeys: [...new Set([...(have.aliasKeys ?? []), ...(char.aliasKeys ?? []), ...aliases])] });
  }
  return [...out.values()];
}

/** Pure: the stored state of a merged character: highest level, earliest finish, earliest first sighting; the full-name entry's week baseline. */
export function mergeStored<T extends { level: number; reachedMaxAt: Date | null; firstSeenAt: Date }>(primary: T, others: readonly T[]): T {
  const all = [primary, ...others];
  const finished = all.flatMap(entry => entry.reachedMaxAt ? [entry.reachedMaxAt] : []).sort((a, b) => a.getTime() - b.getTime());
  return { ...primary, level: Math.max(...all.map(entry => entry.level)), reachedMaxAt: finished[0] ?? null,
    firstSeenAt: all.map(entry => entry.firstSeenAt).sort((a, b) => a.getTime() - b.getTime())[0]! };
}

/** Records every guild character's level, then returns the board's data. */
export async function loadRaceBoardData(db: Pick<PrismaClient, "character" | "unclaimedCharacter" | "levelRaceEntry">, guildId: string, edition: string, now = new Date(), timezone?: string): Promise<RaceBoardData> {
  const dayFrom = timezone ? dayStart(participationDay(now, timezone), timezone) : undefined;
  const linked = await db.character.findMany({ where: { guildId, gameEdition: edition, level: { not: null }, member: { guildId, status: "ACTIVE" } },
    select: { name: true, displayName: true, realm: true, className: true, race: true, level: true, memberId: true, lastSeenAt: true, member: { select: { discordUserId: true } },
      professions: { select: { profession: true, skillLevel: true }, orderBy: { skillLevel: "desc" } } } });
  const unclaimed = await db.unclaimedCharacter.findMany({ where: { guildId, gameEdition: edition, level: { not: null } },
    select: { nameKey: true, name: true, displayName: true, className: true, race: true, level: true, professions: true, lastSeenAt: true } });
  const unclaimedFull = new Map(unclaimed.flatMap(row => { const full = fullNameOf({ name: row.name, displayName: row.displayName }); return full ? [[row.nameKey, full] as const] : []; }));
  const chars = new Map<string, RaceChar>();
  for (const row of unclaimed) if (row.level) chars.set(row.nameKey, { key: row.nameKey, name: bestName(row.name, row.displayName), className: row.className, race: row.race, level: row.level,
    memberId: null, discordId: null, professions: jsonProfessions(row.professions), lastSeenAt: row.lastSeenAt });
  // A linked character wins over a stale unclaimed copy of the same name.
  for (const row of linked) {
    const key = String(characterKey(row.name, row.realm, edition));
    if (row.level) chars.set(key, { key, name: bestName(row.name, row.displayName, unclaimedFull.get(key) ?? null), className: row.className, race: row.race, level: row.level, memberId: row.memberId, discordId: row.member?.discordUserId ?? null,
      professions: (row.professions ?? []).map(skill => professionText(skill.profession, skill.skillLevel)), lastSeenAt: row.lastSeenAt });
  }
  const stored = new Map((await db.levelRaceEntry.findMany({ where: { guildId } })).map(entry => [entry.nameKey, entry]));
  const rows: RaceRow[] = [];
  for (const char of mergeFirstNames([...chars.values()])) {
    const legacy = (char.aliasKeys ?? []).flatMap(alias => stored.get(alias) ?? []);
    const own = stored.get(char.key);
    const primary = own ?? legacy[0];
    const before = primary ? mergeStored(primary, own ? legacy : legacy.slice(1)) : null;
    const next = nextEntry(before, char.level, now, dayFrom);
    const changed = !before || legacy.length > 0 || before.level !== next.level || before.name !== char.name || before.className !== char.className
      || before.weekStartLevel !== next.weekStartLevel || before.weekStartedAt.getTime() !== next.weekStartedAt.getTime() || before.reachedMaxAt?.getTime() !== next.reachedMaxAt?.getTime()
      || before.dayStartLevel !== next.dayStartLevel || before.dayStartedAt?.getTime() !== next.dayStartedAt?.getTime();
    if (changed) await db.levelRaceEntry.upsert({ where: { guildId_nameKey: { guildId, nameKey: char.key } },
      create: { guildId, nameKey: char.key, name: char.name, className: char.className, ...next, firstSeenAt: before?.firstSeenAt ?? now }, update: { name: char.name, className: char.className, ...next, ...(before ? { firstSeenAt: before.firstSeenAt } : {}) } });
    if (legacy.length) await db.levelRaceEntry.deleteMany({ where: { guildId, nameKey: { in: char.aliasKeys ?? [] } } });
    rows.push({ ...(char.aliasKeys?.length ? { aliasKeys: char.aliasKeys } : {}), key: char.key, name: char.name, className: char.className, race: char.race, level: next.level, reachedMaxAt: next.reachedMaxAt, firstSeenAt: before?.firstSeenAt ?? now,
      weekGain: Math.max(0, next.level - next.weekStartLevel), memberId: char.memberId, discordId: char.discordId, professions: char.professions, lastSeenAt: char.lastSeenAt });
  }
  const ordered = orderRace(rows);
  return { rows: ordered, total: ordered.length, finished: ordered.filter(row => row.level >= LEVEL_CAP).length, edition };
}

type HallDb = Pick<PrismaClient, "raceHallEntry" | "memberMilestone">;
interface HallPayload { embeds: EmbedBuilder[]; files: AttachmentBuilder[]; allowedMentions: { parse: never[] }; attachments?: never[] }
interface HallMessage { id: string; editable?: boolean; embeds?: { footer?: { text?: string | null } | null }[]; edit(payload: HallPayload): Promise<unknown>; delete?: () => Promise<unknown> }
interface HallChannel {
  send(payload: HallPayload): Promise<{ id: string }>;
  messages?: { fetch(arg: string | { limit: number }): Promise<unknown> };
}

/**
 * The Hall of Fame. First run (no `raceHallBackfilledAt`): every 60 already on the board is stored, in order of the member's
 * recorded level-60 milestone date when there is one, and announced with ONE summary message. Afterwards each new 60 is
 * claimed in the database first (the unique keys stop a second post after a restart or a parallel refresh), then posted;
 * a post that failed is retried on the next refresh. Posted messages are never edited or deleted.
 */
export interface HallStored extends HallRecord { id: string; nameKey: string; messageId: string | null; posted: boolean; backfilled: boolean; removed?: boolean }

/** Rewrites the one backfill summary message (found by its footer in the last 100 messages) from the live backfilled entries. False when it is not found. */
export async function rewriteHallSummary(channel: HallChannel, guildId: string, entries: readonly HallRecord[], lang: Lang): Promise<boolean> {
  const messages = channel.messages;
  if (!messages) return false;
  const recent = await messages.fetch({ limit: 100 }).catch(() => null) as Map<string, HallMessage> | null | undefined;
  const list = recent && typeof recent.values === "function" ? [...recent.values()] : [];
  const summary = list.find(message => message.embeds?.some(embed => embed.footer?.text?.startsWith(`${HALL_MARKER} • ${guildId} • summary`))) ?? null;
  if (!summary) return false;
  await summary.edit({ embeds: [hallSummaryEmbed([...entries].sort((a, b) => a.order - b.order), lang, guildId)], files: [], allowedMentions: { parse: [] as never[] } });
  return true;
}

/**
 * A name only ever grows here: when the board now knows a character's full name ("Chad" became "Chad Ho"), the stored entry takes
 * it and its permanent post is edited to match (the owner allows editing permanent posts for this). The one summary message of
 * the backfill is found by its footer and rewritten once. A failed edit leaves the old name so the next refresh tries again.
 */
export async function refreshHallNames(db: HallDb, channel: HallChannel, guildId: string, existing: HallStored[], rows: readonly RaceRow[], lang: Lang, memberName: (discordId: string) => string | null = () => null): Promise<number> {
  const best = new Map(rows.map(row => [row.key, row.name]));
  const changed = existing.filter(entry => !entry.removed).filter(entry => { const name = best.get(entry.nameKey); return name !== undefined && Boolean(entry.name) && name !== entry.name && name.toLowerCase().startsWith(`${entry.name.toLowerCase()} `); });
  if (!changed.length) return 0;
  const messages = channel.messages;
  const fetchOne = async (id: string): Promise<HallMessage | null> => {
    const found = await messages?.fetch(id).catch(() => null) as HallMessage | null | undefined;
    return found && typeof found.edit === "function" ? found : null;
  };
  let renamed = 0;
  const summaryChanges: HallStored[] = [];
  for (const entry of changed) {
    const name = best.get(entry.nameKey)!;
    try {
      if (entry.backfilled) { summaryChanges.push(entry); continue; }
      if (entry.posted && entry.messageId && messages) {
        const message = await fetchOne(entry.messageId);
        if (message) await message.edit({ ...await hallPayload({ ...entry, name }, lang, guildId, entry.nameKey, entry.memberDiscordId ? memberName(entry.memberDiscordId) : null), attachments: [] });
      }
      await db.raceHallEntry.update({ where: { id: entry.id }, data: { name } });
      entry.name = name; renamed++;
    } catch (error) { console.warn(`Hall of Fame name edit failed for ${entry.nameKey}; retrying next refresh`, error); }
  }
  if (summaryChanges.length) {
    try {
      const everyone = existing.filter(entry => entry.backfilled && !entry.removed).sort((a, b) => a.order - b.order)
        .map(entry => ({ ...entry, name: summaryChanges.includes(entry) ? best.get(entry.nameKey)! : entry.name }));
      await rewriteHallSummary(channel, guildId, everyone, lang);
      for (const entry of summaryChanges) { await db.raceHallEntry.update({ where: { id: entry.id }, data: { name: best.get(entry.nameKey)! } }); entry.name = best.get(entry.nameKey)!; renamed++; }
    } catch (error) { console.warn("Hall of Fame summary name edit failed; retrying next refresh", error); }
  }
  return renamed;
}

/**
 * One Hall of Fame entry per character. When a first-name entry and a full-name entry both exist for the same character, the
 * earliest number is kept (moved to the full-name key), the other row and its post are removed. A lone first-name entry just
 * takes the full-name key. Mutates `existing` to match.
 */
export async function dedupeHallEntries(db: HallDb, channel: HallChannel, existing: HallStored[], rows: readonly RaceRow[]): Promise<number> {
  let removed = 0;
  for (const row of rows) {
    const keys = new Set([row.key, ...(row.aliasKeys ?? [])]);
    const group = existing.filter(entry => !entry.removed && keys.has(entry.nameKey)).sort((a, b) => a.order - b.order);
    if (!group.length) continue;
    const [keep, ...extras] = group;
    for (const extra of extras) {
      try {
        if (extra.messageId && !extra.backfilled && channel.messages) {
          const message = await channel.messages.fetch(extra.messageId).catch(() => null) as { delete?: () => Promise<unknown> } | null;
          await message?.delete?.().catch(() => undefined);
        }
        await db.raceHallEntry.delete({ where: { id: extra.id } });
        existing.splice(existing.indexOf(extra), 1); removed++;
      } catch (error) { console.warn("Hall of Fame duplicate removal failed; retrying next refresh", error); }
    }
    if (keep!.nameKey !== row.key && !existing.some(entry => entry !== keep && entry.nameKey === row.key)) {
      try { await db.raceHallEntry.update({ where: { id: keep!.id }, data: { nameKey: row.key } }); keep!.nameKey = row.key; }
      catch (error) { console.warn("Hall of Fame key move failed; retrying next refresh", error); }
    }
  }
  return removed;
}

export async function syncHallOfFame(db: HallDb, channel: HallChannel, guildId: string, data: RaceBoardData, lang: Lang, backfilledAt: Date | null, now = new Date(),
  memberName: (discordId: string) => string | null = () => null): Promise<{ markBackfilled: boolean; posted: number }> {
  const finishers = data.rows.filter(row => row.level >= LEVEL_CAP);
  const existing = await db.raceHallEntry.findMany({ where: { guildId }, orderBy: { order: "asc" } });
  await dedupeHallEntries(db, channel, existing as HallStored[], data.rows);
  await refreshHallNames(db, channel, guildId, existing as HallStored[], data.rows, lang, memberName);
  const known = new Set(existing.map(entry => entry.nameKey));
  const fresh = finishers.filter(row => !known.has(row.key));
  let posted = 0;
  let nextOrder = existing.reduce((max, entry) => Math.max(max, entry.order), 0) + 1;
  const professions = (row: RaceRow) => row.professions.length ? shortProfessions(row.professions, 3) : null;
  const send = (embed: EmbedBuilder) => channel.send({ embeds: [embed], files: [], allowedMentions: { parse: [] as never[] } });
  if (!backfilledAt) {
    if (fresh.length) {
      const milestones = await db.memberMilestone.findMany({ where: { guildId, kind: "level", value: LEVEL_CAP, memberId: { in: fresh.flatMap(row => row.memberId ? [row.memberId] : []) } }, select: { memberId: true, reachedAt: true } });
      const dates = new Map<string, Date>();
      for (const milestone of milestones) { const seen = dates.get(milestone.memberId); if (!seen || milestone.reachedAt < seen) dates.set(milestone.memberId, milestone.reachedAt); }
      const dated = fresh.map(row => ({ row, at: (row.memberId ? dates.get(row.memberId) : undefined) ?? row.reachedMaxAt ?? now }))
        .sort((a, b) => a.at.getTime() - b.at.getTime() || a.row.name.localeCompare(b.row.name));
      const records: HallRecord[] = [];
      for (const { row, at } of dated) {
        const order = nextOrder++;
        await db.raceHallEntry.create({ data: { guildId, nameKey: row.key, order, name: row.name, className: row.className, race: row.race, reachedAt: at, firstSeenAt: row.firstSeenAt,
          professions: professions(row), memberDiscordId: row.discordId, backfilled: true, posted: true } });
        records.push({ order, name: row.name, className: row.className, race: row.race, reachedAt: at, firstSeenAt: row.firstSeenAt, professions: professions(row), memberDiscordId: row.discordId });
      }
      await send(hallSummaryEmbed(records, lang, guildId));
      posted++;
    }
    return { markBackfilled: true, posted };
  }
  const post = async (entry: { id: string; nameKey: string } & HallRecord) => {
    const sent = await channel.send(await hallPayload(entry, lang, guildId, entry.nameKey, entry.memberDiscordId ? memberName(entry.memberDiscordId) : null));
    await db.raceHallEntry.update({ where: { id: entry.id }, data: { posted: true, messageId: sent.id } });
    posted++;
  };
  for (const row of fresh.sort((a, b) => (a.reachedMaxAt?.getTime() ?? 0) - (b.reachedMaxAt?.getTime() ?? 0) || a.name.localeCompare(b.name))) {
    let created;
    try {
      created = await db.raceHallEntry.create({ data: { guildId, nameKey: row.key, order: nextOrder, name: row.name, className: row.className, race: row.race, reachedAt: row.reachedMaxAt ?? now,
        firstSeenAt: row.firstSeenAt, professions: professions(row), memberDiscordId: row.discordId,
        sinceLaunchKnown: Boolean(row.reachedMaxAt && row.reachedMaxAt > row.firstSeenAt && row.reachedMaxAt >= LAUNCH_AT) } });
    } catch { continue; } // another refresh claimed this character or number first
    nextOrder++;
    await post(created).catch((error: unknown) => console.error("Hall of Fame post failed; retrying next refresh", error));
  }
  for (const entry of existing.filter(item => !item.posted && !item.backfilled && !item.removed)) await post(entry).catch((error: unknown) => console.error("Hall of Fame retry failed", error));
  return { markBackfilled: false, posted };
}

// ---- Officer edits (9.1): add a missed character, remove a wrong entry, correct a name, class, date or member ----

export type HallEditError = "not-found" | "ambiguous" | "exists" | "bad-class" | "bad-date";
export type HallResult = { ok: true; entry: HallStored } | { ok: false; error: HallEditError };
type HallEditDb = Pick<PrismaClient, "raceHallEntry">;
const asStored = (row: unknown) => row as HallStored;

/** Pure: the live entry an officer means, by number ("3" or "#3") or by name (exact, or the single first-name match). */
export function findHallEntry(entries: readonly HallStored[], query: string): { entry: HallStored } | { error: "not-found" | "ambiguous" } {
  const active = entries.filter(entry => !entry.removed);
  const text = query.trim().replace(/\s+/g, " ");
  const number = /^#?(\d{1,4})$/.exec(text);
  if (number) { const hit = active.find(entry => entry.order === Number(number[1])); return hit ? { entry: hit } : { error: "not-found" }; }
  const hits = foreverNameMatches(active, text, (entry: HallStored) => entry.name) as HallStored[];
  return hits.length === 1 ? { entry: hits[0]! } : { error: hits.length ? "ambiguous" : "not-found" };
}

/** Pure: the permanent key for a name: the board's key for that character when it is on the board, otherwise the plain lower-cased name. */
export function hallKeyFor(name: string, rows: readonly RaceRow[]): { key: string; row: RaceRow | null } {
  const matches = foreverNameMatches(rows, name, (item: RaceRow) => item.name) as RaceRow[];
  const found = matches.length === 1 ? matches[0]! : null;
  return { key: found?.key ?? String(characterKey(name.trim(), "", "forever")), row: found };
}

/** Live entries in number order, for the officer's list. */
export async function listHallEntries(db: HallEditDb, guildId: string): Promise<HallStored[]> {
  return (await db.raceHallEntry.findMany({ where: { guildId, removed: false }, orderBy: { order: "asc" } })).map(asStored);
}

/** Sends (or re-sends) one entry's permanent post and records its message. A failed post stays unposted for the next refresh. */
async function postEntry(db: HallEditDb, channel: HallChannel, guildId: string, entry: HallStored, lang: Lang, memberName: (id: string) => string | null): Promise<void> {
  try {
    const sent = await channel.send(await hallPayload(entry, lang, guildId, entry.nameKey, entry.memberDiscordId ? memberName(entry.memberDiscordId) : null));
    await db.raceHallEntry.update({ where: { id: entry.id }, data: { posted: true, messageId: sent.id } });
    entry.posted = true; entry.messageId = sent.id;
  } catch (error) { console.warn("Hall of Fame post failed; retrying next refresh", error); }
}

export interface HallAddInput { name: string; className?: string | null; race?: string | null; reachedAt?: Date | null; memberDiscordId?: string | null }

/**
 * Adds a character the Hall missed (or brings back a removed one). Whatever the officer leaves out is taken from the board when
 * the character is on it. It gets the next number and its own post, like any new 60.
 */
export async function addHallEntry(db: HallEditDb, channel: HallChannel, guildId: string, input: HallAddInput, rows: readonly RaceRow[], lang: Lang,
  memberName: (id: string) => string | null = () => null, now = new Date()): Promise<HallResult> {
  const name = input.name.trim().replace(/\s+/g, " ");
  const { key, row } = hallKeyFor(name, rows);
  const className = input.className ? normalizeClass(input.className) : (row?.className ?? null);
  if (!className) return { ok: false, error: "bad-class" };
  const all = (await db.raceHallEntry.findMany({ where: { guildId } })).map(asStored);
  const same = all.find(entry => entry.nameKey === key);
  if (same && !same.removed) return { ok: false, error: "exists" };
  const reachedAt = input.reachedAt ?? row?.reachedMaxAt ?? now;
  const known = input.reachedAt ? input.reachedAt >= LAUNCH_AT : Boolean(row?.reachedMaxAt && row.reachedMaxAt > row.firstSeenAt && row.reachedMaxAt >= LAUNCH_AT);
  const data = { name, className, race: input.race ?? row?.race ?? null, reachedAt, firstSeenAt: row?.firstSeenAt ?? reachedAt, professions: row?.professions.length ? shortProfessions(row.professions, 3) : null,
    memberDiscordId: input.memberDiscordId ?? row?.discordId ?? null, sinceLaunchKnown: known, removed: false, posted: false, messageId: null, backfilled: false };
  const entry = asStored(same
    ? await db.raceHallEntry.update({ where: { id: same.id }, data })
    : await db.raceHallEntry.create({ data: { guildId, nameKey: key, order: all.reduce((max, item) => Math.max(max, item.order), 0) + 1, ...data } }));
  await postEntry(db, channel, guildId, entry, lang, memberName);
  return { ok: true, entry };
}

/**
 * Removes a wrong entry. The row stays as a tombstone (removed) so the next refresh does not add the character again; its post is
 * deleted, or the backfill summary rewritten without it. Numbers are not reused: the others keep the number they were announced with.
 */
export async function removeHallEntry(db: HallEditDb, channel: HallChannel, guildId: string, query: string, lang: Lang): Promise<HallResult> {
  const all = (await db.raceHallEntry.findMany({ where: { guildId }, orderBy: { order: "asc" } })).map(asStored);
  const found = findHallEntry(all, query);
  if ("error" in found) return { ok: false, error: found.error };
  const entry = found.entry;
  if (entry.backfilled) await rewriteHallSummary(channel, guildId, all.filter(item => item.backfilled && !item.removed && item.id !== entry.id), lang);
  else if (entry.messageId && channel.messages) {
    const message = await channel.messages.fetch(entry.messageId).catch(() => null) as HallMessage | null;
    await message?.delete?.().catch(() => undefined);
  }
  await db.raceHallEntry.update({ where: { id: entry.id }, data: { removed: true, posted: false, messageId: null } });
  entry.removed = true;
  return { ok: true, entry };
}

export interface HallEditChanges { newName?: string | null; className?: string | null; race?: string | null; reachedAt?: Date | null; memberDiscordId?: string | null }

/** Corrects an entry's name, class, race, date or member, then rewrites its post (card included) or the backfill summary. */
export async function editHallEntry(db: HallEditDb, channel: HallChannel, guildId: string, query: string, changes: HallEditChanges, rows: readonly RaceRow[], lang: Lang,
  memberName: (id: string) => string | null = () => null): Promise<HallResult> {
  const all = (await db.raceHallEntry.findMany({ where: { guildId }, orderBy: { order: "asc" } })).map(asStored);
  const found = findHallEntry(all, query);
  if ("error" in found) return { ok: false, error: found.error };
  const entry = found.entry;
  const data: Record<string, unknown> = {};
  if (changes.className) { const className = normalizeClass(changes.className); if (!className) return { ok: false, error: "bad-class" }; data["className"] = className; }
  if (changes.newName) {
    const name = changes.newName.trim().replace(/\s+/g, " "), { key } = hallKeyFor(name, rows);
    if (all.some(item => item.id !== entry.id && item.nameKey === key)) return { ok: false, error: "exists" };
    data["name"] = name; data["nameKey"] = key;
  }
  if (changes.race) data["race"] = changes.race.trim();
  if (changes.memberDiscordId) data["memberDiscordId"] = changes.memberDiscordId;
  if (changes.reachedAt) { data["reachedAt"] = changes.reachedAt; data["sinceLaunchKnown"] = changes.reachedAt >= LAUNCH_AT; }
  if (!Object.keys(data).length) return { ok: true, entry };
  await db.raceHallEntry.update({ where: { id: entry.id }, data });
  Object.assign(entry, data);
  if (entry.backfilled) await rewriteHallSummary(channel, guildId, all.filter(item => item.backfilled && !item.removed), lang);
  else if (entry.messageId && channel.messages) {
    const message = await channel.messages.fetch(entry.messageId).catch(() => null) as HallMessage | null;
    if (message && typeof message.edit === "function") await message.edit({ ...await hallPayload(entry, lang, guildId, entry.nameKey, entry.memberDiscordId ? memberName(entry.memberDiscordId) : null), attachments: [] });
    else await postEntry(db, channel, guildId, entry, lang, memberName); // the post was deleted: send it again
  }
  return { ok: true, entry };
}

/** Discord display names for the linked members on the board (cache first, one fetch for the rest); unknown ids are left out. */
export async function memberNames(discordGuild: DiscordGuild, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const missing = ids.filter(id => !discordGuild.members.cache.has(id));
  if (missing.length) await discordGuild.members.fetch({ user: missing.slice(0, 100) }).catch(() => null);
  for (const id of ids) { const name = discordGuild.members.cache.get(id)?.displayName; if (name) names.set(id, name); }
  return names;
}

export const RACE_BOARD_TITLES = ["🏁 Race to 60", "🏁 Course au niveau 60", "🏆 Hall of Fame — level 60", "🏆 Temple de la renommée — niveau 60"] as const;
const isBoard = (message: Message, botId: string) => isOwnBoard(message, botId, RACE_BOARD_MARKER, RACE_BOARD_TITLES);

/**
 * Creates the `race-to-60` channel for `/setup` when none exists: visible to the member role only, read-only for everyone.
 * Returns null when it is unsafe to guess, in which case the caller asks the officer to pick a channel.
 */
export async function createRaceChannel(discordGuild: DiscordGuild, memberRoleId: string | null, lang: Lang): Promise<{ id: string; open: boolean } | null> {
  if (!discordGuild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;
  // With no member role the channel is visible to everyone and read-only; `open` tells the caller to say so.
  const gated = Boolean(memberRoleId && memberRoleId !== discordGuild.id && discordGuild.roles.cache.has(memberRoleId));
  const me = discordGuild.members.me.id;
  const lockBits = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads];
  const channel = await discordGuild.channels.create({ name: lang === "fr" ? "course-au-60" : "race-to-60", type: ChannelType.GuildText,
    topic: lang === "fr" ? "Course au niveau 60 de la guilde et temple de la renommée, tenus à jour par Guilded." : "The guild's race to level 60 and its Hall of Fame, kept up to date by Guilded.",
    permissionOverwrites: [
      gated ? { id: discordGuild.id, deny: [PermissionFlagsBits.ViewChannel, ...lockBits] } : { id: discordGuild.id, deny: lockBits },
      ...(gated ? [{ id: memberRoleId!, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: lockBits }] : []),
      { id: me, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] }
    ], reason: "Guilded race to 60 board" });
  return { id: channel.id, open: !gated };
}

/**
 * `/setup` hook: with the board on (the default) and no channel yet, adopt a channel already named race-to-60 or create one,
 * then post the board. Returns "" when there is nothing to do, so `/setup` is unchanged for servers that switched it off.
 */
export async function ensureRaceBoard(discordGuild: DiscordGuild, guildId: string, lang: Lang): Promise<string> {
  const settings = await guildService.getSettings(guildId);
  if (!settings?.raceBoardEnabled) return "";
  const say = (en: string, french: string) => lang === "fr" ? french : en;
  try {
    let channelId = settings.raceBoardChannelId;
    let openNote = "";
    if (!channelId) {
      await discordGuild.channels.fetch();
      const named = discordGuild.channels.cache.filter(c => c.type === ChannelType.GuildText && ["race-to-60", "course-au-60"].includes(c.name));
      if (named.size > 1) return say("Several race-to-60 channels exist: pick one with /character race board-on.", "Plusieurs salons course-au-60 existent : choisissez-en un avec /character race board-on.");
      const made = named.size ? null : await createRaceChannel(discordGuild, settings.memberRoleId ?? null, lang);
      channelId = named.first()?.id ?? made?.id ?? null;
      openNote = made?.open ? say(" It is visible to everyone because no member role is set; restrict it later.", " Il est visible par tous car aucun rôle membre n'est défini; restreignez-le plus tard.") : "";
      if (!channelId) return say("Race to 60 board: pick its channel with /character race board-on (I need Manage Channels to create one).", "Tableau de la course au 60 : choisissez son salon avec /character race board-on (il me faut Gérer les salons pour en créer un).");
      await guildService.updateSettings(guildId, { raceBoardChannelId: channelId });
    }
    const posted = await updateRaceBoard(discordGuild);
    return say(`Race to 60 board ${posted ? "ready" : "saved"} in <#${channelId}>.${openNote}`, `Tableau de la course au 60 ${posted ? "prêt" : "enregistré"} dans <#${channelId}>.${openNote}`);
  } catch (error) {
    return `⚠️ ${say("Race to 60 board didn't finish: ", "Le tableau de la course au 60 n'a pas fini : ")}${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Edits the saved board message in place (it stays the channel's first message), then posts any new Hall of Fame entries.
 * If the board is gone, adopts an existing bot board in the channel before ever posting a new one. Never throws.
 * `delivery` is the job worker's call; any other call queues the refresh.
 */
export async function updateRaceBoard(discordGuild: DiscordGuild | null, delivery = false): Promise<boolean> {
  if (!discordGuild) return false;
  if (!delivery) {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.raceBoardEnabled || !settings.raceBoardChannelId) return false;
    const job = await enqueueDiscordJob(prisma, guild.id, "race-board", "RACE_BOARD");
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
  }
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.raceBoardEnabled || !settings.raceBoardChannelId) return false;
    const channel = await discordGuild.channels.fetch(settings.raceBoardChannelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const lang = asLang(settings.language);
    const top = clampTop(settings.raceBoardTop);
    const data = await loadRaceBoardData(prisma, guild.id, guild.gameEdition ?? "forever", new Date(), settings.timezone);
    const hall = hallMode(data, settings.raceEnded);
    const names = await memberNames(discordGuild, [...new Set(data.rows.flatMap(row => row.discordId ? [row.discordId] : []))]);
    // Today's ranks are stored on every refresh; the card shows the change since the latest earlier day.
    const moves = data.total && !hall ? await trackRanks(prisma, guild.id, "race", leaderboardOrder(data.rows).map(row => row.key)) : null;
    const png = data.total && !hall ? await scoreCardPng(raceCard(data, lang, top, names, new Date(), moves)).catch(() => null) : null;
    const embed = raceBoardEmbed(data, lang, { image: png ? RACE_CARD_FILE : undefined, top, hall }).setTimestamp(new Date());
    const payload = { embeds: [embed], files: png ? [cardAttachment(png, RACE_CARD_FILE)] : [], allowedMentions: { parse: [] as never[] } };
    const botId = discordGuild.client.user?.id ?? "";
    let existing: Message | null = settings.raceBoardMessageId ? await channel.messages.fetch(settings.raceBoardMessageId).catch(() => null) : null;
    if (existing && existing.author.id !== botId) existing = null;
    if (!existing) {
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      existing = recent?.find(message => isBoard(message, botId)) ?? null;
    }
    if (existing?.editable) {
      await existing.edit({ ...payload, attachments: [] });
      if (existing.id !== settings.raceBoardMessageId) await guildService.updateSettings(guild.id, { raceBoardMessageId: existing.id });
    } else {
      const sent = await channel.send(payload);
      await guildService.updateSettings(guild.id, { raceBoardMessageId: sent.id });
    }
    // The board is posted first, so it stays the first message; the Hall of Fame follows it.
    const result = await syncHallOfFame(prisma, channel as unknown as HallChannel, guild.id, data, lang, settings.raceHallBackfilledAt ?? null, new Date(), id => names.get(id) ?? null).catch((error: unknown) => { console.error("Hall of Fame sync failed", error); return null; });
    if (result?.markBackfilled) await guildService.updateSettings(guild.id, { raceHallBackfilledAt: new Date() });
    return true;
  } catch (error) {
    console.error("Failed to update race board", error);
    return false;
  }
}
