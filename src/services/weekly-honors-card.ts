import type { Lang } from "../i18n.js";
import type { ScoreCard, WeeklyIcon } from "./score-card.js";

/**
 * The weekly honors post as ONE picture (19 Nov 2026, owner request): the week's title, the MVP, the top three with medals, the rookie of
 * the week and the guild's week as icons with figures. The post's text then only congratulates and tags the MVP. The layout is
 * card-podium.ts (`renderWeeklyHonorsCard`). No brand text in the picture; the MVP's avatar is added at delivery (`cardMember`).
 */
export interface WeeklyHonorsInput {
  /** "The week of 9 November to 15 November" (without the star emoji). */
  title: string;
  mvp: { name: string; points: number; lead?: number | undefined; times?: number | undefined };
  top: { rank: number; name: string; points: number }[];
  rookie?: { name: string; points: number; place: number; ranked: number } | null | undefined;
  recap: { points: number; members: number; messages: number; reactions: number; voiceHours: number; activities: number; raids: number; bossKills: number; dungeonRuns: number; newMembers: number };
}

export function weeklyHonorsCard(lang: Lang, input: WeeklyHonorsInput): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const n = (value: number) => value.toLocaleString(fr ? "fr-CA" : "en-CA");
  const ordinal = (value: number) => fr ? `${value}${value === 1 ? "re" : "e"}` : `${value}${[11, 12, 13].includes(value % 100) ? "th" : ["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
  const r = input.recap;
  const stats: { icon: WeeklyIcon; value: string; label: string }[] = [
    r.points ? { icon: "points", value: n(r.points), label: t("points earned", "points gagnés") } : null,
    r.members ? { icon: "members", value: n(r.members), label: t("active members", "membres actifs") } : null,
    r.messages ? { icon: "messages", value: n(r.messages), label: t("messages", "messages") } : null,
    r.voiceHours ? { icon: "voice", value: `${n(r.voiceHours)} h`, label: t("in voice", "en vocal") } : null,
    r.dungeonRuns ? { icon: "dungeons", value: n(r.dungeonRuns), label: t("dungeon runs", "donjons complétés") } : null,
    r.newMembers ? { icon: "newcomers", value: n(r.newMembers), label: t("new members", "nouveaux") } : null,
    r.raids ? { icon: "raids", value: n(r.raids), label: t(`raids · ${n(r.bossKills)} bosses`, `raids · ${n(r.bossKills)} boss`) } : null,
    r.reactions ? { icon: "reactions", value: n(r.reactions), label: t("reactions", "réactions") } : null,
    r.activities ? { icon: "activities", value: n(r.activities), label: t("activities", "activités") } : null
  ].filter((stat): stat is { icon: WeeklyIcon; value: string; label: string } => stat !== null);
  return {
    eyebrow: t("Hall of fame", "Palmarès"), title: input.title, subtitle: "",
    backdrop: { kind: "board", key: "hall-of-fame", fallbackKey: "activity" }, stats: [],
    footer: t("Weekly honors · No rewards", "Honneurs de la semaine · Aucune récompense"),
    weekly: {
      mvp: { label: t("MVP of the week", "MVP de la semaine"), name: input.mvp.name, points: n(input.mvp.points),
        ...(input.mvp.lead && input.mvp.lead > 0 ? { note: t(`+${n(input.mvp.lead)} ahead of 2nd`, `+${n(input.mvp.lead)} d’avance sur la 2e place`) } : {}),
        ...(input.mvp.times && input.mvp.times > 1 ? { times: t(`${ordinal(input.mvp.times)} time!`, `${ordinal(input.mvp.times)} fois !`) } : {}) },
      topLabel: t("Top of the week", "Le top de la semaine"), top: input.top.slice(0, 3).map(row => ({ rank: row.rank, name: row.name, points: n(row.points) })),
      ...(input.rookie ? { rookie: { label: t("Rookie of the week", "Recrue de la semaine"), name: input.rookie.name, points: n(input.rookie.points), place: `${input.rookie.place}/${input.rookie.ranked}`, placeLabel: t("Rank", "Rang"),
        note: t("New and already on the board", "Nouveau dans la gang et déjà au classement") } } : {}),
      statsLabel: t("The guild's week", "La semaine de la guilde"), stats, ptsWord: "pts"
    }
  };
}
