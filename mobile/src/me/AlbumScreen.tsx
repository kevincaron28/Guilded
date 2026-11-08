import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError, GuildedClient } from "../api";
import { groupSets, isNew, parseAlbum, type Album, type AlbumCard } from "../album";
import type { Lang } from "../i18n";
import { clearSession, type Session } from "../storage";
import { Medal as MedalRing, ProgressBar, SegmentedTabs, colors } from "../ui";

const words = {
  title: { en: "Badge album", fr: "Album de badges" },
  intro: { en: "One card for every achievement. A card unlocks when you really earn it: no packs, no luck, nothing to buy.", fr: "Une carte pour chaque succès. Une carte se débloque quand vous le méritez vraiment : pas de paquets, pas de chance, rien à acheter." },
  all: { en: "All cards", fr: "Toutes les cartes" },
  mine: { en: "Unlocked", fr: "Débloquées" },
  of: { en: "unlocked", fr: "débloquées" },
  fresh: { en: "NEW", fr: "NOUVEAU" },
  locked: { en: "Locked", fr: "Verrouillée" },
  how: { en: "How to earn", fr: "Comment l'obtenir" },
  unlockedOn: { en: "Unlocked", fr: "Débloquée le" },
  empty: { en: "Nothing unlocked yet. Play, and your first card will appear here.", fr: "Rien de débloqué pour l'instant. Jouez, et votre première carte apparaîtra ici." },
  retry: { en: "Try again", fr: "Réessayer" },
  failed: { en: "The album is unavailable right now.", fr: "L'album est indisponible pour le moment." },
  sample: { en: "Sample cards. Sign in to see your own.", fr: "Cartes d'exemple. Connectez-vous pour voir les vôtres." }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

const sampleBody = { cards: [
  { id: "s1", name: "Dungeon Regular", description: "Complete 10 dungeons.", tier: "bronze", tierLabel: "Bronze", tierColor: "#cd7f32", set: "Sample set", rank: 1, threshold: 10, earnedAt: new Date(Date.now() - 86400000).toISOString() },
  { id: "s2", name: "Dungeon Veteran", description: "Complete 50 dungeons.", tier: "silver", tierLabel: "Silver", tierColor: "#c9d1d9", set: "Sample set", rank: 2, threshold: 50, earnedAt: null },
  { id: "s3", name: "Raid Regular", description: "Attend 5 raids.", tier: "gold", tierColor: "#ffd100", tierLabel: "Gold", set: "Sample set", rank: null, threshold: 5, earnedAt: null }
] };

function Medal({ card, earned }: { card: AlbumCard; earned: boolean }) {
  return <MedalRing tier={card.tier} color={card.tierColor} rank={card.rank} earned={earned} />;
}

/** The badge album (APP_TCG option 1): a read-only collection of the member's own achievements. `session` null shows sample cards. */
export function AlbumScreen({ lang, session }: { lang: Lang; session: Session | null }) {
  const [album, setAlbum] = useState<Album | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [onlyMine, setOnlyMine] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    if (!session) { setAlbum(parseAlbum(sampleBody)); return () => { active = false; }; }
    new GuildedClient(session.apiOrigin, session.companionCredential).album(lang)
      .then((data) => { if (active) setAlbum(data); })
      .catch(async (e: unknown) => {
        if (e instanceof ApiError && e.status === 401) await clearSession();
        if (active) setError(e instanceof Error ? e.message : w("failed", lang));
      });
    return () => { active = false; };
  }, [session, lang, attempt]);

  const sets = useMemo(() => album ? groupSets(album.cards, onlyMine) : [], [album, onlyMine]);
  const now = Date.now();

  if (error) return <View style={styles.card}><Text style={styles.muted}>{error}</Text><Pressable onPress={() => setAttempt(attempt + 1)} accessibilityRole="button"><Text style={styles.link}>{w("retry", lang)}</Text></Pressable></View>;
  if (!album) return <ActivityIndicator color={colors.gold} style={{ marginVertical: 24 }} />;
  return <View>
    <Text style={styles.heading}>{w("title", lang)}</Text>
    <Text style={styles.muted}>{session ? w("intro", lang) : w("sample", lang)}</Text>
    <Text style={styles.total}>{album.earned} / {album.total} {w("of", lang)}</Text>
    <ProgressBar done={album.earned} total={album.total} />
    <View style={styles.chips}><SegmentedTabs options={[{ value: "all", label: w("all", lang) }, { value: "mine", label: w("mine", lang) }]} value={onlyMine ? "mine" : "all"} onChange={(next) => setOnlyMine(next === "mine")} /></View>
    {onlyMine && album.earned === 0 ? <Text style={styles.muted}>{w("empty", lang)}</Text> : null}
    {sets.map((set) => <View key={set.name}>
      <Text style={styles.label}>{set.name.toUpperCase()}  {set.earned}/{album.cards.filter((card) => card.set === set.name).length}</Text>
      <View style={styles.grid}>{set.cards.map((card) => {
        const earned = Boolean(card.earnedAt);
        const expanded = open === card.id;
        return <Pressable key={card.id} onPress={() => setOpen(expanded ? null : card.id)} accessibilityRole="button" accessibilityLabel={`${card.name}, ${card.tierLabel}, ${earned ? w("mine", lang) : w("locked", lang)}`}
          style={[styles.tile, { borderTopColor: earned ? card.tierColor : colors.line }, !earned && styles.tileLocked, expanded && styles.tileOpen]}>
          <Medal card={card} earned={earned} />
          <Text style={styles.cardName}>{card.name}</Text>
          <Text style={styles.sub}>{card.tierLabel}{isNew(card, now) ? `  ·  ${w("fresh", lang)}` : ""}</Text>
          {expanded ? <View style={styles.more}>
            <Text style={styles.sub}>{w("how", lang)}: {card.description}</Text>
            <Text style={[styles.sub, { color: earned ? colors.green : colors.muted }]}>{earned ? `${w("unlockedOn", lang)} ${card.earnedAt!.slice(0, 10)}` : w("locked", lang)}</Text>
          </View> : null}
        </Pressable>;
      })}</View>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  heading: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: 18, marginBottom: 6 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 }, link: { color: colors.gold, fontSize: 14, paddingVertical: 12 },
  total: { color: colors.gold, fontSize: 13, fontWeight: "700", marginTop: 14, marginBottom: 6 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, marginTop: 14 },
  chips: { marginTop: 14 },
  label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700", marginTop: 20, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "48%", flexGrow: 1, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderTopWidth: 3, borderRadius: 10, padding: 10, alignItems: "center", minHeight: 44 },
  tileLocked: { opacity: 0.7 }, tileOpen: { width: "100%" },
  cardName: { color: colors.text, fontSize: 13, fontWeight: "600", textAlign: "center" }, sub: { color: colors.muted, fontSize: 11, marginTop: 3, textAlign: "center" },
  more: { marginTop: 8, borderTopWidth: 1, borderColor: colors.line, paddingTop: 8, alignSelf: "stretch" }
});
