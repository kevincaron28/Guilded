import { Pressable, Text, View } from "react-native";
import { formatWhen, t, type Lang } from "../i18n";
import type { ReminderSync } from "../notify";
import type { planReminders } from "../reminders";
import { common } from "../ui/common";

// On-device raid reminders. Moved from GuildScreen unchanged; the Alerts tab adds the push rows around it.

export function Alerts({ lang, preview, remindersOn, setRemindersOn, planned, imminent, sync }: {
  lang: Lang; preview: boolean; remindersOn: boolean; setRemindersOn: (on: boolean) => void;
  planned: ReturnType<typeof planReminders>; imminent: { id: string; title: string; at: string }[]; sync: ReminderSync | null;
}) {
  return <>
    <Text style={common.intro}>{t(lang, "alertsIntro")}</Text>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: remindersOn }} onPress={() => setRemindersOn(!remindersOn)} style={common.hero}>
      <Text style={common.heroTitle}>{t(lang, "remindMe")}</Text>
      <Text style={common.body}>{remindersOn ? t(lang, "on") : t(lang, "off")}</Text>
    </Pressable>
    {preview ? <Text style={common.muted}>{t(lang, "alertsWeb")}</Text> : null}
    {!preview && sync && !sync.supported ? <Text style={common.muted}>{t(lang, "alertsWeb")}</Text> : null}
    {!preview && sync && sync.supported && !sync.granted ? <Text style={common.error}>{t(lang, "alertsDenied")}</Text> : null}
    {planned.length === 0 ? <Text style={common.muted}>{t(lang, "noReminders")}</Text> : planned.map((reminder) => <View key={reminder.id} style={common.row}>
      <View style={{ flex: 1 }}>
        <Text style={common.body}>{reminder.title}</Text>
        <Text style={common.muted}>{formatWhen(reminder.fireAt, lang)} · {reminder.body}</Text>
      </View>
    </View>)}
    {imminent.length ? <Text style={common.label}>{t(lang, "startsSoon")}</Text> : null}
    {imminent.map((raid) => <Text key={raid.id} style={common.muted}>{raid.title} · {formatWhen(raid.at, lang)}</Text>)}
  </>;
}
