import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SignupClosedError } from "../api";
import { errorText } from "../errors";
import { t, roleLabel, type Lang } from "../i18n";
import { closed, type Choice, type MySignup, type RaidRoleName } from "../signups";
import { common } from "../ui/common";

const chip = { paddingHorizontal: 12 } as const;
const wrap = { flexWrap: "wrap" } as const;
const ROLES: RaidRoleName[] = ["TANK", "HEALER", "DPS"];
const CHOICES: { choice: Choice; label: "signupYes" | "signupMaybe" | "signupNo" }[] = [
  { choice: "YES", label: "signupYes" }, { choice: "MAYBE", label: "signupMaybe" }, { choice: "NO", label: "signupNo" }
];
const chosen = (signup: MySignup | undefined): Choice | null =>
  signup?.status === "SIGNED_UP" || signup?.status === "WAITLISTED" ? "YES" : signup?.status === "MAYBE" ? "MAYBE" : signup?.status === "CANCELLED" ? "NO" : null;

/**
 * My answer on one raid: a role, then I'm in / Maybe / Can't come. The server applies the Discord post's own rules, so the
 * answer can come back as "waitlisted" or be refused (deadline, full role); the line under the buttons says which.
 */
export function RaidAnswer({ lang, raidId, mine, onAnswer }: { lang: Lang; raidId: string; mine: MySignup | undefined; onAnswer: (raidId: string, choice: Choice, role?: RaidRoleName) => Promise<MySignup> }) {
  const [role, setRole] = useState<RaidRoleName | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sending = useRef(false);
  const current = chosen(mine);
  const shownRole = role ?? mine?.role ?? "DPS";
  const shut = closed(mine);
  const send = async (choice: Choice) => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setProblem(null);
    try { await onAnswer(raidId, choice, role ?? undefined); }
    catch (error) { setProblem(error instanceof SignupClosedError ? t(lang, "signupClosed") : errorText(error, lang, t(lang, "signupFailed"))); }
    finally { sending.current = false; setBusy(false); }
  };
  const status = mine?.status === "WAITLISTED" ? t(lang, "signupWaitlisted", { role: roleLabel(mine.role ?? "DPS", lang) })
    : mine?.status === "SIGNED_UP" ? t(lang, "signupDone", { role: roleLabel(mine.role ?? "DPS", lang) })
    : mine?.status === "MAYBE" ? t(lang, "signupMaybeDone") : mine?.status === "CANCELLED" ? t(lang, "signupNoDone") : null;
  return <View style={{ gap: 8, marginTop: 8 }}>
    {shut ? <Text style={common.muted}>{t(lang, "signupClosed")}</Text> : <>
      <View style={[common.langRow, wrap]} accessibilityRole="radiogroup" accessibilityLabel={t(lang, "signupRole")}>
        {ROLES.map((value) => <Pressable key={value} onPress={() => setRole(value)} disabled={busy} accessibilityRole="radio" accessibilityState={{ selected: shownRole === value, disabled: busy }}
          accessibilityLabel={roleLabel(value, lang)} style={[common.lang, chip, shownRole === value && common.langOn]}>
          <Text style={[common.langText, shownRole === value && common.langTextOn]}>{roleLabel(value, lang)}</Text>
        </Pressable>)}
      </View>
      <View style={[common.langRow, wrap]}>
        {CHOICES.map(({ choice, label }) => <Pressable key={choice} onPress={() => void send(choice)} disabled={busy} accessibilityRole="button" accessibilityLabel={t(lang, label)}
          accessibilityState={{ selected: current === choice, disabled: busy }} style={[common.lang, chip, current === choice && common.langOn]}>
          <Text style={[common.langText, current === choice && common.langTextOn]}>{t(lang, label)}</Text>
        </Pressable>)}
      </View>
    </>}
    {status ? <Text style={common.muted} accessibilityLiveRegion="polite">{status}</Text> : null}
    {problem ? <Text style={common.error} accessibilityRole="alert">{problem}</Text> : null}
  </View>;
}
