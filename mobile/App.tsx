import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GuildScreen } from "./src/GuildScreen";

const WEB_ORIGIN = process.env.EXPO_PUBLIC_GUILDED_WEB_URL ?? "https://guilded.kcaron.top";
type Summary = { season: string; ratedRunsThisWeek: number; guilds: number; topRuns: { dungeon: string; levels: string; time: string; score: number }[] };
type Tab = "Home" | "Ranks" | "Guild" | "Profile";

const colors = { bg: "#0b0c0b", panel: "#151714", line: "#282b25", text: "#f3f0e7", muted: "#aaa99f", gold: "#d5ad57", green: "#9fbd83" };

function Label({ children }: { children: string }) { return <Text style={styles.label}>{children.toUpperCase()}</Text>; }
function Action({ title, onPress }: { title: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}><Text style={styles.actionText}>{title}</Text><Text style={styles.arrow}>↗</Text></Pressable>;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("Home");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`${WEB_ORIGIN}/leaderboards/summary.json`)
      .then((r) => { if (!r.ok) throw new Error("summary unavailable"); return r.json() as Promise<Summary>; })
      .then((data) => { if (active) setSummary(data); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const open = (path: string) => Linking.openURL(`${WEB_ORIGIN}${path}`);
  return <View style={styles.frame}>
    <View style={styles.root}>
    <StatusBar style="light" />
    <View style={styles.header}><View><Text style={styles.brand}>GUILDED</Text><Text style={styles.edition}>WORLD OF WARCRAFT · COMMUNITY</Text></View><View style={styles.status}><View style={styles.dot}/><Text style={styles.statusText}>LIVE</Text></View></View>
    {tab === "Guild" ? <GuildScreen defaultOrigin={WEB_ORIGIN} /> : <ScrollView contentContainerStyle={styles.content}>
      {tab === "Home" && <>
        <Text style={styles.kicker}>YOUR COMMUNITY, IN REACH</Text>
        <Text style={styles.title}>The guild never stops.</Text>
        <Text style={styles.intro}>Follow player scores, dungeon runs and the people you play with.</Text>
        <View style={styles.hero}><Label>{summary?.season ?? "Guilded season"}</Label><Text style={styles.heroTitle}>This week on Guilded</Text>
          {loading ? <ActivityIndicator color={colors.gold} style={{ alignSelf: "flex-start", marginTop: 18 }} /> : failed ? <Text style={styles.muted}>Guilded’s live board is temporarily unavailable.</Text> : <View style={styles.stats}><View><Text style={styles.statValue}>{summary?.ratedRunsThisWeek ?? "—"}</Text><Text style={styles.statName}>RATED RUNS</Text></View><View><Text style={styles.statValue}>{summary?.guilds ?? "—"}</Text><Text style={styles.statName}>GUILDS</Text></View></View>}
          {summary?.topRuns.map((run, i) => <View key={`${run.dungeon}-${i}`} style={styles.runRow}><Text style={styles.rank}>0{i + 1}</Text><Text style={styles.runName}>{run.dungeon}</Text><Text style={styles.runScore}>{run.score}</Text></View>)}
        </View>
        <Label>EXPLORE</Label><Action title="Browse leaderboards" onPress={() => setTab("Ranks")} /><Action title="Find your player profile" onPress={() => open("/players/")} />
      </>}
      {tab === "Ranks" && <><Text style={styles.kicker}>THE COMMUNITY</Text><Text style={styles.title}>Leaderboards</Text><Text style={styles.intro}>See the runs and guilds making their mark this season.</Text><View style={styles.hero}><Label>{summary?.season ?? "Current season"}</Label><Text style={styles.heroTitle}>Dungeon standings</Text><Text style={styles.muted}>{loading ? "Loading this week’s activity…" : failed ? "Live summary is temporarily unavailable." : `${summary?.ratedRunsThisWeek} rated runs across ${summary?.guilds} guilds this week.`}</Text></View><Action title="Open dungeon leaderboards" onPress={() => open("/leaderboards/")} /><Action title="See guild rankings" onPress={() => open("/leaderboards/guilds/")} /></>}
      {tab === "Profile" && <><Text style={styles.kicker}>YOUR GUILDED IDENTITY</Text><Text style={styles.title}>Player profile</Text><Text style={styles.intro}>Your characters and public runs come together in one shareable profile.</Text><View style={styles.hero}><Text style={styles.heroTitle}>Your Guilded account</Text><Text style={styles.muted}>Discord sign-in for characters, reserves, wishlists and raids is on the Guild tab. It uses the companion sign-in, not a browser cookie. Private account settings still open on the website.</Text></View><Action title="Open your profile on the web" onPress={() => open("/auth/login?return=%2Fme%2F")} /><Action title="Browse public player profiles" onPress={() => open("/players/")} /></>}
      <Text style={styles.footer}>GUILDED · CONNECTED TO YOUR EXISTING COMMUNITY</Text>
    </ScrollView>}
    <View style={styles.nav}>{(["Home", "Ranks", "Guild", "Profile"] as Tab[]).map((name) => <Pressable key={name} onPress={() => setTab(name)} style={styles.navItem}><Text style={[styles.navText, tab === name && styles.navActive]}>{name}</Text></Pressable>)}</View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.bg, alignItems: "center" },
  root: { flex: 1, backgroundColor: colors.bg, width: "100%", maxWidth: 480 }, header: { paddingTop: 58, paddingHorizontal: 24, paddingBottom: 18, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { color: colors.gold, fontSize: 15, fontWeight: "900", letterSpacing: 3 }, edition: { color: colors.muted, fontSize: 9, letterSpacing: 1.3, marginTop: 5 }, status: { flexDirection: "row", alignItems: "center", gap: 6 }, dot: { width: 6, height: 6, borderRadius: 4, backgroundColor: colors.green }, statusText: { color: colors.green, fontSize: 9, letterSpacing: 1.3 },
  content: { padding: 24, paddingBottom: 30 }, kicker: { color: colors.gold, fontSize: 10, letterSpacing: 2, fontWeight: "700", marginTop: 12 }, title: { color: colors.text, fontSize: 34, lineHeight: 39, fontWeight: "700", marginTop: 12, letterSpacing: -1.2 }, intro: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: 10, marginBottom: 24 },
  hero: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 18, marginBottom: 24 }, label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700", marginBottom: 10 }, heroTitle: { color: colors.text, fontSize: 20, fontWeight: "700", marginBottom: 13 }, muted: { color: colors.muted, fontSize: 13, lineHeight: 20 }, stats: { flexDirection: "row", gap: 44, marginVertical: 14 }, statValue: { color: colors.text, fontSize: 28, fontWeight: "700" }, statName: { color: colors.muted, fontSize: 8, letterSpacing: 1.2, marginTop: 3 }, runRow: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 12, marginTop: 10, flexDirection: "row", alignItems: "center" }, rank: { color: colors.gold, fontSize: 10, marginRight: 12 }, runName: { color: colors.text, flex: 1, fontSize: 13 }, runScore: { color: colors.green, fontWeight: "700", fontSize: 13 },
  action: { borderTopWidth: 1, borderColor: colors.line, paddingVertical: 17, flexDirection: "row", alignItems: "center" }, actionText: { color: colors.text, fontSize: 14, flex: 1 }, arrow: { color: colors.gold, fontSize: 17 }, footer: { color: "#66685f", fontSize: 8, letterSpacing: 1.2, marginTop: 38, marginBottom: 10 },
  nav: { borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, flexDirection: "row", paddingBottom: 24, paddingTop: 12 }, navItem: { flex: 1, alignItems: "center", paddingVertical: 8 }, navText: { color: colors.muted, fontSize: 12 }, navActive: { color: colors.gold, fontWeight: "700" }
});
