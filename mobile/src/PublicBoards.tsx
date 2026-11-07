import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { classColor, classMix, fetchBoards, fetchPublicGuild, type BoardBracket, type Boards, type PublicGuild } from "./publicApi";
import type { Lang } from "./i18n";

const colors = { panel: "#151714", line: "#282b25", text: "#f3f0e7", muted: "#aaa99f", gold: "#d5ad57", green: "#9fbd83" };
const words = {
  title: { en: "Leaderboards", fr: "Classements" },
  intro: { en: "Public dungeon ratings, the same as the website.", fr: "Les cotes publiques des donjons, comme sur le site." },
  characters: { en: "Top characters", fr: "Meilleurs personnages" },
  guilds: { en: "Top guilds", fr: "Meilleures guildes" },
  none: { en: "Nobody is ranked yet.", fr: "Personne n'est encore classé." },
  retry: { en: "Try again", fr: "Réessayer" },
  failed: { en: "The boards are unavailable right now.", fr: "Les classements sont indisponibles pour le moment." },
  back: { en: "← Back", fr: "← Retour" },
  mix: { en: "Class mix", fr: "Répartition des classes" },
  cores: { en: "Raid cores", fr: "Cores de raid" },
  noCores: { en: "This guild has not published its cores.", fr: "Cette guilde n'a pas publié ses cores." },
  standings: { en: "EP/GP standings", fr: "Classement EP/GP" },
  professionsNote: { en: "Professions are not part of a guild's public page, so they stay in the Guild tab after sign-in.", fr: "Les métiers ne font pas partie de la page publique d'une guilde; ils restent dans l'onglet Guilde après connexion." },
  noPage: { en: "No public page", fr: "Pas de page publique" }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

function Retry({ lang, onPress, message }: { lang: Lang; onPress: () => void; message?: string }) {
  return <View style={styles.card}><Text style={styles.muted}>{message ?? w("failed", lang)}</Text><Pressable onPress={onPress} accessibilityRole="button"><Text style={styles.link}>{w("retry", lang)}</Text></Pressable></View>;
}

export function PublicBoards({ origin, lang }: { origin: string; lang: Lang }) {
  const [boards, setBoards] = useState<Boards | null>(null);
  const [failed, setFailed] = useState(false);
  const [bracket, setBracket] = useState(0);
  const [slug, setSlug] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    fetchBoards(origin, lang).then((data) => { if (active) setBoards(data); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [origin, lang, attempt]);

  if (slug) return <PublicGuildView origin={origin} lang={lang} slug={slug} onBack={() => setSlug(null)} />;
  const current: BoardBracket | undefined = boards?.brackets[Math.min(bracket, (boards?.brackets.length ?? 1) - 1)];
  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.kicker}>{(boards?.season || "GUILDED").toUpperCase()}</Text>
    <Text style={styles.title}>{w("title", lang)}</Text>
    <Text style={styles.intro}>{w("intro", lang)}</Text>
    {failed ? <Retry lang={lang} onPress={() => setAttempt(attempt + 1)} /> : !boards ? <ActivityIndicator color={colors.gold} /> : <>
      {boards.brackets.length > 1 && <View style={styles.tabs}>{boards.brackets.map((b, i) => <Pressable key={b.key} onPress={() => setBracket(i)} style={[styles.chip, i === bracket && styles.chipOn]} accessibilityRole="button"><Text style={[styles.chipText, i === bracket && styles.chipTextOn]}>{b.name}</Text></Pressable>)}</View>}
      {current && <>
        <Text style={styles.label}>{w("characters", lang).toUpperCase()}</Text>
        <View style={styles.card}>{current.characters.length === 0 ? <Text style={styles.muted}>{w("none", lang)}</Text> : current.characters.map((c) => <View key={`${c.rank}-${c.name}`} style={styles.row}>
          <Text style={styles.rank}>{c.rank}</Text>
          <View style={{ flex: 1 }}><Text style={[styles.name, { color: classColor(c.className) }]}>{c.name}</Text><Text style={styles.sub}>{[c.className, c.role, c.realm].filter(Boolean).join(" · ")}</Text></View>
          <Text style={styles.score}>{c.points}</Text></View>)}</View>
        <Text style={styles.label}>{w("guilds", lang).toUpperCase()}</Text>
        <View style={styles.card}>{current.guilds.length === 0 ? <Text style={styles.muted}>{w("none", lang)}</Text> : current.guilds.map((g) => <Pressable key={g.id} disabled={!g.slug} onPress={() => g.slug && setSlug(g.slug)} style={styles.row} accessibilityRole={g.slug ? "button" : undefined}>
          <Text style={styles.rank}>{g.rank}</Text>
          <View style={{ flex: 1 }}><Text style={styles.name}>{g.name}</Text><Text style={styles.sub}>{g.slug ? "›" : w("noPage", lang)}</Text></View>
          <Text style={styles.score}>{g.points}</Text></Pressable>)}</View>
      </>}
    </>}
  </ScrollView>;
}

function PublicGuildView({ origin, lang, slug, onBack }: { origin: string; lang: Lang; slug: string; onBack: () => void }) {
  const [guild, setGuild] = useState<PublicGuild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    fetchPublicGuild(origin, slug).then((data) => { if (active) setGuild(data); }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : w("failed", lang)); });
    return () => { active = false; };
  }, [origin, slug, lang, attempt]);
  const mix = guild ? classMix(guild) : [];
  const biggest = mix[0]?.count ?? 1;
  return <ScrollView contentContainerStyle={styles.content}>
    <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.link}>{w("back", lang)}</Text></Pressable>
    {error ? <Retry lang={lang} onPress={() => setAttempt(attempt + 1)} message={error} /> : !guild ? <ActivityIndicator color={colors.gold} /> : <>
      <Text style={styles.title}>{guild.name}</Text>
      {guild.intro ? <Text style={styles.intro}>{guild.intro}</Text> : null}
      {mix.length > 0 && <><Text style={styles.label}>{w("mix", lang).toUpperCase()}</Text>
        <View style={styles.card}>{mix.map((m) => <View key={m.className} style={styles.mixRow}>
          <Text style={[styles.mixName, { color: classColor(m.className) }]}>{m.className}</Text>
          <View style={styles.barTrack}><View style={[styles.bar, { width: `${Math.round((m.count / biggest) * 100)}%`, backgroundColor: classColor(m.className) }]} /></View>
          <Text style={styles.mixCount}>{m.count}</Text></View>)}</View></>}
      <Text style={styles.label}>{w("cores", lang).toUpperCase()}</Text>
      {guild.cores.length === 0 ? <View style={styles.card}><Text style={styles.muted}>{w("noCores", lang)}</Text></View> : guild.cores.map((core) => <View key={core.name} style={styles.card}>
        <Text style={styles.coreName}>{core.name}</Text>
        {core.schedule ? <Text style={styles.sub}>{core.schedule}</Text> : null}
        {core.roster.map((m) => <View key={m.name} style={styles.rosterRow}><Text style={[styles.name, { color: classColor(m.className), flex: 1 }]}>{m.name}</Text><Text style={styles.sub}>{[m.className, m.role, m.bench ? "bench" : "", m.trial ? "trial" : ""].filter(Boolean).join(" · ")}</Text></View>)}
        {core.ranking.length > 0 && <><Text style={[styles.label, { marginTop: 14 }]}>{w("standings", lang).toUpperCase()}</Text>
          {core.ranking.slice(0, 10).map((r, i) => <View key={r.name} style={styles.rosterRow}><Text style={styles.rank}>{i + 1}</Text><Text style={[styles.name, { flex: 1 }]}>{r.name}</Text><Text style={styles.score}>{r.pr.toFixed(2)}</Text></View>)}</>}
      </View>)}
      <Text style={styles.sub}>{w("professionsNote", lang)}</Text>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingBottom: 30 }, kicker: { color: colors.gold, fontSize: 10, letterSpacing: 2, fontWeight: "700", marginTop: 12 },
  title: { color: colors.text, fontSize: 30, fontWeight: "700", marginTop: 10, letterSpacing: -1 }, intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 18 },
  label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700", marginTop: 18, marginBottom: 10 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 10, minHeight: 44 }, rosterRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 10 },
  rank: { color: colors.gold, width: 22, fontSize: 12 }, name: { color: colors.text, fontSize: 14, fontWeight: "600" }, sub: { color: colors.muted, fontSize: 11, marginTop: 2 }, score: { color: colors.green, fontWeight: "700", fontSize: 14 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 }, link: { color: colors.gold, fontSize: 14, paddingVertical: 12 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 }, chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }, chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.muted, fontSize: 12 }, chipTextOn: { color: "#111", fontWeight: "700" },
  coreName: { color: colors.text, fontSize: 17, fontWeight: "700" },
  mixRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5, gap: 10 }, mixName: { width: 90, fontSize: 12 }, barTrack: { flex: 1, height: 8, backgroundColor: colors.line, borderRadius: 4 }, bar: { height: 8, borderRadius: 4 }, mixCount: { color: colors.muted, width: 24, textAlign: "right", fontSize: 12 }
});
