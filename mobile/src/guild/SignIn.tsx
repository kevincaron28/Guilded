import { errorText } from "../errors";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { GuildedClient, apiOrigin } from "../api";
import { t, type Lang } from "../i18n";
import { saveOrigin, saveSession, type Session } from "../storage";
import { colors } from "../ui";
import { common } from "../ui/common";
import { useBack } from "../useBack";

// Discord sign-in (the companion flow), a pairing code, and the sample guild. Moved from GuildScreen.

export function Language({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  return <View style={common.langRow}>
    {(["en", "fr"] as const).map((code) => <Pressable key={code} onPress={() => setLang(code)} accessibilityRole="button" accessibilityLabel={code === "fr" ? "Français" : "English"} accessibilityState={{ selected: lang === code }} style={[common.lang, lang === code && common.langOn]}><Text style={[common.langText, lang === code && common.langTextOn]}>{code.toUpperCase()}</Text></Pressable>)}
  </View>;
}

export function SignIn({ lang, setLang, originDraft, setOriginDraft, defaultOrigin, onSession, onPreview }: {
  lang: Lang; setLang: (lang: Lang) => void; originDraft: string; setOriginDraft: (value: string) => void; defaultOrigin: string;
  onSession: (session: Session) => void; onPreview: () => void;
}) {
  const [pending, setPending] = useState<{ requestId: string; confirm: string; expiresAt: string; url: string; origin: string } | null>(null);
  const [code, setCode] = useState("");
  const [serverId, setServerId] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (Date.parse(pending.expiresAt) <= Date.now()) {
        setPending(null);
        setError(t(lang, "expired"));
        return;
      }
      try {
        const answer = await new GuildedClient(pending.origin).pollSignIn(pending.requestId);
        if (stopped) return;
        if (answer === "pending") { timer = setTimeout(() => void tick(), 2000); return; }
        const session = { ...answer, apiOrigin: pending.origin };
        await saveSession(session);
        setPending(null);
        onSession(session);
      } catch (caught) {
        if (stopped) return;
        setPending(null);
        setError(errorText(caught, lang, t(lang, "signInTitle")));
      }
    };
    timer = setTimeout(() => void tick(), 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [pending, lang, onSession]);

  const originOrError = (): string | null => {
    try { return apiOrigin(originDraft || defaultOrigin); }
    catch (caught) { setError(errorText(caught, lang, t(lang, "advanced"))); return null; }
  };

  const start = async () => {
    const origin = originOrError();
    if (!origin) return;
    setBusy(true);
    setError(null);
    try {
      await saveOrigin(origin);
      const started = await new GuildedClient(origin).startSignIn();
      setPending({ ...started, origin });
      await Linking.openURL(started.url).catch(() => setError(t(lang, "openPageFailed")));
    } catch (caught) {
      setError(errorText(caught, lang, t(lang, "signInTitle")));
    } finally { setBusy(false); }
  };

  const pair = async () => {
    const origin = originOrError();
    if (!origin || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveOrigin(origin);
      const grant = await new GuildedClient(origin).pair(code, serverId);
      const session = { ...grant, apiOrigin: origin };
      await saveSession(session);
      onSession(session);
    } catch (caught) {
      setError(errorText(caught, lang, t(lang, "connect")));
    } finally { setBusy(false); }
  };

  // Android Back while the code is showing returns to the form instead of leaving the app.
  useBack(pending !== null, () => setPending(null));

  return <ScrollView contentContainerStyle={common.content} keyboardShouldPersistTaps="handled">
    <Language lang={lang} setLang={setLang} />
    <Text style={common.kicker}>{t(lang, "guildKicker")}</Text>
    <Text style={common.title} accessibilityRole="header">{t(lang, "signInTitle")}</Text>
    <Text style={common.intro}>{t(lang, "signInIntro")}</Text>
    {error ? <Text style={common.error} accessibilityRole="alert">{error}</Text> : null}
    {pending ? null : <View style={common.hero} accessible accessibilityLabel={`${t(lang, "signInSteps")}. 1. ${t(lang, "signInStep1")} 2. ${t(lang, "signInStep2")} 3. ${t(lang, "signInStep3")}`}>
      <Text style={common.heroTitle}>{t(lang, "signInSteps")}</Text>
      {(["signInStep1", "signInStep2", "signInStep3"] as const).map((key, i) => <Text key={key} style={common.body}>{`${i + 1}. ${t(lang, key)}`}</Text>)}
    </View>}
    {pending ? <View style={common.hero}>
      <Text style={common.code} accessibilityLabel={pending.confirm.split("").join(" ")} maxFontSizeMultiplier={1.3}>{pending.confirm}</Text>
      <Text style={common.muted}>{t(lang, "codeHelp")}</Text>
      <View style={styles.waiting} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.gold} size="small" /><Text style={[common.muted, styles.waitingText]}>{t(lang, "waiting")}</Text></View>
      <Pressable onPress={() => void Linking.openURL(pending.url).catch(() => setError(t(lang, "openPageFailed")))} accessibilityRole="button" style={common.primary}><Text style={common.primaryText}>{t(lang, "openPage")}</Text></Pressable>
      <Pressable onPress={() => setPending(null)} accessibilityRole="button" style={common.secondary}><Text style={common.secondaryText}>{t(lang, "cancel")}</Text></Pressable>
    </View> : <Pressable onPress={() => void start()} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }} style={[common.primary, busy && common.disabled]}>
      {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={common.primaryText}>{t(lang, "signInButton")}</Text>}
    </Pressable>}
    <View style={common.hero}>
      <Text style={common.heroTitle}>{t(lang, "preview")}</Text>
      <Text style={common.muted}>{t(lang, "previewNote")}</Text>
      <Pressable onPress={onPreview} accessibilityRole="button" style={common.secondary}><Text style={common.secondaryText}>{t(lang, "preview")}</Text></Pressable>
    </View>
    <Pressable onPress={() => setPairOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: pairOpen }} style={common.textButton}>
      <Text style={common.textButtonLabel}>{t(lang, pairOpen ? "pairingHide" : "pairingLabel")}</Text>
    </Pressable>
    {pairOpen ? <>
      <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder={t(lang, "pairingPlaceholder")} accessibilityLabel={t(lang, "pairingPlaceholder")} placeholderTextColor={colors.muted} style={common.input} />
      <TextInput value={serverId} onChangeText={setServerId} autoCorrect={false} placeholder={t(lang, "serverIdPlaceholder")} accessibilityLabel={t(lang, "serverIdPlaceholder")} placeholderTextColor={colors.muted} style={common.input} keyboardType="number-pad" />
      <Pressable onPress={() => void pair()} disabled={busy || !code.trim()} accessibilityRole="button" accessibilityState={{ disabled: busy || !code.trim() }} style={[common.secondary, (busy || !code.trim()) && common.disabled]}><Text style={common.secondaryText}>{t(lang, "connect")}</Text></Pressable>
    </> : null}
    <Pressable onPress={() => setAdvanced((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: advanced }} style={common.textButton}><Text style={common.textButtonLabel}>{t(lang, "advanced")}</Text></Pressable>
    {advanced ? <>
      <Text style={common.muted}>{t(lang, "serverAddressHelp")}</Text>
      <TextInput value={originDraft} onChangeText={setOriginDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={defaultOrigin} accessibilityLabel={t(lang, "advanced")} placeholderTextColor={colors.muted} style={common.input} />
    </> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  waiting: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  waitingText: { flex: 1, marginTop: 0 }
});
