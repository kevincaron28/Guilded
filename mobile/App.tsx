import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AlertsTab } from "./src/alerts/AlertsTab";
import { GuildTab } from "./src/guild/GuildTab";
import { MeTab } from "./src/me/MeTab";
import { NewsScreen } from "./src/NewsScreen";
import { StatsTab } from "./src/stats/StatsTab";
import { t, type CopyKey } from "./src/i18n";
import { useGuild } from "./src/useGuild";
import { colors } from "./src/ui";

// Five tabs (docs/plans/APP_REDESIGN.md, slice 3): Guild, Stats, Me, Alerts, News. Stats and News are public;
// Guild is the sign-in when signed out, and Me and Alerts show a sign-in card. The sample guild covers every tab.
const WEB_ORIGIN = process.env.EXPO_PUBLIC_GUILDED_WEB_URL ?? "https://guilded.kcaron.top";
type Tab = "guild" | "stats" | "me" | "alerts" | "news";
const TABS: { tab: Tab; label: CopyKey; glyph: string }[] = [
  { tab: "guild", label: "tabGuild", glyph: "⚑" },
  { tab: "stats", label: "tabStats", glyph: "▤" },
  { tab: "me", label: "tabMe", glyph: "◉" },
  { tab: "alerts", label: "alerts", glyph: "◔" },
  { tab: "news", label: "tabNews", glyph: "☰" }
];

export default function App() {
  const guild = useGuild(WEB_ORIGIN);
  const [chosen, setChosen] = useState<Tab | null>(null);
  // Opens on Guild when signed in (or in the sample), on Stats otherwise.
  const tab: Tab = chosen ?? (guild.signedIn ? "guild" : "stats");
  const { lang } = guild;

  return <View style={styles.frame}>
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.brand}>GUILDED</Text>
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: guild.loading ? colors.gold : guild.signedIn ? colors.green : colors.line }]} />
          <Text style={styles.statusText} numberOfLines={1}>{guild.preview ? t(lang, "sampleBanner").split(".")[0] : guild.guildName ?? "World of Warcraft"}</Text>
        </View>
      </View>
      <View style={styles.body}>
        {!guild.ready ? <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} />
          : tab === "guild" ? <GuildTab guild={guild} defaultOrigin={WEB_ORIGIN} />
          : tab === "stats" ? <StatsTab origin={WEB_ORIGIN} lang={lang} />
          : tab === "me" ? <MeTab guild={guild} webOrigin={WEB_ORIGIN} onSignIn={() => setChosen("guild")} />
          : tab === "alerts" ? <AlertsTab guild={guild} onSignIn={() => setChosen("guild")} />
          : <NewsScreen origin={WEB_ORIGIN} lang={lang} />}
      </View>
      <View style={styles.nav} accessibilityRole="tablist">
        {TABS.map((item) => {
          const on = tab === item.tab;
          return <Pressable key={item.tab} onPress={() => setChosen(item.tab)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={styles.navItem}>
            <Text style={[styles.glyph, on && styles.navActive]}>{item.glyph}</Text>
            <Text style={[styles.navText, on && styles.navActive]}>{t(lang, item.label)}</Text>
          </Pressable>;
        })}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.bg, alignItems: "center" },
  root: { flex: 1, backgroundColor: colors.bg, width: "100%", maxWidth: 480 },
  header: { paddingTop: 52, paddingHorizontal: 24, paddingBottom: 14, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16 },
  brand: { color: colors.gold, fontSize: 15, fontWeight: "900", letterSpacing: 3 },
  status: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 4 },
  statusText: { color: colors.muted, fontSize: 11, flexShrink: 1 },
  body: { flex: 1 },
  nav: { borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, flexDirection: "row", paddingBottom: 20, paddingTop: 6 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48 },
  glyph: { color: colors.muted, fontSize: 16 },
  navText: { color: colors.muted, fontSize: 11, marginTop: 2 },
  navActive: { color: colors.gold, fontWeight: "700" }
});
