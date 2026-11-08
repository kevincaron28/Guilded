import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { classColor } from "../publicApi";
import { championArt } from "./championArt";
import { rulesText } from "./state";
import type { ClashCard, Keyword, Rarity, UnitView } from "./types";

// Frame style A, "gold and stone" (docs/plans/APP_TCG_ART.md, docs/plans/app-tcg-art/make-samples.mjs): a dark stone
// card, a gold title, the rarity on the outer edge and a parchment rules box. The art window shows `artUrl` when the
// owner-approved painted art exists, and a plain class-coloured placeholder until then. No Blizzard art.

export const STONE = { gold: "#ffd100", parch: "#f5e6c0", muted: "#b9a77f", brown: "#120d08", panel: "#21180f", line: "#3a2c1c" } as const;
export const RARITY_EDGE: Record<Rarity, string> = { common: "#9d9d9d", uncommon: "#1eff00", rare: "#3b8fe8", epic: "#b25cf0", legendary: "#ff8000" };
const KW_LABEL: Record<Keyword, string> = { guard: "Guard", swift: "Swift", shield: "Shield", shadow: "Shadow", venom: "Venom", drain: "Drain", twin: "Twin Strike" };
const TYPE_LABEL: Record<ClashCard["type"], string> = { unit: "Unit", spell: "Spell", gear: "Gear", zone: "Zone", standard: "Standard" };

/** The art window: painted art when it exists, else a placeholder in the card's class colour with its initial. */
export function ArtWindow({ card, height }: { card: Pick<ClashCard, "name" | "cls" | "artUrl" | "type">; height: number }) {
  if (card.artUrl) return <Image source={{ uri: card.artUrl }} style={[styles.art, { height }]} resizeMode="cover" accessibilityIgnoresInvertColors />;
  // Champion (class) cards fall back to the owner-approved painting of their class; set cards keep the placeholder.
  const champion = card.type === "standard" ? championArt(card.cls) : null;
  if (champion) return <Image source={champion.window} style={[styles.art, { height }]} resizeMode="cover" accessibilityIgnoresInvertColors />;
  const tint = card.cls === "neutral" ? STONE.muted : classColor(card.cls);
  return <View style={[styles.art, styles.placeholder, { height, borderColor: tint }]}>
    <View style={[styles.glow, { backgroundColor: tint }]} />
    <Text style={[styles.initial, { color: tint, fontSize: Math.max(14, height * 0.42) }]}>{card.name.charAt(0)}</Text>
  </View>;
}

function Gem({ value, size }: { value: number; size: number }) {
  return <View style={[styles.gem, { width: size, height: size, borderRadius: size / 2 }]}><Text style={[styles.gemText, { fontSize: size * 0.55 }]}>{value}</Text></View>;
}
function Stat({ value, kind, size, hurt }: { value: number; kind: "atk" | "hp"; size: number; hurt?: boolean }) {
  return <View style={[styles.stat, kind === "atk" ? styles.atk : styles.hp, { width: size, height: size, borderRadius: kind === "atk" ? 4 : size / 2 }]}>
    <Text style={[styles.statText, { fontSize: size * 0.55 }, hurt && { color: "#ff7a6a" }]}>{value}</Text>
  </View>;
}

