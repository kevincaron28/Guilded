import { Linking, Pressable, Text, View } from "react-native";
import { discordEventLink, withMine, type CoreBoard, type HubView, type ManageView, type StandingsView } from "../api";
import { formatPr, formatWhen, lootModeLabel, roleLabel, t, type Lang } from "../i18n";
import { shownName } from "../ui";
import { common } from "../ui/common";

// The roster (characters and reserves) and raids sections of the Guild tab. Moved from GuildScreen unchanged.

export function Characters({ lang, hub, error }: { lang: Lang; hub: HubView | null; error?: string }) {
  if (error) return <Text style={common.error}>{error}</Text>;
  if (!hub) return null;
  return <>
    {hub.battleNet !== null ? <Text style={common.muted}>{t(lang, "battleNet")}: {hub.battleNet ? t(lang, "linked") : t(lang, "notLinked")}{hub.battleTag ? ` · ${hub.battleTag}` : ""}</Text> : null}
    {hub.characters.length === 0 ? <Text style={common.intro}>{t(lang, "noCharacters")}</Text> : hub.characters.map((character) => <View key={character.id} style={common.hero}>
      <View style={common.titleRow}>
        <Text style={common.heroTitle}>{shownName(character)}</Text>
        <Text style={common.pill}>{character.isMain ? t(lang, "main") : character.className}</Text>
      </View>
      <Text style={common.muted}>{[character.spec, character.className].filter(Boolean).join(" ")}{character.level ? ` · ${t(lang, "level")} ${character.level}` : ""}</Text>
      <Text style={common.muted}>{[character.realm, character.edition].filter(Boolean).join(" · ")}</Text>
      <Text style={common.body}>{t(lang, "rank")}: {character.rank ?? t(lang, "noRank")}</Text>
      {character.guildName ? <Text style={common.muted}>{character.guildName}{character.current ? "" : ` · ${t(lang, "otherServer")}`}</Text> : null}
      {character.cores.map((core) => <Text key={`${character.id}-${core.name}-${core.role}`} style={common.body}>{core.name} · {roleLabel(core.role, lang)}{core.bench ? ` · ${t(lang, "bench")}` : ""}{core.trial ? ` · ${t(lang, "trial")}` : ""}{core.backup ? ` · ${t(lang, "backup")}` : ""}</Text>)}
    </View>)}
  </>;
}

export function Reserves({ lang, hub, error }: { lang: Lang; hub: HubView | null; error?: string }) {
  if (error) return <Text style={common.error}>{error}</Text>;
  if (!hub) return null;
  const reserves = hub.reserves;
  const soft = reserves.cores.filter((core) => core.lootMode === "RESERVE");
  return <>
    <View style={common.hero}>
      <Text style={common.label}>{t(lang, "whereToReserve")}</Text>
      <Text style={common.muted}>{t(lang, "reservesIntro")}</Text>
      {soft.length ? <Text style={common.body}>{t(lang, "coresUsing")}: {soft.map((core) => `${core.name} (${t(lang, "perPlayer", { count: core.reservesPerPlayer ?? 0 })})`).join(", ")}</Text> : <Text style={common.muted}>{t(lang, "noSoftReserveCores")}</Text>}
    </View>
    {!reserves.list?.active ? <Text style={common.intro}>{t(lang, "noReserveList")}</Text> : <View style={common.hero}>
      <View style={common.titleRow}>
        <Text style={common.heroTitle}>{reserves.list.title || t(lang, "reserves")}</Text>
        <Text style={common.pill}>{reserves.list.open ? t(lang, "reserveOpen") : t(lang, "reserveLocked")}</Text>
      </View>
      <Text style={common.body}>{t(lang, "yourReserves")}: {reserves.mineCount}</Text>
      {reserves.items.length === 0 ? <Text style={common.muted}>{t(lang, "nobodyReserved")}</Text> : reserves.items.slice(0, 40).map((item) => <View key={item.itemName} style={common.row}>
        <Text style={[common.body, { flex: 1 }]}>{item.mine ? "★ " : ""}{item.itemName}</Text>
        <Text style={common.muted}>{item.characters.join(", ")}</Text>
      </View>)}
    </View>}
  </>;
}

