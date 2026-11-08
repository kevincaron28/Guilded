import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Lang } from "../i18n";
import { classColor } from "../publicApi";
import { SegmentedTabs, colors } from "../ui";
import type { ClashApi } from "./api";
import { STONE } from "./CardFrame";
import { LadderList } from "./LadderList";
import { bucketDuels, busyOpponents, challengeReducer, challengeStart, filterPartners, formatLeft, msUntil, urgent } from "./pvp";
import type { ClassKey, DuelInfo, DuelResponse, Ladder, Partner } from "./types";
import { CLASS_KEYS } from "./types";
import { CLASS_LABEL, w, type WordKey } from "./words";

/** The class chips both the challenge form and Accept use. */
export function ClassPicker({ cls, setCls, lang }: { cls: ClassKey; setCls: (cls: ClassKey) => void; lang: Lang }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
    {CLASS_KEYS.map((key) => <Pressable key={key} onPress={() => setCls(key)} accessibilityRole="button" accessibilityState={{ selected: cls === key }}
      style={[styles.cls, { borderColor: classColor(key) }, cls === key && { backgroundColor: classColor(key) }]}>
      <Text style={[styles.clsText, { color: cls === key ? colors.ink : classColor(key) }]}>{CLASS_LABEL[key]![lang]}</Text>
    </Pressable>)}
  </ScrollView>;
}

