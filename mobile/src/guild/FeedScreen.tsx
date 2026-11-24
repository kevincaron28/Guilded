import { ActivityIndicator, Text, View } from "react-native";
import { ApiError, GuildedClient } from "../api";
import { guildCacheKey } from "../cache";
import { byDay, feedLine, parseFeed, type Feed, type FeedItem } from "../feed";
import type { Lang } from "../i18n";
import { sampleFeed } from "../sample";
import { clearSession, type Session } from "../storage";
import { EmptyState, LastUpdated, RetryCard, colors } from "../ui";
import { common } from "../ui/common";
import { useCachedResource } from "../useCachedResource";

// Guild tab, Activity part (phone app 0.6.0): joins, departures, rank changes, guild bank gifts and raid kills of the last two weeks.

const words = {
  intro: { en: "What happened in the guild over the last {days} days: who joined or left, rank changes, gifts to the guild bank and raid kills. Officers' addons report the guild log; only members of this guild see it.", fr: "Ce qui s'est passé dans la guilde ces {days} derniers jours : arrivées, départs, changements de rang, dons à la banque de guilde et victoires en raid. Les addons des officiers envoient le journal de la guilde; seuls les membres de cette guilde le voient." },
  empty: { en: "Nothing yet. The guild log arrives when an officer's companion uploads.", fr: "Rien pour l'instant. Le journal de la guilde arrive quand le compagnon d'un officier fait un envoi." },
  failed: { en: "The guild activity is unavailable right now.", fr: "L'activité de la guilde est indisponible pour le moment." }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

const isFeed = (data: unknown): data is Feed => typeof data === "object" && data !== null && Array.isArray((data as Feed).items);
const DOT: Record<FeedItem["kind"], string> = { join: colors.green, leave: colors.muted, removed: colors.error, promote: colors.gold, demote: colors.muted, donation: colors.gold, raidKill: colors.green };

/** `session` null: the sample guild's made-up feed. */
export function FeedScreen({ lang, session }: { lang: Lang; session: Session | null }) {
  const feed = useCachedResource<Feed>(session ? guildCacheKey(session.guildDiscordId, "feed") : "sample.feed", async () => {
    if (!session) return sampleFeed();
    try { return parseFeed(await new GuildedClient(session.apiOrigin, session.companionCredential).guildFeed(session.guildDiscordId)); }
    catch (error) { if (error instanceof ApiError && error.status === 401) await clearSession(); throw error; }
  }, isFeed);
  const data = feed.data;
  return <>
    <Text style={common.muted}>{w("intro", lang).replace("{days}", String(data?.days ?? 14))}</Text>
    {session ? <LastUpdated lang={lang} savedAt={feed.savedAt} stale={feed.stale && feed.failed} /> : null}
    {!data && feed.failed ? <RetryCard lang={lang} message={w("failed", lang)} onRetry={feed.retry} />
      : !data ? <ActivityIndicator color={colors.gold} style={{ marginVertical: 16 }} />
      : data.items.length === 0 ? <EmptyState art="guild" boxed message={w("empty", lang)} />
      : byDay(data.items, lang).map((group) => <View key={group.day} style={common.hero}>
        <Text style={common.label}>{group.day.toUpperCase()}</Text>
        {group.items.map((item, i) => <View key={`${item.at}-${item.kind}-${i}`} style={[common.row, { alignItems: "flex-start" }]} accessible accessibilityLabel={feedLine(item, lang)}>
          <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, marginRight: 10, backgroundColor: DOT[item.kind] }} />
          <View style={{ flex: 1 }}>
            <Text style={common.body}>{feedLine(item, lang)}</Text>
            <Text style={common.muted}>{new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(item.at))}</Text>
          </View>
        </View>)}
      </View>)}
  </>;
}
