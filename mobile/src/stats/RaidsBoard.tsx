import { ActivityIndicator, ScrollView, StyleSheet, Text } from "react-native";
import { cacheKey } from "../cache";
import type { Lang } from "../i18n";
import { fetchRaids, type RaidBoard } from "../publicApi";
import { raidOpenDate, raidsView } from "./raidsView";
import { Card, EmptyState, LastUpdated, RankNumber, RetryCard, Row, colors, usePullToRefresh } from "../ui";
import { useCachedResource } from "../useCachedResource";

const words = {
  kicker: { en: "WOW FOREVER", fr: "WOW FOREVER" },
  title: { en: "Raid progress", fr: "Progression en raid" },
  intro: { en: "Guilds ranked by raid bosses killed, then by who finished first. Only guilds that share their runs publicly are listed.", fr: "Les guildes classées par boss de raid tués, puis par qui a fini en premier. Seules les guildes qui partagent leurs parcours publiquement sont listées." },
  opens: { en: "Raids open {date}", fr: "Les raids ouvrent le {date}" },
  opensBody: { en: "WoW Forever's first raids open on {date}. Install Guilded and its companion now: your guild's first kills will appear here by themselves.", fr: "Les premiers raids de WoW Forever ouvrent le {date}. Installe Guilded et son compagnon dès maintenant : les premières victoires de ta guilde apparaîtront ici toutes seules." },
  none: { en: "No raid kill has been recorded yet. Guilds that share their runs publicly appear here after their first boss.", fr: "Aucune victoire en raid n'a encore été enregistrée. Les guildes qui partagent leurs parcours publiquement apparaissent ici après leur premier boss." },
  failed: { en: "Raid progress is unavailable right now.", fr: "La progression en raid est indisponible pour le moment." },
  guilds: { en: "GUILDS", fr: "GUILDES" },
  firsts: { en: "WORLD FIRSTS", fr: "PREMIÈRES MONDIALES" },
  bosses: { en: "bosses", fr: "boss" },
  worldFirsts: { en: "world firsts", fr: "premières mondiales" },
  kills: { en: "kills recorded", fr: "victoires enregistrées" }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

const isRaidBoard = (data: unknown): data is RaidBoard => typeof data === "object" && data !== null && Array.isArray((data as RaidBoard).guilds) && Array.isArray((data as RaidBoard).firsts);

/** The public raid progress board (GET /leaderboards/raids.json), cached for offline. */
export function RaidsBoard({ origin, lang }: { origin: string; lang: Lang }) {
  const feed = useCachedResource<RaidBoard>(cacheKey("raids", origin), () => fetchRaids(origin), isRaidBoard);
  const board = feed.data;
  const refreshControl = usePullToRefresh(feed.reload);
  const view = board ? raidsView(board) : null;
  const date = raidOpenDate(board?.opensAt ?? null, lang);
  return <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
    <Text style={styles.kicker}>{w("kicker", lang)}</Text>
    <Text style={styles.bigTitle}>{w("title", lang)}</Text>
    <Text style={styles.intro}>{w("intro", lang)}</Text>
    <LastUpdated lang={lang} savedAt={feed.savedAt} stale={feed.stale && feed.failed} />
    {!board && feed.failed ? <RetryCard lang={lang} message={w("failed", lang)} onRetry={feed.retry} />
      : !board ? <ActivityIndicator color={colors.gold} />
      : view === "opens" ? <EmptyState art="runs" message={`${w("opens", lang).replace("{date}", date)}. ${w("opensBody", lang).replace("{date}", date)}`} />
      : view === "none" ? <EmptyState art="runs" message={w("none", lang)} />
      : <>
        <Card style={styles.boardCard}>
          <Text style={styles.label}>{`${w("guilds", lang)} · ${board.totalKills} ${w("kills", lang)}`}</Text>
          {board.guilds.slice(0, 50).map((g) => <Row key={`${g.slug ?? g.name}-${g.rank}`} leading={<RankNumber rank={g.rank} />} name={g.name}
            sub={`${g.worldFirsts} ${w("worldFirsts", lang)}`} score={`${g.bosses} ${w("bosses", lang)}`} />)}
        </Card>
        {board.firsts.length ? <Card style={styles.boardCard}>
          <Text style={styles.label}>{w("firsts", lang)}</Text>
          {board.firsts.slice(0, 50).map((f, i) => <Row key={`${f.instance}-${f.boss}-${f.difficulty ?? ""}-${i}`} name={f.boss} sub={[f.instance, f.difficulty].filter(Boolean).join(" · ")} score={f.guild} />)}
        </Card> : null}
      </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingBottom: 30, gap: 12 },
  kicker: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700", marginTop: 4 },
  bigTitle: { color: colors.text, fontSize: 30, fontWeight: "700", letterSpacing: -1 },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  boardCard: { gap: 0 },
  label: { color: colors.gold, fontSize: 12, letterSpacing: 1.7, fontWeight: "700" }
});
