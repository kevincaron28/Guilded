import { StyleSheet, View } from "react-native";
import { colors } from "./theme";

/** A thin bar filled to done/total (0 when total is 0). */
export function ProgressBar({ done, total, color = colors.gold }: { done: number; total: number; color?: string }) {
  const share = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  return <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }}>
    <View style={[styles.fill, { width: `${Math.round(share * 100)}%`, backgroundColor: color }]} />
  </View>;
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden" },
  fill: { height: 6 }
});
