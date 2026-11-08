import { badgeInner } from "./achievement-badges.js";
import { POE_TRACKING_ENABLED } from "../../companion/active-games.mjs";
import { ACTIVE_ACHIEVEMENTS, TIER_COLOR, TIER_LABEL, achievementById, groupLabel, ladderKey, type AchievementDef, type AchievementGame, type AchievementTier } from "./achievements-catalogue.js";
import type { RaidReport } from "./raid-report.js";
import { formatDuration } from "./raid-report.js";
import type { CardRow, ScoreCard } from "./score-card.js";

type Lang = "en" | "fr";
const pick = (lang: Lang) => (en: string, fr: string) => lang === "fr" ? fr : en;

/** A finished raid: bosses down, time, attendance, and the loot that went out. No per-player performance. */
export function raidEndCard(report: RaidReport, lang: Lang = "en"): ScoreCard {
  const t = pick(lang);
  const cleared = report.bossesPlanned > 0 && report.bossesKilled >= report.bossesPlanned;
  const date = (report.endedAt ?? report.startedAt)?.toISOString().slice(0, 10);
  const lootRows: CardRow[] = report.topLoot.slice(0, 5).map(loot => ({ name: loot.item, sub: `→ ${loot.winner}`, right: `${loot.gp} GP`, rightTone: "gold" }));
  const bossRows: CardRow[] = report.killedNames.slice(0, 5).map(name => ({ name, sub: t("Defeated", "Vaincu"), color: "#6fdc4f", right: t("Down", "Mort"), rightTone: "green" }));
  return {
    eyebrow: t("Guilded · Raids · Report", "Guilded · Raids · Rapport"), title: report.title,
    subtitle: [report.endedAt ? t("Completed", "Terminé") : t("In progress", "En cours"), date].filter(Boolean).join(" · "),
    stats: [
      { label: t("Bosses defeated", "Boss vaincus"), value: report.bossesPlanned > 0 ? `${report.bossesKilled}/${report.bossesPlanned}` : String(report.bossesKilled), accent: cleared ? "green" : "gold", note: cleared ? t("Full clear", "Raid complété") : report.bossesKilled ? t("Partial clear", "Complété en partie") : t("No kills recorded", "Aucune victoire notée") },
      { label: t("Raiders", "Raiders"), value: String(report.raiders), note: report.late ? t(`${report.late} late`, `${report.late} en retard`) : t("All on time", "Tous à l'heure") },
      { label: t("Duration", "Durée"), value: formatDuration(report.durationMinutes), note: report.absent ? t(`${report.absent} absent`, report.absent === 1 ? "1 absent" : `${report.absent} absents`) : undefined }
    ],
    rowsLabel: lootRows.length ? t("Top loot", "Meilleur butin") : t("Bosses defeated", "Boss vaincus"), rows: lootRows.length ? lootRows : bossRows,
    badges: [
      ...(report.epRecipients ? [{ text: t(`${report.epAwarded} EP to ${report.epRecipients} raiders`, `${report.epAwarded} EP à ${report.epRecipients} raiders`), tone: "ok" as const }] : [{ text: t("EP pending", "EP en attente"), tone: "muted" as const }]),
      ...(report.lootCount ? [{ text: t(`${report.lootCount} items · ${report.gpSpent} GP`, `${report.lootCount} objets · ${report.gpSpent} GP`), tone: "muted" as const }] : [])
    ],
    footer: t("Guild raid report · Attendance and loot as recorded by officers · guilded.kcaron.top", "Rapport de raid de guilde · Présences et butin notés par les officiers · guilded.kcaron.top")
  };
}

// Classic battleground map ids; anything else shows its number rather than a guess.
const MAPS: Record<number, string> = { 30: "Alterac Valley", 489: "Warsong Gulch", 529: "Arathi Basin", 566: "Eye of the Storm", 607: "Strand of the Ancients", 628: "Isle of Conquest" };
const mapName = (id: number) => MAPS[id] ?? `Map ${id}`;

