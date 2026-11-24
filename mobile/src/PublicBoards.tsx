import { useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { cacheKey } from "./cache";
import { classColor, classMix, fetchBoards, fetchPublicGuild, type BoardBracket, type Boards, type PublicGuild } from "./publicApi";
import { useCachedResource } from "./useCachedResource";
import { useBack } from "./useBack";
import { classLabel, roleLabel, shownEdition, type Lang } from "./i18n";
import { Card, EmptyState, Glyph, LastUpdated, RankNumber, RetryCard, Row, colors, usePullToRefresh } from "./ui";

const words = {
  title: { en: "Leaderboards", fr: "Classements" },
  intro: { en: "Public dungeon ratings, the same as the website.", fr: "Les cotes publiques des donjons, comme sur le site." },
  characters: { en: "Top characters", fr: "Meilleurs personnages" },
  guilds: { en: "Top guilds", fr: "Meilleures guildes" },
  none: { en: "Nobody is ranked yet.", fr: "Personne n'est encore classé." },
  failed: { en: "The boards are unavailable right now.", fr: "Les classements sont indisponibles pour le moment." },
  back: { en: "Back", fr: "Retour" },
  season: { en: "Season", fr: "Saison" },
  mix: { en: "Class mix", fr: "Répartition des classes" },
  cores: { en: "Raid cores", fr: "Cores de raid" },
  noCores: { en: "This guild has not published its cores.", fr: "Cette guilde n'a pas publié ses cores." },
  standings: { en: "EP/GP standings", fr: "Classement EP/GP" },
  professionsNote: { en: "Professions are not part of a guild's public page, so they stay in the Guild tab after sign-in.", fr: "Les métiers ne font pas partie de la page publique d'une guilde; ils restent dans l'onglet Guilde après connexion." },
  bench: { en: "bench", fr: "banc" },
  trial: { en: "trial", fr: "essai" }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

// Pictures the website serves (site/images/web): the painted header, gold / silver / bronze medals and the class icons.
const web = (origin: string, file: string) => `${origin}/images/web/${file}`;
const MEDAL = ["gold", "silver", "bronze"] as const;
const CLASS_ICONS = new Set(["druid", "hunter", "mage", "paladin", "priest", "rogue", "shaman", "warlock", "warrior"]);
export const classIconFile = (className: string | null): string | null => { const key = (className ?? "").toLowerCase().replace(/[^a-z]/g, ""); return CLASS_ICONS.has(key) ? `class-${key}-64.webp` : null; };
/** Places 1-3 show their medal, the others their number. */
function Place({ origin, rank }: { origin: string; rank: number }) {
  return rank >= 1 && rank <= 3 ? <Image source={{ uri: web(origin, `medal-${MEDAL[rank - 1]}.webp`) }} style={styles.medal} accessibilityLabel={`#${rank}`} /> : <RankNumber rank={rank} />;
}

const isBoards = (data: unknown): data is Boards => typeof data === "object" && data !== null && Array.isArray((data as Boards).brackets);
const isGuild = (data: unknown): data is PublicGuild => typeof data === "object" && data !== null && Array.isArray((data as PublicGuild).cores);

/** Season chips (newest first) shared by the dungeon and duel boards; hidden when the server offers only one. */
export function SeasonPicker({ lang, seasons, value, onChange }: { lang: Lang; seasons: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  if (seasons.length < 2) return null;
  return <View accessibilityRole="tablist" accessibilityLabel={w("season", lang)} style={styles.tabs}>
    {seasons.map((season) => {
      const on = season.id === value;
      return <Pressable key={season.id} onPress={() => onChange(season.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${w("season", lang)} ${season.label}`} style={[styles.chip, on && styles.chipOn]}>
        <Text style={[styles.chipText, on && styles.chipTextOn]}>{season.label}</Text>
      </Pressable>;
    })}
  </View>;
}

export function PublicBoards({ origin, lang, header, onPull }: { origin: string; lang: Lang; header?: ReactNode; onPull?: () => Promise<unknown> }) {
  const [bracket, setBracket] = useState(0);
  const [slug, setSlug] = useState<string | null>(null);
  const [season, setSeason] = useState<string | undefined>(undefined);
  // The server answers the current season for no (or an unknown) id; the last good board of each season is kept for offline.
  const feed = useCachedResource<Boards>(cacheKey("boards", origin, lang, season ?? "current"), () => fetchBoards(origin, lang, season), isBoards);
  const boards = feed.data;

  const refreshControl = usePullToRefresh(async () => { await Promise.all([feed.reload(), onPull?.()]); });
  // Android Back from a guild page returns to the boards.
  useBack(slug !== null, () => setSlug(null));
  if (slug) return <PublicGuildView origin={origin} lang={lang} slug={slug} onBack={() => setSlug(null)} />;
  const current: BoardBracket | undefined = boards?.brackets[Math.min(bracket, (boards?.brackets.length ?? 1) - 1)];
  return <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
    {header}
    <Image source={{ uri: web(origin, "header-players-800.webp") }} style={styles.banner} accessible={false} />
    <Text style={styles.kicker}>{(boards?.season || "GUILDED").toUpperCase()}</Text>
    <Text style={styles.title}>{w("title", lang)}</Text>
    <Text style={styles.intro}>{w("intro", lang)}</Text>
    {boards ? <SeasonPicker lang={lang} seasons={boards.seasons} value={season ?? boards.seasonId} onChange={(id) => { setSeason(id === boards.seasons[0]?.id ? undefined : id); setBracket(0); }} /> : null}
    <LastUpdated lang={lang} savedAt={feed.savedAt} stale={feed.stale && feed.failed} />
    {!boards && feed.failed ? <RetryCard lang={lang} message={w("failed", lang)} onRetry={feed.retry} style={styles.card} /> : !boards ? <ActivityIndicator color={colors.gold} /> : <>
      {boards.brackets.length > 1 && <View style={styles.tabs}>{boards.brackets.map((b, i) => <Pressable key={b.key} onPress={() => setBracket(i)} style={[styles.chip, i === bracket && styles.chipOn]} accessibilityRole="button" accessibilityLabel={b.name} accessibilityState={{ selected: i === bracket }}><Text style={[styles.chipText, i === bracket && styles.chipTextOn]}>{b.name}</Text></Pressable>)}</View>}
      {current && <>
        <Text style={styles.label}>{w("characters", lang).toUpperCase()}</Text>
        <Card style={styles.card}>{current.characters.length === 0 ? <EmptyState art="pvp" message={w("none", lang)} /> : current.characters.map((c) => <Row key={`${c.rank}-${c.name}`}
          leading={<><Place origin={origin} rank={c.rank} />{classIconFile(c.className) ? <Image source={{ uri: web(origin, classIconFile(c.className)!) }} style={styles.classIcon} accessible={false} /> : null}</>}
          name={c.name} nameColor={classColor(c.className)} sub={[classLabel(c.className, lang), c.role ? roleLabel(c.role, lang) : null, shownEdition(c.realm)].filter(Boolean).join(" · ")} score={c.points} />)}</Card>
        <Text style={styles.label}>{w("guilds", lang).toUpperCase()}</Text>
        <Card style={styles.card}>{current.guilds.length === 0 ? <EmptyState art="pvp" message={w("none", lang)} /> : current.guilds.map((g) => <Row key={g.id}
          leading={<Place origin={origin} rank={g.rank} />} name={g.name} score={g.points} trailing={g.slug ? <Glyph name="next" /> : undefined}
          onPress={() => { if (g.slug) setSlug(g.slug); }} disabled={!g.slug} />)}</Card>
      </>}
    </>}
  </ScrollView>;
}

function PublicGuildView({ origin, lang, slug, onBack }: { origin: string; lang: Lang; slug: string; onBack: () => void }) {
  const feed = useCachedResource<PublicGuild>(cacheKey("guildpage", origin, slug), () => fetchPublicGuild(origin, slug), isGuild);
  const guild = feed.data;
  const mix = guild ? classMix(guild) : [];
  const biggest = mix[0]?.count ?? 1;
  const refreshControl = usePullToRefresh(feed.reload);
  return <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={w("back", lang)} style={styles.back}><Glyph name="back" /><Text style={styles.link}>{w("back", lang)}</Text></Pressable>
    <LastUpdated lang={lang} savedAt={feed.savedAt} stale={feed.stale && feed.failed} />
    {!guild && feed.failed ? <RetryCard lang={lang} message={w("failed", lang)} onRetry={feed.retry} style={styles.card} /> : !guild ? <ActivityIndicator color={colors.gold} /> : <>
      <Text style={styles.title}>{guild.name}</Text>
      {guild.intro ? <Text style={styles.intro}>{guild.intro}</Text> : null}
      {mix.length > 0 && <><Text style={styles.label}>{w("mix", lang).toUpperCase()}</Text>
        <Card style={styles.card}>{mix.map((m) => <View key={m.className} style={styles.mixRow}>
          <Text style={[styles.mixName, { color: classColor(m.className) }]}>{classLabel(m.className, lang)}</Text>
          <View style={styles.barTrack}><View style={[styles.bar, { width: `${Math.round((m.count / biggest) * 100)}%`, backgroundColor: classColor(m.className) }]} /></View>
          <Text style={styles.mixCount}>{m.count}</Text></View>)}</Card></>}
      <Text style={styles.label}>{w("cores", lang).toUpperCase()}</Text>
      {guild.cores.length === 0 ? <EmptyState art="guild" boxed message={w("noCores", lang)} style={styles.card} /> : guild.cores.map((core) => <Card key={core.name} style={styles.card}>
        <Text style={styles.coreName}>{core.name}</Text>
        {core.schedule ? <Text style={styles.sub}>{core.schedule}</Text> : null}
        {core.roster.map((m) => <View key={m.name} style={styles.rosterRow}><Text style={[styles.name, { color: classColor(m.className), flex: 1 }]}>{m.name}</Text><Text style={styles.sub}>{[classLabel(m.className, lang), roleLabel(m.role, lang), m.bench ? w("bench", lang) : "", m.trial ? w("trial", lang) : ""].filter(Boolean).join(" · ")}</Text></View>)}
        {core.ranking.length > 0 && <><Text style={[styles.label, { marginTop: 14 }]}>{w("standings", lang).toUpperCase()}</Text>
          {core.ranking.slice(0, 10).map((r, i) => <View key={r.name} style={styles.rosterRow}><RankNumber rank={i + 1} /><Text style={[styles.name, { flex: 1 }]}>{r.name}</Text><Text style={styles.score}>{r.pr.toFixed(2)}</Text></View>)}</>}
      </Card>)}
      <Text style={styles.sub}>{w("professionsNote", lang)}</Text>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  banner: { width: "100%", aspectRatio: 1600 / 360, borderRadius: 12, borderWidth: 1, borderColor: colors.line, marginTop: 4 }, medal: { width: 26, height: 26, resizeMode: "contain" }, classIcon: { width: 22, height: 22, resizeMode: "contain" },
  content: { padding: 24, paddingBottom: 30 }, kicker: { color: colors.gold, fontSize: 12, letterSpacing: 2, fontWeight: "700", marginTop: 12 },
  title: { color: colors.text, fontSize: 30, fontWeight: "700", marginTop: 10, letterSpacing: -1 }, intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 18 },
  label: { color: colors.gold, fontSize: 12, letterSpacing: 1.7, fontWeight: "700", marginTop: 18, marginBottom: 10 },
  card: { gap: 0, marginBottom: 6 }, rosterRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 10 },
  name: { color: colors.text, fontSize: 14, fontWeight: "600" }, sub: { color: colors.muted, fontSize: 12, marginTop: 2 }, score: { color: colors.green, fontWeight: "700", fontSize: 14 },
  link: { color: colors.gold, fontSize: 14, paddingVertical: 12 }, back: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 }, chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 14, minHeight: 44, justifyContent: "center" }, chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.muted, fontSize: 12 }, chipTextOn: { color: colors.ink, fontWeight: "700" },
  coreName: { color: colors.text, fontSize: 17, fontWeight: "700" },
  mixRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5, gap: 10 }, mixName: { width: 90, fontSize: 12 }, barTrack: { flex: 1, height: 8, backgroundColor: colors.line, borderRadius: 4 }, bar: { height: 8, borderRadius: 4 }, mixCount: { color: colors.muted, width: 24, textAlign: "right", fontSize: 12 }
});
