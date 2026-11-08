import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { t, type Lang } from "../i18n";
import { PublicBoards } from "../PublicBoards";
import { Card, StatTile, colors } from "../ui";

// Stats tab: the old Home's weekly summary as a header card, then the public leaderboards (#489) unchanged.
type Summary = { season: string; ratedRunsThisWeek: number; guilds: number; topRuns: { dungeon: string; levels: string; time: string; score: number }[] };

function SummaryCard({ origin, lang }: { origin: string; lang: Lang }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`${origin}/leaderboards/summary.json`)
      .then((r) => { if (!r.ok) throw new Error("summary unavailable"); return r.json() as Promise<Summary>; })
      .then((data) => { if (active) setSummary(data); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [origin]);
  return <Card edge={colors.gold} style={styles.card}>
    <Text style={styles.label}>{(summary?.season ?? "Guilded").toUpperCase()}</Text>
    <Text style={styles.title}>{t(lang, "thisWeek")}</Text>
    {failed ? <Text style={styles.muted}>{t(lang, "summaryDown")}</Text> : !summary ? <ActivityIndicator color={colors.gold} style={{ alignSelf: "flex-start" }} /> : <>
      <View style={styles.tiles}><StatTile value={summary.ratedRunsThisWeek} label={t(lang, "ratedRuns")} /><StatTile value={summary.guilds} label={t(lang, "guilds")} /></View>
      {summary.topRuns.map((run, i) => <View key={`${run.dungeon}-${i}`} style={styles.run}><Text style={styles.rank}>0{i + 1}</Text><Text style={styles.runName}>{run.dungeon}</Text><Text style={styles.score}>{run.score}</Text></View>)}
    </>}
    <Pressable onPress={() => void Linking.openURL(`${origin}/players/`)} accessibilityRole="link" style={styles.link}><Text style={styles.linkText}>{t(lang, "players")} ↗</Text></Pressable>
  </Card>;
}

export function StatsTab({ origin, lang }: { origin: string; lang: Lang }) {
  return <PublicBoards origin={origin} lang={lang} header={<SummaryCard origin={origin} lang={lang} />} />;
}

const styles = StyleSheet.create({
  card: { marginBottom: 8 },
  label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700" },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  tiles: { flexDirection: "row", gap: 44, marginVertical: 6 },
  run: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 10, flexDirection: "row", alignItems: "center" },
  rank: { color: colors.gold, fontSize: 10, marginRight: 12 }, runName: { color: colors.text, flex: 1, fontSize: 13 }, score: { color: colors.green, fontWeight: "700", fontSize: 13 },
  link: { minHeight: 44, justifyContent: "center" }, linkText: { color: colors.gold, fontSize: 13, fontWeight: "700" }
});
