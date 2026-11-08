import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { GuildedClient, apiOrigin } from "../api";
import { t, type Lang } from "../i18n";
import { saveOrigin, saveSession, type Session } from "../storage";
import { colors } from "../ui";
import { common } from "../ui/common";

// Discord sign-in (the companion flow), a pairing code, and the sample guild. Moved from GuildScreen.

export function Language({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  return <View style={common.langRow}>
    {(["en", "fr"] as const).map((code) => <Pressable key={code} onPress={() => setLang(code)} style={[common.lang, lang === code && common.langOn]}><Text style={[common.langText, lang === code && common.langTextOn]}>{code.toUpperCase()}</Text></Pressable>)}
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
        setError(caught instanceof Error ? caught.message : t(lang, "signInTitle"));
      }
    };
    timer = setTimeout(() => void tick(), 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [pending, lang, onSession]);

  const originOrError = (): string | null => {
    try { return apiOrigin(originDraft || defaultOrigin); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t(lang, "advanced")); return null; }
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
      await Linking.openURL(started.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t(lang, "signInTitle"));
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
      setError(caught instanceof Error ? caught.message : t(lang, "connect"));
    } finally { setBusy(false); }
  };

  return <ScrollView contentContainerStyle={common.content} keyboardShouldPersistTaps="handled">
    <Language lang={lang} setLang={setLang} />
    <Text style={common.kicker}>{t(lang, "guildKicker")}</Text>
    <Text style={common.title}>{t(lang, "signInTitle")}</Text>
    <Text style={common.intro}>{t(lang, "signInIntro")}</Text>
    {error ? <Text style={common.error}>{error}</Text> : null}
    {pending ? <View style={common.hero}>
      <Text style={common.code}>{pending.confirm}</Text>
      <Text style={common.muted}>{t(lang, "codeHelp")}</Text>
      <Text style={common.muted}>{t(lang, "waiting")}</Text>
      <Pressable onPress={() => void Linking.openURL(pending.url)} style={common.primary}><Text style={common.primaryText}>{t(lang, "openPage")}</Text></Pressable>
      <Pressable onPress={() => setPending(null)} style={common.secondary}><Text style={common.secondaryText}>{t(lang, "cancel")}</Text></Pressable>
    </View> : <Pressable onPress={() => void start()} disabled={busy} style={common.primary}><Text style={common.primaryText}>{t(lang, "signInButton")}</Text></Pressable>}
    <Text style={common.label}>{t(lang, "pairingLabel")}</Text>
    <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder={t(lang, "pairingPlaceholder")} placeholderTextColor={colors.muted} style={common.input} />
    <TextInput value={serverId} onChangeText={setServerId} autoCorrect={false} placeholder={t(lang, "serverIdPlaceholder")} placeholderTextColor={colors.muted} style={common.input} keyboardType="number-pad" />
    <Pressable onPress={() => void pair()} disabled={busy || !code.trim()} style={common.secondary}><Text style={common.secondaryText}>{t(lang, "connect")}</Text></Pressable>
    <Pressable onPress={() => setAdvanced((open) => !open)} style={common.textButton}><Text style={common.textButtonLabel}>{t(lang, "advanced")}</Text></Pressable>
    {advanced ? <>
      <Text style={common.muted}>{t(lang, "serverAddressHelp")}</Text>
      <TextInput value={originDraft} onChangeText={setOriginDraft} autoCapitalize="none" autoCorrect={false} placeholder={defaultOrigin} placeholderTextColor={colors.muted} style={common.input} />
    </> : null}
    <View style={common.hero}>
      <Text style={common.heroTitle}>{t(lang, "preview")}</Text>
      <Text style={common.muted}>{t(lang, "previewNote")}</Text>
      <Pressable onPress={onPreview} style={common.secondary}><Text style={common.secondaryText}>{t(lang, "preview")}</Text></Pressable>
    </View>
  </ScrollView>;
}
