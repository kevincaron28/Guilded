import { useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, TextInput, View, type LayoutChangeEvent, type ScrollViewInstance } from "react-native";
import Constants from "expo-constants";
import { feedbackReport, sendErrorReport } from "../crashReport";
import { errorText } from "../errors";
import { HELP } from "../helpText";
import type { Lang } from "../i18n";
import { PRIVACY_URL, SUPPORT_URL } from "../links";
import { PRIVACY } from "../privacyText";
import { Card, Glyph, colors } from "../ui";
import { Prose } from "../ui/Prose";
import { common } from "../ui/common";
import { useBack } from "../useBack";
import { useKeyboardScroll } from "../useKeyboardScroll";

// Settings screens of phone app 0.7.0 (Testers Community feedback): the privacy policy inside the app with section links,
// Help & FAQ, and Report a problem. Each opens over the Me tab; its back link and Android Back return to Settings.

const words = {
  back: { en: "Settings", fr: "Réglages" },
  privacy: { en: "Privacy policy", fr: "Politique de confidentialité" },
  contents: { en: "CONTENTS", fr: "SOMMAIRE" },
  top: { en: "Overview", fr: "Aperçu" },
  web: { en: "Open on the website", fr: "Ouvrir sur le site" },
  help: { en: "Help & FAQ", fr: "Aide et FAQ" },
  helpIntro: { en: "Short answers to the usual questions. Tap a question to open it.", fr: "De courtes réponses aux questions habituelles. Touche une question pour l'ouvrir." },
  stillStuck: { en: "Still stuck? Report a problem from Settings, or ask in the Guilded support community.", fr: "Encore pris? Signale un problème dans les Réglages, ou demande dans la communauté de soutien Guilded." },
  support: { en: "Guilded support community (Discord)", fr: "Communauté de soutien Guilded (Discord)" },
  report: { en: "Report a problem", fr: "Signaler un problème" },
  reportIntro: { en: "Tell us what you did and what you saw, or an idea for the app. We get the app version, the phone type and this screen's name with it, never your account, name or guild.", fr: "Dis-nous ce que tu as fait et ce que tu as vu, ou une idée pour l'appli. On reçoit avec ça la version de l'appli, le type de téléphone et le nom de cet écran, jamais ton compte, ton nom ou ta guilde." },
  kindProblem: { en: "Problem", fr: "Problème" },
  kindIdea: { en: "Idea", fr: "Idée" },
  placeholder: { en: "What happened?", fr: "Qu'est-ce qui s'est passé?" },
  send: { en: "Send", fr: "Envoyer" },
  sending: { en: "Sending…", fr: "Envoi…" },
  sent: { en: "Thanks! Your reference is {ref}. Quote it if you ask in the support community.", fr: "Merci! Ta référence est {ref}. Donne-la si tu demandes dans la communauté de soutien." },
  failed: { en: "It was not sent. Try again in a moment, or ask in the support community.", fr: "Ça n'a pas été envoyé. Réessaie dans un moment, ou demande dans la communauté de soutien." },
  hide: { en: "Hide keyboard", fr: "Cacher le clavier" }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

function Back({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  return <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={w("back", lang)} style={[common.textButton, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
    <Glyph name="back" /><Text style={common.textButtonLabel}>{w("back", lang)}</Text>
  </Pressable>;
}

/** The policy from docs/PRIVACY.md, with a contents list that scrolls to each section. */
export function PrivacyScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  useBack(true, onBack);
  const text = PRIVACY[lang];
  const scroll = useRef<ScrollViewInstance>(null);
  const at = useRef<Record<number, number>>({});
  const jump = (i: number) => scroll.current?.scrollTo({ y: Math.max(0, (at.current[i] ?? 0) - 8), animated: true });
  return <ScrollView ref={scroll} contentContainerStyle={common.content}>
    <Back lang={lang} onBack={onBack} />
    <Text style={common.title} accessibilityRole="header">{w("privacy", lang)}</Text>
    <Text style={common.muted}>{PRIVACY.updated}</Text>
    <Card>
      <Text style={common.label}>{w("contents", lang)}</Text>
      {[w("top", lang), ...text.sections.map((s) => s.title)].map((title, i) => <Pressable key={title} onPress={() => jump(i)} accessibilityRole="link" accessibilityLabel={title} style={{ minHeight: 40, justifyContent: "center" }}>
        <Text style={common.textButtonLabel}>{title}</Text>
      </Pressable>)}
    </Card>
    <View onLayout={(e: LayoutChangeEvent) => { at.current[0] = e.nativeEvent.layout.y; }}><Prose markdown={text.intro} /></View>
    {text.sections.map((section, i) => <View key={section.title} onLayout={(e: LayoutChangeEvent) => { at.current[i + 1] = e.nativeEvent.layout.y; }} style={{ gap: 10 }}>
      <Text style={common.heroTitle} accessibilityRole="header">{section.title}</Text>
      <Prose markdown={section.body} />
    </View>)}
    <Pressable onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => {})} accessibilityRole="link" style={[common.textButton, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
      <Text style={common.textButtonLabel}>{w("web", lang)}</Text><Glyph name="external" />
    </Pressable>
  </ScrollView>;
}

/** Help & FAQ: topics with questions that open in place. */
export function HelpScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  useBack(true, onBack);
  const [open, setOpen] = useState<string | null>(null);
  return <ScrollView contentContainerStyle={common.content}>
    <Back lang={lang} onBack={onBack} />
    <Text style={common.title} accessibilityRole="header">{w("help", lang)}</Text>
    <Text style={common.intro}>{w("helpIntro", lang)}</Text>
    {HELP[lang].map((topic) => <View key={topic.id} style={{ gap: 6 }}>
      <Text style={common.label}>{topic.title.toUpperCase()}</Text>
      <Card style={{ gap: 0 }}>{topic.items.map((item) => {
        const key = `${topic.id}:${item.q}`;
        const shown = open === key;
        return <View key={key} style={{ borderTopWidth: 1, borderColor: colors.line, paddingVertical: 4 }}>
          <Pressable onPress={() => setOpen(shown ? null : key)} accessibilityRole="button" accessibilityState={{ expanded: shown }} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[common.body, { flex: 1, fontWeight: "600" }]}>{item.q}</Text>
            <Text style={{ color: colors.gold, fontSize: 18 }}>{shown ? "−" : "+"}</Text>
          </Pressable>
          {shown ? <View style={{ paddingBottom: 10 }}><Prose markdown={item.a} /></View> : null}
        </View>;
      })}</Card>
    </View>)}
    <Text style={common.muted}>{w("stillStuck", lang)}</Text>
    <Pressable onPress={() => void Linking.openURL(SUPPORT_URL).catch(() => {})} accessibilityRole="link" style={[common.textButton, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
      <Text style={common.textButtonLabel}>{w("support", lang)}</Text><Glyph name="external" />
    </Pressable>
  </ScrollView>;
}

/** Report a problem / feedback: filed by the same route as the error screen's report (POST /api/v1/mobile/report). */
export function FeedbackScreen({ lang, origin, onBack }: { lang: Lang; origin: string; onBack: () => void }) {
  useBack(true, onBack);
  const [kind, setKind] = useState<"problem" | "idea">("problem");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | { ref: string } | { error: string }>("idle");
  const keyboard = useKeyboardScroll();
  const send = async () => {
    if (state === "sending" || !text.trim()) return;
    setState("sending");
    try {
      const ref = await sendErrorReport(origin, feedbackReport(kind, text, Constants.expoConfig?.version, Platform.OS));
      setState({ ref }); setText("");
    } catch (error) { setState({ error: errorText(error, lang, w("failed", lang)) }); }
  };
  const chip = (value: "problem" | "idea", label: string) => <Pressable key={value} onPress={() => setKind(value)} accessibilityRole="button" accessibilityState={{ selected: kind === value }} style={[common.chip, kind === value && common.chipOn]}>
    <Text style={[common.chipText, kind === value && common.chipTextOn]}>{label}</Text>
  </Pressable>;
  return <ScrollView ref={keyboard.scroll} contentContainerStyle={[common.content, { paddingBottom: 24 + keyboard.height }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScroll={keyboard.onScroll} scrollEventThrottle={16}>
    <Back lang={lang} onBack={onBack} />
    <Text style={common.title} accessibilityRole="header">{w("report", lang)}</Text>
    <Text style={common.intro}>{w("reportIntro", lang)}</Text>
    <View style={common.chips}>{chip("problem", w("kindProblem", lang))}{chip("idea", w("kindIdea", lang))}</View>
    <TextInput value={text} onChangeText={setText} placeholder={w("placeholder", lang)} placeholderTextColor={colors.muted} accessibilityLabel={w("placeholder", lang)}
      multiline maxLength={1500} textAlignVertical="top" onFocus={keyboard.reveal} style={[common.input, { minHeight: 140 }]} />
    {keyboard.height ? <Pressable onPress={keyboard.dismiss} accessibilityRole="button" style={common.textButton}><Text style={common.textButtonLabel}>{w("hide", lang)}</Text></Pressable> : null}
    <Pressable onPress={() => void send()} disabled={state === "sending" || !text.trim()} accessibilityRole="button" accessibilityState={{ disabled: state === "sending" || !text.trim() }}
      style={[common.primary, (state === "sending" || !text.trim()) && common.disabled]}>
      <Text style={common.primaryText}>{state === "sending" ? w("sending", lang) : w("send", lang)}</Text>
    </Pressable>
    {typeof state === "object" && "ref" in state ? <Text accessibilityRole="alert" style={common.body}>{w("sent", lang).replace("{ref}", state.ref)}</Text> : null}
    {typeof state === "object" && "error" in state ? <Text accessibilityRole="alert" style={common.error}>{state.error}</Text> : null}
    <Pressable onPress={() => void Linking.openURL(SUPPORT_URL).catch(() => {})} accessibilityRole="link" style={[common.textButton, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
      <Text style={common.textButtonLabel}>{w("support", lang)}</Text><Glyph name="external" />
    </Pressable>
  </ScrollView>;
}
