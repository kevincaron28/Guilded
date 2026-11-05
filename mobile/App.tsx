import { Component, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { GuildScreen } from "./src/GuildScreen";
import { apiOrigin, fetchBounded, readTextBounded, parseSummary, type Summary } from "./src/api";
import { readEdition, saveEdition, editions, type Edition, readLang, saveLang } from "./src/storage";
import { mobileRoute, notificationRoute, type MobileRoute } from "./src/routes";
import { prepareLaunchUpdate } from "./src/updates";
import type { Lang } from "./src/i18n";

const WEB_ORIGIN = (() => { try { return apiOrigin(process.env.EXPO_PUBLIC_GUILDED_WEB_URL ?? "https://guilded.kcaron.top"); } catch { return "https://guilded.kcaron.top"; } })();
type Tab = "Home" | "Ranks" | "Guild" | "Profile";
const colors = { bg: "#0b0c0b", panel: "#151714", line: "#393d33", text: "#f3f0e7", muted: "#b6b5ab", gold: "#d5ad57", green: "#9fbd83" };

class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <SafeAreaView style={styles.frame}><View style={styles.content}><Text accessibilityRole="header" style={styles.heroTitle}>Guilded could not display this screen / Affichage indisponible</Text><Text style={styles.muted}>Your account is safe. Retry to reopen the app. / Réessayez pour rouvrir l’application.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={() => this.setState({ failed: false })}><Text style={styles.actionText}>Retry / Réessayer</Text></Pressable></View></SafeAreaView>;
    return this.props.children;
  }
}
function Action({ title, onPress }: { title: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}><Text style={styles.actionText}>{title}</Text><Text accessible={false} style={styles.arrow}>↗</Text></Pressable>;
}
export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => { let active = true; void prepareLaunchUpdate().catch(() => "unavailable").finally(() => { if (active) setReady(true); }); return () => { active = false; }; }, []);
  return <SafeAreaProvider><ScreenBoundary>{ready ? <GuildedApp /> : <SafeAreaView style={styles.frame}><View style={styles.content}><Text style={styles.brand}>GUILDED</Text><ActivityIndicator color={colors.gold} accessibilityLabel="Starting Guilded / Démarrage" /><Text style={styles.muted}>Starting / Démarrage…</Text></View></SafeAreaView>}</ScreenBoundary></SafeAreaProvider>;
}
function GuildedApp() {
  const [lang, setLang] = useState<Lang>("en");
  const tr = (en: string, fr: string) => lang === "fr" ? fr : en;
  const [edition, setEdition] = useState<Edition>("forever");
  const [tab, setTab] = useState<Tab>("Home");
  const [route, setRoute] = useState<MobileRoute | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [linkError, setLinkError] = useState(false);
  const request = useRef(0);
  const reload = useCallback(async () => {
    const revision = ++request.current;
    setLoading(true);
    try {
      const response = await fetchBounded(`${WEB_ORIGIN}/leaderboards/summary.json?edition=${edition}&lang=${lang}`);
      if (!response.ok) throw new Error("summary unavailable");
      const data = parseSummary(JSON.parse(await readTextBounded(response)));
      if (revision !== request.current) return;
      setSummary(data); setFailed(false); setUpdatedAt(Date.now());
    } catch { if (revision === request.current) setFailed(true); }
    finally { if (revision === request.current) setLoading(false); }
  }, [edition, lang]);
  useEffect(() => {
    void readEdition().then(setEdition);
    void readLang().then(setLang);
  }, []);
  useEffect(() => {
    void reload();
    const resume = AppState.addEventListener("change", (state) => { if (state === "active") void reload(); });
    return () => { request.current++; resume.remove(); };
  }, [reload]);
  useEffect(() => {
    let active = true;
    const accept = (next: MobileRoute | null) => { if (active && next) { setRoute(next); setTab("Guild"); } };
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
  const chooseLang = (next: Lang) => { setLang(next); void saveLang(next); };
  const open = (path: string) => { setLinkError(false); const url = new URL(path, WEB_ORIGIN); url.searchParams.set("edition", edition); url.searchParams.set("lang", lang); if (url.pathname === "/auth/login") url.searchParams.set("return", `/me/?edition=${edition}&lang=${lang}`); void Linking.openURL(url.href).catch(() => setLinkError(true)); };
  const status = loading ? tr("UPDATING", "ACTUALISATION") : failed ? tr("OFFLINE", "HORS LIGNE") : updatedAt ? tr("CONNECTED", "CONNECTÉ") : tr("WAITING", "EN ATTENTE");
  const tabs: Tab[] = ["Home", "Ranks", "Guild", "Profile"];
  const tabLabel = (name: Tab) => ({ Home: tr("Home", "Accueil"), Ranks: tr("Ranks", "Classements"), Guild: tr("Guild", "Guilde"), Profile: tr("Profile", "Profil") })[name];
  return <SafeAreaView style={styles.frame} edges={["top", "bottom", "left", "right"]}>
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}><View style={{ flex: 1 }}><Text accessibilityRole="header" style={styles.brand}>GUILDED</Text><Text style={styles.edition}>WORLD OF WARCRAFT · COMMUNITY</Text></View><Text accessibilityLiveRegion="polite" style={styles.statusText}>{status}</Text></View>
      <View style={styles.languages}>{(["en", "fr"] as const).map((code) => <Pressable key={code} accessibilityRole="button" accessibilityLabel={code === "en" ? "English" : "Français"} accessibilityState={{ selected: lang === code }} onPress={() => chooseLang(code)} style={styles.language}><Text style={[styles.muted, lang === code && { color: colors.gold, fontWeight: "700" }]}>{code.toUpperCase()}</Text></Pressable>)}</View>
      {linkError ? <Text accessibilityRole="alert" style={styles.error}>{tr("The page could not open. Check your browser and retry.", "Impossible d’ouvrir la page. Vérifiez votre navigateur et réessayez.")}</Text> : null}
      <View style={[styles.fill, tab !== "Guild" && styles.hidden]} accessibilityElementsHidden={tab !== "Guild"} importantForAccessibility={tab === "Guild" ? "auto" : "no-hide-descendants"}>
        <GuildScreen defaultOrigin={WEB_ORIGIN} lang={lang} onLang={chooseLang} route={route} />
      </View>
      {tab !== "Guild" ? <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} tintColor={colors.gold} />}>
        {tab === "Home" ? <>
          <Text style={styles.kicker}>{tr("YOUR COMMUNITY, IN REACH", "VOTRE COMMUNAUTÉ, À PORTÉE")}</Text>
          <Text accessibilityRole="header" style={styles.title}>{tr("The guild never stops.", "La guilde ne s’arrête jamais.")}</Text>
          <Text style={styles.intro}>{tr("Follow player scores, dungeon runs and the people you play with.", "Suivez les scores, les donjons et les gens avec qui vous jouez.")}</Text>
        </> : null}
        {tab === "Ranks" ? <><Text style={styles.kicker}>{tr("THE COMMUNITY", "LA COMMUNAUTÉ")}</Text><Text accessibilityRole="header" style={styles.title}>{tr("Leaderboards", "Classements")}</Text><Text style={styles.intro}>{tr("Explore dungeon runs and guild rankings on the Guilded website.", "Explorez les donjons et les classements de guildes sur le site Guilded.")}</Text></> : null}
        {tab === "Home" || tab === "Ranks" ? <>
          <Text style={styles.label}>{tr("WoW edition", "Version de WoW")}</Text><View style={styles.editions}>{editions.map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: edition === value }} onPress={() => { if (value !== edition) { request.current++; setSummary(null); setUpdatedAt(null); setEdition(value); void saveEdition(value); } }} style={[styles.editionChip, edition === value && { borderColor: colors.gold }]}><Text style={[styles.muted, edition === value && { color: colors.gold }]}>{({ forever: "Forever", "classic-era": "Era", "classic-tbc": "TBC", "classic-mists": "Mists", retail: "Retail" })[value]}</Text></Pressable>)}</View>
          <View style={styles.hero}><Text style={styles.label}>{summary?.season ?? tr("Current season", "Saison actuelle")}</Text><Text accessibilityRole="header" style={styles.heroTitle}>{tr("This week on Guilded", "Cette semaine sur Guilded")}</Text>
            {loading && !summary ? <ActivityIndicator color={colors.gold} accessibilityLabel={tr("Loading", "Chargement")} /> : null}
            {failed ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{summary ? tr("Offline. Showing the last successful update from this visit.", "Hors ligne. Dernière mise à jour de cette visite.") : tr("The live board is unavailable. Pull down or retry.", "Le classement est indisponible. Actualisez ou réessayez.")}</Text> : null}
            {summary ? <><View style={styles.stats}><View style={styles.fill}><Text style={styles.statValue}>{summary.ratedRunsThisWeek}</Text><Text style={styles.label}>{tr("RATED RUNS", "DONJONS CLASSÉS")}</Text></View><View style={styles.fill}><Text style={styles.statValue}>{summary.guilds}</Text><Text style={styles.label}>{tr("GUILDS", "GUILDES")}</Text></View></View>{summary.topRuns.map((run, index) => <View key={`${run.dungeon}-${index}`} style={styles.runRow}><Text style={styles.rank}>{index + 1}</Text><View style={styles.fill}><Text style={styles.runName}>{run.dungeon}</Text><Text style={styles.muted}>{[run.levels, run.time].filter(Boolean).join(" · ")}</Text></View><Text style={styles.runScore}>{run.score}</Text></View>)}</> : null}
            {updatedAt ? <Text style={styles.muted}>{tr("Updated", "Actualisé")} {new Date(updatedAt).toLocaleTimeString(lang === "fr" ? "fr-CA" : "en-CA", { hour: "2-digit", minute: "2-digit" })}</Text> : null}
            <Action title={loading ? tr("Updating…", "Actualisation…") : tr("Refresh live board", "Actualiser le classement")} onPress={() => void reload()} />
          </View>
          <Action title={tr("Open dungeon leaderboards", "Ouvrir les classements de donjons")} onPress={() => open("/leaderboards/")} />
          <Action title={tr("See guild rankings", "Voir les classements de guildes")} onPress={() => open("/leaderboards/guilds/")} />
          {tab === "Home" ? <Action title={tr("Find your player profile", "Trouver votre profil de joueur")} onPress={() => open("/players/")} /> : null}
        </> : null}
        {tab === "Profile" ? <><Text style={styles.kicker}>{tr("YOUR GUILDED IDENTITY", "VOTRE IDENTITÉ GUILDED")}</Text><Text accessibilityRole="header" style={styles.title}>{tr("Player profile", "Profil de joueur")}</Text><Text style={styles.intro}>{tr("Characters, reserves, wishlist and raids are in Guild. Your public profile and account settings open on the website.", "Personnages, réserves, souhaits et raids sont dans Guilde. Votre profil public et vos réglages s’ouvrent sur le site.")}</Text><Action title={tr("Open your guild", "Ouvrir votre guilde")} onPress={() => setTab("Guild")} /><Action title={tr("Open your profile on the web", "Ouvrir votre profil sur le site")} onPress={() => open("/auth/login?return=%2Fme%2F")} /><Action title={tr("Browse public player profiles", "Parcourir les profils publics")} onPress={() => open("/players/")} /><Action title={tr("Privacy and account deletion", "Confidentialité et suppression du compte")} onPress={() => open("/docs/PRIVACY.html")} /><Action title={tr("Help and getting started", "Aide et premiers pas")} onPress={() => open("/start/")} /></> : null}
        <Text style={styles.footer}>{tr("GUILDED · YOUR EXISTING COMMUNITY", "GUILDED · VOTRE COMMUNAUTÉ")}</Text>
      </ScrollView> : null}
      <View style={styles.nav} accessibilityRole="tablist">{tabs.map((name) => <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: tab === name }} onPress={() => setTab(name)} style={styles.navItem}><Text style={[styles.navText, tab === name && styles.navActive]}>{tabLabel(name)}</Text></Pressable>)}</View>
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 }, hidden: { display: "none" }, frame: { flex: 1, backgroundColor: colors.bg, alignItems: "center" },
  root: { flex: 1, backgroundColor: colors.bg, width: "100%", maxWidth: 680 }, header: { paddingTop: 18, paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", gap: 8, alignItems: "center" },
  brand: { color: colors.gold, fontSize: 17, fontWeight: "900", letterSpacing: 3 }, edition: { color: colors.muted, fontSize: 10, marginTop: 5 }, statusText: { color: colors.green, fontSize: 10, maxWidth: 110 },
  editions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }, editionChip: { minHeight: 44, borderRadius: 20, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, justifyContent: "center" },
  languages: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16 }, language: { minWidth: 48, minHeight: 44, alignItems: "center", justifyContent: "center" },
  content: { padding: 24, paddingBottom: 30 }, kicker: { color: colors.gold, fontSize: 11, letterSpacing: 1.2, fontWeight: "700", marginTop: 8 }, title: { color: colors.text, fontSize: 34, fontWeight: "700", marginTop: 12, letterSpacing: -0.8 }, intro: { color: colors.muted, fontSize: 16, lineHeight: 24, marginTop: 10, marginBottom: 24 },
  hero: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 18, marginBottom: 24 }, label: { color: colors.gold, fontSize: 11, fontWeight: "700", marginVertical: 8 }, heroTitle: { color: colors.text, fontSize: 21, fontWeight: "700", marginBottom: 13 }, muted: { color: colors.muted, fontSize: 14, lineHeight: 21 }, stats: { flexDirection: "row", flexWrap: "wrap", gap: 24, marginVertical: 14 }, statValue: { color: colors.text, fontSize: 30, fontWeight: "700" }, runRow: { borderTopWidth: 1, borderColor: colors.line, paddingVertical: 12, flexDirection: "row", gap: 12, alignItems: "center" }, rank: { color: colors.gold, fontSize: 14 }, runName: { color: colors.text, fontSize: 15 }, runScore: { color: colors.green, fontWeight: "700", fontSize: 15 },
  action: { borderTopWidth: 1, borderColor: colors.line, minHeight: 48, paddingVertical: 16, flexDirection: "row", alignItems: "center", gap: 12 }, actionText: { color: colors.text, fontSize: 15, flex: 1 }, arrow: { color: colors.gold, fontSize: 17 }, footer: { color: colors.muted, fontSize: 11, marginTop: 32 }, error: { color: "#e7b4a8", fontSize: 14, padding: 12 },
  nav: { borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, flexDirection: "row", paddingVertical: 4 }, navItem: { flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", paddingHorizontal: 4 }, navText: { color: colors.muted, fontSize: 13 }, navActive: { color: colors.gold, fontWeight: "700" }
});
