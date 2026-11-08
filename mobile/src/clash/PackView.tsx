import { useEffect, useReducer, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import type { Lang } from "../i18n";
import { colors } from "../ui";
import type { ClashApi } from "./api";
import { CardBack, CardFace, RARITY_EDGE, STONE } from "./CardFrame";
import { asFace } from "./CollectionView";
import { packReducer, packStart, revealOrder } from "./state";
import type { Collection, OpenedPack } from "./types";
import { w } from "./words";

const CARD_W = 100;

function untilText(iso: string | null, lang: Lang): string {
  if (!iso) return "—";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return lang === "fr" ? "bientôt" : "soon";
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000);
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/** One card of the fan: flies out of the pack, then flips (scale on X) to its face when tapped. */
function FanCard({ pack, index, slot, flipped, onFlip, lang }: { pack: OpenedPack; index: number; slot: number; flipped: boolean; onFlip: () => void; lang: Lang }) {
  const out = useRef(new Animated.Value(0)).current;
  const flip = useRef(new Animated.Value(flipped ? 1 : 0)).current;
  const [face, setFace] = useState(flipped);
  useEffect(() => { Animated.timing(out, { toValue: 1, duration: 380, delay: slot * 90, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start(); }, [out, slot]);
  useEffect(() => {
    if (!flipped || face) return;
    Animated.timing(flip, { toValue: 0.5, duration: 140, useNativeDriver: true }).start(() => {
      setFace(true);
      Animated.timing(flip, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    });
  }, [flipped, face, flip]);
  const pulled = pack.cards[index]!;
  const card = pack.collection.cards.find((c) => c.key === pulled.key);
  const scaleX = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 1] });
  const translateY = out.interpolate({ inputRange: [0, 1], outputRange: [-160, 0] });
  const rotate = out.interpolate({ inputRange: [0, 1], outputRange: [`${(slot - 2) * 9}deg`, "0deg"] });
  return <Pressable onPress={onFlip} disabled={face} accessibilityRole="button" accessibilityLabel={face ? `${pulled.name}, ${pulled.rarityLabel}${pulled.isNew ? `, ${w("isNew", lang)}` : ""}` : w("flip", lang)}>
    <Animated.View style={{ opacity: out, transform: [{ translateY }, { rotate }, { scaleX }] }}>
      {face && card ? <View>
        <CardFace card={asFace(card)} width={CARD_W} collectible typeLabel={pulled.rarityLabel} style={{ shadowColor: RARITY_EDGE[pulled.rarity], shadowOpacity: 0.9, shadowRadius: 10 }} />
        {pulled.isNew ? <Text style={styles.newTag}>{w("isNew", lang)}</Text> : <Text style={styles.dupTag}>+{pulled.dust}</Text>}
      </View> : <View><CardBack width={CARD_W} /><View style={[styles.rarityHint, { backgroundColor: RARITY_EDGE[pulled.rarity] }]} /></View>}
    </Animated.View>
  </Pressable>;
}

/** The daily pack: banked count, timer, odds and the opening (tear, fan out, flip with NEW tags). */
export function PackView({ api, lang, collection, onChange }: { api: ClashApi; lang: Lang; collection: Collection; onChange: (next: Collection) => void }) {
  const [pack, setPack] = useState<OpenedPack | null>(null);
  const [ui, dispatch] = useReducer(packReducer, packStart(5));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shake = useRef(new Animated.Value(0)).current;

  const open = async () => {
    setBusy(true); setError(null);
    try { const opened = await api.openPack(); setPack(opened); dispatch({ type: "reset", size: opened.cards.length }); }
    catch (e) { setError(e instanceof Error ? e.message : w("failed", lang)); }
    finally { setBusy(false); }
  };
  const tear = () => {
    Animated.sequence([-1, 1, -1, 0].map((toValue) => Animated.timing(shake, { toValue, duration: 60, useNativeDriver: true }))).start(() => { dispatch({ type: "tear" }); dispatch({ type: "fan" }); });
  };
  const finish = () => { if (pack) onChange(pack.collection); setPack(null); };

  if (pack) {
    const order = revealOrder(pack.cards.map((c) => c.rarity));
    const newCount = pack.cards.filter((c) => c.isNew).length;
    return <View style={styles.stage}>
      {ui.stage === "sealed" ? <Pressable onPress={tear} accessibilityRole="button" accessibilityLabel={w("tear", lang)} style={styles.center}>
        <Animated.View style={[styles.pack, { transform: [{ rotate: shake.interpolate({ inputRange: [-1, 1], outputRange: ["-4deg", "4deg"] }) }] }]}>
          <View style={styles.packBand} /><Text style={styles.packTitle}>GUILDED</Text><Text style={styles.packSub}>Dawn of Forever</Text><View style={[styles.packBand, { bottom: 24, top: undefined }]} />
        </Animated.View>
        <Text style={styles.hint}>{w("tear", lang)}</Text>
      </Pressable> : <>
        <Text style={styles.hint}>{ui.stage === "done" ? `${newCount} ${w("isNew", lang)} · ${w("dustGained", lang)}: ${pack.dustGained}` : w("flip", lang)}</Text>
        <View style={styles.fan}>{order.map((index, slot) => <FanCard key={index} pack={pack} index={index} slot={slot} flipped={ui.flipped[index] ?? false} lang={lang} onFlip={() => dispatch({ type: "flip", index })} />)}</View>
        {ui.stage === "done"
          ? <Pressable onPress={finish} accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>{w("done", lang)}</Text></Pressable>
          : <Pressable onPress={() => dispatch({ type: "flipAll" })} accessibilityRole="button" style={styles.ghost}><Text style={styles.ghostText}>{w("flipAll", lang)}</Text></Pressable>}
      </>}
    </View>;
  }

  return <View style={{ gap: 12 }}>
    <View style={styles.status}>
      <CardBack width={70} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.big}>{collection.packs.ready} / {collection.packs.max} {w("ready", lang)}</Text>
        <Text style={styles.muted}>{w("nextPack", lang)}: {collection.packs.ready >= collection.packs.max ? "—" : untilText(collection.packs.nextAt, lang)}</Text>
        <Text style={styles.muted}>{w("pity", lang, { epic: collection.pity.epicIn, legendary: collection.pity.legendaryIn })}</Text>
      </View>
    </View>
    <Pressable onPress={() => void open()} disabled={busy || collection.packs.ready < 1} accessibilityRole="button" style={[styles.button, collection.packs.ready < 1 && { opacity: 0.4 }]}>
      {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.buttonText}>{w("openPack", lang)}</Text>}
    </Pressable>
    {collection.packs.ready < 1 ? <Text style={styles.muted}>{w("noPack", lang)}</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {collection.odds ? <View style={styles.odds}>
      <Text style={styles.label}>{w("odds", lang).toUpperCase()}</Text>
      <Text style={styles.muted}>{w("oddsLine", lang, { epic: collection.odds.epicPity, legendary: collection.odds.legendaryPity })}</Text>
      <Text style={styles.muted}>{Object.entries(collection.odds.rarePlusSlot).map(([r, pct]) => `${r} ${pct}%`).join(" · ")}</Text>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  stage: { alignItems: "center", gap: 14, paddingVertical: 8, minHeight: 420 },
  center: { alignItems: "center", gap: 16, paddingTop: 20 },
  pack: { width: 170, height: 240, borderRadius: 14, backgroundColor: "#2a1a0c", borderWidth: 3, borderColor: STONE.gold, alignItems: "center", justifyContent: "center", shadowColor: STONE.gold, shadowOpacity: 0.6, shadowRadius: 18 },
  packBand: { position: "absolute", top: 24, left: 0, right: 0, height: 8, backgroundColor: STONE.gold, opacity: 0.8 },
  packTitle: { color: STONE.gold, fontSize: 24, fontWeight: "900", letterSpacing: 4 },
  packSub: { color: STONE.parch, fontSize: 12, fontStyle: "italic", marginTop: 6 },
  hint: { color: colors.muted, fontSize: 13, textAlign: "center" },
  fan: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  newTag: { position: "absolute", top: -8, alignSelf: "center", color: colors.ink, backgroundColor: "#9fbd83", fontWeight: "900", fontSize: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  dupTag: { position: "absolute", top: -8, alignSelf: "center", color: colors.ink, backgroundColor: "#c9b3ff", fontWeight: "800", fontSize: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  rarityHint: { position: "absolute", bottom: 8, alignSelf: "center", width: 24, height: 4, borderRadius: 2, opacity: 0.8 },
  status: { flexDirection: "row", gap: 14, alignItems: "center", backgroundColor: STONE.panel, borderColor: STONE.line, borderWidth: 1, borderRadius: 12, padding: 12 },
  big: { color: colors.text, fontSize: 18, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.error, fontSize: 13 },
  odds: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700" },
  button: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 48, minWidth: 200, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, alignSelf: "stretch" },
  buttonText: { color: colors.ink, fontWeight: "700", fontSize: 15 },
  ghost: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }, ghostText: { color: colors.gold, fontWeight: "700" }
});
