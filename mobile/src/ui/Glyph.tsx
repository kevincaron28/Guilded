import { StyleSheet, View } from "react-native";
import { colors } from "./theme";

/**
 * Small drawn icons that replace the typed arrows ("←", "↗", "›"), so they look the same on every phone font and a
 * screen reader never reads out an arrow character. Decorative: the button around one carries the accessibility label.
 */
export type GlyphName = "back" | "next" | "external";

export function Glyph({ name, color = colors.gold, size = 10 }: { name: GlyphName; color?: string; size?: number }) {
  const stroke = Math.max(1.5, size / 6);
  if (name === "external") {
    return <View style={{ width: size + 2, height: size + 2 }} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={{ position: "absolute", top: 1, right: 1, width: size * 0.7, height: size * 0.7, borderTopWidth: stroke, borderRightWidth: stroke, borderColor: color }} />
      <View style={{ position: "absolute", top: size * 0.45, right: 0, width: size * 1.1, height: stroke, backgroundColor: color, transform: [{ rotate: "-45deg" }] }} />
    </View>;
  }
  return <View style={[styles.box, { width: size, height: size }]} accessible={false} importantForAccessibility="no-hide-descendants">
    <View style={{ width: size * 0.7, height: size * 0.7, borderColor: color, borderLeftWidth: stroke, borderBottomWidth: stroke, transform: [{ rotate: name === "back" ? "45deg" : "-135deg" }], marginLeft: name === "back" ? size * 0.2 : -size * 0.2 }} />
  </View>;
}

const styles = StyleSheet.create({ box: { alignItems: "center", justifyContent: "center" } });
