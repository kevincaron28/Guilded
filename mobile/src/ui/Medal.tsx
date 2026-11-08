import { StyleSheet, Text, View } from "react-native";

/** The badge medal from the album: tier letter in a ring, one pip per rank. Grey and dotted while locked. */
export function Medal({ tier, color, rank, earned }: { tier: string; color: string; rank: number | null; earned: boolean }) {
  const colour = earned ? color : "#4a4f58";
  return <View style={[styles.medal, { borderColor: colour, backgroundColor: earned ? "#1c1a26" : "#101112" }]}>
    <Text style={[styles.letter, { color: colour }]}>{earned ? tier.charAt(0).toUpperCase() : "·"}</Text>
    {rank ? <View style={styles.pips}>{Array.from({ length: Math.min(rank, 10) }, (_, i) => <View key={i} style={[styles.pip, { backgroundColor: colour }]} />)}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  medal: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  letter: { fontSize: 18, fontWeight: "800" },
  pips: { flexDirection: "row", gap: 2, position: "absolute", bottom: 7 },
  pip: { width: 3, height: 3, borderRadius: 2 }
});
