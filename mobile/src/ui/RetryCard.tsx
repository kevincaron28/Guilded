import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { t, type Lang } from "../i18n";
import { Card } from "./Card";
import { colors } from "./theme";

/** What a screen shows when its data could not load: the reason and a "Try again" button. */
export function RetryCard({ lang, message, onRetry, style }: { lang: Lang; message: string; onRetry: () => void; style?: StyleProp<ViewStyle> }) {
  return <Card style={[styles.card, style]}>
    <Text style={styles.message}>{message}</Text>
    <Pressable onPress={onRetry} accessibilityRole="button" style={styles.button}><Text style={styles.label}>{t(lang, "retry")}</Text></Pressable>
  </Card>;
}

const styles = StyleSheet.create({
  card: { gap: 0 },
  message: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  button: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  label: { color: colors.gold, fontSize: 14 }
});
