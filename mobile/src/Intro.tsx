import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBack } from "./useBack";
import { t, type CopyKey, type Lang } from "./i18n";
import { colors } from "./ui";
import { common } from "./ui/common";
import { Language } from "./guild/SignIn";

// Three short screens on the first launch: what the app gives, how to sign in, and the sample guild. "Skip" is on every screen.
const PAGES: { title: CopyKey; body: CopyKey }[] = [
  { title: "intro1Title", body: "intro1Body" },
  { title: "intro2Title", body: "intro2Body" },
  { title: "intro3Title", body: "intro3Body" }
];

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro needs a literal require() path
const HERO = require("../assets/signin-hero.webp") as number;

export function Intro({ lang, setLang, onDone, onSample }: { lang: Lang; setLang: (lang: Lang) => void; onDone: () => void; onSample: () => void }) {
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;
  const current = PAGES[page]!;
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  // Half as tall as wide (the app is at most 480 wide), and never more than a quarter of the screen.
  const heroHeight = Math.round(Math.min((Math.min(screen.width, 480) - 48) / 2, screen.height * 0.25));
  // Android Back steps to the previous screen before it leaves the app.
  useBack(page > 0, () => setPage(page - 1));
  return <View style={styles.frame}>
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <View style={styles.top}>
        <Language lang={lang} setLang={setLang} />
        <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel={t(lang, "introSkip")} hitSlop={{ left: 12 }} style={styles.skip}><Text style={styles.skipText}>{t(lang, "introSkip")}</Text></Pressable>
      </View>
      {/* An explicit height: on small phones (and the web preview) the picture otherwise took the whole screen and pushed the title below the fold. */}
      <Image source={HERO} style={[styles.hero, { height: heroHeight }]} resizeMode="cover" accessible={false} />
      <Text style={common.kicker} accessibilityLabel={t(lang, "introPage", { n: page + 1, total: PAGES.length })}>{`${page + 1} / ${PAGES.length}`}</Text>
      <Text style={common.title} accessibilityRole="header">{t(lang, current.title)}</Text>
      <Text style={common.intro}>{t(lang, current.body)}</Text>
      <View style={styles.dots} accessible={false}>{PAGES.map((_, i) => <View key={i} style={[styles.dot, i === page && styles.dotOn]} />)}</View>
    </ScrollView>
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      {last ? <>
        <Pressable onPress={onSample} accessibilityRole="button" style={common.secondary}><Text style={common.secondaryText}>{t(lang, "introSample")}</Text></Pressable>
        <Pressable onPress={onDone} accessibilityRole="button" style={common.primary}><Text style={common.primaryText}>{t(lang, "introStart")}</Text></Pressable>
      </> : <View style={styles.row}>
        {page > 0 ? <Pressable onPress={() => setPage(page - 1)} accessibilityRole="button" style={[common.secondary, styles.half]}><Text style={common.secondaryText}>{t(lang, "introBack")}</Text></Pressable> : <View style={styles.half} />}
        <Pressable onPress={() => setPage(page + 1)} accessibilityRole="button" style={[common.primary, styles.half]}><Text style={common.primaryText}>{t(lang, "introNext")}</Text></Pressable>
      </View>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  content: { padding: 24, paddingBottom: 24 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  skip: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
  skipText: { color: colors.gold, fontSize: 14, fontWeight: "700" },
  dots: { flexDirection: "row", gap: 8, marginTop: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.gold },
  bar: { paddingHorizontal: 24 },
  hero: { width: "100%", borderRadius: 12, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: "row", gap: 12 },
  half: { flex: 1 }
});
