import { Linking, Pressable, Text, View } from "react-native";
import { formatWhen, t, type Lang } from "../i18n";
import type { ReminderSync } from "../notify";
import type { planReminders } from "../reminders";
import { EmptyState } from "../ui";
import { common } from "../ui/common";

// On-device raid reminders. Moved from GuildScreen unchanged; the Alerts tab adds the push rows around it.

export function Alerts({ lang, preview, remindersOn, remoteOn, setRemindersOn, planned, imminent, sync }: {
  lang: Lang; preview: boolean; remindersOn: boolean; remoteOn: boolean; setRemindersOn: (on: boolean) => void;
  planned: ReturnType<typeof planReminders>; imminent: { id: string; title: string; at: string }[]; sync: ReminderSync | null;
}) {
  const failed = !preview && Boolean(sync?.error);
  const denied = !preview && Boolean(sync?.supported && !sync.granted && !sync.error);
  // A reminder is listed only when this phone will deliver it (or push, which replaces them, is off and they are on).
  const listed = remindersOn && !remoteOn && !denied && !failed;
  return <>
    <Text style={common.intro}>{t(lang, "alertsIntro")}</Text>
    <Pressable accessibilityRole="switch" accessibilityLabel={`${t(lang, "remindMe")}, ${remindersOn ? t(lang, "on") : t(lang, "off")}`} accessibilityState={{ checked: remindersOn }} onPress={() => setRemindersOn(!remindersOn)} style={common.hero}>
      <Text style={common.heroTitle}>{t(lang, "remindMe")}</Text>
      <Text style={common.body}>{remindersOn ? t(lang, "on") : t(lang, "off")}</Text>
    </Pressable>
    {preview ? <Text style={common.muted}>{t(lang, "alertsWeb")}</Text> : null}
    {!preview && sync && !sync.supported ? <Text style={common.muted}>{t(lang, "alertsWeb")}</Text> : null}
    {failed ? <Text accessibilityRole="alert" style={common.error}>{t(lang, "alertsFailed")}</Text> : null}
    {denied ? <>
      <Text accessibilityRole="alert" style={common.error}>{t(lang, "alertsDenied")}</Text>
      <Pressable onPress={() => void Linking.openSettings().catch(() => {})} accessibilityRole="button" accessibilityLabel={t(lang, "openSettings")} style={common.secondary}>
        <Text style={common.secondaryText}>{t(lang, "openSettings")}</Text>
      </Pressable>
    </> : null}
    {remoteOn ? <Text style={common.muted}>{t(lang, "alertsReplaced")}</Text> : null}
    {!listed ? null : planned.length === 0 ? <EmptyState art="season" boxed message={t(lang, "noReminders")} /> : planned.map((reminder) => <View key={`${reminder.id}-${reminder.leadMs}`} style={common.row}>
      <View style={{ flex: 1 }}>
        <Text style={common.body}>{reminder.title}</Text>
        <Text style={common.muted}>{formatWhen(reminder.fireAt, lang)} · {reminder.body}</Text>
      </View>
    </View>)}
    {imminent.length ? <Text style={common.label}>{t(lang, "startsSoon")}</Text> : null}
    {imminent.map((raid) => <Text key={raid.id} style={common.muted}>{raid.title} · {formatWhen(raid.at, lang)}</Text>)}
  </>;
}
