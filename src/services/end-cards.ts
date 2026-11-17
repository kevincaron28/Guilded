// 9.3: badges are the painted ones (tier frame + emblem) when their assets exist, else the old SVG: badgeIcon decides.
import { badgeIcon as badgeInner } from "./achievement-badges.js";
import { POE_TRACKING_ENABLED } from "../../companion/active-games.mjs";
import { ACTIVE_ACHIEVEMENTS, TIER_COLOR, TIER_LABEL, achievementById, groupLabel, ladderKey, isHiddenSecret, secretCountLabel, SECRET_TAG, SECRET_LABEL, type AchievementDef, type AchievementGame, type AchievementTier } from "./achievements-catalogue.js";
import type { RaidReport } from "./raid-report.js";
import { formatDuration } from "./raid-report.js";
import { cardDate } from "./card-format.js";
import { classColor, type CardRow, type ScoreCard } from "./score-card.js";

type Lang = "en" | "fr";
const pick = (lang: Lang) => (en: string, fr: string) => lang === "fr" ? fr : en;

/**
 * Which painted raid backdrop a report asks for: the raid has no instance field, so the key comes from its title and the bosses it killed
 * (English and French names). Anything not recognised falls back to raid/default.
 */
export function raidArtKey(report: Pick<RaidReport, "title" | "killedNames">): string {
  const text = [report.title, ...report.killedNames].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/molten core|c(?:oe|œ)ur du magma|\b(?:lucifron|magmadar|gehennas|shazzrah|baron geddon|sulfuron|golemagg|majordomo|ragnaros)\b/.test(text)) return "molten-core";
  if (/onyxia|repaire d'onyxia/.test(text)) return "onyxias-lair";
  if (/blackwing|aile noire|\b(?:razorgore|vaelastrasz|lashlayer|firemaw|gueule-de-feu|ebonroc|flamegor|chromaggus|nefarian|tranchetripe)\b/.test(text)) return "blackwing-lair";
  return "default";
}

/** "2 h 10" / "2h 10m" for the raid's length; "—" when the raid has no recorded start or end. */
const raidLength = (minutes: number | null, lang: Lang) => {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return lang === "fr" ? (hours > 0 ? `${hours} h ${String(rest).padStart(2, "0")}` : `${minutes} min`) : formatDuration(minutes);
};

/**
 * A finished raid: bosses down, time, attendance, and the loot that went out. No per-player performance. Every figure has its own label
 * and value (no "Duration · 1 absent"); the bosses that died are ticked rows. A raid with no named kill shows its attendance as rows
 * instead, so the card is never mostly empty. Members never see EP/GP: they are "raid points".
 */
