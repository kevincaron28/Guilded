import { KeyboardAvoidingView, Linking, Platform, Pressable, Text, View } from "react-native";
import { t } from "../i18n";
import type { GuildState } from "../useGuild";
import { Card, ClassName, Screen, SignInCard, shownName } from "../ui";
import { common } from "../ui/common";
import { Language } from "../guild/SignIn";
import { AlbumScreen } from "./AlbumScreen";
import { Wishlist } from "./Wishlist";

/** Me tab: my characters, badges (album), wishlist, language and sign-out. Sign-out lives only here. */
export function MeTab({ guild, webOrigin, onSignIn }: { guild: GuildState; webOrigin: string; onSignIn: () => void }) {
  const { lang, session, preview, snapshot } = guild;
  if (!guild.signedIn) return <Screen>
    <SignInCard lang={lang} onSignIn={onSignIn} />
    <Settings guild={guild} />
  </Screen>;
  const hub = snapshot?.hub ?? null;
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
      {guild.hasGuild ? <>
        <Text style={common.label}>{t(lang, "wishlist").toUpperCase()}</Text>
        <Wishlist lang={lang} preview={preview} session={session} manage={snapshot?.manage ?? null}
          {...(snapshot?.errors.manage ? { error: snapshot.errors.manage } : {})}
          onChange={(next) => guild.setSnapshot((current) => current ? { ...current, manage: next } : current)} />
        <Text style={common.muted}>{t(lang, "mapShareHere")}</Text>
      </> : null}
      <Settings guild={guild} />
      <Pressable onPress={() => void guild.leave()} style={common.secondary}><Text style={common.secondaryText}>{preview ? t(lang, "closeSample") : t(lang, "signOut")}</Text></Pressable>
    </Screen>
  </KeyboardAvoidingView>;
}

function Settings({ guild }: { guild: GuildState }) {
  return <>
    <Text style={common.label}>{t(guild.lang, "settings").toUpperCase()}</Text>
    <Text style={common.muted}>{t(guild.lang, "language")}</Text>
    <Language lang={guild.lang} setLang={guild.setLang} />
  </>;
}
