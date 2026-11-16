import { Image, Pressable, StyleSheet, Text } from "react-native";
import { t, type Lang } from "../i18n";
import { Card } from "./Card";
import { colors } from "./theme";

/** What Me and Alerts show to someone not signed in: one line and a button to the Guild tab's sign-in. */
export function SignInCard({ lang, onSignIn }: { lang: Lang; onSignIn: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro needs a literal require() path
  const hero = require("../../assets/signin-hero.webp") as number;
  return <Card edge={colors.gold}>
    <Image source={hero} style={styles.hero} accessible={false} />
    <Text style={styles.title}>{t(lang, "signInCardTitle")}</Text>
    <Text style={styles.body}>{t(lang, "signInCardBody")}</Text>
    <Pressable onPress={onSignIn} accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>{t(lang, "signInGo")}</Text></Pressable>
  </Card>;
}

const styles = StyleSheet.create({
  hero: { width: "100%", aspectRatio: 2, borderRadius: 8, marginBottom: 10 },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  body: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  button: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 4 },
  buttonText: { color: colors.ink, fontWeight: "700", fontSize: 15 }
});