/** One duel in a list: opponent, class, the clock or the result, and its button. */
function DuelRow({ duel, lang, now, onOpen, children }: { duel: DuelInfo; lang: Lang; now: number; onOpen?: () => void; children?: React.ReactNode }) {
  const pending = duel.status === "pending";
  const clock = msUntil(pending ? duel.expiresAt : duel.turnDeadlineAt, now);
  const tint = duel.opponent.cls ? classColor(duel.opponent.cls) : colors.muted;
  const finished = !pending && duel.status !== "active";
  const resultColor = duel.status === "won" ? "#9fbd83" : duel.status === "lost" ? colors.error : colors.muted;
  return <View style={styles.duel}>
    <View style={[styles.avatar, { borderColor: tint }]}><Text style={[styles.avatarText, { color: tint }]}>{duel.opponent.name.charAt(0)}</Text></View>
    <View style={{ flex: 1, gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Text style={styles.text} numberOfLines={1}>{duel.opponent.name}</Text>
        {duel.status === "active" && duel.yourTurn ? <Text style={styles.badge}>{w("yourMove", lang)}</Text> : null}
        {duel.live ? <Text style={styles.liveTag}>{w("live", lang)}</Text> : null}
        {duel.kind === "ranked" ? <Text style={styles.rankedTag}>{w("ranked", lang)}</Text> : null}
      </View>
      <Text style={[styles.small, !finished && urgent(clock, duel.live) && { color: colors.error }]}>
        {duel.opponent.cls ? `${CLASS_LABEL[duel.opponent.cls]?.[lang] ?? duel.opponent.cls} · ` : ""}
        {finished ? <Text style={{ color: resultColor, fontWeight: "700" }}>{w(`status_${duel.status}` as WordKey, lang)}</Text>
          : pending ? w("expiresIn", lang, { t: formatLeft(clock ?? 0, lang) })
          : `${duel.yourTurn ? w("yourMove", lang) : w("theirMove", lang)} · ${w("round", lang)} ${duel.round} · ${w("timeLeft", lang, { t: formatLeft(clock ?? 0, lang) })}`}
      </Text>
      {children}
    </View>
    {onOpen ? <Pressable onPress={onOpen} accessibilityRole="button" style={[styles.open, duel.yourTurn && duel.status === "active" && styles.openHot]}>
      <Text style={[styles.openText, duel.yourTurn && duel.status === "active" && { color: colors.ink }]}>{duel.status === "active" && duel.yourTurn ? w("play2", lang) : w("view", lang)}</Text>
    </Pressable> : null}
  </View>;
}

/** Guild play: challenge a guildmate, answer challenges, your matches (async 24 h turns or live), and the weekly guild board. */
export function DuelsView({ api, lang, cls, setCls, duels, reload, onOpen }: {
  api: ClashApi; lang: Lang; cls: ClassKey; setCls: (cls: ClassKey) => void; duels: DuelInfo[] | null; reload: () => Promise<void>; onOpen: (res: DuelResponse) => void;
}) {
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [weekly, setWeekly] = useState<Ladder | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [form, dispatch] = useReducer(challengeReducer, cls, challengeStart);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const loadSide = useCallback(async () => {
    const [p, l] = await Promise.allSettled([api.partners(), api.leaderboard("friendly")]);
    if (p.status === "fulfilled") setPartners(p.value); else setError(p.reason instanceof Error ? p.reason.message : w("failed", lang));
    if (l.status === "fulfilled") { setWeekly(l.value); setBoardId((id) => id ?? l.value.boards[0]?.id ?? null); }
  }, [api, lang]);
  useEffect(() => { void loadSide(); }, [loadSide]);
  // The list refreshes every 20 s while open, so "your turn" and incoming challenges show up without a pull.
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); void reload(); }, 20_000);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => { dispatch({ type: "class", cls }); }, [cls]);

  const buckets = useMemo(() => bucketDuels(duels ?? [], now), [duels, now]);
  const busyWith = useMemo(() => busyOpponents(duels ?? [], now), [duels, now]);
  const matches = useMemo(() => filterPartners(partners ?? [], form.query, busyWith).slice(0, 8), [partners, form.query, busyWith]);

  const act = async (id: string, run: () => Promise<DuelResponse>, open: boolean) => {
    setBusyId(id); setError(null);
    try { const res = await run(); await reload(); if (open && res.view) onOpen(res); }
    catch (e) { setError(e instanceof Error ? e.message : w("failed", lang)); }
    finally { setBusyId(null); setNow(Date.now()); }
  };
  const send = async () => {
    if (!form.to) return;
    dispatch({ type: "sending" });
    try { const res = await api.challenge({ to: form.to.discordUserId, cls: form.cls, live: form.live }); dispatch({ type: "sent", duel: res.duel }); await reload(); }
    catch (e) { dispatch({ type: "failed", message: e instanceof Error ? e.message : w("failed", lang) }); }
  };
  const openDuel = (duel: DuelInfo) => void act(duel.id, () => api.duel(duel.id), true);
  const board = weekly?.boards.find((b) => b.id === boardId) ?? weekly?.boards[0] ?? null;
  const ongoing = [...buckets.yourTurn, ...buckets.waiting];

  return <View style={{ gap: 14 }}>
    {error ? <Text style={styles.error}>{error}</Text> : null}

    {buckets.incoming.length ? <View style={[styles.panel, styles.hot]}>
      <Text style={styles.label}>{w("incoming", lang).toUpperCase()}</Text>
      {buckets.incoming.map((d) => <DuelRow key={d.id} duel={d} lang={lang} now={now}>
        <Text style={styles.small}>{w("playAs", lang)}: <Text style={{ color: classColor(cls), fontWeight: "700" }}>{CLASS_LABEL[cls]![lang]}</Text>{d.live ? ` · ${w("liveTurns", lang)}` : ` · ${w("asyncTurns", lang)}`}</Text>
        <View style={styles.buttons}>
          <Pressable onPress={() => void act(d.id, () => api.accept(d.id, cls), true)} disabled={busyId !== null} accessibilityRole="button" style={styles.primarySmall}>
            {busyId === d.id ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryText}>{w("accept", lang)}</Text>}
          </Pressable>
          <Pressable onPress={() => void act(d.id, () => api.decline(d.id), false)} disabled={busyId !== null} accessibilityRole="button" style={styles.ghost}>
            <Text style={styles.ghostText}>{w("decline", lang)}</Text>
          </Pressable>
        </View>
      </DuelRow>)}
    </View> : null}

    <View style={styles.panel}>
      <Text style={styles.label}>{w("yourMatches", lang).toUpperCase()}</Text>
      {duels === null ? <ActivityIndicator color={colors.gold} /> : null}
      {duels !== null && !ongoing.length && !buckets.outgoing.length ? <Text style={styles.muted}>{w("noDuels", lang)}</Text> : null}
      {ongoing.map((d) => <DuelRow key={d.id} duel={d} lang={lang} now={now} onOpen={() => openDuel(d)} />)}
      {buckets.outgoing.length ? <Text style={[styles.small, { marginTop: 6 }]}>{w("outgoing", lang)}</Text> : null}
      {buckets.outgoing.map((d) => <DuelRow key={d.id} duel={d} lang={lang} now={now}>
        <Pressable onPress={() => void act(d.id, () => api.decline(d.id), false)} disabled={busyId !== null} accessibilityRole="button" style={styles.inlineLink}>
          <Text style={styles.ghostText}>{w("withdraw", lang)}</Text>
        </Pressable>
      </DuelRow>)}
      {buckets.finished.length ? <Text style={[styles.small, { marginTop: 6 }]}>{w("recent", lang)}</Text> : null}
      {buckets.finished.slice(0, 5).map((d) => <DuelRow key={d.id} duel={d} lang={lang} now={now} onOpen={d.status === "won" || d.status === "lost" || d.status === "draw" ? () => openDuel(d) : undefined} />)}
    </View>

    <View style={styles.panel}>
      <Text style={styles.label}>{w("challengeTitle", lang).toUpperCase()}</Text>
      <Text style={styles.muted}>{w("challengeIntro", lang)}</Text>
      {form.to ? <View style={styles.picked}>
        <Text style={styles.text}>{w("vs", lang, { name: form.to.name })}</Text>
        <Pressable onPress={() => dispatch({ type: "clear" })} accessibilityRole="button" style={styles.inlineLink}><Text style={styles.ghostText}>{w("change", lang)}</Text></Pressable>
      </View> : <>
        <TextInput value={form.query} onChangeText={(query) => dispatch({ type: "query", query })} placeholder={w("searchGuild", lang)} placeholderTextColor={colors.muted}
          style={styles.input} accessibilityLabel={w("searchGuild", lang)} autoCorrect={false} />
        {partners === null ? <ActivityIndicator color={colors.gold} /> : !partners.length ? <Text style={styles.muted}>{w("noPartners", lang)}</Text>
          : !matches.length ? <Text style={styles.muted}>{w("noMatch", lang)}</Text>
          : matches.map((p) => <Pressable key={p.discordUserId} onPress={() => dispatch({ type: "pick", partner: p })} accessibilityRole="button" style={styles.partner}>
              <Text style={styles.text}>{p.name}</Text><Text style={styles.link}>›</Text>
            </Pressable>)}
      </>}
      <Text style={styles.small}>{w("playAs", lang)}</Text>
      <ClassPicker cls={cls} setCls={setCls} lang={lang} />
      <SegmentedTabs options={[{ value: "async", label: w("asyncTurns", lang) }, { value: "live", label: w("liveTurns", lang) }]} value={form.live ? "live" : "async"} onChange={(v) => dispatch({ type: "live", live: v === "live" })} />
      <Text style={styles.small}>{form.live ? w("liveNote", lang) : w("asyncNote", lang)}</Text>
      {form.error ? <Text style={styles.error}>{form.error}</Text> : null}
      {form.sent ? <Text style={[styles.small, { color: "#9fbd83" }]}>✓ {w("challengeSent", lang, { name: form.sent.opponent.name })}</Text> : null}
      <Pressable onPress={() => void send()} disabled={!form.to || form.busy} accessibilityRole="button" style={[styles.primary, !form.to && { opacity: 0.4 }]}>
        {form.busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryText}>{w("sendChallenge", lang)}</Text>}
      </Pressable>
    </View>

    <View style={styles.panel}>
      <Text style={styles.label}>{w("weekly", lang).toUpperCase()}</Text>
      <Text style={styles.muted}>{w("weeklyIntro", lang)}</Text>
      {weekly && weekly.boards.length > 1 ? <SegmentedTabs options={weekly.boards.map((b) => ({ value: b.id, label: b.title }))} value={board?.id ?? ""} onChange={setBoardId} /> : null}
      {weekly === null ? <ActivityIndicator color={colors.gold} /> : board ? <LadderList board={board} lang={lang} ranked={false} empty={w("noWeekly", lang)} /> : <Text style={styles.muted}>{w("noWeekly", lang)}</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  hot: { borderColor: STONE.gold },
  label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700" },
  text: { color: colors.text, fontSize: 14, flexShrink: 1 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  small: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  link: { color: colors.gold, fontWeight: "700", fontSize: 16 },
  error: { color: colors.error, fontSize: 13 },
  cls: { borderWidth: 2, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  clsText: { fontSize: 12, fontWeight: "700" },
  duel: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderColor: colors.line, paddingVertical: 8 },
  avatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, backgroundColor: STONE.brown, alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "900", fontSize: 15 },
  badge: { backgroundColor: "#9fbd83", color: colors.ink, fontSize: 10, fontWeight: "800", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: "hidden" },
  liveTag: { borderColor: "#5aa9ff", borderWidth: 1, color: "#cfe6ff", fontSize: 10, fontWeight: "700", paddingHorizontal: 5, borderRadius: 4 },
  rankedTag: { borderColor: STONE.gold, borderWidth: 1, color: STONE.gold, fontSize: 10, fontWeight: "700", paddingHorizontal: 5, borderRadius: 4 },
  open: { borderWidth: 1, borderColor: STONE.gold, borderRadius: 6, paddingHorizontal: 14, minHeight: 40, minWidth: 64, alignItems: "center", justifyContent: "center" },
  openHot: { backgroundColor: STONE.gold },
  openText: { color: STONE.gold, fontWeight: "800" },
  buttons: { flexDirection: "row", gap: 8, marginTop: 4 },
  primary: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primarySmall: { backgroundColor: colors.gold, borderRadius: 6, minHeight: 40, minWidth: 96, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  primaryText: { color: colors.ink, fontWeight: "800", fontSize: 14 },
  ghost: { minHeight: 40, justifyContent: "center", paddingHorizontal: 12 },
  ghostText: { color: colors.gold, fontWeight: "700" },
  inlineLink: { minHeight: 36, justifyContent: "center", alignSelf: "flex-start" },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, color: colors.text, paddingHorizontal: 12, minHeight: 44, fontSize: 15, backgroundColor: colors.bg },
  partner: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 44, borderTopWidth: 1, borderColor: colors.line },
  picked: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: STONE.gold, borderRadius: 8, paddingHorizontal: 12, minHeight: 44 }
});