export interface BgCardRow { reportId: string; mode: string; mapId: number; bracket: string; endedAt: Date; durationSeconds?: number | undefined; outcome: string; presence: string; status: string; corroborated?: boolean | undefined; reloaded?: boolean | undefined }

/** End of a match, from the player's own consented postmatch report. Self-only: no roster, damage or honor exists. */
export function battlegroundEndCard(row: BgCardRow, recent: BgCardRow[] = [], lang: Lang = "en"): ScoreCard {
  const t = pick(lang);
  const outcome = { win: [t("Victory", "Victoire"), "green"], loss: [t("Defeat", "Défaite"), "red"], draw: [t("Draw", "Égalité"), "gold"] }[row.outcome] ?? [t("Unknown", "Inconnu"), "gold"];
  const word = (o: string) => o === "win" ? t("Win", "Victoire") : o === "loss" ? t("Loss", "Défaite") : o === "draw" ? t("Draw", "Égalité") : "—";
  const tone = (o: string) => o === "win" ? "green" as const : o === "loss" ? "red" as const : undefined;
  const minutes = row.durationSeconds === undefined ? "—" : `${Math.floor(row.durationSeconds / 60)}:${String(row.durationSeconds % 60).padStart(2, "0")}`;
  return {
    eyebrow: t("Guilded · Battlegrounds · Result", "Guilded · Champs de bataille · Résultat"), title: mapName(row.mapId),
    subtitle: `${row.mode} · ${row.endedAt.toISOString().slice(0, 10)} UTC`,
    stats: [
      { label: t("Result", "Résultat"), value: outcome[0]!, accent: outcome[1] as "green" | "red" | "gold", note: t("As reported after the match", "Selon le rapport après le match") },
      { label: t("Match time", "Durée"), value: minutes, note: row.presence === "complete" ? t("Whole match", "Tout le match") : row.presence === "backfill" ? t("Joined late", "Arrivé en cours") : row.presence === "early-exit" ? t("Left early", "Parti tôt") : undefined },
      { label: t("Format", "Format"), value: row.mode, note: t(`Bracket ${row.bracket}`, `Bracket ${row.bracket}`) }
    ],
    rowsLabel: t("Your recent matches", "Vos matchs récents"),
    rows: recent.slice(0, 5).map(r => ({ name: mapName(r.mapId), sub: `${r.endedAt.toISOString().slice(0, 10)} · ${r.mode}`, right: word(r.outcome), rightTone: tone(r.outcome), color: r.reportId === row.reportId ? "#ffd100" : undefined })),
    badges: [
      { text: row.corroborated ? t("Matches a party member's report", "Concorde avec un autre rapport") : t("Provisional · not yet corroborated", "Provisoire · non corroboré"), tone: row.corroborated ? "ok" : "warn" },
      ...(row.status !== "PROVISIONAL" ? [{ text: row.status.toLowerCase(), tone: "muted" as const }] : [])
    ],
    footer: t("Private to you · Your own post-match report · Not Blizzard verified · no honor or ranking implied", "Privé · Votre propre rapport d'après-match · Non vérifié par Blizzard · aucun honneur ni classement")
  };
}

export interface AchievementCardItem { id: string; earnedAt: Date | null; value: number }