export function raidEndCard(report: RaidReport, lang: Lang = "en", timeZone?: string): ScoreCard {
  const t = pick(lang);
  const cleared = report.bossesPlanned > 0 && report.bossesKilled >= report.bossesPlanned;
  const when = report.endedAt ?? report.startedAt, date = when ? cardDate(when, lang, timeZone) : undefined;
  const lootRows: CardRow[] = report.topLoot.slice(0, 5).map(loot => ({ name: loot.item, sub: `→ ${loot.winner}`, right: `${loot.gp} pts`, rightTone: "gold" }));
  const bossRows: CardRow[] = report.killedNames.slice(0, 5).map(name => ({ name, sub: t("Defeated", "Vaincu"), color: "#6fdc4f", right: t("Down", "Mort"), rightTone: "green" }));
  const named = report.killedNames.length > 0;
  const lateAbsent = { label: t("Late / absent", "En retard / absents"), value: `${report.late} / ${report.absent}` };
  const attendanceRows: CardRow[] = [
    { name: t("Raiders present", "Raiders présents"), right: String(report.raiders), rightTone: "gold" },
    { name: t("Late", "En retard"), right: String(report.late) },
    { name: t("Absent", "Absents"), right: String(report.absent) },
    ...(report.epRecipients ? [{ name: t("Raid points awarded", "Points de raid remis"), right: String(report.epAwarded), rightTone: "green" as const }] : [])
  ];
  return {
    eyebrow: t("Guilded · Raids · Report", "Guilded · Raids · Rapport"), title: report.title,
    subtitle: [report.endedAt ? t("Completed", "Terminé") : t("In progress", "En cours"), date].filter(Boolean).join(" · "),
    stats: [
      { label: t("Bosses defeated", "Boss vaincus"), value: report.bossesPlanned > 0 ? `${report.bossesKilled}/${report.bossesPlanned}` : String(report.bossesKilled), accent: cleared ? "green" : "gold", note: cleared ? t("Full clear", "Raid complété") : report.bossesKilled ? t("Partial clear", "Complété en partie") : t("No kills recorded", "Aucune victoire notée") },
      // With the bosses ticked on the left the right column carries attendance and time; without them the left carries attendance, so the right shows the raid's other facts.
      ...(named ? [
        { label: t("Raiders", "Raiders"), value: String(report.raiders) },
        lateAbsent,
        { label: t("Duration", "Durée"), value: raidLength(report.durationMinutes, lang) }
      ] : [
        { label: t("Duration", "Durée"), value: raidLength(report.durationMinutes, lang) },
        { label: t("Raid points awarded", "Points de raid remis"), value: String(report.epRecipients ? report.epAwarded : 0) },
        { label: t("Items handed out", "Objets distribués"), value: String(report.lootCount) }
      ])
    ],
    backdrop: { kind: "raid", key: raidArtKey(report), fallbackKey: "default" },
    // `checks` feeds the banner layout; `rows` is what the older layout (and a card queued before this) draws.
    ...(named ? { checks: report.killedNames.slice(0, 12) } : {}),
    moreLabel: t("more", "autres"),
    rowsLabel: named ? t("Bosses defeated", "Boss vaincus") : t("Attendance", "Présences"), rows: named ? (lootRows.length ? lootRows : bossRows) : attendanceRows,
    badges: [
      ...(report.epRecipients ? [{ text: t(`${report.epAwarded} raid points to ${report.epRecipients} raiders`, `${report.epAwarded} points de raid à ${report.epRecipients} raiders`), tone: "ok" as const }] : [{ text: t("Raid points pending", "Points de raid en attente"), tone: "muted" as const }]),
      ...(report.lootCount ? [{ text: t(`${report.lootCount} items handed out`, `${report.lootCount} objets distribués`), tone: "muted" as const }] : [])
    ],
    footer: t("Guild raid report · Attendance and loot as recorded by officers · guildedwow.com", "Rapport de raid de guilde · Présences et butin notés par les officiers · guildedwow.com")
  };
}

// Classic battleground map ids; anything else shows its number rather than a guess.
const MAPS: Record<number, string> = { 30: "Alterac Valley", 489: "Warsong Gulch", 529: "Arathi Basin", 566: "Eye of the Storm", 607: "Strand of the Ancients", 628: "Isle of Conquest" };
const MAPS_FR: Record<number, string> = { 30: "Vallée d'Alterac", 489: "Goulet des Chanteguerres", 529: "Bassin d'Arathi", 566: "Œil du cyclone", 607: "Rivage des Anciens", 628: "Île des Conquérants" };
/** The map's name in the guild's language; an id nobody knows reads as a plain "Battleground", never as a number. */
const mapName = (id: number, lang: Lang = "en") => (lang === "fr" ? MAPS_FR[id] : MAPS[id]) ?? (lang === "fr" ? "Champ de bataille" : "Battleground");
/** The painting is chosen by the English name, whatever the language. */
const mapArtKey = (id: number) => (MAPS[id] ?? "default").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export interface BgCardRow { reportId: string; mode: string; mapId: number; bracket: string; endedAt: Date; durationSeconds?: number | undefined; outcome: string; presence: string; status: string; corroborated?: boolean | undefined; reloaded?: boolean | undefined;
  /** The guild players who reported the same match (consented, see battlegroundParty), with their class when known. */
  party?: { name: string; className?: string | undefined }[] | undefined }

/** The label of the player list on a battleground card (the banner layout shows the list only under this label). */
export const BG_PARTY_LABEL: Record<Lang, string> = { en: "Guild players", fr: "Joueurs de la guilde" };

