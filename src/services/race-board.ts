import { armoryUrl } from "./armory-link.js";
import { AttachmentBuilder, ChannelType, EmbedBuilder, escapeMarkdown, PermissionFlagsBits, type Guild as DiscordGuild, type Message } from "discord.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { prisma } from "../database.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { fullNameOf } from "./forever-names.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { classColor, scoreCardPng, type ScoreCard } from "./score-card.js";
import { previewAllows } from "./feature-preview.js";

// The live "Race to 60" leaderboard and Hall of Fame (8.5, track B1). The channel's FIRST message is the live board: the
// top N guild characters (default 25, officers pick 10-30) with class, race, level bar, professions, last seen and the
// linked Discord member, edited in place after every sync. Every character that reaches 60 then gets its own permanent
// Hall of Fame message, never edited or deleted, backed by a database row so history survives channel resets.
// Same pattern as the duel board: footer marker, pure builders, refresh through discord-jobs. On by default; officers
// switch it off. Members hide their characters with `/character race action:hide`.

const guildService = createGuildService(prisma);
export const RACE_BOARD_MARKER = "Guilded race board";
export const HALL_MARKER = "Guilded hall of fame";
export const LEVEL_CAP = 60;
export const DEFAULT_TOP = 25, MIN_TOP = 10, MAX_TOP = 30;
/** With at least this many tracked characters, everyone reaching 60 switches the board to Hall of Fame mode by itself. */
const AUTO_END_MINIMUM = 3;
const BARS = 14, GAINERS = 5, DESCRIPTION_BUDGET = 3800;

