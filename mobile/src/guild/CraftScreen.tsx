import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { ApiError, GuildedClient } from "../api";
import { parseCrafting, professionLabel, sampleCrafting, type CraftableItem, type Crafting } from "../crafting";
import { errorText } from "../errors";
import type { Lang } from "../i18n";
import { clearSession, type Session } from "../storage";
import { Card, EmptyState, colors } from "../ui";
import { common } from "../ui/common";

// Guild tab, Crafting part (phone app 0.6.0): search who in the guild can make an item, ask for it, see my open requests.
// The request is the same as /craft request in Discord and the addon's Request button: posted on the craft board,
// shown on every guild addon's Orders page, claimed and finished by a crafter in game or in Discord.

const words = {
  intro: { en: "Search an item to see who in the guild can make it, from the recipes their addons scanned. Your request goes to the craft board and every guildmate's Orders page in game.", fr: "Cherche un objet pour voir qui dans la guilde peut le fabriquer, d'après les recettes lues par leurs addons. Ta demande va au tableau d'artisanat et à la page Commandes de chaque membre en jeu." },
  search: { en: "Item name", fr: "Nom de l'objet" },
  short: { en: "Type at least two letters.", fr: "Tape au moins deux lettres." },
  none: { en: "Nobody in the guild has this recipe yet (or their addon has not scanned it).", fr: "Personne dans la guilde n'a encore cette recette (ou son addon ne l'a pas lue)." },
  quantity: { en: "Quantity", fr: "Quantité" },
  ask: { en: "Ask for it", fr: "Le demander" },
  anyone: { en: "Anyone", fr: "N'importe qui" },
  note: { en: "Note for the crafter (optional)", fr: "Note pour l'artisan (facultatif)" },
  sent: { en: "Request sent. A crafter will claim it in game or in Discord.", fr: "Demande envoyée. Un artisan la prendra en jeu ou dans Discord." },
  sampleSent: { en: "Sample guild: nothing was sent.", fr: "Guilde d'exemple : rien n'a été envoyé." },
  mine: { en: "MY OPEN REQUESTS", fr: "MES DEMANDES OUVERTES" },
  noMine: { en: "No open request.", fr: "Aucune demande ouverte." },
  open: { en: "waiting for a crafter", fr: "en attente d'un artisan" },
  claimed: { en: "claimed by {name}", fr: "prise par {name}" },
  forYou: { en: "you are crafting it", fr: "tu la fabriques" },
  failed: { en: "Crafting is unavailable right now.", fr: "L'artisanat est indisponible pour le moment." },
  notSent: { en: "That request was not sent.", fr: "Cette demande n'a pas été envoyée." },
  cancelIt: { en: "Cancel request", fr: "Annuler la demande" },
  confirmCancel: { en: "Tap again to cancel", fr: "Touche encore pour annuler" },
  cancelled: { en: "Request cancelled.", fr: "Demande annulée." },
  notCancelled: { en: "That request was not cancelled.", fr: "Cette demande n'a pas été annulée." }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

/** `session` null: the sample guild (made-up crafters, nothing is sent). */
export function CraftScreen({ lang, session }: { lang: Lang; session: Session | null }) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Crafting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<CraftableItem | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const latest = useRef(0);
  // Cancelling takes two taps: the first arms the button for that request.
  const [arming, setArming] = useState<string | null>(null);
  const cancelling = useRef(false);
  const cancelRequest = async (id: string) => {
    if (arming !== id) { setArming(id); return; }
    if (cancelling.current) return;
    cancelling.current = true; setDone(null); setError(null);
    try {
      if (session) await new GuildedClient(session.apiOrigin, session.companionCredential).cancelCraft(session.guildDiscordId, id);
      setDone(session ? w("cancelled", lang) : w("sampleSent", lang));
      setReload((n) => n + 1);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await clearSession();
      setError(errorText(e, lang, w("notCancelled", lang)));
    } finally { cancelling.current = false; setArming(null); }
  };
  // Searches 400 ms after the last key, and loads my requests on open; an older answer never replaces a newer one.
  useEffect(() => {
    const request = ++latest.current;
    const timer = setTimeout(() => {
      if (!session) { setData(sampleCrafting(query)); return; }
      setLoading(true);
      new GuildedClient(session.apiOrigin, session.companionCredential).crafting(session.guildDiscordId, query.trim())
        .then((body) => { if (request === latest.current) { setData(parseCrafting(body)); setError(null); } })
        .catch(async (e: unknown) => {
          if (e instanceof ApiError && e.status === 401) await clearSession();
          if (request === latest.current) setError(errorText(e, lang, w("failed", lang)));
        })
        .finally(() => { if (request === latest.current) setLoading(false); });
    }, query ? 400 : 0);
    return () => clearTimeout(timer);
  }, [session, query, lang, reload]);

  const typed = query.trim().length;
  return <>
    <Text style={common.muted}>{w("intro", lang)}</Text>
    <TextInput value={query} onChangeText={(text) => { setQuery(text); setPicked(null); setDone(null); }} placeholder={w("search", lang)} placeholderTextColor={colors.muted}
      accessibilityLabel={w("search", lang)} autoCorrect={false} maxLength={60} style={common.input} />
    {loading && !data ? <ActivityIndicator color={colors.gold} /> : null}
    {error ? <Text accessibilityRole="alert" style={common.error}>{error}</Text> : null}
    {done ? <Text accessibilityRole="alert" style={common.body}>{done}</Text> : null}
    {typed > 0 && typed < 2 ? <Text style={common.muted}>{w("short", lang)}</Text> : null}
    {typed >= 2 && data && data.items.length === 0 && !loading ? <EmptyState art="search" boxed message={w("none", lang)} /> : null}
    {typed >= 2 ? data?.items.map((item) => picked?.itemKey === item.itemKey
      ? <AskCard key={item.itemKey} lang={lang} item={item} session={session} onCancel={() => setPicked(null)}
        onSent={() => { setPicked(null); setDone(session ? w("sent", lang) : w("sampleSent", lang)); setReload((n) => n + 1); }} />
      : <Pressable key={item.itemKey} onPress={() => { setPicked(item); setDone(null); }} accessibilityRole="button" accessibilityLabel={`${item.itemName}, ${item.crafters.join(", ")}`} style={common.row}>
        <View style={{ flex: 1 }}>
          <Text style={common.body}>{item.itemName}</Text>
          <Text style={common.muted}>{[professionLabel(item.profession, lang), item.crafters.join(", ")].filter(Boolean).join(" · ")}</Text>
        </View>
        <Text style={common.textButtonLabel}>{w("ask", lang)}</Text>
      </Pressable>) : null}
    <Text style={common.label}>{w("mine", lang)}</Text>
    {!data ? null : data.requests.length === 0 ? <Text style={common.muted}>{w("noMine", lang)}</Text> : data.requests.map((row) => <View key={row.id} style={common.row}>
      <View style={{ flex: 1 }}>
        <Text style={common.body}>{row.quantity > 1 ? `${row.quantity} × ` : ""}{row.item}</Text>
        <Text style={common.muted}>{!row.mine ? w("forYou", lang) : row.status === "CLAIMED" ? w("claimed", lang).replace("{name}", row.crafter ?? "?") : w("open", lang)}</Text>
      </View>
      {row.mine ? <Pressable onPress={() => void cancelRequest(row.id)} accessibilityRole="button" accessibilityLabel={`${w(arming === row.id ? "confirmCancel" : "cancelIt", lang)}, ${row.item}`} style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={common.textButtonLabel}>{w(arming === row.id ? "confirmCancel" : "cancelIt", lang)}</Text>
      </Pressable> : null}
    </View>)}
  </>;
}