/** A member's achievements: how many are unlocked, the latest ones, and what is closest. Computed from recorded data only. */
export function achievementsCard(name: string, items: AchievementCardItem[], lang: Lang = "en"): ScoreCard {
  const t = pick(lang);
  // Legacy rows (replaced by the per-edition ones) only appear if already earned.
  const rows = items.flatMap(item => { const def = achievementById(item.id); return def && (!def.legacy || item.earnedAt) ? [{ def, ...item }] : []; });
  const earned = rows.filter(row => row.earnedAt).sort((a, b) => b.earnedAt!.getTime() - a.earnedAt!.getTime());
  const count = (game: AchievementGame) => `${earned.filter(row => row.def.game === game).length}/${rows.filter(row => row.def.game === game).length + ACTIVE_ACHIEVEMENTS.filter(def => def.game === game && !rows.some(row => row.def.id === def.id)).length}`;
  // A long progression shows only its highest earned step, and only its next unearned step as "next", so one ladder cannot crowd the card.
  const topStep = (row: (typeof earned)[number]) => !row.def.rank || !earned.some(other => ladderKey(other.def) === ladderKey(row.def) && other.def.threshold > row.def.threshold);
  const nextStep = (row: (typeof rows)[number]) => !row.def.rank || !rows.some(other => !other.earnedAt && ladderKey(other.def) === ladderKey(row.def) && other.def.threshold < row.def.threshold);
  const next = rows.filter(row => !row.earnedAt && nextStep(row)).map(row => ({ row, ratio: row.value / row.def.threshold })).sort((a, b) => b.ratio - a.ratio)[0]?.row;
  const label = (def: AchievementDef) => def[lang].name;
  const shown: CardRow[] = earned.length
    ? earned.filter(topStep).slice(0, 5).map(row => ({ name: label(row.def), sub: `${row.earnedAt!.toISOString().slice(0, 10)} · ${groupLabel(row.def, lang)}`, color: TIER_COLOR[row.def.tier], right: TIER_LABEL[row.def.tier][lang], icon: badgeInner(row.def, true) }))
    : rows.filter(row => !row.earnedAt && nextStep(row)).sort((a, b) => b.value / b.def.threshold - a.value / a.def.threshold).slice(0, 5)
      .map(row => ({ name: label(row.def), sub: `${Math.min(row.value, row.def.threshold)}/${row.def.threshold}`, color: "#8a7a5a", right: t("Locked", "Verrouillé"), icon: badgeInner(row.def, false) }));
  return {
    eyebrow: t("Guilded · Achievements", "Guilded · Succès"), title: name,
    subtitle: t("Computed from recorded guild data", "Données enregistrées de la guilde"),
    stats: [
      { label: t("Unlocked", "Débloqués"), value: `${earned.length}/${rows.length}`, accent: earned.length ? "gold" : "red", note: t(`${Math.round(rows.length ? (earned.length / rows.length) * 100 : 0)}% of the catalogue`, `${Math.round(rows.length ? (earned.length / rows.length) * 100 : 0)} % du catalogue`) },
      { label: "WoW", value: count("wow") }, { label: t("Guild", "Guilde"), value: count("guild") }
    ],
    rowsLabel: earned.length ? t("Latest achievements", "Derniers succès") : t("Closest to unlocking", "Les plus proches"), rows: shown,
    badges: [
      ...(POE_TRACKING_ENABLED ? [{ text: `PoE2 ${count("poe2")}`, tone: "muted" as const }] : []),
      ...(next ? [{ text: t(`Next: ${label(next.def)} ${Math.min(next.value, next.def.threshold)}/${next.def.threshold}`, `Prochain : ${label(next.def)} ${Math.min(next.value, next.def.threshold)}/${next.def.threshold}`), tone: "ok" as const }] : [])
    ],
    footer: t(`Earned from synced characters, runs, raid attendance${POE_TRACKING_ENABLED ? " and your own PoE2 log" : ""} · No points · guilded.kcaron.top`, `Obtenus à partir des personnages synchronisés, donjons, présences aux raids${POE_TRACKING_ENABLED ? " et de votre journal PoE2" : ""} · Aucun point · guilded.kcaron.top`)
  };
}

export interface ServerAnniversaryCardInput { serverName: string; years: number; founded: Date; members: number; achievementsEarned: number; oldestMembers: { displayName: string; createdAt: Date }[] }

