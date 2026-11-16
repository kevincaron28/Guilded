import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

/**
 * One list line: an optional leading slot (rank, medal, icon, colour swatch), the name with a muted sub line,
 * then a green score or any trailing node. With `onPress` the whole line is a 44 px button.
 */
export function Row({ leading, name, nameColor, sub, score, trailing, onPress, disabled, accessibilityLabel }: {
  leading?: ReactNode; name: string; nameColor?: string | null; sub?: string | null; score?: string | number | null;
  trailing?: ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string;
}) {
  const content = <>
    {leading}
    <View style={styles.middle}>
      <Text style={[styles.name, nameColor ? { color: nameColor } : null]}>{name}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
    {score !== undefined && score !== null ? <Text style={styles.score}>{score}</Text> : null}
    {trailing}
  </>;
  return onPress
    ? <Pressable onPress={onPress} disabled={disabled} accessibilityRole={disabled ? undefined : "button"} accessibilityLabel={accessibilityLabel} style={styles.row}>{content}</Pressable>
    : <View style={styles.row} accessibilityLabel={accessibilityLabel}>{content}</View>;
}

/** The rank number column used before a name (places without a medal). */
export function RankNumber({ rank }: { rank: number }) {
  return <Text style={styles.rank}>{rank}</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 10, minHeight: 44 },
  middle: { flex: 1 },
  rank: { color: colors.gold, width: 22, fontSize: 12 },
  name: { color: colors.text, fontSize: 14, fontWeight: "600" },
  sub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  score: { color: colors.green, fontWeight: "700", fontSize: 14 }
});