/** A full card (collection, pack, card detail). `width` sets the scale; height follows the 5:7 card shape. */
export function CardFace({ card, width = 150, dim = false, style, typeLabel, collectible = false }: { card: ClashCard; width?: number; dim?: boolean; style?: StyleProp<ViewStyle>; typeLabel?: string; collectible?: boolean }) {
  const edge = RARITY_EDGE[card.rarity];
  const s = width / 150;
  const keywords = (card.kw ?? []).map((k) => KW_LABEL[k]).join(", ");
  return <View style={[styles.card, { width, height: width * 1.4, borderColor: edge, opacity: dim ? 0.45 : 1 }, style]} accessible accessibilityLabel={`${card.name}, ${card.cost} mana ${TYPE_LABEL[card.type]}. ${card.text}`}>
    <View style={[styles.title, { height: 22 * s, paddingHorizontal: collectible ? 4 : 18 * s }]}><Text style={[styles.titleText, { fontSize: 11 * s }]} numberOfLines={1}>{card.name}</Text></View>
    <ArtWindow card={card} height={58 * s} />
    <Text style={[styles.typeLine, { fontSize: 8 * s }]} numberOfLines={1}>{typeLabel ?? <>{TYPE_LABEL[card.type]}{card.cls !== "neutral" ? ` · ${card.cls.charAt(0).toUpperCase()}${card.cls.slice(1)}` : ""}{card.role && card.role !== "damage" ? ` · ${card.role === "tank" ? "Tank" : "Healer"}` : ""}</>}</Text>
    <View style={styles.rules}>
      {keywords ? <Text style={[styles.kw, { fontSize: 8.5 * s }]} numberOfLines={1}>{keywords}</Text> : null}
      <Text style={[styles.rulesText, { fontSize: 8.5 * s }]} numberOfLines={4}>{rulesText(card, keywords)}</Text>
    </View>
    {collectible ? null : <View style={[styles.corner, { left: 3, top: 3 }]}><Gem value={card.cost} size={20 * s} /></View>}
    {card.type === "unit" && !collectible ? <>
      <View style={[styles.corner, { left: 3, bottom: 3 }]}><Stat value={card.atk ?? 0} kind="atk" size={20 * s} /></View>
      <View style={[styles.corner, { right: 3, bottom: 3 }]}><Stat value={card.hp ?? 0} kind="hp" size={20 * s} /></View>
    </> : null}
    {card.type === "gear" && card.gear ? <Text style={[styles.gear, { fontSize: 9 * s }]}>+{card.gear.atk}/+{card.gear.hp}</Text> : null}
  </View>;
}

/** The back of a card (pack opening, opponent's hand). */
export function CardBack({ width = 150, style }: { width?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, styles.back, { width, height: width * 1.4 }, style]}>
    <View style={[styles.backRing, { width: width * 0.5, height: width * 0.5, borderRadius: width * 0.25 }]}><Text style={[styles.backG, { fontSize: width * 0.26 }]}>G</Text></View>
  </View>;
}

/** A small hand card: cost, name, stats. Lit when playable, raised when picked. */
export function HandCard({ card, playable, picked, marked }: { card: ClashCard; playable: boolean; picked: boolean; marked?: boolean }) {
  return <View style={[styles.hand, { borderColor: picked ? STONE.gold : RARITY_EDGE[card.rarity] }, playable && styles.handPlayable, picked && styles.handPicked, marked && styles.handMarked]}>
    <View style={styles.handTop}><Gem value={card.cost} size={16} /><Text style={styles.handType}>{TYPE_LABEL[card.type].charAt(0)}</Text></View>
    <Text style={styles.handName} numberOfLines={2}>{card.name}</Text>
    {card.type === "unit" ? <View style={styles.handStats}><Stat value={card.atk ?? 0} kind="atk" size={15} /><Stat value={card.hp ?? 0} kind="hp" size={15} /></View> : null}
  </View>;
}

