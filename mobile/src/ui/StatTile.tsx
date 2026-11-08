import { StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

/** One big number with a small caption under it. */
export function StatTile({ value, label }: { value: string | number; label: string }) {
  return <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
    <Text style={styles.value}>{value}</Text>
    <Text style={styles.label}>{label.toUpperCase()}</Text>
  </View>;
}

const styles = StyleSheet.create({
  tile: { minWidth: 72 },
  value: { color: colors.text, fontSize: 28, fontWeight: "700" },
  label: { color: colors.muted, fontSize: 8, letterSpacing: 1.2, marginTop: 3 }
});
