import { useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBack } from "./useBack";
import { t, type Lang } from "./i18n";
import { colors } from "./ui";
import { common } from "./ui/common";
import { Language } from "./guild/SignIn";

// First-run walkthrough (0.7.0, Testers Community feedback: the old intro was too basic). Four short steps you can swipe or
// step through: what the app is, the five tabs, how to sign in, and reminders plus the sample guild. Skip is on every step;
// Android Back steps back. Shown once (introSeen.ts).

/* eslint-disable @typescript-eslint/no-require-imports -- Metro needs literal require() paths */
const HERO = require("../assets/signin-hero.webp") as number;
const ICONS = {
  guild: require("../assets/tabs/tab-guild.png") as number, stats: require("../assets/tabs/tab-stats.png") as number, me: require("../assets/tabs/tab-me.png") as number,
  alerts: require("../assets/tabs/tab-alerts.png") as number, news: require("../assets/tabs/tab-news.png") as number
};
/* eslint-enable @typescript-eslint/no-require-imports */

const words = {
  tabsTitle: { en: "Five tabs", fr: "Cinq onglets" },
  tabsBody: { en: "Everything is one tap away at the bottom of the screen.", fr: "Tout est à un toucher, en bas de l'écran." },
  guild: { en: "Guild: roster, activity, crafting, map and raid sign-up", fr: "Guilde : membres, activité, artisanat, carte et inscription aux raids" },
  stats: { en: "Stats: dungeon, duel and raid leaderboards", fr: "Stats : classements des donjons, des duels et des raids" },
  me: { en: "Me: your characters, badges, help and settings", fr: "Moi : tes personnages, tes badges, l'aide et les réglages" },
  alerts: { en: "Alerts: raid reminders and push alerts", fr: "Alertes : rappels de raid et alertes push" },
  news: { en: "News: World of Warcraft headlines", fr: "Nouvelles : les manchettes de World of Warcraft" },
  pairTitle: { en: "Sign in with Discord", fr: "Connecte-toi avec Discord" },
  pairBody: { en: "Use the same Discord account as the Windows companion. Three steps, about a minute:", fr: "Prends le même compte Discord que le compagnon Windows. Trois étapes, environ une minute :" },
  pair1: { en: "Open the Guild tab and press Sign in with Discord. A short code appears on this phone.", fr: "Ouvre l'onglet Guilde et touche Connexion avec Discord. Un court code s'affiche sur ce téléphone." },
  pairCode: { en: "The code looks like this", fr: "Le code ressemble à ça" },
  lastTitle: { en: "Reminders, then look around", fr: "Les rappels, puis fais le tour" },
  lastBody: { en: "Once signed in, turn on raid reminders in Alerts: the phone reminds you a day, two hours and an hour before each raid. Not ready to sign in? The sample guild fills every screen with made-up names and changes nothing.", fr: "Une fois connecté, active les rappels de raid dans Alertes : le téléphone te les rappelle un jour, deux heures et une heure avant chaque raid. Pas prêt à te connecter? La guilde d'exemple remplit chaque écran avec des noms inventés et ne change rien." },
  help: { en: "Questions later? Me > Settings > Help & FAQ.", fr: "Des questions plus tard? Moi > Réglages > Aide et FAQ." }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];
const STEPS = 4;

