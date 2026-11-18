import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { getJsonBounded } from "./api";
import { cacheKey } from "./cache";
import { BLIZZARD_NEWS_URL, ago, parseNews, type News } from "./news";
import { useCachedResource } from "./useCachedResource";
import type { Lang } from "./i18n";
import { Card, EmptyState, Glyph, LastUpdated, RetryCard, colors, usePullToRefresh } from "./ui";

const words = {
  kicker: { en: "WOW NEWS", fr: "NOUVELLES WOW" },
  title: { en: "Headlines", fr: "Manchettes" },
  intro: { en: "Headlines only. Tap one to read it on the publisher's site.", fr: "Seulement les manchettes. Touchez-en une pour la lire sur le site de l'éditeur." },
  via: { en: "Headlines from Wowhead", fr: "Manchettes de Wowhead" },
  blizzard: { en: "Open Blizzard news", fr: "Ouvrir les nouvelles de Blizzard" },
  empty: { en: "No headlines right now.", fr: "Aucune manchette pour le moment." },
  off: { en: "Headlines are switched off on this server.", fr: "Les manchettes sont désactivées sur ce serveur." },
  failed: { en: "The headlines are unavailable right now.", fr: "Les manchettes sont indisponibles pour le moment." }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

const isNews = (data: unknown): data is News => typeof data === "object" && data !== null && Array.isArray((data as News).items);

/** The News tab: Wowhead headlines (title, link, date) fetched through the bot, plus a plain link to Blizzard's news page. The last good list is kept for offline. */
export function NewsScreen({ origin, lang }: { origin: string; lang: Lang }) {
  const feed = useCachedResource<News>(cacheKey("news", origin), async () => parseNews(await getJsonBounded(`${origin}/news/headlines.json`)), isNews);
  const news = feed.data;
  const now = Date.now();
  const refreshControl = usePullToRefresh(feed.reload);
  return <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
    <Text style={styles.kicker}>{w("kicker", lang)}</Text>
    <Text style={styles.title}>{w("title", lang)}</Text>
    <Text style={styles.intro}>{w("intro", lang)}</Text>
    <LastUpdated lang={lang} savedAt={feed.savedAt} stale={feed.stale && feed.failed} />
    {!news && feed.failed ? <RetryCard lang={lang} message={w("failed", lang)} onRetry={feed.retry} />
      : !news ? <ActivityIndicator color={colors.gold} />
      : !news.enabled ? <EmptyState message={w("off", lang)} />
      : news.items.length === 0 ? <EmptyState art="search" message={w("empty", lang)} />
      : <Card style={styles.card}>
        <Text style={styles.label}>{w("via", lang).toUpperCase()}</Text>
        {news.items.map((item) => <Pressable key={item.url} onPress={() => void Linking.openURL(item.url).catch(() => {})} accessibilityRole="link" accessibilityLabel={item.title} style={styles.row}>
          <Text style={styles.headline}>{item.title}</Text>
          <Text style={styles.sub}>{ago(item.publishedAt, now, lang)}</Text>
        </Pressable>)}
      </Card>}
    <Pressable onPress={() => void Linking.openURL(BLIZZARD_NEWS_URL).catch(() => {})} accessibilityRole="link" accessibilityLabel={w("blizzard", lang)} style={styles.action}><Text style={styles.actionText}>{w("blizzard", lang)}</Text><Glyph name="external" /></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingBottom: 30 }, kicker: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700", marginTop: 12 },
  title: { color: colors.text, fontSize: 30, fontWeight: "700", marginTop: 10, letterSpacing: -1 }, intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 18 },
  card: { gap: 0 },
  label: { color: colors.gold, fontSize: 12, letterSpacing: 1.7, fontWeight: "700", marginBottom: 6 },
  row: { paddingVertical: 12, borderTopWidth: 1, borderColor: colors.line, minHeight: 44 }, headline: { color: colors.text, fontSize: 14, lineHeight: 20 }, sub: { color: colors.muted, fontSize: 12, marginTop: 3 },
  action: { borderTopWidth: 1, borderColor: colors.line, paddingVertical: 17, flexDirection: "row", alignItems: "center", marginTop: 18 }, actionText: { color: colors.text, fontSize: 14, flex: 1 }
});
