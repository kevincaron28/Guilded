import { useCallback, useEffect, useReducer, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Lang } from "../i18n";
import { classColor } from "../publicApi";
import { colors } from "../ui";
import type { ClashApi } from "./api";
import { CardFace, HandCard, STONE, UnitToken } from "./CardFrame";
import {
  attacksOf, canEnd, cardOf, immediate, initialMatchUi, matchUiReducer, modesOf, playsOf, powersOf, resolveTap, targetKey, targetsFor, type Selection
} from "./state";
import type { Intent, MatchResponse, SideView, Target } from "./types";
import { CLASS_LABEL, POWER, w } from "./words";

/** One Champion: portrait (a target when lit), Health, Armor, mana and counts. */
function ChampionBar({ side, seat, lang, lit, onTap, extra }: { side: SideView; seat: 0 | 1; lang: Lang; lit: boolean; onTap: () => void; extra: string }) {
  const tint = classColor(side.cls);
  return <View style={styles.champRow}>
    <Pressable onPress={onTap} disabled={!lit} accessibilityRole="button" accessibilityLabel={`${seat === 0 ? "Your" : "Enemy"} Champion, ${side.hp} health${side.armor ? `, ${side.armor} armor` : ""}`}
      style={[styles.portrait, { borderColor: lit ? "#e0624f" : tint }, lit && styles.portraitLit]}>
      <Text style={[styles.portraitText, { color: tint }]}>{CLASS_LABEL[side.cls]![lang].charAt(0)}</Text>
      <View style={styles.hpBadge}><Text style={styles.hpText}>{side.hp}</Text></View>
      {side.armor ? <View style={styles.armorBadge}><Text style={styles.armorText}>{side.armor}</Text></View> : null}
    </Pressable>
    <View style={{ flex: 1 }}>
      <Text style={styles.champName}>{CLASS_LABEL[side.cls]![lang]}{side.standard ? `  ⚑ ${cardOf(side.standard).name}` : ""}</Text>
      <Text style={styles.small}>{extra}</Text>
      <View style={styles.pips}>{Array.from({ length: Math.max(side.mana, Math.min(side.turns, 8)) }, (_, i) => <View key={i} style={[styles.pip, i < side.mana && styles.pipFull]} />)}
        <Text style={styles.small}> {side.mana}</Text></View>
    </View>
  </View>;
}