/** End of a match, from the player's own consented postmatch report. Self-only: no roster, damage or honor exists. */
export function battlegroundEndCard(row: BgCardRow, recent: BgCardRow[] = [], lang: Lang = "en", timeZone?: string): ScoreCard {
  const t = pick(lang);
  const outcome = { win: [t("Victory", "Victoire"), "green"], loss: [t("Defeat", "Défaite"), "red"], draw: [t("Draw", "Égalité"), "gold"] }[row.outcome] ?? [t("Unknown", "Inconnu"), "gold"];
  const word = (o: string) => o === "win" ? t("Win", "Victoire") : o === "loss" ? t("Loss", "Défaite") : o === "draw" ? t("Draw", "Égalité") : "—";
  const tone = (o: string) => o === "win" ? "green" as const : o === "loss" ? "red" as const : undefined;
  const minutes = row.durationSeconds === undefined ? "—" : `${Math.floor(row.durationSeconds / 60)}:${String(row.durationSeconds % 60).padStart(2, "0")}`;
  return {
    eyebrow: t("Guilded · Battlegrounds · Result", "Guilded · Champs de bataille · Résultat"), title: mapName(row.mapId, lang),
    subtitle: cardDate(row.endedAt, lang, timeZone),
    stats: [
      { label: t("Result", "Résultat"), value: outcome[0]!, accent: outcome[1] as "green" | "red" | "gold", note: t("As reported after the match", "Selon le rapport après le match") },
      { label: t("Match time", "Durée"), value: minutes, note: row.presence === "complete" ? t("Whole match", "Tout le match") : row.presence === "backfill" ? t("Joined late", "Arrivé en cours") : row.presence === "early-exit" ? t("Left early", "Parti tôt") : undefined },
      { label: t("Format", "Format"), value: row.mode, note: t(`Bracket ${row.bracket}`, `Tranche ${row.bracket}`) }
    ],
    backdrop: { kind: "battleground", key: mapArtKey(row.mapId), fallbackKey: "default" },
    rowsLabel: row.party?.length ? BG_PARTY_LABEL[lang] : t("Your recent matches", "Vos matchs récents"),
    rows: row.party?.length ? row.party.slice(0, 6).map(p => ({ name: p.name, color: classColor(p.className) })) : recent.slice(0, 5).map(r => ({ name: mapName(r.mapId, lang), sub: `${cardDate(r.endedAt, lang, timeZone)} · ${r.mode}`, right: word(r.outcome), rightTone: tone(r.outcome), color: r.reportId === row.reportId ? "#ffd100" : undefined })),
    badges: [
      { text: row.corroborated ? t("Matches a party member's report", "Concorde avec un autre rapport") : t("Provisional result", "Résultat provisoire"), tone: row.corroborated ? "ok" : "warn" },
      ...(row.status !== "PROVISIONAL" ? [{ text: row.status.toLowerCase(), tone: "muted" as const }] : [])
    ],
    footer: t("Private to you · Your own post-match report · Not Blizzard verified · no honor or ranking implied", "Privé · Votre propre rapport d'après-match · Non vérifié par Blizzard · aucun honneur ni classement")
  };
}

export interface AchievementCardItem { id: string; earnedAt: Date | null; value: number }

