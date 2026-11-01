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
