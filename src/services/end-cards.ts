import { badgeInner } from "./achievement-badges.js";
import { ACHIEVEMENTS, GAME_LABEL, TIER_COLOR, TIER_LABEL, achievementById, type AchievementDef, type AchievementGame } from "./achievements-catalogue.js";
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
      { label: t("Duration", "Durée"), value: formatDuration(report.durationMinutes), note: report.absent ? t(`${report.absent} absent`, `${report.absent} absents`) : undefined }
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
  const rows = items.flatMap(item => { const def = achievementById(item.id); return def ? [{ def, ...item }] : []; });
  const earned = rows.filter(row => row.earnedAt).sort((a, b) => b.earnedAt!.getTime() - a.earnedAt!.getTime());
  const count = (game: AchievementGame) => `${earned.filter(row => row.def.game === game).length}/${ACHIEVEMENTS.filter(def => def.game === game).length}`;
  const next = rows.filter(row => !row.earnedAt).map(row => ({ row, ratio: row.value / row.def.threshold })).sort((a, b) => b.ratio - a.ratio)[0]?.row;
  const label = (def: AchievementDef) => def[lang].name;
  const shown: CardRow[] = earned.length
    ? earned.slice(0, 5).map(row => ({ name: label(row.def), sub: `${row.earnedAt!.toISOString().slice(0, 10)} · ${GAME_LABEL[row.def.game][lang]}`, color: TIER_COLOR[row.def.tier], right: TIER_LABEL[row.def.tier][lang], icon: badgeInner(row.def, true) }))
    : rows.filter(row => !row.earnedAt).sort((a, b) => b.value / b.def.threshold - a.value / a.def.threshold).slice(0, 5)
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
      { text: `PoE2 ${count("poe2")}`, tone: "muted" },
      ...(next ? [{ text: t(`Next: ${label(next.def)} ${Math.min(next.value, next.def.threshold)}/${next.def.threshold}`, `Prochain : ${label(next.def)} ${Math.min(next.value, next.def.threshold)}/${next.def.threshold}`), tone: "ok" as const }] : [])
    ],
    footer: t("Earned from synced characters, runs, raid attendance and your own PoE2 log · No points · guilded.kcaron.top", "Obtenus à partir des personnages synchronisés, donjons, présences aux raids et de votre journal PoE2 · Aucun point · guilded.kcaron.top")
  };
}