/** A unit on the board: art, keywords as letters, Attack and current Health. */
export function UnitToken({ unit, card, ready, picked, target, width = 60 }: { unit: UnitView; card: ClashCard; ready: boolean; picked: boolean; target: boolean; width?: number }) {
  const kw = [...new Set([...unit.kw, ...unit.tempKw])];
  const health = unit.hp - unit.dmg;
  return <View style={[styles.unit, { width, height: width * 1.4, borderColor: picked ? STONE.gold : target ? "#e0624f" : RARITY_EDGE[card.rarity] }, ready && styles.unitReady, picked && styles.unitPicked, target && styles.unitTarget, kw.includes("guard") && styles.guard]}
    accessible accessibilityLabel={`${card.name}, ${unit.atk + unit.tempAtk} attack, ${health} health${kw.length ? `, ${kw.map((k) => KW_LABEL[k]).join(", ")}` : ""}${unit.chilled ? ", chilled" : ""}`}>
    <ArtWindow card={card} height={width * 0.5} />
    <Text style={styles.unitName} numberOfLines={1}>{card.name}</Text>
    <Text style={styles.unitKw} numberOfLines={1}>{kw.map((k) => KW_LABEL[k].charAt(0)).join(" ")}{unit.chilled ? " ❄" : ""}{unit.gear ? " ⚙" : ""}</Text>
    <View style={styles.unitStats}><Stat value={unit.atk + unit.tempAtk} kind="atk" size={17} /><Stat value={health} kind="hp" size={17} hurt={unit.dmg > 0} /></View>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: STONE.panel, borderWidth: 3, borderRadius: 10, padding: 4, overflow: "hidden" },
  title: { backgroundColor: STONE.brown, borderWidth: 1, borderColor: STONE.gold, borderRadius: 4, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  titleText: { color: STONE.gold, fontStyle: "italic", fontWeight: "700" },
  art: { width: "100%", borderRadius: 4, marginTop: 3, backgroundColor: "#0b0806", borderWidth: 1, borderColor: STONE.line, overflow: "hidden" },
  placeholder: { alignItems: "center", justifyContent: "center" },
  glow: { position: "absolute", height: "80%", aspectRatio: 1, borderRadius: 999, opacity: 0.16 },
  initial: { fontWeight: "900", opacity: 0.85 },
  typeLine: { color: STONE.parch, fontStyle: "italic", marginTop: 3, borderWidth: 1, borderColor: STONE.line, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  rules: { flex: 1, marginTop: 3, borderWidth: 1, borderColor: STONE.line, borderRadius: 4, padding: 4, backgroundColor: "#170f09" },
  kw: { color: STONE.gold, fontWeight: "700" },
  rulesText: { color: STONE.parch, lineHeight: 12 },
  corner: { position: "absolute" },
  gem: { backgroundColor: "#1d4f9c", borderWidth: 1.5, borderColor: "#9fd0ff", alignItems: "center", justifyContent: "center" },
  gemText: { color: "#fff", fontWeight: "900" },
  stat: { alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  atk: { backgroundColor: "#5a3a12", borderColor: STONE.gold },
  hp: { backgroundColor: "#5a1414", borderColor: "#ff9a8a" },
  statText: { color: "#fff", fontWeight: "900" },
  gear: { position: "absolute", right: 6, bottom: 6, color: STONE.gold, fontWeight: "800" },
  back: { borderColor: STONE.gold, alignItems: "center", justifyContent: "center", backgroundColor: "#1a120b" },
  backRing: { borderWidth: 3, borderColor: STONE.gold, alignItems: "center", justifyContent: "center", backgroundColor: STONE.brown },
  backG: { color: STONE.gold, fontWeight: "900" },
  hand: { width: 66, height: 92, borderRadius: 7, borderWidth: 2, backgroundColor: STONE.panel, padding: 4, opacity: 0.6 },
  handPlayable: { opacity: 1, shadowColor: "#9fd0ff", shadowOpacity: 0.6, shadowRadius: 6 },
  handPicked: { transform: [{ translateY: -10 }], opacity: 1 },
  handMarked: { opacity: 0.35, borderStyle: "dashed" },
  handTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  handType: { color: STONE.muted, fontSize: 10, fontWeight: "700" },
  handName: { color: STONE.parch, fontSize: 10, fontWeight: "700", marginTop: 4, lineHeight: 12 },
  handStats: { position: "absolute", left: 4, right: 4, bottom: 4, flexDirection: "row", justifyContent: "space-between" },
  unit: { width: 60, height: 84, borderRadius: 8, borderWidth: 2, backgroundColor: STONE.panel, padding: 3 },
  unitReady: { shadowColor: "#9fbd83", shadowOpacity: 0.8, shadowRadius: 6, borderColor: "#9fbd83" },
  unitPicked: { transform: [{ translateY: -6 }] },
  unitTarget: { shadowColor: "#e0624f", shadowOpacity: 0.9, shadowRadius: 8 },
  guard: { borderWidth: 3 },
  unitName: { color: STONE.parch, fontSize: 8, fontWeight: "700", marginTop: 2 },
  unitKw: { color: STONE.gold, fontSize: 8, height: 11 },
  unitStats: { position: "absolute", left: 3, right: 3, bottom: 3, flexDirection: "row", justifyContent: "space-between" }
});
