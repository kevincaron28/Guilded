import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, Text, ToastAndroid, View, type ImageSourcePropType } from "react-native";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { checkForNewApk, type ApkRelease } from "./src/apkUpdate";
import { DEFAULT_WEB_ORIGIN } from "./src/links";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { backTarget, mobileRoute, notificationRoute, routeTarget, type GuildPart, type MobileRoute } from "./src/routes";
import { doubleBackToExit, setBackFallback, useBack } from "./src/useBack";
import { countSession } from "./src/review";
import { ErrorBoundary } from "./src/ErrorBoundary";
import { setReportScreen } from "./src/crashReport";
import { Intro } from "./src/Intro";
import { markIntroSeen, readIntroSeen } from "./src/introSeen";
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
const WEB_ORIGIN = process.env.EXPO_PUBLIC_GUILDED_WEB_URL ?? DEFAULT_WEB_ORIGIN;
type Tab = "guild" | "stats" | "me" | "alerts" | "news";
// Painted tab icons (mobile/assets/tabs, 96 x 96 with transparency); the active one is tinted gold, the others muted.
/* eslint-disable @typescript-eslint/no-require-imports -- Metro needs literal require() paths */
export const TAB_ICONS: Record<Tab, ImageSourcePropType> = {
  guild: require("./assets/tabs/tab-guild.png"), stats: require("./assets/tabs/tab-stats.png"), me: require("./assets/tabs/tab-me.png"),
  alerts: require("./assets/tabs/tab-alerts.png"), news: require("./assets/tabs/tab-news.png")
};
const TABS: { tab: Tab; label: CopyKey }[] = [
  { tab: "guild", label: "tabGuild" }, { tab: "stats", label: "tabStats" }, { tab: "me", label: "tabMe" }, { tab: "alerts", label: "alerts" }, { tab: "news", label: "tabNews" }
];

export default function App() {
  // Apply a downloaded over-the-air update before the first screen (src/updates.ts), then show the app.
  const [launched, setLaunched] = useState(false);
  useEffect(() => {
    let active = true;
    void prepareLaunchUpdate().catch(() => "unavailable").finally(() => { if (active) setLaunched(true); });
    return () => { active = false; };
  }, []);
  return <SafeAreaProvider><ErrorBoundary origin={WEB_ORIGIN}>{launched ? <GuildedApp /> : <View style={styles.frame}><ActivityIndicator color={colors.gold} style={{ marginTop: 96 }} /></View>}</ErrorBoundary></SafeAreaProvider>;
}