export interface RaceChar { aliasKeys?: string[]; key: string; name: string; className: string; race: string | null; level: number; memberId: string | null; discordId: string | null; professions: string[]; lastSeenAt: Date | null }
export interface RaceEntryState { level: number; reachedMaxAt: Date | null; weekStartLevel: number; weekStartedAt: Date }
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
export function nextEntry(previous: RaceEntryState | null, level: number, now: Date): RaceEntryState {
  const monday = weekStart(now);
  if (!previous || level < previous.level) return { level, reachedMaxAt: level >= LEVEL_CAP ? now : null, weekStartLevel: level, weekStartedAt: monday };
  const rolled = previous.weekStartedAt < monday;
  return {
    level,
    reachedMaxAt: previous.reachedMaxAt ?? (level >= LEVEL_CAP ? now : null),
    weekStartLevel: rolled ? previous.level : previous.weekStartLevel,
    weekStartedAt: rolled ? monday : previous.weekStartedAt
  };
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

export function raceCard(data: RaceBoardData, lang: Lang, top = DEFAULT_TOP): ScoreCard {
  const fr = lang === "fr";
  const ranked = leaderboardOrder(data.rows).slice(0, top);
  return {
    eyebrow: "Guilded · WoW Forever", title: fr ? "Course au niveau 60" : "Race to 60",
    subtitle: fr ? `${data.finished} sur ${data.total} personnages au niveau ${LEVEL_CAP}` : `${data.finished} of ${data.total} characters at level ${LEVEL_CAP}`,
    stats: [], footer: fr ? `Top ${ranked.length} sur ${data.total} · détails dans le message · les membres peuvent se masquer` : `Top ${ranked.length} of ${data.total} · details in the message · members can hide theirs`,
    race: ranked.slice(0, BARS).map(row => ({ name: row.name, color: classColor(row.className), level: row.level, max: LEVEL_CAP, done: row.level >= LEVEL_CAP,
      ...(row.weekGain > 0 ? { note: fr ? `+${row.weekGain} sem.` : `+${row.weekGain} wk` } : {}) }))
  };
}

/** Pure: one leaderboard line. */
export function raceLine(row: RaceRow, rank: number, lang: Lang, hall = false, edition = "forever"): string {
  const fr = lang === "fr";
  const name = escapeMarkdown(row.name).slice(0, 32);
  const kind = [row.className, row.race].filter(Boolean).join(" ");
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
export function raceBoardEmbed(data: RaceBoardData, lang: Lang, guildId = "", options: { image?: string | undefined; top?: number; hall?: boolean } = {}): EmbedBuilder {
  const fr = lang === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const hall = options.hall === true;
  const embed = new EmbedBuilder().setColor(0xffd100).setTitle(hall ? t("🏆 Hall of Fame — level 60", "🏆 Temple de la renommée — niveau 60") : t("🏁 Race to 60", "🏁 Course au niveau 60"));
  if (!data.total) {
    embed.setDescription(t("No levelled character reported yet. Officers' addon uploads fill this board.", "Aucun personnage avec niveau rapporté. Les envois de l'addon des officiers remplissent ce tableau."));
  } else {
    const rows = hall ? data.rows.filter(row => row.level >= LEVEL_CAP).sort((a, b) => (a.reachedMaxAt?.getTime() ?? 0) - (b.reachedMaxAt?.getTime() ?? 0) || a.name.localeCompare(b.name))
      : leaderboardOrder(data.rows).slice(0, clampTop(options.top));
    const head = hall ? t(`**${data.finished}** characters reached level ${LEVEL_CAP}, in arrival order.`, `**${data.finished}** personnages ont atteint le niveau ${LEVEL_CAP}, par ordre d'arrivée.`)
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
    embed.setDescription(`${head}\n\n${lines.join("\n")}`);
    const gainers = data.rows.filter(row => row.weekGain > 0).sort((a, b) => b.weekGain - a.weekGain || a.name.localeCompare(b.name)).slice(0, GAINERS);
    if (gainers.length && !hall) embed.addFields({ name: t("Most levels this week", "Plus de niveaux cette semaine"), value: gainers.map(row => `${escapeMarkdown(row.name).slice(0, 32)} +${row.weekGain}`).join("\n").slice(0, 1024), inline: true });
    embed.addFields({ name: t("Level 60", "Niveau 60"), value: String(data.finished), inline: true });
  }
  if (options.image && data.total) embed.setImage(`attachment://${options.image}`);
  return embed.setFooter({ text: `${RACE_BOARD_MARKER} • ${guildId} • ${t("/character race near finds partners at your level · /character race hide opts out", "/character race near trouve des partenaires de ton niveau · /character race hide pour te masquer")}`.slice(0, 2048) });
}

export interface HallRecord { order: number; name: string; className: string; race: string | null; reachedAt: Date; firstSeenAt: Date; professions: string | null; memberDiscordId: string | null }

/** Pure: one permanent Hall of Fame post. */
export function hallEmbed(entry: HallRecord, lang: Lang, guildId = "", nameKey = ""): EmbedBuilder {
  const fr = lang === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const days = Math.max(0, Math.floor((entry.reachedAt.getTime() - entry.firstSeenAt.getTime()) / 86_400_000));
  const lines = [`**${escapeMarkdown(entry.name).slice(0, 40)}** — ${[entry.className, entry.race].filter(Boolean).join(" ")}`,
    t(`Reached level ${LEVEL_CAP} on ${stamp(entry.reachedAt, "d")}`, `A atteint le niveau ${LEVEL_CAP} le ${stamp(entry.reachedAt, "d")}`),
    t(`${days} day${days === 1 ? "" : "s"} after first being seen in the guild`, `${days} jour${days === 1 ? "" : "s"} après sa première apparition dans la guilde`)];
  if (entry.professions) lines.push(entry.professions);
  if (entry.memberDiscordId) lines.push(`<@${entry.memberDiscordId}>`);
  return new EmbedBuilder().setColor(0xffd100).setTitle(t(`🏆 #${entry.order} to reach ${LEVEL_CAP}`, `🏆 N° ${entry.order} à atteindre le niveau ${LEVEL_CAP}`)).setDescription(lines.join("\n"))
    .setFooter({ text: `${HALL_MARKER} • ${guildId} • ${nameKey}`.slice(0, 2048) });
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

/** Records every guild character's level, then returns the board's data. Hidden members' characters are left out. */
export async function loadRaceBoardData(db: Pick<PrismaClient, "character" | "unclaimedCharacter" | "levelRaceEntry">, guildId: string, edition: string, now = new Date()): Promise<RaceBoardData> {
  const linked = await db.character.findMany({ where: { guildId, gameEdition: edition, level: { not: null }, member: { guildId, status: "ACTIVE", raceHidden: false } },
    select: { name: true, displayName: true, realm: true, className: true, race: true, level: true, memberId: true, lastSeenAt: true, member: { select: { discordUserId: true } },
      professions: { select: { profession: true, skillLevel: true }, orderBy: { skillLevel: "desc" } } } });
  const hiddenLinked = await db.character.findMany({ where: { guildId, gameEdition: edition, member: { guildId, raceHidden: true } }, select: { name: true, realm: true } });
  const unclaimed = await db.unclaimedCharacter.findMany({ where: { guildId, gameEdition: edition, level: { not: null } },
    select: { nameKey: true, name: true, displayName: true, className: true, race: true, level: true, professions: true, lastSeenAt: true } });
  const unclaimedFull = new Map(unclaimed.flatMap(row => { const full = fullNameOf({ name: row.name, displayName: row.displayName }); return full ? [[row.nameKey, full] as const] : []; }));
  const hiddenKeys = new Set(hiddenLinked.map(row => String(characterKey(row.name, row.realm, edition))));
  const chars = new Map<string, RaceChar>();
  for (const row of unclaimed) if (row.level && !hiddenKeys.has(row.nameKey)) chars.set(row.nameKey, { key: row.nameKey, name: bestName(row.name, row.displayName), className: row.className, race: row.race, level: row.level,
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
    const next = nextEntry(before, char.level, now);
    const changed = !before || legacy.length > 0 || before.level !== next.level || before.name !== char.name || before.className !== char.className
      || before.weekStartLevel !== next.weekStartLevel || before.weekStartedAt.getTime() !== next.weekStartedAt.getTime() || before.reachedMaxAt?.getTime() !== next.reachedMaxAt?.getTime();
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
interface HallPayload { embeds: EmbedBuilder[]; allowedMentions: { parse: never[] } }
interface HallMessage { id: string; editable?: boolean; embeds?: { footer?: { text?: string | null } | null }[]; edit(payload: HallPayload): Promise<unknown> }
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
interface HallStored extends HallRecord { id: string; nameKey: string; messageId: string | null; posted: boolean; backfilled: boolean }

/**
 * A name only ever grows here: when the board now knows a character's full name ("Chad" became "Chad Ho"), the stored entry takes
 * it and its permanent post is edited to match (the owner allows editing permanent posts for this). The one summary message of
 * the backfill is found by its footer and rewritten once. A failed edit leaves the old name so the next refresh tries again.
 */
export async function refreshHallNames(db: HallDb, channel: HallChannel, guildId: string, existing: HallStored[], rows: readonly RaceRow[], lang: Lang): Promise<number> {
  const best = new Map(rows.map(row => [row.key, row.name]));
  const changed = existing.filter(entry => { const name = best.get(entry.nameKey); return name !== undefined && Boolean(entry.name) && name !== entry.name && name.toLowerCase().startsWith(`${entry.name.toLowerCase()} `); });
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
        if (message) await message.edit({ embeds: [hallEmbed({ ...entry, name }, lang, guildId, entry.nameKey)], allowedMentions: { parse: [] as never[] } });
      }
      await db.raceHallEntry.update({ where: { id: entry.id }, data: { name } });
      entry.name = name; renamed++;
    } catch (error) { console.warn(`Hall of Fame name edit failed for ${entry.nameKey}; retrying next refresh`, error); }
  }
  if (summaryChanges.length) {
    try {
      const everyone = existing.filter(entry => entry.backfilled).sort((a, b) => a.order - b.order)
        .map(entry => ({ ...entry, name: summaryChanges.includes(entry) ? best.get(entry.nameKey)! : entry.name }));
      let summary: HallMessage | null = null;
      if (messages) {
        const recent = await messages.fetch({ limit: 100 }).catch(() => null) as Map<string, HallMessage> | null | undefined;
        const list = recent && typeof recent.values === "function" ? [...recent.values()] : [];
        summary = list.find(message => message.embeds?.some(embed => embed.footer?.text?.startsWith(`${HALL_MARKER} • ${guildId} • summary`))) ?? null;
      }
      if (summary) await summary.edit({ embeds: [hallSummaryEmbed(everyone, lang, guildId)], allowedMentions: { parse: [] as never[] } });
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
    const group = existing.filter(entry => keys.has(entry.nameKey)).sort((a, b) => a.order - b.order);
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

export async function syncHallOfFame(db: HallDb, channel: HallChannel, guildId: string, data: RaceBoardData, lang: Lang, backfilledAt: Date | null, now = new Date()): Promise<{ markBackfilled: boolean; posted: number }> {
  const finishers = data.rows.filter(row => row.level >= LEVEL_CAP);
  const existing = await db.raceHallEntry.findMany({ where: { guildId }, orderBy: { order: "asc" } });
  await dedupeHallEntries(db, channel, existing as HallStored[], data.rows);
  await refreshHallNames(db, channel, guildId, existing as HallStored[], data.rows, lang);
  const known = new Set(existing.map(entry => entry.nameKey));
  const fresh = finishers.filter(row => !known.has(row.key));
  let posted = 0;
  let nextOrder = existing.reduce((max, entry) => Math.max(max, entry.order), 0) + 1;
  const professions = (row: RaceRow) => row.professions.length ? shortProfessions(row.professions, 3) : null;
  const send = (embed: EmbedBuilder) => channel.send({ embeds: [embed], allowedMentions: { parse: [] as never[] } });
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
    const sent = await send(hallEmbed(entry, lang, guildId, entry.nameKey));
    await db.raceHallEntry.update({ where: { id: entry.id }, data: { posted: true, messageId: sent.id } });
    posted++;
  };
  for (const row of fresh.sort((a, b) => (a.reachedMaxAt?.getTime() ?? 0) - (b.reachedMaxAt?.getTime() ?? 0) || a.name.localeCompare(b.name))) {
    let created;
    try {
      created = await db.raceHallEntry.create({ data: { guildId, nameKey: row.key, order: nextOrder, name: row.name, className: row.className, race: row.race, reachedAt: row.reachedMaxAt ?? now,
        firstSeenAt: row.firstSeenAt, professions: professions(row), memberDiscordId: row.discordId } });
    } catch { continue; } // another refresh claimed this character or number first
    nextOrder++;
    await post(created).catch((error: unknown) => console.error("Hall of Fame post failed; retrying next refresh", error));
  }
  for (const entry of existing.filter(item => !item.posted && !item.backfilled)) await post(entry).catch((error: unknown) => console.error("Hall of Fame retry failed", error));
  return { markBackfilled: false, posted };
}

const isBoard = (message: Message, botId: string) => message.author.id === botId && message.embeds.some(embed => embed.footer?.text?.startsWith(`${RACE_BOARD_MARKER} •`));

/**
 * Creates the `race-to-60` channel for `/setup` when none exists: visible to the member role only, read-only for everyone.
 * Returns null when it is unsafe to guess, in which case the caller asks the officer to pick a channel.
 */
export async function createRaceChannel(discordGuild: DiscordGuild, memberRoleId: string | null, lang: Lang): Promise<{ id: string; open: boolean } | null> {
  if (!discordGuild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;
  // With no member role the channel is visible to everyone and read-only; `open` tells the caller to say so.
  const gated = Boolean(memberRoleId && memberRoleId !== discordGuild.id && discordGuild.roles.cache.has(memberRoleId));
  const me = discordGuild.members.me.id;
  const channel = await discordGuild.channels.create({ name: lang === "fr" ? "course-au-60" : "race-to-60", type: ChannelType.GuildText,
    topic: lang === "fr" ? "Course au niveau 60 de la guilde et temple de la renommée, tenus à jour par Guilded." : "The guild's race to level 60 and its Hall of Fame, kept up to date by Guilded.",
    permissionOverwrites: [
      gated ? { id: discordGuild.id, deny: [PermissionFlagsBits.ViewChannel] } : { id: discordGuild.id, deny: [PermissionFlagsBits.SendMessages] },
      ...(gated ? [{ id: memberRoleId!, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] }] : []),
      { id: me, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] }
    ], reason: "Guilded race to 60 board" });
  return { id: channel.id, open: !gated };
}

/**
 * `/setup` hook: with the board on (the default) and no channel yet, adopt a channel already named race-to-60 or create one,
 * then post the board. Returns "" when there is nothing to do, so `/setup` is unchanged for servers that switched it off.
 */
export async function ensureRaceBoard(discordGuild: DiscordGuild, guildId: string, lang: Lang): Promise<string> {
  if (!previewAllows(discordGuild.id)) return "";
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
  if (!discordGuild || !previewAllows(discordGuild.id)) return false;
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
    const data = await loadRaceBoardData(prisma, guild.id, guild.gameEdition ?? "forever");
    const hall = hallMode(data, settings.raceEnded);
    const png = data.total && !hall ? await scoreCardPng(raceCard(data, lang, top)).catch(() => null) : null;
    const embed = raceBoardEmbed(data, lang, guild.id, { image: png ? "race.png" : undefined, top, hall }).setTimestamp(new Date());
    const payload = { embeds: [embed], files: png ? [new AttachmentBuilder(png, { name: "race.png" })] : [], allowedMentions: { parse: [] as never[] } };
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
    const result = await syncHallOfFame(prisma, channel as unknown as HallChannel, guild.id, data, lang, settings.raceHallBackfilledAt ?? null).catch((error: unknown) => { console.error("Hall of Fame sync failed", error); return null; });
    if (result?.markBackfilled) await guildService.updateSettings(guild.id, { raceHallBackfilledAt: new Date() });
    return true;
  } catch (error) {
    console.error("Failed to update race board", error);
    return false;
  }
}
