import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getJsonBounded, parseSummary, type Summary } from "../api";
import { cacheKey } from "../cache";
import { classLabel, t, type Lang } from "../i18n";
import { PublicBoards, SeasonPicker } from "../PublicBoards";
import { classColor, fetchDuels, type Duels } from "../publicApi";
import { Card, EmptyState, Glyph, LastUpdated, RankNumber, RetryCard, Row, SegmentedTabs, StatTile, colors, usePullToRefresh } from "../ui";
import { useBack } from "../useBack";
import { RaidsBoard } from "./RaidsBoard";
import { useCachedResource } from "../useCachedResource";

// Stats tab: the weekly summary card, then Dungeons (the public leaderboards, by season) or Duels (the public duel ladder).
type Section = "dungeons" | "duels" | "raids";

const words = {
  dungeons: { en: "Dungeons", fr: "Donjons" },
  raids: { en: "Raids", fr: "Raids" },
  duels: { en: "Duels", fr: "Duels" },
  duelTitle: { en: "Duel ladder", fr: "Classement des duels" },
  duelIntro: { en: "Rated duels between players, the same as the website.", fr: "Les duels cotés entre joueurs, comme sur le site." },
  duelClosed: { en: "The duel ladder is not open yet. Check back soon.", fr: "Le classement des duels n'est pas encore ouvert. Reviens bientôt." },
  duelNone: { en: "Nobody is ranked yet this season.", fr: "Personne n'est encore classé cette saison." },
  duelFailed: { en: "The duel ladder is unavailable right now.", fr: "Le classement des duels est indisponible pour le moment." },
  record: { en: "W-L", fr: "V-D" },
  duelsCounted: { en: "duels counted", fr: "duels comptés" },
  placement: { en: "In placement", fr: "En classement initial" },
  duelPage: { en: "Duel stats on the website", fr: "Statistiques de duels sur le site" },
  pvpPage: { en: "World PvP and battlegrounds on the website", fr: "JcJ sauvage et champs de bataille sur le site" }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

const isSummary = (data: unknown): data is Summary => typeof data === "object" && data !== null && Array.isArray((data as Summary).topRuns);

// The server names the season, the dungeons and the level ranges in the asked language (?lang=fr), so the saved copy is per language.
function useSummary(origin: string, lang: Lang) {
  return useCachedResource<Summary>(cacheKey("summary", origin, lang), async () => parseSummary(await getJsonBounded(`${origin}/leaderboards/summary.json?lang=${lang}`)), isSummary);
}

function SummaryCard({ origin, lang, feed }: { origin: string; lang: Lang; feed: ReturnType<typeof useSummary> }) {
  const summary = feed.data;
  return <Card edge={colors.gold} style={styles.card}>
    <Text style={styles.label}>{(summary?.season ?? "Guilded").toUpperCase()}</Text>
    <Text style={styles.title}>{t(lang, "thisWeek")}</Text>
    {!summary && feed.failed ? <Text style={styles.muted}>{t(lang, "summaryDown")}</Text> : !summary ? <ActivityIndicator color={colors.gold} style={{ alignSelf: "flex-start" }} /> : <>
      <View style={styles.tiles}><StatTile value={summary.ratedRunsThisWeek} label={t(lang, "ratedRuns")} /><StatTile value={summary.guilds} label={t(lang, "guilds")} /></View>
      {summary.topRuns.map((run, i) => <View key={`${run.dungeon}-${i}`} style={styles.run} accessible accessibilityLabel={`${i + 1}, ${run.dungeon}, ${run.score}`}><Text style={styles.rank}>0{i + 1}</Text><Text style={styles.runName}>{run.dungeon}</Text><Text style={styles.score}>{run.score}</Text></View>)}
    </>}
    <LastUpdated lang={lang} savedAt={feed.savedAt} stale={feed.stale && feed.failed} />
    <Pressable onPress={() => void Linking.openURL(`${origin}/players/`).catch(() => {})} accessibilityRole="link" accessibilityLabel={t(lang, "players")} style={styles.link}><Text style={styles.linkText}>{t(lang, "players")}</Text><Glyph name="external" /></Pressable>
  </Card>;
}

type DuelsState = { duels: Duels | null };
const isDuelsState = (data: unknown): data is DuelsState => typeof data === "object" && data !== null && "duels" in data;

/** The duel ladder, by season. Before it opens (the server answers 404) a note explains when. */
function DuelsBoard({ origin, lang }: { origin: string; lang: Lang }) {
  const [season, setSeason] = useState<string | undefined>(undefined);
  const feed = useCachedResource<DuelsState>(cacheKey("duels", origin, lang, season ?? "current"), async () => ({ duels: await fetchDuels(origin, lang, season) }), isDuelsState);
  const duels = feed.data?.duels ?? null;
  const refreshControl = usePullToRefresh(feed.reload);
  return <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
    <Text style={styles.kicker}>{(duels?.seasons.find((s) => s.id === duels.season)?.label ?? "GUILDED").toUpperCase()}</Text>
    <Text style={styles.bigTitle}>{w("duelTitle", lang)}</Text>
    <Text style={styles.intro}>{w("duelIntro", lang)}</Text>
    {duels ? <SeasonPicker lang={lang} seasons={duels.seasons} value={season ?? duels.season} onChange={(id) => setSeason(id === duels.seasons[0]?.id ? undefined : id)} /> : null}
    <LastUpdated lang={lang} savedAt={feed.savedAt} stale={feed.stale && feed.failed} />
    {!feed.data && feed.failed ? <RetryCard lang={lang} message={w("duelFailed", lang)} onRetry={feed.retry} />
      : !feed.data ? <ActivityIndicator color={colors.gold} />
      : !duels ? <EmptyState art="duel" message={w("duelClosed", lang)} />
      : <Card style={styles.boardCard}>
        <Text style={styles.label}>{`${duels.duels} ${w("duelsCounted", lang)}`.toUpperCase()}</Text>
        {duels.players.length === 0 ? <EmptyState art="duel" message={w("duelNone", lang)} /> : duels.players.slice(0, 50).map((p) => <Row key={`${p.name}-${p.realm ?? ""}`}
          leading={<RankNumber rank={p.rank ?? 0} />}
          name={p.name} nameColor={classColor(p.className)}
          sub={[classLabel(p.className, lang), p.level ? `${t(lang, "level")} ${p.level}` : null, p.guild, `${w("record", lang)} ${p.wins}-${p.losses}`, p.ranked ? null : w("placement", lang)].filter(Boolean).join(" · ")} score={p.rating} />)}
      </Card>}
    {/* World PvP and the per-duel stats have no public JSON yet: the website pages show them. */}
    <WebLink url={`${origin}/leaderboards/duels/?lang=${lang}`} label={w("duelPage", lang)} />
    <WebLink url={`${origin}/leaderboards/pvp/?lang=${lang}`} label={w("pvpPage", lang)} />
  </ScrollView>;
}

function WebLink({ url, label }: { url: string; label: string }) {
  return <Pressable onPress={() => void Linking.openURL(url).catch(() => {})} accessibilityRole="link" accessibilityLabel={label} style={styles.link}>
    <Text style={[styles.linkText, { flex: 1 }]}>{label}</Text><Glyph name="external" />
  </Pressable>;
}

export function StatsTab({ origin, lang }: { origin: string; lang: Lang }) {
  const [section, setSection] = useState<Section>("dungeons");
  const summary = useSummary(origin, lang);
  // Android Back from Duels returns to Dungeons.
  useBack(section !== "dungeons", () => setSection("dungeons"));
  const picker = <View style={styles.sections}><SegmentedTabs options={(["dungeons", "duels", "raids"] as const).map((value) => ({ value, label: w(value, lang) }))} value={section} onChange={setSection} /></View>;
  if (section === "duels") return <View style={styles.fill}><View style={styles.pickerBar}>{picker}</View><DuelsBoard origin={origin} lang={lang} /></View>;
  if (section === "raids") return <View style={styles.fill}><View style={styles.pickerBar}>{picker}</View><RaidsBoard origin={origin} lang={lang} /></View>;
  return <PublicBoards origin={origin} lang={lang} header={<><SummaryCard origin={origin} lang={lang} feed={summary} />{picker}</>} onPull={summary.reload} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pickerBar: { paddingHorizontal: 24, paddingTop: 16 },
  sections: { marginVertical: 8 },
  card: { marginBottom: 8 },
  boardCard: { gap: 0 },
  content: { padding: 24, paddingBottom: 30 },
  kicker: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700", marginTop: 4 },
  bigTitle: { color: colors.text, fontSize: 30, fontWeight: "700", marginTop: 10, letterSpacing: -1 },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 12 },
  label: { color: colors.gold, fontSize: 12, letterSpacing: 1.7, fontWeight: "700" },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  tiles: { flexDirection: "row", gap: 44, marginVertical: 6 },
  run: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 10, flexDirection: "row", alignItems: "center" },
  rank: { color: colors.gold, fontSize: 12, marginRight: 12 }, runName: { color: colors.text, flex: 1, fontSize: 13 }, score: { color: colors.green, fontWeight: "700", fontSize: 13 },
  link: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }, linkText: { color: colors.gold, fontSize: 13, fontWeight: "700" }
});
