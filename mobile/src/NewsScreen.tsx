import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BLIZZARD_NEWS_URL, ago, parseNews, type News } from "./news";
import type { Lang } from "./i18n";

const colors = { panel: "#151714", line: "#282b25", text: "#f3f0e7", muted: "#aaa99f", gold: "#d5ad57" };
const words = {
  kicker: { en: "WOW NEWS", fr: "NOUVELLES WOW" },
  title: { en: "Headlines", fr: "Manchettes" },
  intro: { en: "Headlines only. Tap one to read it on the publisher's site.", fr: "Seulement les manchettes. Touchez-en une pour la lire sur le site de l'éditeur." },
  via: { en: "Headlines from Wowhead", fr: "Manchettes de Wowhead" },
  blizzard: { en: "Open Blizzard news", fr: "Ouvrir les nouvelles de Blizzard" },
  empty: { en: "No headlines right now.", fr: "Aucune manchette pour le moment." },
  off: { en: "Headlines are switched off on this server.", fr: "Les manchettes sont désactivées sur ce serveur." },
  failed: { en: "The headlines are unavailable right now.", fr: "Les manchettes sont indisponibles pour le moment." },
  retry: { en: "Try again", fr: "Réessayer" }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

/** The News tab: Wowhead headlines (title, link, date) fetched through the bot, plus a plain link to Blizzard's news page. */
export function NewsScreen({ origin, lang }: { origin: string; lang: Lang }) {
  const [news, setNews] = useState<News | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    fetch(`${origin}/news/headlines.json`, { headers: { accept: "application/json" } })
      .then((r) => { if (!r.ok) throw new Error("news unavailable"); return r.json() as Promise<unknown>; })
      .then((body) => { if (active) setNews(parseNews(body)); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [origin, attempt]);

  const now = Date.now();
  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.kicker}>{w("kicker", lang)}</Text>
    <Text style={styles.title}>{w("title", lang)}</Text>
    <Text style={styles.intro}>{w("intro", lang)}</Text>
    {failed ? <View style={styles.card}><Text style={styles.muted}>{w("failed", lang)}</Text><Pressable onPress={() => setAttempt(attempt + 1)} accessibilityRole="button"><Text style={styles.link}>{w("retry", lang)}</Text></Pressable></View>
      : !news ? <ActivityIndicator color={colors.gold} />
      : !news.enabled ? <Text style={styles.muted}>{w("off", lang)}</Text>
      : news.items.length === 0 ? <Text style={styles.muted}>{w("empty", lang)}</Text>
      : <View style={styles.card}>
        <Text style={styles.label}>{w("via", lang).toUpperCase()}</Text>
        {news.items.map((item) => <Pressable key={item.url} onPress={() => void Linking.openURL(item.url)} accessibilityRole="link" style={styles.row}>
          <Text style={styles.headline}>{item.title}</Text>
          <Text style={styles.sub}>{ago(item.publishedAt, now, lang)}</Text>
        </Pressable>)}
      </View>}
    <Pressable onPress={() => void Linking.openURL(BLIZZARD_NEWS_URL)} accessibilityRole="link" style={styles.action}><Text style={styles.actionText}>{w("blizzard", lang)}</Text><Text style={styles.arrow}>↗</Text></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingBottom: 30 }, kicker: { color: colors.gold, fontSize: 10, letterSpacing: 2, fontWeight: "700", marginTop: 12 },
  title: { color: colors.text, fontSize: 30, fontWeight: "700", marginTop: 10, letterSpacing: -1 }, intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 18 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14 },
  label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700", marginBottom: 6 },
  row: { paddingVertical: 12, borderTopWidth: 1, borderColor: colors.line, minHeight: 44 }, headline: { color: colors.text, fontSize: 14, lineHeight: 20 }, sub: { color: colors.muted, fontSize: 11, marginTop: 3 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 }, link: { color: colors.gold, fontSize: 14, paddingVertical: 12 },
  action: { borderTopWidth: 1, borderColor: colors.line, paddingVertical: 17, flexDirection: "row", alignItems: "center", marginTop: 18 }, actionText: { color: colors.text, fontSize: 14, flex: 1 }, arrow: { color: colors.gold, fontSize: 17 }
});
