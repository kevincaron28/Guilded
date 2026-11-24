import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { cacheKey } from "../cache";
import { classLabel, formatWhen, t, type Lang } from "../i18n";
import { Card, ClassName, EmptyState, Glyph, LastUpdated, RankNumber, RetryCard, StatTile, colors } from "../ui";
import { common } from "../ui/common";
import { useBack } from "../useBack";
import { useCachedResource } from "../useCachedResource";
import { fetchDuelRecord, fetchStanding, runTime, type DuelRecord, type DungeonStanding } from "./characterData";

// "My character" (phone app 0.6.0), opened from My characters on the Me tab: dungeon rank per level bracket, recent rated runs,
// the duel record and a line about badges. Public numbers from the leaderboards (boards.json and duels.json with ?player=).

const words = {
  back: { en: "My characters", fr: "Mes personnages" },
  dungeons: { en: "DUNGEON RANK", fr: "RANG EN DONJON" },
  of: { en: "of {n}", fr: "sur {n}" },
  points: { en: "points", fr: "points" },
  noRank: { en: "No rated dungeon run this season yet.", fr: "Aucun donjon coté cette saison pour l'instant." },
  runs: { en: "RECENT RUNS", fr: "DONJONS RÉCENTS" },
  unrated: { en: "not rated", fr: "non coté" },
  duels: { en: "DUELS", fr: "DUELS" },
  noDuels: { en: "No counted duel yet.", fr: "Aucun duel compté pour l'instant." },
  rating: { en: "rating", fr: "cote" },
  record: { en: "W-L", fr: "V-D" },
  rankLabel: { en: "rank", fr: "rang" },
  best: { en: "best streak", fr: "meilleure série" },
  badges: { en: "Badges are shared by all your characters: see the album below My characters.", fr: "Les badges sont communs à tous tes personnages : vois l'album sous Mes personnages." },
  failed: { en: "This character's numbers are unavailable right now.", fr: "Les chiffres de ce personnage sont indisponibles pour le moment." }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

type Numbers = { standing: DungeonStanding | null; duels: DuelRecord | null };
const isNumbers = (data: unknown): data is Numbers => typeof data === "object" && data !== null && "standing" in data && "duels" in data;

export function CharacterPage({ lang, origin, name, className, level, onBack }: { lang: Lang; origin: string; name: string; className: string | null; level: number | null; onBack: () => void }) {
  useBack(true, onBack);
  const feed = useCachedResource<Numbers>(cacheKey("character", origin, lang, name.toLowerCase()), async () => {
    const [standing, duels] = await Promise.all([fetchStanding(origin, name, lang), fetchDuelRecord(origin, name, lang)]);
    return { standing, duels };
  }, isNumbers);
  const data = feed.data;
  return <>
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={w("back", lang)} style={[common.textButton, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
      <Glyph name="back" /><Text style={common.textButtonLabel}>{w("back", lang)}</Text>
    </Pressable>
    <ClassName name={name} className={className} style={{ fontSize: 26, fontWeight: "700" }} />
    <Text style={common.muted}>{[classLabel(className, lang), level ? `${t(lang, "level")} ${level}` : null, data?.standing?.season].filter(Boolean).join(" · ")}</Text>
    <LastUpdated lang={lang} savedAt={feed.savedAt} stale={feed.stale && feed.failed} />
    {!data && feed.failed ? <RetryCard lang={lang} message={w("failed", lang)} onRetry={feed.retry} />
      : !data ? <ActivityIndicator color={colors.gold} style={{ marginVertical: 16 }} />
      : <>
        <Text style={common.label}>{w("dungeons", lang)}</Text>
        {!data.standing || data.standing.brackets.length === 0 ? <EmptyState art="runs" boxed message={w("noRank", lang)} /> : <Card>
          {data.standing.brackets.map((b) => <View key={b.key} style={common.row} accessible accessibilityLabel={`${b.name}, #${b.rank} ${w("of", lang).replace("{n}", String(b.of))}, ${b.points} ${w("points", lang)}`}>
            <RankNumber rank={b.rank} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={common.body}>{b.name}</Text>
              <Text style={common.muted}>{`#${b.rank} ${w("of", lang).replace("{n}", String(b.of))}`}</Text>
            </View>
            <Text style={[common.body, { color: colors.green, fontWeight: "700" }]}>{b.points}</Text>
          </View>)}
        </Card>}
        {data.standing && data.standing.runs.length ? <>
          <Text style={common.label}>{w("runs", lang)}</Text>
          <Card>{data.standing.runs.map((run, i) => <View key={`${run.endedAt}-${i}`} style={common.row}>
            <View style={{ flex: 1 }}>
              <Text style={common.body}>{run.dungeon}</Text>
              <Text style={common.muted}>{[formatWhen(run.endedAt, lang), run.bracket, runTime(run.durationSec)].filter(Boolean).join(" · ")}</Text>
            </View>
            <Text style={[common.body, { color: run.points ? colors.green : colors.muted }]}>{run.points ?? w("unrated", lang)}</Text>
          </View>)}</Card>
        </> : null}
        <Text style={common.label}>{w("duels", lang)}</Text>
        {!data.duels ? <EmptyState art="duel" boxed message={w("noDuels", lang)} /> : <Card>
          <View style={{ flexDirection: "row", gap: 32, flexWrap: "wrap" }}>
            <StatTile value={data.duels.rating} label={w("rating", lang)} />
            <StatTile value={`${data.duels.wins}-${data.duels.losses}`} label={w("record", lang)} />
            {data.duels.rank ? <StatTile value={`#${data.duels.rank}`} label={w("rankLabel", lang)} /> : null}
            <StatTile value={data.duels.bestStreak} label={w("best", lang)} />
          </View>
        </Card>}
        <Text style={common.muted}>{w("badges", lang)}</Text>
      </>}
  </>;
}
