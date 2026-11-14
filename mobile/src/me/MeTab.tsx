import { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from "react-native";
import { t } from "../i18n";
import type { GuildState } from "../useGuild";
import { Card, ClassName, Screen, SignInCard, shownName } from "../ui";
import { common } from "../ui/common";
import { Language } from "../guild/SignIn";
import { AlbumScreen } from "./AlbumScreen";
import { Wishlist } from "./Wishlist";
import { PRIVACY_URL, deleteDataUrl } from "../links";
import * as clashEntry from "../clash/entry";

// Guilded Clash is on hold (owner, 14 November 2026): hidden, not deleted. metro.config.js resolves this module
// to an empty one unless the build sets EXPO_PUBLIC_GUILDED_CLASH=1, so a store bundle carries neither the game
// nor its card art; the flag is checked here as well. tests/mobile-release.test.ts guards both.
const clashParts: typeof clashEntry | null = process.env.EXPO_PUBLIC_GUILDED_CLASH === "1" && typeof clashEntry.ClashHome === "function" ? clashEntry : null;

/** Me tab: my characters, badges (album), wishlist, language and sign-out. Sign-out lives only here. */
export function MeTab({ guild, webOrigin, onSignIn }: { guild: GuildState; webOrigin: string; onSignIn: () => void }) {
  const { lang, session, preview, snapshot } = guild;
  const [clash, setClash] = useState(false);
  const hub = snapshot?.hub ?? null;
  // Guilded Clash opens in place of the Me list (the bottom tabs stay). Sample guild and signed out: the local sample game.
  if (clash && clashParts) return <Screen><clashParts.ClashHome lang={lang} session={preview ? null : session} defaultClass={hub?.characters.find((c) => c.isMain)?.className ?? null} onBack={() => setClash(false)} /></Screen>;
  if (!guild.signedIn) return <Screen>
    <SignInCard lang={lang} onSignIn={onSignIn} />
    {clashParts ? <clashParts.ClashTeaser lang={lang} onOpen={() => setClash(true)} /> : null}
    <Settings guild={guild} webOrigin={webOrigin} />
  </Screen>;
  const characters = hub?.characters ?? [];
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <Screen onRefresh={guild.refresh}>
      {preview ? <Text style={common.banner}>{t(lang, "sampleBanner")}</Text> : null}
      {guild.hasGuild ? <>
        <Text style={common.label}>{t(lang, "profile").toUpperCase()}</Text>
        {characters.length === 0 ? <Text style={common.muted}>{t(lang, "noCharacters")}</Text> : characters.map((character) =>
          <Card key={character.id} edge={null}>
            <View style={common.titleRow}>
              <ClassName name={shownName(character)} className={character.className} style={{ fontSize: 16, flex: 1 }} />
              <Text style={common.pill}>{character.isMain ? t(lang, "main") : character.className}</Text>
            </View>
            <Text style={common.muted}>{[character.spec, character.className].filter(Boolean).join(" ")}{character.level ? ` · ${t(lang, "level")} ${character.level}` : ""}</Text>
          </Card>)}
      </> : null}
      <Pressable onPress={() => void Linking.openURL(`${webOrigin}/auth/login?return=%2Fme%2F`)} accessibilityRole="link" style={common.textButton}>
        <Text style={common.textButtonLabel}>{t(lang, "webProfile")} ↗</Text>
      </Pressable>
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
      <Settings guild={guild} webOrigin={webOrigin} />
      <Pressable onPress={() => void guild.leave()} style={common.secondary}><Text style={common.secondaryText}>{preview ? t(lang, "closeSample") : t(lang, "signOut")}</Text></Pressable>
    </Screen>
  </KeyboardAvoidingView>;
}

function Settings({ guild, webOrigin }: { guild: GuildState; webOrigin: string }) {
  return <>
    <Text style={common.label}>{t(guild.lang, "settings").toUpperCase()}</Text>
    <Text style={common.muted}>{t(guild.lang, "language")}</Text>
    <Language lang={guild.lang} setLang={guild.setLang} />
    <Pressable onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => {})} accessibilityRole="link" style={common.textButton}>
      <Text style={common.textButtonLabel}>{t(guild.lang, "privacyPolicy")} ↗</Text>
    </Pressable>
    <Pressable onPress={() => void Linking.openURL(deleteDataUrl(webOrigin)).catch(() => {})} accessibilityRole="link" style={common.textButton}>
      <Text style={common.textButtonLabel}>{t(guild.lang, "deleteMyData")} ↗</Text>
    </Pressable>
    <Text style={common.muted}>{t(guild.lang, "deleteMyDataHelp")}</Text>
  </>;
}
