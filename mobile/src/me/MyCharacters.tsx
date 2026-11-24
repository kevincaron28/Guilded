import { errorText } from "../errors";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { ApiError, GuildedClient } from "../api";
import { guildCacheKey } from "../cache";
import { classLabel, type Lang } from "../i18n";
import { clearSession, type Session } from "../storage";
import { Card, ClassName, EmptyState, LastUpdated, RetryCard, colors } from "../ui";
import { common } from "../ui/common";
import { useCachedResource } from "../useCachedResource";
import { isMeCharacters, parseMeCharacters, type MeCharacter } from "./meData";

const words = {
  title: { en: "My characters", fr: "Mes personnages" },
  intro: { en: "Every character linked to you, with its Discord server and in-game guild rank.", fr: "Tous les personnages liés à toi, avec leur serveur Discord et leur rang dans la guilde en jeu." },
  main: { en: "Main", fr: "Principal" },
  alt: { en: "Alt", fr: "Alt" },
  makeMain: { en: "Make main", fr: "Rendre principal" },
  details: { en: "Details", fr: "Détails" },
  unlink: { en: "Unlink", fr: "Délier" },
  server: { en: "Discord server", fr: "Serveur Discord" },
  inGame: { en: "In-game guild", fr: "Guilde en jeu" },
  notSeen: { en: "not seen in the roster", fr: "absent de la liste" },
  rank: { en: "Rank", fr: "Rang" },
  level: { en: "Level", fr: "Niveau" },
  confirmed: { en: "Confirmed", fr: "Confirmé" },
  reported: { en: "Reported", fr: "Rapporté" },
  empty: { en: "No linked character yet. Send the Guilded bot your character's full name in a Discord message, or sign the Windows companion in.", fr: "Aucun personnage lié. Envoie au bot Guilded le nom complet du personnage en message privé Discord, ou connecte le compagnon Windows." },
  failed: { en: "Your characters are unavailable right now.", fr: "Tes personnages sont indisponibles pour le moment." },
  unlinkTitle: { en: "Unlink this character?", fr: "Délier ce personnage ?" },
  unlinkBody: { en: "{name} leaves your list on this Discord server. Its history is kept and the officers see a line in the log. You can link it back later with /character list in Discord.", fr: "{name} quitte ta liste sur ce serveur Discord. Son historique est conservé et les officiers voient une ligne dans le journal. Tu pourras le relier plus tard avec /character list dans Discord." },
  cancel: { en: "Keep it", fr: "Le garder" },
  yesUnlink: { en: "Yes, unlink", fr: "Oui, délier" },
  changed: { en: "Done.", fr: "C'est fait." },
  notSaved: { en: "That could not be done right now. Try again later.", fr: "Impossible pour le moment. Réessaie plus tard." }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

/** My characters (0.5.0): the member's own characters with their server and rank, Make main, and Unlink after a confirmation. Signed-in only. */
export function MyCharacters({ lang, session, onOpen }: { lang: Lang; session: Session; /** 0.6.0: opens the character's page (ranks, runs, duels). */ onOpen?: (character: MeCharacter) => void }) {
  const feed = useCachedResource<MeCharacter[]>(guildCacheKey("me", "characters"), async () => parseMeCharacters(await new GuildedClient(session.apiOrigin, session.companionCredential).meCharacters()), isMeCharacters);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const sending = useRef(false);

  const run = async (action: "main" | "unlink", id: string) => {
    if (sending.current) return;
    sending.current = true; setBusy(id); setProblem(null);
    try {
      await new GuildedClient(session.apiOrigin, session.companionCredential).changeCharacter(action, id);
      await feed.reload();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await clearSession();
      setProblem(error instanceof ApiError && error.status === 403 ? w("notSaved", lang) : errorText(error, lang, w("notSaved", lang)));
    } finally { sending.current = false; setBusy(null); }
  };
  const confirmUnlink = (character: MeCharacter) => Alert.alert(w("unlinkTitle", lang), w("unlinkBody", lang).replace("{name}", character.name), [
    { text: w("cancel", lang), style: "cancel" },
    { text: w("yesUnlink", lang), style: "destructive", onPress: () => void run("unlink", character.id) }
  ]);

  const characters = feed.data;
  return <View>
    <Text style={common.label}>{w("title", lang).toUpperCase()}</Text>
    <Text style={common.muted}>{w("intro", lang)}</Text>
    {!characters && feed.failed ? <RetryCard lang={lang} message={w("failed", lang)} onRetry={feed.retry} />
      : !characters ? <ActivityIndicator color={colors.gold} style={{ marginVertical: 16 }} />
      : characters.length === 0 ? <EmptyState art="guild" message={w("empty", lang)} />
      : characters.map((character) => <Card key={character.id} edge={null} style={styles.card}>
        <View style={common.titleRow}>
          <ClassName name={character.name} className={character.className} style={{ fontSize: 16, flex: 1 }} />
          <Text style={common.pill}>{character.isMain ? w("main", lang) : w("alt", lang)}</Text>
        </View>
        <Text style={common.muted}>{[classLabel(character.className, lang), character.level ? `${w("level", lang)} ${character.level}` : null, character.trusted ? w("confirmed", lang) : w("reported", lang)].filter(Boolean).join(" · ")}</Text>
        <Text style={common.body}>{w("server", lang)}: {character.serverName || "-"}</Text>
        <Text style={common.body}>{w("inGame", lang)}: {character.inGuild && character.serverName ? `${character.serverName}${character.guildRank ? ` · ${w("rank", lang)} ${character.guildRank}` : ""}` : w("notSeen", lang)}</Text>
        <View style={styles.actions}>
          {onOpen ? <Pressable onPress={() => onOpen(character)} accessibilityRole="button" accessibilityLabel={`${w("details", lang)}, ${character.name}`} style={styles.action}>
            <Text style={common.textButtonLabel}>{w("details", lang)}</Text>
          </Pressable> : null}
          {character.isMain ? null : <Pressable onPress={() => void run("main", character.id)} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`${w("makeMain", lang)}, ${character.name}`} accessibilityState={{ disabled: busy !== null }} style={[styles.action, busy !== null && common.disabled]}>
            <Text style={common.textButtonLabel}>{busy === character.id ? "…" : w("makeMain", lang)}</Text>
          </Pressable>}
          <Pressable onPress={() => confirmUnlink(character)} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`${w("unlink", lang)}, ${character.name}`} accessibilityState={{ disabled: busy !== null }} style={[styles.action, busy !== null && common.disabled]}>
            <Text style={[common.textButtonLabel, { color: colors.error }]}>{w("unlink", lang)}</Text>
          </Pressable>
        </View>
      </Card>)}
    {problem ? <Text accessibilityRole="alert" style={common.error}>{problem}</Text> : null}
    <LastUpdated lang={lang} savedAt={feed.savedAt} stale={feed.stale && feed.failed} />
  </View>;
}

const styles = StyleSheet.create({
  card: { marginTop: 8 },
  actions: { flexDirection: "row", gap: 20, marginTop: 4 },
  action: { minHeight: 44, justifyContent: "center" }
});