/** The battle: both boards (5 slots each), the Zone, hands, mana, Champions, attacks and targets, end turn and concede. */
export function MatchView({ api, lang, initial, onExit }: { api: ClashApi; lang: Lang; initial: MatchResponse; onExit: () => void }) {
  const [ui, dispatch] = useReducer(matchUiReducer, initialMatchUi);
  const [detail, setDetail] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [boardW, setBoardW] = useState(300);
  // Five slots must fit the narrowest phones: the slot width follows the board's measured width.
  const slotW = Math.max(44, Math.min(64, Math.floor((boardW - 6 - 4 * 4) / 5)));
  const slotStyle = { width: slotW, height: slotW * 1.4 };
  useEffect(() => { dispatch({ type: "loaded", res: initial }); }, [initial]);

  const res = ui.res ?? initial;
  const view = res.view;
  const legal = view.legal;
  const lit = targetsFor(ui.selection, legal);
  const over = view.phase === "over";
  const matchId = res.match.id;

  const send = useCallback(async (intent: Intent) => {
    dispatch({ type: "sending" });
    try { dispatch({ type: "loaded", res: await api.intent(matchId, intent) }); }
    catch (e) { dispatch({ type: "failed", message: e instanceof Error ? e.message : w("failed", lang) }); }
  }, [api, matchId, lang]);
  const refresh = useCallback(async () => {
    dispatch({ type: "sending" });
    try { dispatch({ type: "loaded", res: await api.match(matchId) }); }
    catch (e) { dispatch({ type: "failed", message: e instanceof Error ? e.message : w("failed", lang) }); }
  }, [api, matchId, lang]);
  // An opponent still deciding (a live server AI or a Loot choice) is polled gently while the screen is open.
  useEffect(() => {
    if (over || view.yourTurn || ui.busy) return;
    const timer = setTimeout(() => void refresh(), 4000);
    return () => clearTimeout(timer);
  }, [over, view.yourTurn, ui.busy, refresh, res.match.version]);

  const pick = (selection: Selection, action: Parameters<typeof dispatch>[0]) => {
    const now = immediate(selection, legal);
    if (now) void send(now); else dispatch(action);
  };
  const tapHand = (hand: number) => {
    if (ui.busy) return;
    if (ui.selection.k === "mulligan") { dispatch({ type: "toggleMulligan", hand }); return; }
    if (ui.selection.k === "hand" && ui.selection.hand === hand) { dispatch({ type: "cancel" }); return; }
    if (!playsOf(legal, hand).length) { setDetail(view.me.hand[hand] ?? null); return; }
    pick({ k: "hand", hand }, { type: "selectHand", hand });
  };
  const tapTarget = (target: Target, ownUnit?: number) => {
    if (ui.busy) return;
    const move = resolveTap(ui.selection, legal, target);
    if (move) { void send(move); return; }
    if (ownUnit !== undefined && attacksOf(legal, ownUnit).length) { dispatch({ type: "selectAttacker", unit: ownUnit }); return; }
    if ("unit" in target) {
      const unit = [...view.me.board, ...view.opponent.board].find((u) => u.uid === target.unit);
      if (unit) setDetail(unit.card);
    }
  };
  const concede = () => {
    const go = () => { dispatch({ type: "sending" }); api.concede(matchId).then((r) => dispatch({ type: "loaded", res: r })).catch((e: unknown) => dispatch({ type: "failed", message: e instanceof Error ? e.message : w("failed", lang) })); };
    if (Platform.OS === "web") { go(); return; }
    Alert.alert(w("concede", lang), w("concedeAsk", lang), [{ text: w("cancel", lang), style: "cancel" }, { text: w("concede", lang), style: "destructive", onPress: go }]);
  };

  const selectedHand = ui.selection.k === "hand" ? ui.selection.hand : null;
  const modes = selectedHand !== null && ui.selection.k === "hand" && ui.selection.mode === undefined ? modesOf(legal, selectedHand) : [];
  const hint = ui.error ?? (ui.selection.k === "mulligan" ? w("mulligan", lang)
    : modes.length ? w("pickMode", lang)
    : ui.selection.k !== "none" ? w("pickTarget", lang)
    : view.pending ? w("loot", lang)
    : view.opponentChoosing ? w("choosing", lang)
    : view.yourTurn ? w("pickAttacker", lang) : w("theirTurn", lang));
  const zone = view.zone ? cardOf(view.zone.card) : null;
  const powerReady = powersOf(legal).length > 0;
  const power = POWER[view.me.cls]?.[lang] ?? w("power", lang);

  return <View style={styles.root}>
    <View style={styles.topBar}>
      <Pressable onPress={onExit} accessibilityRole="button" style={styles.topButton}><Text style={styles.link}>{w("back", lang)}</Text></Pressable>
      <Text style={styles.status} numberOfLines={1}>{res.match.boss?.name ?? w("startAi", lang)} · {w("round", lang)} {view.round}</Text>
      {!over ? <Pressable onPress={concede} accessibilityRole="button" style={styles.topButton}><Text style={styles.concede}>{w("concede", lang)}</Text></Pressable> : <View style={styles.topButton} />}
    </View>

    <ChampionBar side={view.opponent} seat={1} lang={lang} lit={lit.has("c:1")} onTap={() => tapTarget({ champ: 1 })}
      extra={`${view.opponent.handCount} ${w("hand", lang)} · ${view.opponent.deckCount} ${w("deck", lang)}`} />
    <View style={styles.board} accessibilityLabel="Enemy board" onLayout={(e) => setBoardW(e.nativeEvent.layout.width)}>
      {Array.from({ length: 5 }, (_, i) => {
        const unit = view.opponent.board[i];
        if (!unit) return <View key={`e${i}`} style={[styles.slot, slotStyle]} />;
        return <Pressable key={unit.uid} onPress={() => tapTarget({ unit: unit.uid })} accessibilityRole="button">
          <UnitToken unit={unit} card={cardOf(unit.card)} ready={false} picked={false} target={lit.has(targetKey({ unit: unit.uid }))} width={slotW} />
        </Pressable>;
      })}
    </View>

    <View style={styles.middle}>
      <Pressable onPress={() => zone && setDetail(zone.id)} disabled={!zone} accessibilityRole="button" style={[styles.zone, zone && styles.zoneOn]}>
        <Text style={styles.zoneText} numberOfLines={1}>{zone ? `${w("zone", lang)}: ${zone.name}` : w("noZone", lang)}</Text>
      </Pressable>
      <Text style={[styles.turn, view.yourTurn && { color: "#9fbd83" }]}>{over ? "" : view.yourTurn ? w("yourTurn", lang) : w("theirTurn", lang)}</Text>
    </View>

    <View style={styles.board} accessibilityLabel="Your board">
      {Array.from({ length: 5 }, (_, i) => {
        const unit = view.me.board[i];
        if (!unit) return <View key={`m${i}`} style={[styles.slot, slotStyle]} />;
        const ready = attacksOf(legal, unit.uid).length > 0;
        return <Pressable key={unit.uid} onPress={() => tapTarget({ unit: unit.uid }, unit.uid)} accessibilityRole="button">
          <UnitToken unit={unit} card={cardOf(unit.card)} ready={ready} picked={ui.selection.k === "attacker" && ui.selection.unit === unit.uid} target={lit.has(targetKey({ unit: unit.uid }))} width={slotW} />
        </Pressable>;
      })}
    </View>
    <ChampionBar side={view.me} seat={0} lang={lang} lit={lit.has("c:0")} onTap={() => tapTarget({ champ: 0 })} extra={`${view.me.deckCount} ${w("deck", lang)}`} />

    <Text style={[styles.hint, ui.error && { color: colors.error }]} numberOfLines={2}>{hint}</Text>
    {modes.length ? <View style={styles.modes}>
      <Text style={styles.small} numberOfLines={3}>{cardOf(view.me.hand[selectedHand!] ?? "").text}</Text>
      {modes.map((mode) => <Pressable key={mode} onPress={() => dispatch({ type: "selectMode", mode })} accessibilityRole="button" style={styles.modeButton}><Text style={styles.modeText}>{w("mode", lang, { n: mode + 1 })}</Text></Pressable>)}
    </View> : null}

    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hand}>
      {view.me.hand.map((id, hand) => <Pressable key={`${id}-${hand}`} onPress={() => tapHand(hand)} onLongPress={() => setDetail(id)} accessibilityRole="button" accessibilityLabel={`${cardOf(id).name}, ${cardOf(id).cost} mana`}>
        <HandCard card={cardOf(id)} playable={playsOf(legal, hand).length > 0 || ui.selection.k === "mulligan"} picked={selectedHand === hand}
          marked={ui.selection.k === "mulligan" && ui.selection.replace.includes(hand)} />
      </Pressable>)}
    </ScrollView>

    <View style={styles.actions}>
      {ui.selection.k === "mulligan"
        ? <Pressable onPress={() => void send({ t: "mulligan", replace: ui.selection.k === "mulligan" ? ui.selection.replace : [] })} disabled={ui.busy} accessibilityRole="button" style={[styles.primary, { flex: 1 }]}>
            <Text style={styles.primaryText}>{ui.selection.replace.length ? w("replaceN", lang, { n: ui.selection.replace.length }) : w("keep", lang)}</Text>
          </Pressable>
        : <>
          <Pressable onPress={() => pick({ k: "power" }, { type: "selectPower" })} disabled={!powerReady || ui.busy} accessibilityRole="button" style={[styles.secondary, !powerReady && { opacity: 0.4 }, ui.selection.k === "power" && styles.secondaryOn]}>
            <Text style={styles.secondaryText} numberOfLines={1}>{power} (2)</Text>
          </Pressable>
          <Pressable onPress={() => setShowLog((v) => !v)} accessibilityRole="button" style={styles.logButton}><Text style={styles.link}>☰</Text></Pressable>
          <Pressable onPress={() => void send({ t: "end" })} disabled={!canEnd(legal) || ui.busy} accessibilityRole="button" style={[styles.primary, !canEnd(legal) && { opacity: 0.4 }]}>
            {ui.busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.primaryText}>{w("endTurn", lang)}</Text>}
          </Pressable>
        </>}
    </View>
    {showLog ? <View style={styles.log}><Text style={styles.label}>{w("log", lang).toUpperCase()}</Text>{ui.log.slice(-6).map((line, i) => <Text key={i} style={styles.small}>{line}</Text>)}</View> : null}

    <Modal visible={view.pending !== null && view.yourTurn} transparent animationType="fade">
      <View style={styles.backdrop}><View style={styles.sheet}>
        <Text style={styles.sheetTitle}>{w("loot", lang)}</Text>
        <View style={styles.lootRow}>{(view.pending?.options ?? []).map((id, index) => <Pressable key={`${id}-${index}`} onPress={() => void send({ t: "choose", index })} accessibilityRole="button">
          <CardFace card={cardOf(id)} width={96} />
        </Pressable>)}</View>
      </View></View>
    </Modal>

    <Modal visible={detail !== null} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
      <Pressable style={styles.backdrop} onPress={() => setDetail(null)}>{detail ? <CardFace card={cardOf(detail)} width={230} /> : null}</Pressable>
    </Modal>

    <Modal visible={over} transparent animationType="fade">
      <View style={styles.backdrop}><View style={styles.sheet}>
        <Text style={[styles.result, { color: view.winner === 0 ? STONE.gold : view.winner === "draw" ? colors.text : colors.error }]}>{view.winner === 0 ? w("won", lang) : view.winner === "draw" ? w("draw", lang) : w("lost", lang)}</Text>
        {res.rewards || res.match.rewards ? <Text style={styles.text}>{w("rewards", lang)}: {(res.rewards ?? res.match.rewards)!.dust} {w("dust", lang)}{(res.rewards ?? res.match.rewards)!.packs ? ` + ${(res.rewards ?? res.match.rewards)!.packs} ${w("pack", lang)}` : ""}</Text> : null}
        {res.rewards?.questsCompleted.length ? <Text style={styles.small}>✓ {res.rewards.questsCompleted.join(", ")}</Text> : null}
        <Pressable onPress={onExit} accessibilityRole="button" style={styles.primary}><Text style={styles.primaryText}>{w("playAgain", lang)}</Text></Pressable>
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 6, backgroundColor: STONE.brown, borderRadius: 12, padding: 6, borderWidth: 1, borderColor: STONE.line, marginHorizontal: -16 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 6 },
  topButton: { minHeight: 40, minWidth: 64, justifyContent: "center" },
  status: { flex: 1, color: STONE.parch, fontSize: 12, textAlign: "center", fontStyle: "italic" },
  link: { color: colors.gold, fontWeight: "700", fontSize: 14 },
  concede: { color: colors.error, fontWeight: "700", fontSize: 12, textAlign: "right" },
  champRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  portrait: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, backgroundColor: STONE.panel, alignItems: "center", justifyContent: "center" },
  portraitLit: { shadowColor: "#e0624f", shadowOpacity: 1, shadowRadius: 10 },
  portraitText: { fontSize: 22, fontWeight: "900" },
  hpBadge: { position: "absolute", right: -6, bottom: -4, backgroundColor: "#5a1414", borderColor: "#ff9a8a", borderWidth: 1.5, borderRadius: 11, minWidth: 24, height: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  hpText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  armorBadge: { position: "absolute", left: -6, bottom: -4, backgroundColor: "#3a3f48", borderColor: "#c9d1d9", borderWidth: 1.5, borderRadius: 4, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center" },
  armorText: { color: "#fff", fontWeight: "800", fontSize: 11 },
  champName: { color: STONE.gold, fontWeight: "700", fontSize: 14 },
  small: { color: colors.muted, fontSize: 11 },
  pips: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 3 },
  pip: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: "#5aa9ff" },
  pipFull: { backgroundColor: "#3b8fe8" },
  board: { flexDirection: "row", justifyContent: "center", gap: 4, alignItems: "center", backgroundColor: "#1a120b", borderRadius: 8, padding: 3 },
  slot: { borderRadius: 8, borderWidth: 1, borderColor: STONE.line, borderStyle: "dashed" },
  middle: { flexDirection: "row", alignItems: "center", gap: 8 },
  zone: { flex: 1, borderWidth: 1, borderColor: STONE.line, borderRadius: 6, paddingHorizontal: 8, minHeight: 30, justifyContent: "center" },
  zoneOn: { borderColor: STONE.gold, backgroundColor: "#2a1d0c" },
  zoneText: { color: STONE.parch, fontSize: 11, fontStyle: "italic" },
  turn: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  hint: { color: STONE.parch, fontSize: 12, textAlign: "center", minHeight: 16 },
  modes: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  modeButton: { borderWidth: 1, borderColor: STONE.gold, borderRadius: 6, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  modeText: { color: STONE.gold, fontWeight: "700" },
  hand: { gap: 6, paddingTop: 12, paddingBottom: 4, paddingHorizontal: 2 },
  actions: { flexDirection: "row", gap: 6, alignItems: "center" },
  primary: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 46, minWidth: 110, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  primaryText: { color: colors.ink, fontWeight: "800", fontSize: 14 },
  secondary: { flex: 1, borderWidth: 1, borderColor: "#5aa9ff", borderRadius: 8, minHeight: 46, justifyContent: "center", paddingHorizontal: 10 },
  secondaryOn: { backgroundColor: "#1d4f9c" },
  secondaryText: { color: "#cfe6ff", fontSize: 12, fontWeight: "700" },
  logButton: { minWidth: 44, minHeight: 46, alignItems: "center", justifyContent: "center" },
  log: { backgroundColor: STONE.panel, borderRadius: 8, padding: 8, gap: 2 },
  label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "#000c", alignItems: "center", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: colors.panel, borderColor: STONE.gold, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12, alignItems: "center", maxWidth: 380 },
  sheetTitle: { color: STONE.gold, fontSize: 16, fontWeight: "700" },
  lootRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  result: { fontSize: 30, fontWeight: "900" },
  text: { color: colors.text, fontSize: 14 }
});
