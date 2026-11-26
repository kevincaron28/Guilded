import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ApiError, GuildedClient, type HubView, type ReserveAnswer } from "../api";
import { errorText } from "../errors";
import { t, type Lang } from "../i18n";
import { clearSession, type Session } from "../storage";
import { colors, shownName } from "../ui";
import { common } from "../ui/common";

/** Ask for a soft reserve on the open list, or take one of mine back. The loot keeper's game applies it at the next /reload. */
export function ReserveForm({ lang, hub, session, onChanged }: { lang: Lang; hub: HubView; session: Session; onChanged: (() => void) | undefined }) {
  const characters = hub.characters.filter((character) => character.current);
  const [picked, setPicked] = useState<string | null>(null);
  const [item, setItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const sending = useRef(false);
  const character = characters.find((row) => row.id === picked) ?? characters.find((row) => row.isMain) ?? characters[0];
  if (!character || !hub.reserves.remote) return null;
  const same = (name: string) => name.toLowerCase() === character.name.toLowerCase();
  const waiting = hub.reserves.remote.pending.filter((row) => same(row.character));
  const listed = hub.reserves.items.filter((row) => row.characters.some(same) && !waiting.some((wanted) => wanted.itemName === row.itemName));
  const answer = (outcome: ReserveAnswer) => {
    const values = { item: outcome.itemName };
    if (outcome.kind === "cancelled") return t(lang, "reserveCancelled", values);
    if (outcome.kind === "kept") return t(lang, "reserveKept", values);
    if (outcome.kind === "removal") return t(lang, "reserveRemoval", values);
    return [t(lang, "reserveAsked", values), outcome.replaced ? t(lang, "reserveReplaced") : null, outcome.known ? null : t(lang, "reserveByHand")].filter(Boolean).join(" ");
  };
  const send = async (wanted: string, remove: boolean) => {
    if (sending.current || !wanted.trim()) return;
    sending.current = true; setBusy(true); setDone(null); setProblem(null);
    try {
      setDone(answer(await new GuildedClient(session.apiOrigin, session.companionCredential).reserve(session.guildDiscordId, character.id, wanted.trim(), remove)));
      if (!remove) setItem("");
      onChanged?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await clearSession();
      setProblem(errorText(error, lang, t(lang, "reserveNotSent")));
    } finally { sending.current = false; setBusy(false); }
  };
  const row = (key: string, label: string, name: string, remove: boolean) => <View key={key} style={common.row}>
    <Text style={[common.body, { flex: 1 }]}>{label}</Text>
    <Pressable onPress={() => void send(name, remove)} disabled={busy} accessibilityRole="button" accessibilityLabel={`${t(lang, remove ? "remove" : "reserveSend")} ${name}`}
      accessibilityState={{ disabled: busy }} style={common.textButton}><Text style={common.textButtonLabel}>{t(lang, remove ? "remove" : "reserveSend")}</Text></Pressable>
  </View>;
  return <View style={common.hero}>
    {characters.length > 1 ? <View style={common.chips}>{characters.map((value) => <Pressable key={value.id} onPress={() => { setPicked(value.id); setDone(null); setProblem(null); }}
      accessibilityRole="button" accessibilityState={{ selected: value.id === character.id }} style={[common.chip, value.id === character.id && common.chipOn]}>
      <Text style={[common.chipText, value.id === character.id && common.chipTextOn]}>{shownName(value)}</Text>
    </Pressable>)}</View> : <Text style={common.heroTitle}>{shownName(character)}</Text>}
    <TextInput value={item} onChangeText={setItem} placeholder={t(lang, "reserveItem")} placeholderTextColor={colors.muted} accessibilityLabel={t(lang, "reserveItem")}
      autoCorrect={false} maxLength={300} style={common.input} />
    <Pressable onPress={() => void send(item, false)} disabled={busy || !item.trim()} accessibilityRole="button" accessibilityState={{ disabled: busy || !item.trim() }}
      style={[common.primary, (busy || !item.trim()) && common.disabled]}><Text style={common.primaryText}>{t(lang, "reserveSend")}</Text></Pressable>
    {done ? <Text style={common.body} accessibilityLiveRegion="polite">{done}</Text> : null}
    {problem ? <Text style={common.error} accessibilityRole="alert">{problem}</Text> : null}
    {listed.map((entry) => row(`listed-${entry.itemName}`, entry.itemName, entry.itemName, true))}
    {waiting.length ? <Text style={common.label}>{t(lang, "reserveWaiting")}</Text> : null}
    {/* A waiting addition is cancelled by removing it; a waiting removal is taken back by reserving again. */}
    {waiting.map((entry) => row(`waiting-${entry.itemName}-${entry.remove}`, entry.remove ? `${entry.itemName} (${t(lang, "reserveToRemove")})` : entry.itemName, entry.itemName, !entry.remove))}
  </View>;
}
