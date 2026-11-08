import { StyleSheet, Text, View } from "react-native";
import type { Lang } from "../i18n";
import { colors } from "../ui";
import { STONE } from "./CardFrame";
import { ladderRows } from "./pvp";
import type { LadderBoard } from "./types";
import { rankLabelText, w } from "./words";

/** A ladder board: position, name, rank or record. Your own row is gold, and shown after a gap when you are below the top. */
export function LadderList({ board, lang, ranked, empty }: { board: LadderBoard; lang: Lang; ranked: boolean; empty: string }) {
  const rows = ladderRows(board);
  if (!rows.length) return <Text style={styles.muted}>{empty}</Text>;
  return <View accessibilityLabel={board.title}>
    {rows.map((row, i) => {
      if (row.kind === "gap") return <Text key={`gap${i}`} style={styles.gap}>⋯</Text>;
      const e = row.entry;
      const medal = e.position === 1 ? "#d5ad57" : e.position === 2 ? "#c9d1d9" : e.position === 3 ? "#c47f3f" : null;
      return <View key={`${e.position}-${e.name}`} style={[styles.row, e.you && styles.you]}>
        <Text style={[styles.pos, medal ? { color: medal } : null]}>{e.position}</Text>
        <Text style={[styles.name, e.you && { color: STONE.gold }]} numberOfLines={1}>{e.you && e.name === "You" ? w("you", lang) : e.name}</Text>
        {ranked && e.label ? <Text style={[styles.rank, e.legend && { color: "#e8b8ff" }]} numberOfLines={1}>
          {rankLabelText(e.label, lang)}
        </Text> : null}
        <Text style={styles.record}>{e.wins}–{e.losses}</Text>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36, borderTopWidth: 1, borderColor: colors.line, paddingHorizontal: 4 },
  you: { backgroundColor: "#2a1d0c", borderRadius: 6 },
  pos: { width: 28, color: colors.muted, fontWeight: "800", fontSize: 13, textAlign: "right" },
  name: { flex: 1, color: colors.text, fontSize: 14 },
  rank: { color: colors.gold, fontSize: 12, fontWeight: "700", maxWidth: 110 },
  record: { color: colors.muted, fontSize: 12, minWidth: 44, textAlign: "right" },
  gap: { color: colors.muted, textAlign: "center", paddingVertical: 2 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17 }
});
