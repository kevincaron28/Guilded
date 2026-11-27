import { errorText } from "../errors";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from "react-native";
import { classLabel, specClassLabel, t } from "../i18n";
import type { GuildState } from "../useGuild";
import { Card, ClassName, EmptyState, Glyph, Screen, SignInCard, colors, shownName } from "../ui";
import { common } from "../ui/common";

import { Language } from "../guild/SignIn";
import { AlbumScreen } from "./AlbumScreen";
import { CharacterPage } from "./CharacterPage";
import { MyCharacters } from "./MyCharacters";
import type { MeCharacter } from "./meData";
import { PromotionCard } from "./PromotionCard";
import { Wishlist } from "./Wishlist";
import { DEFAULT_WEB_ORIGIN, DELETE_INFO_URL } from "../links";
import { openRating, shareApp } from "../review";
import { FeedbackScreen, HelpScreen, PrivacyScreen } from "./InfoScreens";
import * as clashEntry from "../clash/entry";

const linkRow = { flexDirection: "row", alignItems: "center", gap: 8 } as const;
const settingRow = { alignSelf: "stretch", justifyContent: "space-between", borderBottomWidth: 1, borderColor: colors.line } as const;

// Guilded Clash is on hold (owner, 14 November 2026): hidden, not deleted. metro.config.js resolves this module
// to an empty one unless the build sets EXPO_PUBLIC_GUILDED_CLASH=1, so a store bundle carries neither the game
// nor its card art; the flag is checked here as well. tests/mobile-release.test.ts guards both.
const clashParts: typeof clashEntry | null = process.env.EXPO_PUBLIC_GUILDED_CLASH === "1" && typeof clashEntry.ClashHome === "function" ? clashEntry : null;

/** Me tab: my characters, badges (album), wishlist, language and sign-out. Sign-out lives only here. */
export function MeTab({ guild, onSignIn }: { guild: GuildState; onSignIn: () => void }) {
  const { lang, session, preview, snapshot } = guild;
  const [clash, setClash] = useState(false);
  // 0.6.0: one of my characters' page (ranks, runs, duels) shown in place of the Me list; Android Back and its link return.
  const [page, setPage] = useState<MeCharacter | null>(null);
  // 0.7.0: Help & FAQ, the privacy policy and Report a problem open over the Me tab (Settings).
  const [info, setInfo] = useState<Info | null>(null);
  if (info === "privacy") return <PrivacyScreen lang={lang} onBack={() => setInfo(null)} />;
  if (info === "help") return <HelpScreen lang={lang} onBack={() => setInfo(null)} />;
  if (info === "feedback") return <FeedbackScreen lang={lang} origin={session?.apiOrigin ?? DEFAULT_WEB_ORIGIN} onBack={() => setInfo(null)} />;
  const hub = snapshot?.hub ?? null;
  // Guilded Clash opens in place of the Me list (the bottom tabs stay). Sample guild and signed out: the local sample game.
  if (clash && clashParts) return <Screen><clashParts.ClashHome lang={lang} session={preview ? null : session} defaultClass={hub?.characters.find((c) => c.isMain)?.className ?? null} onBack={() => setClash(false)} /></Screen>;
  if (!guild.signedIn) return <Screen>
    <SignInCard lang={lang} onSignIn={onSignIn} />
    {clashParts ? <clashParts.ClashTeaser lang={lang} onOpen={() => setClash(true)} /> : null}
    <Settings guild={guild} onOpen={setInfo} />
  </Screen>;
  if (page && session && !preview) return <Screen><CharacterPage lang={lang} origin={session.apiOrigin} name={page.name} className={page.className} level={page.level} onBack={() => setPage(null)} /></Screen>;
  const characters = hub?.characters ?? [];
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <Screen onRefresh={guild.refresh}>
      {preview ? <Text style={common.banner}>{t(lang, "sampleBanner")}</Text> : null}
      {session && !preview ? <>
        <MyCharacters lang={lang} session={session} onOpen={setPage} />
        <PromotionCard lang={lang} session={session} />
      </> : guild.hasGuild ? <>
        <Text style={common.label}>{t(lang, "profile").toUpperCase()}</Text>
        {characters.length === 0 ? <EmptyState art="guild" message={t(lang, "noCharacters")} /> : characters.map((character) =>
          <Card key={character.id} edge={null}>
            <View style={common.titleRow}>
              <ClassName name={shownName(character)} className={character.className} style={{ fontSize: 16, flex: 1 }} />
              <Text style={common.pill}>{character.isMain ? t(lang, "main") : classLabel(character.className, lang)}</Text>
            </View>
            <Text style={common.muted}>{specClassLabel(character.spec, character.className, lang)}{character.level ? ` · ${t(lang, "level")} ${character.level}` : ""}</Text>
          </Card>)}
      </> : null}
      <Text style={common.label}>{t(lang, "badges").toUpperCase()}</Text>
      <AlbumScreen lang={lang} session={preview ? null : session} />
      {clashParts ? <clashParts.ClashTeaser lang={lang} onOpen={() => setClash(true)} /> : null}
      {guild.hasGuild ? <>
        <Text style={common.label}>{t(lang, "wishlist").toUpperCase()}</Text>
        <Wishlist lang={lang} preview={preview} session={session} manage={snapshot?.manage ?? null}
          {...(snapshot?.errors.manage ? { error: snapshot.errors.manage } : {})}
          onChange={(next) => guild.setSnapshot((current) => current ? { ...current, manage: next } : current)} />
        <Text style={common.muted}>{t(lang, "mapShareHere")}</Text>
      </> : null}
      <Settings guild={guild} onOpen={setInfo} />
      <Pressable onPress={() => void guild.leave()} accessibilityRole="button" style={common.secondary}><Text style={common.secondaryText}>{preview ? t(lang, "closeSample") : t(lang, "signOut")}</Text></Pressable>
    </Screen>
  </KeyboardAvoidingView>;
}

