import { Switch, Text, View } from "react-native";
import { t, type CopyKey } from "../i18n";
import type { GuildState } from "../useGuild";
import { Card, Screen, SignInCard, colors } from "../ui";
import { common } from "../ui/common";
import { Alerts } from "./AlertsList";

// Alerts tab: on-device raid reminders today. Help-call, dungeon and raid-vacancy alerts are listed as switched-off
// rows until the server sends them (raid push is live with PR #345; server hook: onHelpCallStored in src/services/guild-map.ts).
const PUSH_ROWS: CopyKey[] = ["pushHelp", "pushDungeon", "pushRaid"];

export function AlertsTab({ guild, onSignIn }: { guild: GuildState; onSignIn: () => void }) {
  const { lang } = guild;
  if (!guild.hasGuild) return <Screen><SignInCard lang={lang} onSignIn={onSignIn} /></Screen>;
  return <Screen>
    {guild.preview ? <Text style={common.banner}>{t(lang, "sampleBanner")}</Text> : null}
    <Alerts lang={lang} preview={guild.preview} remindersOn={guild.remindersOn} setRemindersOn={guild.setRemindersOn}
      planned={guild.planned} imminent={guild.imminent} sync={guild.reminderSync} />
    <Card>
      <Text style={common.heroTitle}>{t(lang, "pushTitle")}</Text>
      <Text style={common.muted}>{t(lang, "pushBody")}</Text>
      <View style={common.row}>
        <Text style={[common.body, { flex: 1 }]}>{t(lang, "pushRemote")}</Text>
        <Switch value={guild.remoteOn} disabled={guild.preview || guild.pushBusy || !guild.session || guild.session.personal} onValueChange={() => void guild.togglePush()}
          trackColor={{ true: colors.green, false: colors.line }} accessibilityLabel={t(lang, "pushRemote")} />
      </View>
      {guild.pushNotice ? <Text accessibilityRole="alert" style={common.muted}>{guild.pushNotice}</Text> : null}
      {PUSH_ROWS.map((key) => <View key={key} style={common.row}>
        <Text style={[common.body, { flex: 1 }]}>{t(lang, key)}</Text>
        <Switch value={false} disabled trackColor={{ true: colors.green, false: colors.line }} accessibilityLabel={t(lang, key)} />
      </View>)}
    </Card>
  </Screen>;
}
