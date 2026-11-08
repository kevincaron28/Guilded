import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { GuildedClient, type ManageView, type WishCharacter } from "../api";
import { t, type Lang } from "../i18n";
import type { Session } from "../storage";
import { Card, SegmentedTabs, colors, shownName } from "../ui";

// The wishlist (per character). Moved out of GuildScreen for the redesign (docs/plans/APP_REDESIGN.md):
// it belongs to Me, next to the badges. Same endpoint (/api/v1/manage) and the same behaviour.

export function Wishlist({ lang, preview, session, manage, error, onChange }: {
  lang: Lang; preview: boolean; session: Session | null; manage: ManageView | null; error?: string;
  onChange: (next: ManageView) => void;
}) {
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [item, setItem] = useState("");
  const [priority, setPriority] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeId = characterId ?? manage?.characters[0]?.id ?? null;
  const selected = manage?.characters.find((character) => character.id === activeId) ?? null;

  const applyLocal = (character: WishCharacter, nextList: WishCharacter["wishlist"]) => {
    if (!manage) return;
    onChange({ ...manage, characters: manage.characters.map((entry) => entry.id === character.id ? { ...entry, wishlist: nextList } : entry) });
  };

  const add = async () => {
    if (!selected || !item.trim()) return;
    const name = item.trim();
    setBusy(true);
    setNotice(null);
    try {
      if (preview || !session) {
        const without = selected.wishlist.filter((wish) => wish.itemName.toLowerCase() !== name.toLowerCase());
        applyLocal(selected, [...without, { itemName: name, priority }].sort((a, b) => a.priority - b.priority || a.itemName.localeCompare(b.itemName)));
      } else {
        const message = await new GuildedClient(session.apiOrigin, session.companionCredential).setWishlist(session.guildDiscordId, selected.id, name, priority);
        setNotice(message);
        const fresh = await new GuildedClient(session.apiOrigin, session.companionCredential).manage(session.guildDiscordId);
        onChange(fresh);
      }
      setItem("");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : t(lang, "add"));
    } finally { setBusy(false); }
  };

  const remove = async (wish: string) => {
    if (!selected) return;
    setNotice(null);
    try {
      if (preview || !session) applyLocal(selected, selected.wishlist.filter((entry) => entry.itemName !== wish));
      else if (session) {
        const message = await new GuildedClient(session.apiOrigin, session.companionCredential).removeWishlist(session.guildDiscordId, selected.id, wish);
        setNotice(message);
        onChange(await new GuildedClient(session.apiOrigin, session.companionCredential).manage(session.guildDiscordId));
      }
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : t(lang, "remove"));
    }
  };

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!manage) return null;
  return <>
    <Text style={styles.intro}>{t(lang, "wishlistIntro")}</Text>
    {selected ? <View style={styles.chips}><SegmentedTabs options={manage.characters.map((character) => ({ value: character.id, label: shownName(character) }))} value={selected.id} onChange={setCharacterId} /></View> : null}
    {notice ? <Text style={styles.muted}>{notice}</Text> : null}
    {selected && selected.wishlist.length === 0 ? <Text style={styles.muted}>{t(lang, "noWishes")}</Text> : selected?.wishlist.map((wish) => <View key={wish.itemName} style={styles.row}>
      <Text style={[styles.body, { flex: 1 }]}>{wish.priority}. {wish.itemName}</Text>
      <Pressable onPress={() => void remove(wish.itemName)}><Text style={styles.textButtonLabel}>{t(lang, "remove")}</Text></Pressable>
    </View>)}
    {selected ? <Card style={styles.form}>
      <TextInput value={item} onChangeText={setItem} placeholder={t(lang, "itemPlaceholder")} placeholderTextColor={colors.muted} style={styles.input} />
      <Text style={styles.label}>{t(lang, "priority")}</Text>
      <SegmentedTabs options={[1, 2, 3].map((value) => ({ value, label: String(value) }))} value={priority} onChange={setPriority} />
      <Pressable onPress={() => void add()} disabled={busy || !item.trim()} style={styles.primary}><Text style={styles.primaryText}>{t(lang, "add")}</Text></Pressable>
    </Card> : null}
  </>;
}

const styles = StyleSheet.create({
  intro: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 4 },
  error: { color: colors.error, fontSize: 14, lineHeight: 20, marginTop: 12 },
  label: { color: colors.gold, fontSize: 10, letterSpacing: 1.4, fontWeight: "700", marginTop: 18 },
  chips: { paddingVertical: 12 },
  form: { marginTop: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderColor: colors.line, paddingVertical: 12 },
  textButtonLabel: { color: colors.gold, fontSize: 13, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, color: colors.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, marginTop: 8 },
  primary: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 16, paddingHorizontal: 16 },
  primaryText: { color: colors.ink, fontWeight: "700", fontSize: 15 }
});
