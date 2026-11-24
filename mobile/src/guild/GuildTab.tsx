import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { shownEdition, t } from "../i18n";
import type { GuildState } from "../useGuild";
import type { GuildPart } from "../routes";
import { useBack } from "../useBack";
import { LastUpdated, RetryCard, Screen, SegmentedTabs, colors } from "../ui";
import { common } from "../ui/common";
import { Characters, Raids, Reserves } from "./GuildParts";
import { MapScreen } from "./MapScreen";
import { SignIn } from "./SignIn";

type Section = "roster" | "map" | "raids";

/** Guild tab: Roster (characters, reserves) | Map | Raids. Signed out, it is the sign-in screen. */
export function GuildTab({ guild, defaultOrigin, focus }: { guild: GuildState; defaultOrigin: string; focus?: { part: GuildPart; n: number } | null }) {
  const [section, setSection] = useState<Section>(focus?.part ?? "roster");
  // An app link or a tapped reminder opens a given part (Raids for a raid reminder).
  useEffect(() => { if (focus) setSection(focus.part); }, [focus]);
  // Android Back from Map or Raids returns to the Roster before it leaves the tab.
  useBack(section !== "roster", () => setSection("roster"));
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
      <Text style={common.muted}>{[shownEdition(hub?.edition || standings?.edition), hub?.battleTag].filter(Boolean).join(" · ")}</Text>
    </View>
    {!preview ? <LastUpdated lang={lang} savedAt={snapshot?.savedAt ?? null} stale={Boolean(snapshot?.stale)} /> : null}
    <SegmentedTabs options={(["roster", "map", "raids"] as const).map((value) => ({ value, label: t(lang, value) }))} value={section} onChange={setSection} />
    {guild.loading && !snapshot ? <ActivityIndicator color={colors.gold} style={{ marginVertical: 24 }} /> : null}
    {section === "roster" ? <>
      {snapshot?.errors.hub && !hub ? <RetryCard lang={lang} message={snapshot.errors.hub} onRetry={() => void guild.refresh()} /> : <>
        <Characters lang={lang} hub={hub} />
        <Text style={common.label}>{t(lang, "reserves").toUpperCase()}</Text>
        <Reserves lang={lang} hub={hub} />
      </>}
    </> : null}
    {section === "map" ? <MapScreen lang={lang} session={preview ? null : session} /> : null}
    {section === "raids" ? (snapshot?.errors.standings && !standings ? <RetryCard lang={lang} message={snapshot.errors.standings} onRetry={() => void guild.refresh()} />
      : <Raids lang={lang} hub={hub} manage={manage} standings={standings} answers={guild.answers} preview={preview} {...(preview || (session && !session.personal) ? { onAnswer: guild.answerRaid } : {})} />) : null}
    {(manage?.raidLeader || hub?.raidLeader) ? <Text style={common.note}>{t(lang, "leaderNote")}</Text> : null}
  </Screen>;
}
