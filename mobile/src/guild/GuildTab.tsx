import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { t } from "../i18n";
import type { GuildState } from "../useGuild";
import { Screen, SegmentedTabs, colors } from "../ui";
import { common } from "../ui/common";
import { Characters, Raids, Reserves } from "./GuildParts";
import { MapScreen } from "./MapScreen";
import { SignIn } from "./SignIn";

type Section = "roster" | "map" | "raids";

/** Guild tab: Roster (characters, reserves) | Map | Raids. Signed out, it is the sign-in screen. */
export function GuildTab({ guild, defaultOrigin }: { guild: GuildState; defaultOrigin: string }) {
  const [section, setSection] = useState<Section>("roster");
  const { lang, session, preview, snapshot } = guild;

  if (!session && !preview) {
    return <SignIn lang={lang} setLang={guild.setLang} originDraft={guild.originDraft} setOriginDraft={guild.setOriginDraft} defaultOrigin={defaultOrigin}
      onSession={guild.setSession} onPreview={guild.startPreview} />;
  }
  if (session?.personal && !preview) {
    return <Screen>
      <Text style={common.title}>{t(lang, "personalTitle")}</Text>
      <Text style={common.intro}>{t(lang, "personalBody")}</Text>
    </Screen>;
  }

  const hub = snapshot?.hub ?? null;
  const manage = snapshot?.manage ?? null;
  const standings = snapshot?.standings ?? null;
  return <Screen onRefresh={guild.refresh}>
    {preview ? <Text style={common.banner}>{t(lang, "sampleBanner")}</Text> : null}
    <View>
      <Text style={common.kicker}>{t(lang, "guildKicker")}</Text>
      <Text style={common.title}>{guild.guildName || "Guild"}</Text>
      <Text style={common.muted}>{[hub?.edition || standings?.edition, hub?.battleTag].filter(Boolean).join(" · ")}</Text>
    </View>
    <SegmentedTabs options={(["roster", "map", "raids"] as const).map((value) => ({ value, label: t(lang, value) }))} value={section} onChange={setSection} />
    {guild.loading && !snapshot ? <ActivityIndicator color={colors.gold} style={{ marginVertical: 24 }} /> : null}
    {section === "roster" ? <>
      <Characters lang={lang} hub={hub} {...(snapshot?.errors.hub ? { error: snapshot.errors.hub } : {})} />
      <Text style={common.label}>{t(lang, "reserves").toUpperCase()}</Text>
      <Reserves lang={lang} hub={hub} {...(snapshot?.errors.hub ? { error: snapshot.errors.hub } : {})} />
    </> : null}
    {section === "map" ? <MapScreen lang={lang} session={preview ? null : session} /> : null}
    {section === "raids" ? <Raids lang={lang} hub={hub} manage={manage} standings={standings} {...(snapshot?.errors.standings ? { error: snapshot.errors.standings } : {})} /> : null}
    {(manage?.raidLeader || hub?.raidLeader) ? <Text style={common.note}>{t(lang, "leaderNote")}</Text> : null}
  </Screen>;
}
