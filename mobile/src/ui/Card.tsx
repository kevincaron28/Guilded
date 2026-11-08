import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "./theme";

/** A panel. `edge` draws the 3 px top edge in the item's colour (tier on badges, class on characters). */
export function Card({ children, edge, style }: { children: ReactNode; edge?: string | null; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, edge ? { borderTopWidth: 3, borderTopColor: edge } : null, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 14, gap: 8 }
});
