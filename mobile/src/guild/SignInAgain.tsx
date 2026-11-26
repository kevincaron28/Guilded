import { Pressable, Text } from "react-native";
import { t } from "../i18n";
import type { GuildState } from "../useGuild";
import { common } from "../ui/common";

/** For a personal sign-in (public boards only): signs out so the Discord sign-in, with its server choice, can start again. */
export function SignInAgain({ guild, onDone }: { guild: GuildState; onDone?: () => void }) {
  return <Pressable onPress={() => void guild.leave().then(() => onDone?.())} accessibilityRole="button" accessibilityLabel={t(guild.lang, "signInAgain")} style={common.primary}>
    <Text style={common.primaryText}>{t(guild.lang, "signInAgain")}</Text>
  </Pressable>;
}
