import { StyleSheet, Text } from "react-native";
import { updatedAgo } from "../cache";
import { t, type Lang } from "../i18n";
import { colors } from "./theme";

/** "Last updated 5 min ago", with a second line when the phone is showing the saved copy because the refresh failed. */
export function LastUpdated({ lang, savedAt, stale, now = Date.now() }: { lang: Lang; savedAt: number | null; stale: boolean; now?: number }) {
  if (savedAt === null) return null;
  return <Text style={styles.line} accessibilityLiveRegion="polite">
    {t(lang, "updatedLine", { when: updatedAgo(savedAt, now, lang) })}{stale ? ` · ${t(lang, "savedCopy")}` : ""}
  </Text>;
}

const styles = StyleSheet.create({ line: { color: colors.muted, fontSize: 12, marginTop: 4, marginBottom: 4 } });