/** A member's achievements: how many are unlocked, the latest ones, and what is closest. Computed from recorded data only. */
export function achievementsCard(name: string, items: AchievementCardItem[], lang: Lang = "en", timeZone?: string): ScoreCard {
  const t = pick(lang);
  // Legacy rows (replaced by the per-edition ones) only appear if already earned.
  const rows = items.flatMap(item => { const def = achievementById(item.id); return def && (!def.legacy || item.earnedAt) && !isHiddenSecret(def, Boolean(item.earnedAt)) ? [{ def, ...item }] : []; });
  // Secrets nobody has earned stay out of every row and count; they only show as "+N secret" beside the total.
  const hiddenSecrets = items.filter(item => { const def = achievementById(item.id); return def && isHiddenSecret(def, Boolean(item.earnedAt)); }).length;
  const earned = rows.filter(row => row.earnedAt).sort((a, b) => b.earnedAt!.getTime() - a.earnedAt!.getTime());
  const count = (game: AchievementGame) => `${earned.filter(row => row.def.game === game).length}/${rows.filter(row => row.def.game === game).length + ACTIVE_ACHIEVEMENTS.filter(def => def.game === game && !def.secret && !rows.some(row => row.def.id === def.id)).length}`;
  // A long progression shows only its highest earned step, and only its next unearned step as "next", so one ladder cannot crowd the card.
  const topStep = (row: (typeof earned)[number]) => !row.def.rank || !earned.some(other => ladderKey(other.def) === ladderKey(row.def) && other.def.threshold > row.def.threshold);
  const nextStep = (row: (typeof rows)[number]) => !row.def.rank || !rows.some(other => !other.earnedAt && ladderKey(other.def) === ladderKey(row.def) && other.def.threshold < row.def.threshold);
  const next = rows.filter(row => !row.earnedAt && nextStep(row)).map(row => ({ row, ratio: row.value / row.def.threshold })).sort((a, b) => b.ratio - a.ratio)[0]?.row;
  const label = (def: AchievementDef) => def[lang].name;
  const shown: CardRow[] = earned.length
    ? earned.filter(topStep).slice(0, 5).map(row => ({ name: label(row.def), sub: `${cardDate(row.earnedAt!, lang, timeZone)} · ${groupLabel(row.def, lang)}${row.def.secret ? ` · ${SECRET_TAG[lang]}` : ""}`, color: TIER_COLOR[row.def.tier], right: TIER_LABEL[row.def.tier][lang], icon: badgeInner(row.def, true) }))
    : rows.filter(row => !row.earnedAt && nextStep(row)).sort((a, b) => b.value / b.def.threshold - a.value / a.def.threshold).slice(0, 5)
      .map(row => ({ name: label(row.def), sub: `${Math.min(row.value, row.def.threshold)}/${row.def.threshold}`, color: "#8a7a5a", right: t("Locked", "Verrouillé"), icon: badgeInner(row.def, false) }));
  return {
    eyebrow: t("Guilded · Achievements", "Guilded · Succès"), title: name,
    backdrop: { kind: "board", key: "achievements" },
    subtitle: "",
    stats: [
      { label: t("Unlocked", "Débloqués"), value: `${earned.length}/${rows.length}${hiddenSecrets ? ` ${secretCountLabel(hiddenSecrets)}` : ""}`, accent: earned.length ? "gold" : "red", note: t(`${Math.round(rows.length ? (earned.length / rows.length) * 100 : 0)}% of the catalogue`, `${Math.round(rows.length ? (earned.length / rows.length) * 100 : 0)} % du catalogue`) },
      { label: "WoW", value: count("wow") }, { label: t("Guild", "Guilde"), value: count("guild") }
    ],
    rowsLabel: earned.length ? t("Latest achievements", "Derniers succès") : t("Closest to unlocking", "Les plus proches"), rows: shown,
    badges: [
      ...(POE_TRACKING_ENABLED ? [{ text: `PoE2 ${count("poe2")}`, tone: "muted" as const }] : []),
      ...(next ? [{ text: t(`Next: ${label(next.def)} ${Math.min(next.value, next.def.threshold)}/${next.def.threshold}`, `Prochain : ${label(next.def)} ${Math.min(next.value, next.def.threshold)}/${next.def.threshold}`), tone: "ok" as const }] : [])
    ],
    footer: t(`Earned from synced characters, runs, raid attendance${POE_TRACKING_ENABLED ? " and your own PoE2 log" : ""} · No points · guildedwow.com`, `Obtenus à partir des personnages synchronisés, donjons, présences aux raids${POE_TRACKING_ENABLED ? " et de votre journal PoE2" : ""} · Aucun point · guildedwow.com`)
  };
}

export interface ServerAnniversaryCardInput { serverName: string; years: number; founded: Date; members: number; achievementsEarned: number; oldestMembers: { displayName: string; createdAt: Date }[] }

/** The server's birthday: years, members, achievements earned, and the longest-standing members. No points involved. */
export function serverAnniversaryCard(input: ServerAnniversaryCardInput, lang: Lang = "en", timeZone?: string): ScoreCard {
  const t = pick(lang), { years } = input;
  const day = (date: Date) => cardDate(date, lang, timeZone);
  return {
    eyebrow: t("Guilded · Server anniversary", "Guilded · Anniversaire du serveur"), title: input.serverName,
    subtitle: t(`Founded ${day(input.founded)}`, `Fondé le ${day(input.founded)}`),
    stats: [
      { label: t("Years together", "Années ensemble"), value: String(years), accent: "gold", note: t(`Happy ${years === 1 ? "first" : `${years}th`} anniversary!`, years === 1 ? "Joyeux premier anniversaire !" : `Joyeux ${years}e anniversaire !`) },
      { label: t("Members", "Membres"), value: String(input.members) },
      { label: t("Achievements earned", "Succès obtenus"), value: String(input.achievementsEarned) }
    ],
    rowsLabel: t("Longest-standing members", "Membres de longue date"),
    rows: input.oldestMembers.slice(0, 5).map(member => ({ name: member.displayName, sub: t(`Member since ${day(member.createdAt)}`, `Membre depuis le ${day(member.createdAt)}`), color: "#ffd100" })),
    backdrop: { kind: "board", key: "anniversary", fallbackKey: "community" },
    badges: [{ text: t("Members earn Anniversary achievements", "Les membres obtiennent des succès d'anniversaire"), tone: "ok" }],
    footer: t("Celebrating together · Member dates are when each member was first recorded · No points · guildedwow.com", "On fête ensemble · Dates de membre : première inscription de chaque membre · Aucun point · guildedwow.com")
  };
}

