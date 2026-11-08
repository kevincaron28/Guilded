import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

/** The pill row used for sections inside a tab. Each pill is at least 44 px tall to tap. */
export function SegmentedTabs<T extends string | number>({ options, value, onChange }: {
  options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void;
}) {
  return <View style={styles.row} accessibilityRole="tablist">
    {options.map((option) => {
      const on = option.value === value;
      return <Pressable key={String(option.value)} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(option.value)} style={[styles.chip, on && styles.chipOn]}>
        <Text style={[styles.text, on && styles.textOn]}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 14, minHeight: 36, justifyContent: "center" },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  text: { color: colors.muted, fontSize: 12 },
  textOn: { color: colors.ink, fontWeight: "700" }
});