/** The server's birthday: years, members, achievements earned, and the longest-standing members. No points involved. */
export function serverAnniversaryCard(input: ServerAnniversaryCardInput, lang: Lang = "en"): ScoreCard {
  const t = pick(lang), { years } = input;
  const day = (date: Date) => date.toISOString().slice(0, 10);
  return {
    eyebrow: t("Guilded · Server anniversary", "Guilded · Anniversaire du serveur"), title: input.serverName,
    subtitle: t(`Founded ${day(input.founded)}`, `Fondé le ${day(input.founded)}`),
    stats: [
      { label: t("Years together", "Années ensemble"), value: String(years), accent: "gold", note: t(`Happy ${years === 1 ? "first" : `${years}th`} anniversary!`, years === 1 ? "Joyeux premier anniversaire !" : `Joyeux ${years}e anniversaire !`) },
      { label: t("Members", "Membres"), value: String(input.members) },
      { label: t("Achievements earned", "Succès obtenus"), value: String(input.achievementsEarned) }
    ],
    rowsLabel: t("Longest-standing members", "Membres de longue date"),
    rows: input.oldestMembers.slice(0, 5).map(member => ({ name: member.displayName, sub: t(`Member since ${day(member.createdAt)}`, `Membre depuis le ${day(member.createdAt)}`), color: "#ffd100", right: "🎂" })),
    badges: [{ text: t("Members earn Anniversary achievements", "Les membres obtiennent des succès d'anniversaire"), tone: "ok" }],
    footer: t("Celebrating together · Member dates are when Guilded first recorded each member · No points · guilded.kcaron.top", "On fête ensemble · Dates de membre : première inscription dans Guilded · Aucun point · guilded.kcaron.top")
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
  const total = Math.max(ACTIVE_ACHIEVEMENTS.length, totalEarned), percent = Math.round((totalEarned / Math.max(1, total)) * 100);
  const tierCounts = (Object.keys(TIER_COLOR) as AchievementTier[]).flatMap(tier => { const count = defs.filter(def => def.tier === tier).length; return count ? [{ label: TIER_LABEL[tier][lang], color: TIER_COLOR[tier], count }] : []; });
  return {
    eyebrow: t("Guilded · Achievement unlocked", "Guilded · Succès débloqué"), title: name,
    subtitle: t("Computed from recorded guild data", "Données enregistrées de la guilde"),
    stats: [
      { label: t("Unlocked now", "Débloqués"), value: `+${defs.length}`, accent: "gold" },
      { label: t("Total", "Total"), value: `${totalEarned}/${total}` }
    ],
    rowsLabel: t("New achievements", "Nouveaux succès"),
    // `rows` keeps the older layout drawable; `unlocks` and the fields after it select the richer one.
    rows: shown.slice(0, 5).map(def => ({ name: def[lang].name, sub: groupLabel(def, lang), color: TIER_COLOR[def.tier], right: TIER_LABEL[def.tier][lang], icon: badgeInner(def, true) })),
    unlocks: shown.map(def => ({ name: def[lang].name, group: groupLabel(def, lang), detail: def[lang].description, tier: TIER_LABEL[def.tier][lang], color: TIER_COLOR[def.tier], icon: badgeInner(def, true) })),
    unlocksMore: newest.length - shown.length, moreLabel: t("more", "autres"),
    progress: { label: t("Achievements unlocked", "Succès débloqués"), value: totalEarned, max: total, note: lang === "fr" ? `${percent} % du catalogue` : `${percent}% of the catalogue` },
    tierCounts,
    footer: t(`Earned from synced characters, runs, raid attendance${POE_TRACKING_ENABLED ? " and the PoE2 log" : ""} · No points · guilded.kcaron.top`, `Obtenus à partir des personnages synchronisés, donjons, présences aux raids${POE_TRACKING_ENABLED ? " et du journal PoE2" : ""} · Aucun point · guilded.kcaron.top`)
  };
}