export function Intro({ lang, setLang, onDone, onSample }: { lang: Lang; setLang: (lang: Lang) => void; onDone: () => void; onSample: () => void }) {
  const [page, setPage] = useState(0);
  const pager = useRef<ScrollViewInstance>(null);
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const width = Math.min(screen.width, 480);
  const heroHeight = Math.round(Math.min((width - 48) / 2, screen.height * 0.25));
  const last = page === STEPS - 1;
  const go = (next: number) => { const to = Math.max(0, Math.min(STEPS - 1, next)); setPage(to); pager.current?.scrollTo({ x: to * width, animated: true }); };
  const settled = (event: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  // Android Back steps to the previous step before it leaves the app.
  useBack(page > 0, () => go(page - 1));

  const step = (index: number, title: string, body: React.ReactNode) => <ScrollView key={index} style={{ width }} contentContainerStyle={styles.page}
    accessibilityLabel={t(lang, "introPage", { n: index + 1, total: STEPS })}>
    <Text style={common.kicker}>{`${index + 1} / ${STEPS}`}</Text>
    <Text style={common.title} accessibilityRole="header">{title}</Text>
    {body}
  </ScrollView>;

  return <View style={styles.frame}>
    <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
      <Language lang={lang} setLang={setLang} />
      <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel={t(lang, "introSkip")} hitSlop={{ left: 12 }} style={styles.skip}><Text style={styles.skipText}>{t(lang, "introSkip")}</Text></Pressable>
    </View>
    <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={settled} style={{ flex: 1 }}>
      {step(0, t(lang, "intro1Title"), <>
        <Image source={HERO} style={[styles.hero, { height: heroHeight }]} resizeMode="cover" accessible={false} />
        <Text style={common.intro}>{t(lang, "intro1Body")}</Text>
      </>)}
      {step(1, w("tabsTitle", lang), <>
        <Text style={common.intro}>{w("tabsBody", lang)}</Text>
        {(["guild", "stats", "me", "alerts", "news"] as const).map((tab) => <View key={tab} style={styles.tabRow}>
          <Image source={ICONS[tab]} style={styles.tabIcon} accessible={false} />
          <Text style={[common.body, { flex: 1 }]}>{w(tab, lang)}</Text>
        </View>)}
      </>)}
      {step(2, w("pairTitle", lang), <>
        <Text style={common.intro}>{w("pairBody", lang)}</Text>
        {(["signInStep1", "signInStep2", "signInStep3"] as const).map((key, i) => <View key={key} style={styles.tabRow}>
          <Text style={styles.number}>{i + 1}</Text><Text style={[common.body, { flex: 1 }]}>{i === 0 ? w("pair1", lang) : t(lang, key)}</Text>
        </View>)}
        <View style={styles.codeCard} accessible accessibilityLabel={w("pairCode", lang)}>
          <Text style={common.muted}>{w("pairCode", lang)}</Text>
          <Text style={common.code}>K7Q2-9M</Text>
        </View>
      </>)}
      {step(3, w("lastTitle", lang), <>
        <Image source={ICONS.alerts} style={[styles.tabIcon, { width: 56, height: 56, tintColor: colors.gold }]} accessible={false} />
        <Text style={common.intro}>{w("lastBody", lang)}</Text>
        <Text style={common.muted}>{w("help", lang)}</Text>
      </>)}
    </ScrollView>
    <View style={styles.dots} accessible={false}>{Array.from({ length: STEPS }, (_, i) => <View key={i} style={[styles.dot, i === page && styles.dotOn]} />)}</View>
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      {last ? <>
        <Pressable onPress={onSample} accessibilityRole="button" style={common.secondary}><Text style={common.secondaryText}>{t(lang, "introSample")}</Text></Pressable>
        <Pressable onPress={onDone} accessibilityRole="button" style={common.primary}><Text style={common.primaryText}>{t(lang, "introStart")}</Text></Pressable>
      </> : <View style={styles.row}>
        {page > 0 ? <Pressable onPress={() => go(page - 1)} accessibilityRole="button" style={[common.secondary, styles.half]}><Text style={common.secondaryText}>{t(lang, "introBack")}</Text></Pressable> : <View style={styles.half} />}
        <Pressable onPress={() => go(page + 1)} accessibilityRole="button" style={[common.primary, styles.half]}><Text style={common.primaryText}>{t(lang, "introNext")}</Text></Pressable>
      </View>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 24 },
  page: { padding: 24, gap: 10 },
  skip: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
  skipText: { color: colors.gold, fontSize: 14, fontWeight: "700" },
  dots: { flexDirection: "row", gap: 8, justifyContent: "center", paddingVertical: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.gold, width: 20 },
  bar: { paddingHorizontal: 24 },
  hero: { width: "100%", borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  tabRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 44 },
  tabIcon: { width: 30, height: 30, resizeMode: "contain", tintColor: colors.gold },
  number: { color: colors.ink, backgroundColor: colors.gold, width: 28, height: 28, borderRadius: 14, textAlign: "center", lineHeight: 28, fontWeight: "800" },
  codeCard: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16, alignItems: "center", gap: 6, marginTop: 6 },
  row: { flexDirection: "row", gap: 12 },
  half: { flex: 1 }
});
