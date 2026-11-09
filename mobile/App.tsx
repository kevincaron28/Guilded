import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { checkForNewApk, type ApkRelease } from "./src/apkUpdate";
import { mobileRoute, notificationRoute, type MobileRoute } from "./src/routes";
import { readApkCache, writeApkCache } from "./src/storage";
import { prepareLaunchUpdate } from "./src/updates";
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
  // Apply a downloaded over-the-air update before the first screen (src/updates.ts), then show the app.
  const [launched, setLaunched] = useState(false);
  useEffect(() => {
    let active = true;
    void prepareLaunchUpdate().catch(() => "unavailable").finally(() => { if (active) setLaunched(true); });
    return () => { active = false; };
  }, []);
  return launched ? <GuildedApp /> : <View style={styles.frame}><ActivityIndicator color={colors.gold} style={{ marginTop: 96 }} /></View>;
}

function GuildedApp() {
  const guild = useGuild(WEB_ORIGIN);
  const [newApk, setNewApk] = useState<ApkRelease | null>(null);
  const [chosen, setChosen] = useState<Tab | null>(null);
  // Opens on Guild when signed in (or in the sample), on Stats otherwise.
  const tab: Tab = chosen ?? (guild.signedIn ? "guild" : "stats");
  const { lang } = guild;

  // App links and tapped push notifications open the Alerts tab (raid reminders) or the Guild tab.
  useEffect(() => {
    let active = true;
    const accept = (route: MobileRoute | null) => { if (active && route) setChosen(route.section === "alerts" ? "alerts" : "guild"); };
    void Linking.getInitialURL().then((url) => { if (url) accept(mobileRoute(url)); }).catch(() => {});
    const links = Linking.addEventListener("url", ({ url }) => accept(mobileRoute(url)));
    let removeNotifications: (() => void) | undefined;
    if (Platform.OS !== "web") void import("expo-notifications").then(async (notifications) => {
      if (!active) return;
      const subscription = notifications.addNotificationResponseReceivedListener((response) => accept(notificationRoute(response.notification.request.content.data)));
      removeNotifications = () => subscription.remove();
      const response = await notifications.getLastNotificationResponseAsync();
      if (response) { accept(notificationRoute(response.notification.request.content.data)); await notifications.clearLastNotificationResponseAsync(); }
    }).catch(() => {});
    return () => { active = false; links.remove(); removeNotifications?.(); };
  }, []);

  // Only the sideloaded preview APK updates from GitHub; store builds update through their store.
  useEffect(() => {
    if (Platform.OS !== "android" || Updates.channel !== "preview") return;
    let active = true;
    void checkForNewApk({ now: Date.now(), installedVersion: Constants.expoConfig?.version, readCache: readApkCache, writeCache: writeApkCache })
      .then((release) => { if (active) setNewApk(release); }).catch(() => {});
    return () => { active = false; };
  }, []);

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
      {newApk ? <Pressable accessibilityRole="link" accessibilityLabel={lang === "fr" ? `Nouvelle version ${newApk.version} disponible. Télécharger` : `New version ${newApk.version} available. Download`}
        onPress={() => { void Linking.openURL(newApk.url).catch(() => {}); }} style={styles.update}>
        <Text style={styles.updateText}>{lang === "fr" ? `Nouvelle version ${newApk.version} disponible · Télécharger` : `New version ${newApk.version} available · Download`}</Text>
      </Pressable> : null}
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
  update: { backgroundColor: colors.panel, borderBottomWidth: 1, borderColor: colors.gold, paddingVertical: 10, paddingHorizontal: 24 },
  updateText: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  nav: { borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, flexDirection: "row", paddingBottom: 20, paddingTop: 6 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48 },
  glyph: { color: colors.muted, fontSize: 16 },
  navText: { color: colors.muted, fontSize: 11, marginTop: 2 },
  navActive: { color: colors.gold, fontWeight: "700" }
});