export function Raids({ lang, hub, manage, standings, error }: { lang: Lang; hub: HubView | null; manage: ManageView | null; standings: StandingsView | null; error?: string }) {
  if (error && !standings) return <Text style={common.error}>{error}</Text>;
  if (!standings) return error ? <Text style={common.error}>{error}</Text> : null;
  const mine = withMine(standings.standings, (hub?.characters ?? []).filter((character) => character.current));
  const rows = [...mine.filter((row) => row.mine), ...mine.filter((row) => !row.mine)].slice(0, 20);
  const next = standings.nextRaid;
  return <>
    <Text style={common.intro}>{t(lang, "raidIntro")}</Text>
    <View style={common.hero}>
      <Text style={common.label}>{t(lang, "nextRaid")}</Text>
      {!next ? <Text style={common.muted}>{t(lang, "noNextRaid")}</Text> : <>
        <Text style={common.heroTitle}>{next.title}</Text>
        <Text style={common.muted}>{formatWhen(next.scheduledAt, lang)}{next.core ? ` · ${next.core}` : ""}</Text>
        <Text style={common.body}>{t(lang, "signedUp")}</Text>
        {next.players.map((player) => <Text key={`${player.name}-${player.role}`} style={common.muted}>{player.name} · {roleLabel(player.role, lang)}</Text>)}
        {next.maybe.length ? <Text style={common.muted}>{t(lang, "maybe")}: {next.maybe.join(", ")}</Text> : null}
      </>}
    </View>
    <Text style={common.label}>{t(lang, "upcoming")}</Text>
    {standings.raids.length === 0 ? <Text style={common.muted}>{t(lang, "noUpcoming")}</Text> : standings.raids.map((raid) => {
      const link = discordEventLink(raid.note);
      return <View key={raid.id} style={common.row}>
        <View style={{ flex: 1 }}>
          <Text style={common.body}>{raid.title}</Text>
          <Text style={common.muted}>{formatWhen(raid.at, lang)}{raid.core ? ` · ${raid.core}` : ""}</Text>
        </View>
        {link ? <Pressable onPress={() => void Linking.openURL(link)}><Text style={common.textButtonLabel}>{t(lang, "openDiscord")}</Text></Pressable> : null}
      </View>;
    })}
    <Text style={common.label}>{t(lang, "standings")}</Text>
    {rows.length === 0 ? <Text style={common.muted}>{t(lang, "noStandings")}</Text> : rows.map((row) => <View key={row.character} style={common.row}>
      <Text style={[common.body, { flex: 1 }]}>{row.mine ? `${t(lang, "you")} · ` : ""}{row.character}</Text>
      <Text style={common.muted}>{row.ep} / {row.gp} · {formatPr(row.pr)}</Text>
    </View>)}
    {(manage?.cores ?? []).filter((core) => core.rows.length > 0).map((core) => <CoreList key={core.id} lang={lang} core={core} />)}
  </>;
}

function CoreList({ lang, core }: { lang: Lang; core: CoreBoard }) {
  return <View style={common.hero}>
    <Text style={common.heroTitle}>{core.name}</Text>
    <Text style={common.muted}>{lootModeLabel(core.lootMode, lang)}</Text>
    {core.rows.slice(0, 12).map((row) => <View key={`${core.id}-${row.name}`} style={common.row}>
      <Text style={[common.body, { flex: 1 }]}>{row.rank}. {row.me ? `${t(lang, "you")} · ` : ""}{row.name}</Text>
      <Text style={common.muted}>{formatPr(row.pr)}</Text>
    </View>)}
  </View>;
}
