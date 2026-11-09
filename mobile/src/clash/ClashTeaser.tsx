import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Lang } from "../i18n";
import { colors } from "../ui";
import { CardBack, STONE } from "./CardFrame";
import { w } from "./words";

/** The entry card in the Me tab, under the badge album. */
export function ClashTeaser({ lang, onOpen }: { lang: Lang; onOpen: () => void }) {
  return <View style={styles.card}>
    <View style={styles.backs}><CardBack width={44} style={{ transform: [{ rotate: "-8deg" }] }} /><CardBack width={44} style={{ marginLeft: -24, transform: [{ rotate: "6deg" }] }} /></View>
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={styles.title}>{w("title", lang)}</Text>
      <Text style={styles.text}>{w("intro", lang)}</Text>
      <Pressable onPress={onOpen} accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>{w("open", lang)}</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: 14, alignItems: "center", backgroundColor: STONE.panel, borderColor: STONE.gold, borderWidth: 1, borderTopWidth: 3, borderRadius: 12, padding: 12, marginTop: 12 },
  backs: { flexDirection: "row", paddingLeft: 4 },
  title: { color: STONE.gold, fontSize: 18, fontWeight: "800", fontStyle: "italic" },
  text: { color: STONE.parch, fontSize: 12, lineHeight: 17 },
  button: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, alignSelf: "flex-start" },
  buttonText: { color: colors.ink, fontWeight: "800", fontSize: 14 }
});
