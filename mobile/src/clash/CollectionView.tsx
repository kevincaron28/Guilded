import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import type { Lang } from "../i18n";
import { ProgressBar, SegmentedTabs, colors } from "../ui";
import type { ClashApi } from "./api";
import { CardFace, RARITY_EDGE, STONE } from "./CardFrame";
import { craftable, groupCollection, type OwnedFilter } from "./state";
import type { ClashCard, Collection, CollectionCard, Rarity } from "./types";
import { RARITIES } from "./types";
import { w } from "./words";

/** A collection card drawn in the style A frame. Class cards are Champion portraits, badge cards come from achievements. */
export function asFace(card: CollectionCard): ClashCard {
  const cls = card.key.startsWith("class:") ? card.key.split(":")[1] as ClashCard["cls"] : "neutral";
  const flavour = card.flavour ?? (card.family === "class" ? "Champion portrait. Guilded Collection." : "");
  return { id: card.key, name: card.name, type: "standard", rarity: card.rarity, cost: 0, cls, text: "", flavour, artUrl: card.artUrl };
}

/** Owned cards by class and rarity, the dust balance and crafting. */
export function CollectionView({ api, lang, collection, onChange }: { api: ClashApi; lang: Lang; collection: Collection; onChange: (next: Collection) => void }) {
  const [filter, setFilter] = useState<OwnedFilter>("all");
  const [rarity, setRarity] = useState<Rarity | "all">("all");
  const [open, setOpen] = useState<CollectionCard | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => groupCollection(collection.cards, filter, rarity), [collection.cards, filter, rarity]);

  const craft = async (card: CollectionCard) => {
    setBusy(true); setNotice(null);
    try { const next = await api.craft(card.key); onChange(next); setOpen(next.cards.find((c) => c.key === card.key) ?? null); setNotice(w("crafted", lang)); }
    catch (e) { setNotice(e instanceof Error ? e.message : w("failed", lang)); }
    finally { setBusy(false); }
  };

  return <View style={{ gap: 12 }}>
    <View style={styles.summary}>
      <View style={{ flex: 1 }}>
        <Text style={styles.big}>{collection.owned} / {collection.total} <Text style={styles.small}>{w("owned", lang)}</Text></Text>
        <ProgressBar done={collection.owned} total={collection.total} />
      </View>
      <View style={styles.dust}><Text style={styles.dustValue}>{collection.dust}</Text><Text style={styles.small}>{w("dust", lang)}</Text></View>
    </View>
    <SegmentedTabs options={(["all", "owned", "missing"] as const).map((value) => ({ value, label: w(value === "owned" ? "mine" : value, lang) }))} value={filter} onChange={setFilter} />
    <View style={styles.rarities}>
      {(["all", ...RARITIES] as const).map((r) => <Pressable key={r} onPress={() => setRarity(r)} accessibilityRole="button" accessibilityState={{ selected: rarity === r }}
        style={[styles.rarity, { borderColor: r === "all" ? colors.line : RARITY_EDGE[r] }, rarity === r && { backgroundColor: r === "all" ? colors.gold : RARITY_EDGE[r] }]}>
        <Text style={[styles.rarityText, rarity === r && { color: colors.ink, fontWeight: "700" }]}>{r === "all" ? w("all", lang) : r.charAt(0).toUpperCase()}</Text>
      </Pressable>)}
    </View>
    {groups.map((group) => <View key={group.key}>
      <Text style={styles.label}>{group.title.toUpperCase()}  {group.owned}/{group.cards.length}</Text>
      <View style={styles.grid}>{group.cards.map((card) => <Pressable key={card.key} onPress={() => { setOpen(card); setNotice(null); }} accessibilityRole="button">
        <CardFace card={asFace(card)} width={96} dim={!card.owned} collectible typeLabel={card.rarityLabel} />
        {card.count > 1 ? <Text style={styles.count}>×{card.count}</Text> : null}
        {craftable(card, collection.dust) ? <Text style={styles.craftTag}>{w("craft", lang)}</Text> : null}
      </Pressable>)}</View>
    </View>)}
    <Modal visible={open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
      <Pressable style={styles.backdrop} onPress={() => setOpen(null)}>
        {open ? <Pressable style={styles.detail} onPress={() => undefined}>
          <CardFace card={asFace(open)} width={220} dim={!open.owned} collectible typeLabel={`${open.rarityLabel} · ${open.family === "badge" ? "Badge" : "Champion"}`} />
          <Text style={styles.detailLine}>{open.owned ? `${open.count} ${w("copies", lang)}` : open.craftCost === null ? w("notCraftable", lang) : `${w("craft", lang)}: ${open.craftCost} ${w("dust", lang)}`}</Text>
          {!open.owned && open.craftCost !== null ? <Pressable disabled={busy || !craftable(open, collection.dust)} onPress={() => void craft(open)} accessibilityRole="button"
            style={[styles.button, !craftable(open, collection.dust) && { opacity: 0.4 }]}><Text style={styles.buttonText}>{craftable(open, collection.dust) ? `${w("craft", lang)} (${open.craftCost})` : w("needDust", lang)}</Text></Pressable> : null}
          {notice ? <Text style={styles.detailLine}>{notice}</Text> : null}
          <Pressable onPress={() => setOpen(null)} accessibilityRole="button" style={styles.ghost}><Text style={styles.ghostText}>{w("close", lang)}</Text></Pressable>
        </Pressable> : null}
      </Pressable>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: STONE.panel, borderColor: STONE.line, borderWidth: 1, borderRadius: 12, padding: 12 },
  big: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 6 },
  small: { color: colors.muted, fontSize: 11, fontWeight: "400" },
  dust: { alignItems: "center" }, dustValue: { color: "#c9b3ff", fontSize: 22, fontWeight: "800" },
  rarities: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  rarity: { minWidth: 36, minHeight: 32, borderWidth: 2, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  rarityText: { color: colors.text, fontSize: 12 },
  label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700", marginTop: 6, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  count: { position: "absolute", right: 6, top: 30, color: colors.text, backgroundColor: "#000a", fontSize: 11, fontWeight: "800", paddingHorizontal: 4, borderRadius: 4 },
  craftTag: { position: "absolute", left: 6, top: 30, color: colors.ink, backgroundColor: "#c9b3ff", fontSize: 10, fontWeight: "800", paddingHorizontal: 4, borderRadius: 4 },
  backdrop: { flex: 1, backgroundColor: "#000c", alignItems: "center", justifyContent: "center", padding: 24 },
  detail: { backgroundColor: colors.panel, borderRadius: 14, borderWidth: 1, borderColor: STONE.gold, padding: 16, alignItems: "center", gap: 10, maxWidth: 360 },
  detailLine: { color: colors.text, fontSize: 13, textAlign: "center" },
  button: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 44, minWidth: 180, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  buttonText: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  ghost: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16 }, ghostText: { color: colors.gold, fontWeight: "700" }
});