type Info = "privacy" | "help" | "feedback";

function Settings({ guild, onOpen }: { guild: GuildState; onOpen: (info: Info) => void }) {
  const lang = guild.lang;
  // 0.7.0 (Testers Community feedback): Help & FAQ, the privacy policy inside the app, Report a problem, Rate and Share.
  const row = (label: string, onPress: () => void, external = false) => <Pressable key={label} onPress={onPress} accessibilityRole={external ? "link" : "button"} accessibilityLabel={label} style={[common.textButton, linkRow, settingRow]}>
    <Text style={common.textButtonLabel}>{label}</Text>{external ? <Glyph name="external" /> : <Glyph name="next" />}
  </Pressable>;
  return <>
    <Text style={common.label}>{t(lang, "settings").toUpperCase()}</Text>
    <Text style={common.muted} accessibilityRole="header">{t(lang, "language")}</Text>
    <Language lang={lang} setLang={guild.setLang} />
    {row(t(lang, "helpFaq"), () => onOpen("help"))}
    {row(t(lang, "privacyPolicy"), () => onOpen("privacy"))}
    {row(t(lang, "reportProblem"), () => onOpen("feedback"))}
    {row(t(lang, "rateApp"), () => void openRating(), true)}
    {row(t(lang, "shareApp"), () => void shareApp(lang))}
    <DeleteMyData guild={guild} />
  </>;
}

/**
 * Delete my data, inside the app (Google Play asks for an in-app way). Signed in: a button, then a confirmation that
 * says what is erased and what stays, then the erasure through the API. Signed out or in the sample guild there is
 * no account on this phone to delete, so the public page that explains the other ways is offered instead.
 */
function DeleteMyData({ guild }: { guild: GuildState }) {
  const { lang } = guild;
  const [step, setStep] = useState<"idle" | "confirm" | "working">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  // A second tap can land before the disabled state is drawn; a ref closes that gap, so only one request leaves.
  const sending = useRef(false);
  const info = <Pressable onPress={() => void Linking.openURL(DELETE_INFO_URL).catch(() => {})} accessibilityRole="link" accessibilityLabel={t(lang, "deleteMyDataHow")} style={[common.textButton, linkRow]}>
    <Text style={common.textButtonLabel}>{t(lang, "deleteMyDataHow")}</Text><Glyph name="external" />
  </Pressable>;
  if (!guild.session || guild.preview) return <>
    <Text style={common.muted}>{t(lang, "deleteMyDataSignedOut")}</Text>
    {info}
  </>;
  const run = async () => {
    if (sending.current) return;
    sending.current = true;
    setStep("working");
    setProblem(null);
    try {
      if (await guild.deleteMyData() === "unavailable") setProblem(t(lang, "deleteUnavailable"));
    } catch (error) {
      setProblem(errorText(error, lang, t(lang, "deleteUnavailable")));
    } finally {
      sending.current = false;
    }
    setStep("idle");
  };
  return <>
    {step === "idle" ? <>
      <Pressable onPress={() => { setProblem(null); setStep("confirm"); }} accessibilityRole="button" style={common.textButton}>
        <Text style={common.textButtonLabel}>{t(lang, "deleteMyData")}</Text>
      </Pressable>
      <Text style={common.muted}>{t(lang, "deleteMyDataHelp")}</Text>
    </> : <Card edge={null}>
      <Text style={common.heroTitle}>{t(lang, "deleteConfirmTitle")}</Text>
      <Text style={common.muted}>{t(lang, "deleteConfirmBody")}</Text>
      <Pressable onPress={() => void run()} disabled={step === "working"} accessibilityRole="button" accessibilityState={{ disabled: step === "working" }} style={[common.secondary, step === "working" && common.disabled]}>
        <Text style={[common.secondaryText, { color: colors.error }]}>{step === "working" ? t(lang, "deleteWorking") : t(lang, "deleteConfirmYes")}</Text>
      </Pressable>
      <Pressable onPress={() => setStep("idle")} disabled={step === "working"} accessibilityRole="button" style={[common.secondary, step === "working" && common.disabled]}>
        <Text style={common.secondaryText}>{t(lang, "deleteConfirmNo")}</Text>
      </Pressable>
    </Card>}
    {problem ? <>
      <Text accessibilityRole="alert" style={common.error}>{problem}</Text>
      {info}
    </> : null}
  </>;
}
