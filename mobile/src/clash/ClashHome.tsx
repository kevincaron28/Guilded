import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Lang } from "../i18n";
import type { Session } from "../storage";
import { SegmentedTabs, colors } from "../ui";
import { ClashClient, type ClashApi } from "./api";
import { STONE } from "./CardFrame";
import { CollectionView } from "./CollectionView";
import { MatchView } from "./MatchView";
import { MockClash } from "./mock";
import { PackView } from "./PackView";
import { PlayView } from "./PlayView";
import type { ClassKey, Collection, MatchInfo, MatchResponse, PveProgress, StartInput } from "./types";
import { CLASS_KEYS } from "./types";
import { w } from "./words";

type Tab = "play" | "collection" | "packs";

/** Guilded Clash inside the Me tab. Signed in: the member's server (`/api/v1/companion/cards`, `/clash/*`). Signed out or
 *  in the sample guild: the local sample. If the server does not have the game yet, the member can switch to the sample. */
export function ClashHome({ lang, session, defaultClass, onBack }: { lang: Lang; session: Session | null; defaultClass: string | null; onBack: () => void }) {
  const mock = useRef(new MockClash());
  const [forceSample, setForceSample] = useState(false);
  const api: ClashApi = useMemo(() => session && !forceSample ? new ClashClient(session.apiOrigin, session.companionCredential, lang) : mock.current, [session, forceSample, lang]);
  const [tab, setTab] = useState<Tab>("play");
  const [cls, setCls] = useState<ClassKey>(() => CLASS_KEYS.includes((defaultClass ?? "").toLowerCase() as ClassKey) ? (defaultClass ?? "").toLowerCase() as ClassKey : "warrior");
  const [collection, setCollection] = useState<Collection | null>(null);
  const [pve, setPve] = useState<PveProgress | null>(null);
  const [matches, setMatches] = useState<MatchInfo[]>([]);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [c, p, m] = await Promise.allSettled([api.collection(), api.pve(), api.matches()]);
    if (c.status === "fulfilled") setCollection(c.value);
    if (p.status === "fulfilled") setPve(p.value);
    if (m.status === "fulfilled") setMatches(m.value);
    const failed = [c, p, m].find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") setError(failed.reason instanceof Error ? failed.reason.message : w("failed", lang));
  }, [api, lang]);
  useEffect(() => { void load(); }, [load]);

  const start = async (input: StartInput) => {
    setBusy(true); setError(null);
    try { setMatch(await api.start(input)); } catch (e) { setError(e instanceof Error ? e.message : w("failed", lang)); } finally { setBusy(false); }
  };
  const resume = async (id: string) => {
    setBusy(true); setError(null);
    try { setMatch(await api.match(id)); } catch (e) { setError(e instanceof Error ? e.message : w("failed", lang)); } finally { setBusy(false); }
  };

  if (match) return <MatchView api={api} lang={lang} initial={match} onExit={() => { setMatch(null); void load(); }} />;

  return <View style={{ gap: 12 }}>
    <View style={styles.head}>
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}><Text style={styles.link}>{w("back", lang)}</Text></Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{w("title", lang)}</Text>
        <Text style={styles.muted}>{api.sample ? w("sample", lang) : w("intro", lang)}</Text>
      </View>
    </View>
    <SegmentedTabs options={(["play", "collection", "packs"] as const).map((value) => ({ value, label: w(value, lang) }))} value={tab} onChange={setTab} />
    {error ? <View style={styles.error}>
      <Text style={styles.errorText}>{error}</Text>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <Pressable onPress={() => void load()} accessibilityRole="button"><Text style={styles.link}>{w("retry", lang)}</Text></Pressable>
        {!api.sample ? <Pressable onPress={() => setForceSample(true)} accessibilityRole="button"><Text style={styles.link}>{w("useSample", lang)}</Text></Pressable> : null}
      </View>
    </View> : null}
    {tab === "play" ? <PlayView lang={lang} pve={pve} matches={matches} cls={cls} setCls={setCls} busy={busy} onStart={(input) => void start(input)} onResume={(id) => void resume(id)} /> : null}
    {tab !== "play" && !collection ? (error ? null : <ActivityIndicator color={colors.gold} style={{ marginTop: 24 }} />) : null}
    {tab === "collection" && collection ? <CollectionView api={api} lang={lang} collection={collection} onChange={setCollection} /> : null}
    {tab === "packs" && collection ? <PackView api={api} lang={lang} collection={collection} onChange={setCollection} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  back: { minHeight: 44, justifyContent: "center" },
  title: { color: STONE.gold, fontSize: 22, fontWeight: "800", fontStyle: "italic" },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  link: { color: colors.gold, fontWeight: "700", fontSize: 14 },
  error: { backgroundColor: colors.panel, borderColor: colors.error, borderWidth: 1, borderRadius: 10, padding: 10, gap: 8 },
  errorText: { color: colors.error, fontSize: 13 }
});