function GuildedApp() {
  const guild = useGuild(WEB_ORIGIN);
  const [newApk, setNewApk] = useState<ApkRelease | null>(null);
  const [chosen, setChosen] = useState<Tab | null>(null);
  // Opens on Guild when signed in (or in the sample), on Stats otherwise.
  const home: Tab = guild.signedIn ? "guild" : "stats";
  const tab: Tab = chosen ?? home;
  const { lang } = guild;
  const insets = useSafeAreaInsets();
  // Which part of the Guild tab a link asked for; `n` makes the same link work twice.
  const [guildPart, setGuildPart] = useState<{ part: GuildPart; n: number } | null>(null);
  // Android Back: from any other tab it goes to the home tab, and only from there leaves the app.
  useBack(backTarget(tab, home) !== null, () => setChosen(null));
  useEffect(() => { setReportScreen(tab); }, [tab]);
  // 0.7.0 (Testers Community report): on the home tab with nothing open, Back asks for a second press before leaving.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    setBackFallback(doubleBackToExit(() => ToastAndroid.show(t(lang, "pressBackAgain"), ToastAndroid.SHORT)));
    return () => setBackFallback(null);
  }, [lang]);
  // Counts launches for the one-time review sheet (review.ts).
  useEffect(() => { void countSession(); }, []);

  // First launch: three short intro screens, once (signed-in phones and a skipped intro never see them again).
  const [intro, setIntro] = useState<"unknown" | "show" | "done">("unknown");
  useEffect(() => {
    if (!guild.ready) return;
    let active = true;
    if (guild.signedIn) { setIntro("done"); return; }
    void readIntroSeen().then((seen) => { if (active) setIntro(seen ? "done" : "show"); });
    return () => { active = false; };
  }, [guild.ready, guild.signedIn]);
  const finishIntro = () => { setIntro("done"); void markIntroSeen(); };

  // App links and tapped push notifications open the Alerts tab (raid reminders) or the Guild tab.
  useEffect(() => {
    let active = true;
    const accept = (route: MobileRoute | null) => {
      if (!active || !route) return;
      const target = routeTarget(route);
      setChosen(target.tab);
      if (target.part) setGuildPart((current) => ({ part: target.part!, n: (current?.n ?? 0) + 1 }));
    };
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

  if (guild.ready && intro === "show") {
    return <View style={styles.frame}><View style={styles.root}><StatusBar style="light" />
      <Intro lang={lang} setLang={guild.setLang} onDone={finishIntro} onSample={() => { guild.startPreview(); finishIntro(); }} />
    </View></View>;
  }
  return <View style={styles.frame}>
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => setChosen(null)} accessibilityRole="button" accessibilityLabel={`Guilded, ${t(lang, "goHome")}`} hitSlop={{ top: 8, bottom: 8, left: 8, right: 16 }} style={styles.brandButton}>
          <Text style={styles.brand} maxFontSizeMultiplier={1.3}>GUILDED</Text>
        </Pressable>
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: guild.loading ? colors.gold : guild.signedIn ? colors.green : colors.line }]} />
          <Text style={styles.statusText} numberOfLines={1} maxFontSizeMultiplier={1.3}>{guild.preview ? t(lang, "sampleBanner").split(".")[0] : guild.guildName ?? "World of Warcraft"}</Text>
        </View>
      </View>
      {newApk ? <Pressable accessibilityRole="link" accessibilityLabel={lang === "fr" ? `Nouvelle version ${newApk.version} disponible. Télécharger` : `New version ${newApk.version} available. Download`}
        onPress={() => { void Linking.openURL(newApk.url).catch(() => {}); }} style={styles.update}>
        <Text style={styles.updateText}>{lang === "fr" ? `Nouvelle version ${newApk.version} disponible · Télécharger` : `New version ${newApk.version} available · Download`}</Text>
      </Pressable> : null}
      <View style={styles.body}>
        {!guild.ready ? <ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} />
          : tab === "guild" ? <GuildTab guild={guild} defaultOrigin={WEB_ORIGIN} focus={guildPart} />
          : tab === "stats" ? <StatsTab origin={WEB_ORIGIN} lang={lang} />
          : tab === "me" ? <MeTab guild={guild} onSignIn={() => setChosen("guild")} />
          : tab === "alerts" ? <AlertsTab guild={guild} onSignIn={() => setChosen("guild")} />
          : <NewsScreen origin={WEB_ORIGIN} lang={lang} />}
      </View>
      <View style={[styles.nav, { paddingBottom: Math.max(insets.bottom, 10) }]} accessibilityRole="tablist">
        {TABS.map((item) => {
          const on = tab === item.tab;
          return <Pressable key={item.tab} onPress={() => setChosen(item.tab)} accessibilityRole="tab" accessibilityLabel={t(lang, item.label)} accessibilityState={{ selected: on }} style={styles.navItem}>
            <Image source={TAB_ICONS[item.tab]} style={[styles.icon, { tintColor: on ? colors.gold : colors.muted }]} accessible={false} />
            <Text style={[styles.navText, on && styles.navActive]} numberOfLines={1} maxFontSizeMultiplier={1.2}>{t(lang, item.label)}</Text>
          </Pressable>;
        })}
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.bg, alignItems: "center" },
  root: { flex: 1, backgroundColor: colors.bg, width: "100%", maxWidth: 480 },
  header: { paddingHorizontal: 24, paddingBottom: 12, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16 },
  brandButton: { minHeight: 44, justifyContent: "center" },
  brand: { color: colors.gold, fontSize: 15, fontWeight: "900", letterSpacing: 3 },
  status: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 4 },
  statusText: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  body: { flex: 1 },
  update: { backgroundColor: colors.panel, borderBottomWidth: 1, borderColor: colors.gold, paddingVertical: 10, paddingHorizontal: 24 },
  updateText: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  nav: { borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, flexDirection: "row", paddingTop: 6 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48 },
  icon: { width: 26, height: 26, resizeMode: "contain" },
  navText: { color: colors.muted, fontSize: 12, marginTop: 2 },
  navActive: { color: colors.gold, fontWeight: "700" }
});