const UNLOCK_CARD_MAX = 8;

/**
 * The name a celebration card leads with. Server nicknames often read "Character (Discord name)": past 24 characters the
 * part in brackets is dropped, so the character name stays large instead of being shrunk and cut.
 */
export function cardName(name: string): string {
  const trimmed = name.trim(), bracket = /^(.+?)\s*\([^()]*\)$/.exec(trimmed);
  return bracket && [...trimmed].length > 24 ? bracket[1]!.trim() : trimmed;
}

/** The card for a celebration post: the achievements just unlocked (newest first, up to eight, then a count), with their badges. */
export function achievementUnlockedCard(name: string, ids: string[], totalEarned: number, lang: Lang = "en"): ScoreCard {
  const t = pick(lang);
  name = cardName(name);
  const defs = ids.flatMap(id => { const def = achievementById(id); return def ? [def] : []; });
  const newest = defs.slice().reverse(), shown = newest.slice(0, UNLOCK_CARD_MAX);
  const secretNow = defs.some(def => def.secret);
  const total = Math.max(ACTIVE_ACHIEVEMENTS.filter(def => !def.secret).length + defs.filter(def => def.secret).length, totalEarned), percent = Math.round((totalEarned / Math.max(1, total)) * 100);
  const tierCounts = (Object.keys(TIER_COLOR) as AchievementTier[]).flatMap(tier => { const count = defs.filter(def => def.tier === tier).length; return count ? [{ label: TIER_LABEL[tier][lang], color: TIER_COLOR[tier], count }] : []; });
  return {
    eyebrow: secretNow ? `Guilded · ${t("Secret achievement unlocked!", "Succès secret débloqué !")}` : t("Guilded · Achievement unlocked", "Guilded · Succès débloqué"), title: name,
    backdrop: { kind: "board", key: "achievement-unlocked" },
    subtitle: "",
    stats: [
      { label: t("Unlocked now", "Débloqués"), value: `+${defs.length}`, accent: "gold" },
      { label: t("Total", "Total"), value: `${totalEarned}/${total}` }
    ],
    rowsLabel: secretNow ? SECRET_LABEL[lang] : t("New achievements", "Nouveaux succès"),
    // `rows` keeps the older layout drawable; `unlocks` and the fields after it select the richer one.
    rows: shown.slice(0, 5).map(def => ({ name: def[lang].name, sub: groupLabel(def, lang), color: TIER_COLOR[def.tier], right: def.secret ? SECRET_TAG[lang] : TIER_LABEL[def.tier][lang], icon: badgeInner(def, true) })),
    unlocks: shown.map(def => ({ name: def[lang].name, group: groupLabel(def, lang), detail: def[lang].description, tier: def.secret ? `${SECRET_TAG[lang]} · ${TIER_LABEL[def.tier][lang]}` : TIER_LABEL[def.tier][lang], color: TIER_COLOR[def.tier], icon: badgeInner(def, true) })),
    unlocksMore: newest.length - shown.length, moreLabel: t("more", "autres"),
    progress: { label: t("Achievements unlocked", "Succès débloqués"), value: totalEarned, max: total, note: lang === "fr" ? `${percent} % du catalogue` : `${percent}% of the catalogue` },
    tierCounts,
    footer: t(`Earned from synced characters, runs, raid attendance${POE_TRACKING_ENABLED ? " and the PoE2 log" : ""} · No points · guildedwow.com`, `Obtenus à partir des personnages synchronisés, donjons, présences aux raids${POE_TRACKING_ENABLED ? " et du journal PoE2" : ""} · Aucun point · guildedwow.com`)
  };
}