function AskCard({ lang, item, session, onSent, onCancel }: { lang: Lang; item: CraftableItem; session: Session | null; onSent: () => void; onCancel: () => void }) {
  const [quantity, setQuantity] = useState(1);
  const [crafter, setCrafter] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const send = async () => {
    if (busy) return;
    if (!session) { onSent(); return; }
    setBusy(true); setProblem(null);
    try {
      await new GuildedClient(session.apiOrigin, session.companionCredential).requestCraft(session.guildDiscordId, item.itemKey, quantity, note.trim() || undefined, crafter ?? undefined);
      onSent();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await clearSession();
      setProblem(errorText(e, lang, w("notSent", lang)));
    } finally { setBusy(false); }
  };
  const chip = (label: string, on: boolean, press: () => void) => <Pressable key={label} onPress={press} accessibilityRole="button" accessibilityState={{ selected: on }}
    style={[common.chip, on && common.chipOn]}><Text style={[common.chipText, on && common.chipTextOn]}>{label}</Text></Pressable>;
  return <Card>
    <Text style={common.heroTitle}>{item.itemName}</Text>
    <Text style={common.muted}>{w("quantity", lang)}</Text>
    <View style={common.chips}>{[1, 2, 5, 10, 20].map((n) => chip(String(n), quantity === n, () => setQuantity(n)))}</View>
    <View style={common.chips}>{[chip(w("anyone", lang), crafter === null, () => setCrafter(null)), ...item.crafters.map((name) => chip(name, crafter === name, () => setCrafter(name)))]}</View>
    <TextInput value={note} onChangeText={setNote} placeholder={w("note", lang)} placeholderTextColor={colors.muted} accessibilityLabel={w("note", lang)} maxLength={300} style={common.input} />
    {problem ? <Text accessibilityRole="alert" style={common.error}>{problem}</Text> : null}
    <Pressable onPress={() => void send()} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }} style={[common.primary, busy && common.disabled]}>
      <Text style={common.primaryText}>{w("ask", lang)}</Text>
    </Pressable>
    <Pressable onPress={onCancel} accessibilityRole="button" style={common.secondary}><Text style={common.secondaryText}>{lang === "fr" ? "Annuler" : "Cancel"}</Text></Pressable>
  </Card>;
}
