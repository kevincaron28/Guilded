import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { GuildedClient } from "../api";
import { guildCacheKey } from "../cache";
import type { Lang } from "../i18n";
import type { Session } from "../storage";
import { Card, LastUpdated, RetryCard, colors } from "../ui";
import { common } from "../ui/common";
import { useCachedResource } from "../useCachedResource";
import { isPromotion, parsePromotion, promotionChecklist, type PromotionServer } from "./meData";

const words = {
  title: { en: "What I still need to be promoted", fr: "Ce qu'il me reste pour être promu" },
  off: { en: "The promotion rule is switched off on this server.", fr: "La règle de promotion est désactivée sur ce serveur." },
  above: { en: "You are already {rank}. Nothing left to do.", fr: "Vous êtes déjà {rank}. Il ne reste rien à faire." },
  ready: { en: "You are on the list to be promoted at the next officer pass.", fr: "Vous êtes sur la liste pour être promu à la prochaine passe des officiers." },
  notYet: { en: "Not yet: finish the items marked as missing.", fr: "Pas encore : terminez les points marqués comme manquants." },
  linkHow: { en: "Link a character: send its full name (First Last) to the Guilded bot in a Discord message, or type it in the guild-invite channel.", fr: "Liez un personnage : envoyez son nom complet (Prénom Nom) au bot Guilded en message privé Discord, ou écrivez-le dans le salon d'invitation." },
  solo: { en: "Time alone in a voice channel counts.", fr: "Le temps seul dans un salon vocal compte." },
  failed: { en: "Promotion status is unavailable right now.", fr: "Le statut de promotion est indisponible pour le moment." },
  ok: { en: "Done", fr: "Fait" },
  missing: { en: "Missing", fr: "Manque" }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

/** "What I still need to be promoted" (0.5.0): the member's own progress toward each server's promotion rule. Signed-in only. */
export function PromotionCard({ lang, session }: { lang: Lang; session: Session }) {
  const feed = useCachedResource<PromotionServer[]>(guildCacheKey("me", "promotion"), async () => parsePromotion(await new GuildedClient(session.apiOrigin, session.companionCredential).mePromotion()), isPromotion);
  const servers = feed.data;
  // Nothing to show on a server that has no promotion at all (an empty list); the card then stays out of the way.
  if (servers && servers.length === 0) return null;
  return <View>
    <Text style={common.label}>{w("title", lang).toUpperCase()}</Text>
    {!servers && feed.failed ? <RetryCard lang={lang} message={w("failed", lang)} onRetry={feed.retry} />
      : !servers ? <ActivityIndicator color={colors.gold} style={{ marginVertical: 16 }} />
      : servers.map((server) => <ServerProgress key={server.guildDiscordId || server.serverName} server={server} lang={lang} showName={servers.length > 1} />)}
    <LastUpdated lang={lang} savedAt={feed.savedAt} stale={feed.stale && feed.failed} />
  </View>;
}

function ServerProgress({ server, lang, showName }: { server: PromotionServer; lang: Lang; showName: boolean }) {
  const lines = promotionChecklist(server, lang);
  return <Card edge={server.ready || server.state === "above" ? colors.green : colors.gold} style={styles.card}>
    {showName ? <Text style={common.heroTitle}>{server.serverName}</Text> : null}
    {server.state === "off" ? <Text style={common.muted}>{w("off", lang)}</Text>
      : server.state === "above" ? <Text style={common.body}>{w("above", lang).replace("{rank}", server.rank ?? "")}</Text>
      : <>
        {lines.map((line) => <View key={line.key} style={styles.line} accessible accessibilityLabel={`${line.label}: ${line.value}, ${line.done ? w("ok", lang) : w("missing", lang)}`}>
          <Text style={[styles.mark, { color: line.done ? colors.green : colors.error }]}>{line.done ? "✓" : "✗"}</Text>
          <Text style={styles.label}>{line.label}</Text>
          <Text style={styles.value}>{line.value}</Text>
        </View>)}
        {server.minVoiceMinutes > 0 ? <Text style={common.muted}>{w("solo", lang)}</Text> : null}
        {server.requireLink && !server.linked ? <Text style={common.muted}>{w("linkHow", lang)}</Text> : null}
        <Text style={[common.body, { color: server.ready ? colors.green : colors.text }]}>{server.ready ? w("ready", lang) : w("notYet", lang)}</Text>
      </>}
  </Card>;
}

const styles = StyleSheet.create({
  card: { marginTop: 8 },
  line: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 },
  mark: { fontSize: 16, fontWeight: "700", width: 18 },
  label: { color: colors.text, fontSize: 14, flex: 1 },
  value: { color: colors.muted, fontSize: 14, textAlign: "right", flexShrink: 1 }
});
