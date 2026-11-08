import { useCallback, useEffect, useReducer, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Lang } from "../i18n";
import { classColor } from "../publicApi";
import { SegmentedTabs, colors } from "../ui";
import type { ClashApi } from "./api";
import { STONE } from "./CardFrame";
import { ClassPicker } from "./DuelsView";
import { LadderList } from "./LadderList";
import { divisionPips, formatLeft, lossesCostStars, msUntil, QUEUE_POLL_MS, rankedReducer, rankedStart } from "./pvp";
import type { ClassKey, DuelResponse, Ladder } from "./types";
import { CLASS_LABEL, rankLabel, w } from "./words";

const RANK_TINT: Record<string, string> = { Initiate: "#9a9a8f", Adept: "#9fbd83", Veteran: "#5aa9ff", Elite: "#c9b3ff", Legend: "#e8b8ff" };

/** Ranked: your rank and stars this season, the waiting room, ranked matches in progress and the ladder (global or your server). */
export function RankedView({ api, lang, cls, setCls, onOpen }: { api: ClashApi; lang: Lang; cls: ClassKey; setCls: (cls: ClassKey) => void; onOpen: (res: DuelResponse) => void }) {
  const [ui, dispatch] = useReducer(rankedReducer, rankedStart);
  const [scope, setScope] = useState<"global" | "guild">("global");
  const [ladder, setLadder] = useState<Ladder | null>(null);
  const [ladderError, setLadderError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const fail = (e: unknown) => dispatch({ type: "failed", message: e instanceof Error ? e.message : w("failed", lang) });
  const load = useCallback(async () => {
    try { dispatch({ type: "loaded", status: await api.ranked() }); } catch (e) { dispatch({ type: "failed", message: e instanceof Error ? e.message : w("failed", lang) }); }
    setNow(Date.now());
  }, [api, lang]);
  useEffect(() => { void load(); }, [load]);
  // While searching, ask again every few seconds: each ask also retries the pairing with a wider rating window.
  useEffect(() => {
    if (ui.phase !== "searching" || ui.busy) return;
    const timer = setTimeout(() => void load(), QUEUE_POLL_MS);
    return () => clearTimeout(timer);
  }, [ui.phase, ui.busy, ui.status, load]);
  useEffect(() => {
    let gone = false;
    setLadder(null); setLadderError(null);
    api.leaderboard(scope).then((l) => { if (!gone) setLadder(l); }).catch((e: unknown) => { if (!gone) setLadderError(e instanceof Error ? e.message : w("failed", lang)); });
    return () => { gone = true; };
  }, [api, scope, lang]);

  const join = async () => { dispatch({ type: "sending" }); try { dispatch({ type: "loaded", status: await api.joinRanked(cls) }); } catch (e) { fail(e); } };
  const leave = async () => { dispatch({ type: "sending" }); try { await api.leaveRanked(); dispatch({ type: "left" }); } catch (e) { fail(e); } };
  const open = async (id: string) => { dispatch({ type: "sending" }); try { const res = await api.duel(id); dispatch({ type: "opened" }); onOpen(res); } catch (e) { fail(e); } };

  const status = ui.status;
  if (!status) return ui.error ? <Text style={styles.error}>{ui.error}</Text> : <ActivityIndicator color={colors.gold} style={{ marginTop: 24 }} />;
  const { rank } = status.standing;
  const pips = divisionPips(rank);
  const tint = RANK_TINT[rank.rank] ?? colors.gold;
  const seasonLeft = msUntil(status.seasonEndsAt, now);
  const waited = status.queue ? Math.max(0, now - Date.parse(status.queue.since)) : 0;
  const board = ladder?.boards[0] ?? null;

  return <View style={{ gap: 14 }}>
    <View style={[styles.panel, { borderColor: tint }]}>
      <Text style={styles.label}>{w("rankedTitle", lang).toUpperCase()}</Text>
      <View style={styles.rankRow}>
        <View style={[styles.crest, { borderColor: tint }]}><Text style={[styles.crestText, { color: tint }]}>{rank.legend ? "♛" : rank.division}</Text></View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.rankName, { color: tint }]}>{rankLabel(rank, lang)}</Text>
          {pips.total ? <View style={styles.pips} accessibilityLabel={`${pips.filled} / ${pips.total}`}>
            {Array.from({ length: pips.total }, (_, i) => <Text key={i} style={[styles.star, i < pips.filled && { color: STONE.gold }]}>★</Text>)}
          </View> : null}
          <Text style={styles.small}>{rank.legend ? w("legendNote", lang) : w("starsToNext", lang, { n: rank.starsToNext })}</Text>
        </View>
      </View>
      <Text style={styles.text}>{w("record", lang)}: {status.standing.wins} / {status.standing.losses}</Text>
      {status.standing.streak >= 2 ? <Text style={[styles.small, { color: "#9fbd83" }]}>🔥 {w("streak", lang, { n: status.standing.streak })}</Text> : null}
      <Text style={styles.small}>{lossesCostStars(rank) ? w("lossRank", lang) : w("safeRank", lang)}</Text>
      <Text style={styles.small}>{w("seasonEnds", lang, { season: status.season, t: formatLeft(seasonLeft ?? 0, lang) })}</Text>
    </View>

    <View style={styles.panel}>
      <Text style={styles.muted}>{w("rankedIntro", lang)}</Text>
      {ui.error ? <Text style={styles.error}>{ui.error}</Text> : null}
      {ui.phase === "matched" && ui.matched ? <View style={[styles.found, { borderColor: STONE.gold }]}>
        <Text style={[styles.text, { color: STONE.gold, fontWeight: "800" }]}>{w("matchFound", lang, { name: ui.matched.duel.opponent.name })}</Text>
        <Pressable onPress={() => void open(ui.matched!.duel.id)} disabled={ui.busy} accessibilityRole="button" style={styles.primary}><Text style={styles.primaryText}>{w("openMatch", lang)}</Text></Pressable>
      </View> : ui.phase === "searching" && status.queue ? <View style={styles.found}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <ActivityIndicator color={STONE.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.text}>{w("searching", lang)}</Text>
            <Text style={styles.small}>{CLASS_LABEL[status.queue.cls]?.[lang] ?? status.queue.cls} · {w("searchingFor", lang, { t: waited < 60_000 ? `${Math.floor(waited / 1000)} s` : formatLeft(waited, lang) })}</Text>
          </View>
        </View>
        <Pressable onPress={() => void leave()} disabled={ui.busy} accessibilityRole="button" style={styles.ghost}><Text style={styles.ghostText}>{w("leaveQueue", lang)}</Text></Pressable>
      </View> : <>
        <Text style={styles.small}>{w("playAs", lang)}</Text>
        <ClassPicker cls={cls} setCls={setCls} lang={lang} />
        <Pressable onPress={() => void join()} disabled={ui.busy} accessibilityRole="button" style={styles.primary}>
          {ui.busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryText}>{w("findMatch", lang)}</Text>}
        </Pressable>
      </>}
    </View>

    {status.active.length ? <View style={styles.panel}>
      <Text style={styles.label}>{w("rankedActive", lang).toUpperCase()}</Text>
      {status.active.map((d) => <Pressable key={d.id} onPress={() => void open(d.id)} accessibilityRole="button" style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.text}>{w("vs", lang, { name: d.opponent.name })}{d.yourTurn ? "  " : ""}{d.yourTurn ? <Text style={styles.badge}> {w("yourMove", lang)} </Text> : null}</Text>
          <Text style={styles.small}>{d.opponent.cls ? <Text style={{ color: classColor(d.opponent.cls) }}>{CLASS_LABEL[d.opponent.cls]?.[lang]} · </Text> : null}{w("round", lang)} {d.round} · {w("timeLeft", lang, { t: formatLeft(msUntil(d.turnDeadlineAt, now) ?? 0, lang) })}</Text>
        </View>
        <Text style={styles.link}>{d.yourTurn ? w("play2", lang) : w("view", lang)} ›</Text>
      </Pressable>)}
    </View> : null}

    <View style={styles.panel}>
      <Text style={styles.label}>{w("ladder", lang).toUpperCase()} · {status.season}</Text>
      <SegmentedTabs options={[{ value: "global", label: w("global", lang) }, { value: "guild", label: w("myServer", lang) }]} value={scope} onChange={(v) => setScope(v as "global" | "guild")} />
      {ladderError ? <Text style={styles.error}>{ladderError}</Text> : ladder === null ? <ActivityIndicator color={colors.gold} />
        : board ? <LadderList board={board} lang={lang} ranked empty={w("noLadder", lang)} /> : <Text style={styles.muted}>{w("noLadder", lang)}</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700" },
  text: { color: colors.text, fontSize: 14 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  small: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  link: { color: colors.gold, fontWeight: "700" },
  error: { color: colors.error, fontSize: 13 },
  rankRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  crest: { width: 60, height: 60, borderRadius: 12, borderWidth: 3, backgroundColor: STONE.brown, alignItems: "center", justifyContent: "center", transform: [{ rotate: "45deg" }] },
  crestText: { fontSize: 22, fontWeight: "900", transform: [{ rotate: "-45deg" }] },
  rankName: { fontSize: 22, fontWeight: "900", fontStyle: "italic" },
  pips: { flexDirection: "row", gap: 2 },
  star: { color: "#3a3428", fontSize: 18 },
  found: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10, gap: 8 },
  primary: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryText: { color: colors.ink, fontWeight: "800", fontSize: 15 },
  ghost: { minHeight: 40, justifyContent: "center", alignSelf: "center", paddingHorizontal: 12 },
  ghostText: { color: colors.gold, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", minHeight: 52, borderTopWidth: 1, borderColor: colors.line },
  badge: { backgroundColor: "#9fbd83", color: colors.ink, fontSize: 10, fontWeight: "800" }
});
