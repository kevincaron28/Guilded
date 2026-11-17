import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Card } from "./Card";
import { colors } from "./theme";

// The same painted empty-state pictures the website uses (site/images/web/empty-*.webp), 360 px square.
/* eslint-disable @typescript-eslint/no-require-imports -- Metro needs literal require() paths for bundled images */
const ART = {
  guild: require("../../assets/empty/empty-guild.webp"),
  runs: require("../../assets/empty/empty-runs.webp"),
  search: require("../../assets/empty/empty-search.webp"),
  pvp: require("../../assets/empty/empty-pvp.webp"),
  duel: require("../../assets/empty/empty-duel.webp"),
  season: require("../../assets/empty/empty-season.webp")
} as const;
/* eslint-enable @typescript-eslint/no-require-imports */
export type EmptyArt = keyof typeof ART;

/** One muted line for "nothing here yet" or "switched off". `boxed` puts it on its own panel; `art` adds a painted picture above the line. */
export function EmptyState({ message, boxed, art, style }: { message: string; boxed?: boolean; art?: EmptyArt; style?: StyleProp<ViewStyle> }) {
  const text = <Text style={art ? [styles.text, styles.centered] : styles.text}>{message}</Text>;
  const body = art ? (
    <View style={styles.withArt}>
      <Image source={ART[art]} style={styles.art} resizeMode="contain" accessible={false} />
      {text}
    </View>
  ) : text;
  return boxed ? <Card style={style}>{body}</Card> : body;
}

const styles = StyleSheet.create({
  text: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  centered: { textAlign: "center" },
  withArt: { alignItems: "center", gap: 8, paddingVertical: 8 },
  art: { width: 132, height: 132, opacity: 0.92 }
});
