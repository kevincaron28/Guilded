import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View, type LayoutChangeEvent } from "react-native";
import { ApiError, GuildedClient } from "./api";
import {
  HEAT_COLS, HEAT_ROWS, attackersLine, classColor, continentTabs, heatLevel, sampleGuildMap, timeAgo,
  type GuildMap, type HelpPin, type MapMate
} from "./guildMap";
import type { Lang } from "./i18n";
import { clearSession, type Session } from "./storage";

// Track M items 3 and 4: guildmate dots, the last-seen heat map and help pins on one plain grid.
// The map art is our own: a grid with zone names placed where the guild has been. No game map images.

const colors = { panel: "#151714", line: "#282b25", grid: "#20231e", text: "#f3f0e7", muted: "#aaa99f", gold: "#d5ad57", green: "#9fbd83", red: "#e0624f", ink: "#1b160c" };
const words = {
  title: { en: "Guild map", fr: "Carte de la guilde" },
  intro: { en: "Where guildmates were last seen outdoors, and where the guild plays. Only signed-in members of this guild see it; it is never public. Positions arrive when a companion uploads, so they are last seen, not live.", fr: "Où les membres ont été vus dehors pour la dernière fois, et où joue la guilde. Seuls les membres connectés de cette guilde la voient ; elle n'est jamais publique. Les positions arrivent quand un compagnon envoie ses données : ce sont des dernières positions, pas du direct." },
  off: { en: "Officers turned the guild map off for this server.", fr: "Les officiers ont désactivé la carte de la guilde sur ce serveur." },
  empty: { en: "No positions yet. They appear after guildmates play outdoors and their companion uploads.", fr: "Aucune position pour l'instant. Elles apparaissent quand des membres jouent dehors et que leur compagnon envoie ses données." },
  heat: { en: "Heat: where the guild was seen in the last", fr: "Chaleur : où la guilde a été vue ces" },
  days: { en: "days", fr: "derniers jours" },
  mates: { en: "Last seen", fr: "Dernières positions" },
  calls: { en: "Calls for help", fr: "Appels à l'aide" },
  noCalls: { en: "No call for help in the last few hours.", fr: "Aucun appel à l'aide ces dernières heures." },
  active: { en: "NOW", fr: "EN COURS" },
  cleared: { en: "all clear", fr: "terminé" },
  attackers: { en: "Attackers", fr: "Attaquants" },
  you: { en: "you", fr: "vous" },
  share: { en: "Share my position with the guild", fr: "Partager ma position avec la guilde" },
  shareOn: { en: "On by default. Turning it off deletes every position of yours stored by Guilded, and new ones are not kept.", fr: "Activé par défaut. Le couper efface toutes vos positions gardées par Guilded, et les nouvelles ne sont pas conservées." },
  shareOff: { en: "Off: Guilded keeps none of your positions, and guildmates do not see you here.", fr: "Désactivé : Guilded ne garde aucune de vos positions, et les membres ne vous voient pas ici." },
  confirmTitle: { en: "Stop sharing?", fr: "Arrêter le partage ?" },
  confirmBody: { en: "Your stored positions are deleted now. Your calls for help stay, without their map position.", fr: "Vos positions gardées sont effacées maintenant. Vos appels à l'aide restent, sans leur position sur la carte." },
  confirmYes: { en: "Stop and delete", fr: "Arrêter et effacer" },
  cancel: { en: "Cancel", fr: "Annuler" },
  noPlace: { en: "not on a map", fr: "hors carte" },
  failed: { en: "The guild map is unavailable right now.", fr: "La carte de la guilde est indisponible pour le moment." },
  retry: { en: "Try again", fr: "Réessayer" },
  sample: { en: "Sample map with made-up zones. Sign in to see your guild.", fr: "Carte d'exemple aux zones inventées. Connectez-vous pour voir votre guilde." }
} as const;
const w = (key: keyof typeof words, lang: Lang) => words[key][lang];

/** The map tab. `session` null shows the sample map and a switch that changes nothing. */
export function MapScreen({ lang, session }: { lang: Lang; session: Session | null }) {
  const [map, setMap] = useState<GuildMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [continent, setContinent] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [width, setWidth] = useState(0);
  const now = Date.now();

  useEffect(() => {
    let active = true;
    setError(null);
    if (!session) { setMap(sampleGuildMap()); return () => { active = false; }; }
    new GuildedClient(session.apiOrigin, session.companionCredential).guildMap(session.guildDiscordId)
      .then((data) => { if (active) setMap(data); })
      .catch(async (e: unknown) => {
        if (e instanceof ApiError && e.status === 401) await clearSession();
        if (active) setError(e instanceof Error ? e.message : w("failed", lang));
      });
    return () => { active = false; };
  }, [session, lang, attempt]);

  const tabs = useMemo(() => map ? continentTabs(map) : [], [map]);
  const shown = continent !== null && tabs.some((tab) => tab.id === continent) ? continent : tabs[0]?.id ?? null;
  const heat = map?.continents.find((c) => c.id === shown) ?? null;
  const dots = map?.mates.filter((m) => m.continentId === shown && m.cx !== null && m.cy !== null) ?? [];
  const pins = map?.calls.filter((c) => c.continentId === shown && c.cx !== null && c.cy !== null) ?? [];
  const height = Math.round(width * HEAT_ROWS / HEAT_COLS);

  const changeSharing = (share: boolean) => {
    if (!map) return;
    if (!session) { setMap({ ...map, sharing: share }); return; }
    const run = () => {
      setSaving(true);
      new GuildedClient(session.apiOrigin, session.companionCredential).setMapSharing(session.guildDiscordId, share)
        .then((next) => setMap(next))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : w("failed", lang)))
        .finally(() => setSaving(false));
    };
    if (share) { run(); return; }
    Alert.alert(w("confirmTitle", lang), w("confirmBody", lang), [
      { text: w("cancel", lang), style: "cancel" },
      { text: w("confirmYes", lang), style: "destructive", onPress: run }
    ]);
  };

  if (error && !map) return <View style={styles.panel}>
    <Text style={styles.muted}>{error}</Text>
    <Pressable onPress={() => setAttempt((n) => n + 1)} style={styles.chip}><Text style={styles.chipText}>{w("retry", lang)}</Text></Pressable>
  </View>;
  if (!map) return <ActivityIndicator color={colors.gold} style={{ marginTop: 24 }} />;

  const pickedMate = map.mates.find((m) => key(m) === picked);
  const pickedPin = map.calls.find((c) => pinKey(c) === picked);

  return <View style={{ gap: 12 }}>
    <View style={styles.panel}>
      <Text style={styles.heading}>{w("title", lang)}</Text>
      <Text style={styles.muted}>{session ? w("intro", lang) : w("sample", lang)}</Text>
    </View>
    {!map.enabled ? <View style={styles.panel}><Text style={styles.muted}>{w("off", lang)}</Text></View> : <>
      {tabs.length > 1 ? <View style={styles.chips}>
        {tabs.map((tab) => <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: tab.id === shown }} onPress={() => { setContinent(tab.id); setPicked(null); }} style={[styles.chip, tab.id === shown && styles.chipOn]}>
          <Text style={[styles.chipText, tab.id === shown && styles.chipTextOn]}>{tab.name}</Text>
        </Pressable>)}
      </View> : null}
      {shown === null ? <View style={styles.panel}><Text style={styles.muted}>{w("empty", lang)}</Text></View> : <View style={styles.panel}>
        {tabs.length === 1 ? <Text style={styles.subheading}>{tabs[0]!.name}</Text> : null}
        <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={[styles.canvas, { height: height || 200 }]}
          accessibilityLabel={`${heat?.name ?? ""}: ${dots.length} ${w("mates", lang)}, ${pins.length} ${w("calls", lang)}`}>
          {width > 0 ? <>
            {Array.from({ length: HEAT_COLS / 4 - 1 }, (_, i) => <View key={`v${i}`} style={[styles.gridLine, { left: (i + 1) * width / 6, top: 0, bottom: 0, width: 1 }]} />)}
            {Array.from({ length: HEAT_ROWS / 4 - 1 }, (_, i) => <View key={`h${i}`} style={[styles.gridLine, { top: (i + 1) * height / 4, left: 0, right: 0, height: 1 }]} />)}
            {heat?.cells.map(([col, row, count]) => <View key={`c${col}-${row}`} pointerEvents="none" style={{
              position: "absolute", left: col * width / HEAT_COLS, top: row * height / HEAT_ROWS, width: width / HEAT_COLS + 0.5, height: height / HEAT_ROWS + 0.5,
              backgroundColor: colors.gold, opacity: 0.12 + 0.55 * heatLevel(count, heat.max)
            }} />)}
            {heat?.zones.slice(0, 14).map((zone) => <Text key={zone.zone} pointerEvents="none" numberOfLines={1} style={[styles.zoneLabel, {
              left: Math.max(0, Math.min(width - 96, zone.cx * width - 48)), top: Math.max(0, Math.min(height - 16, zone.cy * height + 6))
            }]}>{zone.zone}</Text>)}
            {dots.map((mate) => <Pressable key={key(mate)} onPress={() => setPicked(key(mate))} hitSlop={10} accessibilityLabel={`${mate.name}, ${mate.zone}`}
              style={[styles.dot, { left: mate.cx! * width - 6, top: mate.cy! * height - 6, backgroundColor: classColor(mate.className) }, mate.mine && styles.dotMine, picked === key(mate) && styles.dotPicked]} />)}
            {pins.map((pin) => <Pressable key={pinKey(pin)} onPress={() => setPicked(pinKey(pin))} hitSlop={10} accessibilityLabel={`${w("calls", lang)}: ${pin.name}, ${pin.zone}`}
              style={[styles.pin, { left: pin.cx! * width - 9, top: pin.cy! * height - 9 }, !pin.active && styles.pinOld]}>
              <Text style={styles.pinText}>!</Text>
            </Pressable>)}
          </> : null}
        </View>
        {pickedMate ? <Text style={styles.picked}>{mateLine(pickedMate, lang, now)}</Text> : null}
        {pickedPin ? <Text style={styles.picked}>{pinLine(pickedPin, lang, now)}</Text> : null}
        <Text style={styles.small}>{w("heat", lang)} {map.days} {w("days", lang)}.</Text>
      </View>}

      <View style={styles.panel}>
        <Text style={styles.subheading}>{w("calls", lang)}</Text>
        {map.calls.length ? map.calls.map((pin) => <View key={pinKey(pin)} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.text}>{pin.name}{pin.mine ? ` (${w("you", lang)})` : ""} · {[pin.zone, pin.subzone].filter(Boolean).join(", ")}</Text>
            {pin.attackers.length ? <Text style={styles.muted}>{w("attackers", lang)}: {attackersLine(pin)}</Text> : null}
          </View>
          <Text style={pin.active ? styles.badge : styles.muted}>{pin.active ? w("active", lang) : `${timeAgo(pin.calledAt, now, lang)}${pin.cleared ? ` · ${w("cleared", lang)}` : ""}`}</Text>
        </View>) : <Text style={styles.muted}>{w("noCalls", lang)}</Text>}
      </View>

      <View style={styles.panel}>
        <Text style={styles.subheading}>{w("mates", lang)}</Text>
        {map.mates.length ? map.mates.slice(0, 60).map((mate) => <Pressable key={key(mate)} onPress={() => { if (mate.continentId !== null) { setContinent(mate.continentId); setPicked(key(mate)); } }} style={styles.row}>
          <View style={[styles.swatch, { backgroundColor: classColor(mate.className) }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.text}>{mate.name}{mate.mine ? ` (${w("you", lang)})` : ""}{mate.level ? ` · ${mate.level}` : ""}{mate.className ? ` ${mate.className}` : ""}</Text>
            <Text style={styles.muted}>{mate.zone}{mate.continentId === null ? ` · ${w("noPlace", lang)}` : ""}</Text>
          </View>
          <Text style={styles.muted}>{timeAgo(mate.seenAt, now, lang)}</Text>
        </Pressable>) : <Text style={styles.muted}>{w("empty", lang)}</Text>}
      </View>
    </>}

    <View style={styles.panel}>
      <View style={styles.row}>
        <Text style={[styles.text, { flex: 1 }]}>{w("share", lang)}</Text>
        <Switch value={map.sharing} disabled={saving} onValueChange={changeSharing} trackColor={{ true: colors.green, false: colors.line }} thumbColor={colors.text} />
      </View>
      <Text style={styles.muted}>{map.sharing ? w("shareOn", lang) : w("shareOff", lang)}</Text>
      {error ? <Text style={[styles.muted, { color: colors.red }]}>{error}</Text> : null}
    </View>
  </View>;
}

const key = (mate: MapMate) => `m:${mate.character}`;
const pinKey = (pin: HelpPin) => `p:${pin.character}:${pin.calledAt}`;
function mateLine(mate: MapMate, lang: Lang, now: number): string {
  return `${mate.name}${mate.level ? ` (${mate.level})` : ""} · ${mate.zone} · ${timeAgo(mate.seenAt, now, lang)}`;
}
function pinLine(pin: HelpPin, lang: Lang, now: number): string {
  const who = pin.attackers.length ? ` · ${w("attackers", lang)}: ${attackersLine(pin)}` : "";
  return `${pin.name} · ${pin.zone} · ${pin.active ? w("active", lang) : timeAgo(pin.calledAt, now, lang)}${who}`;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  heading: { color: colors.text, fontSize: 18, fontWeight: "700" },
  subheading: { color: colors.gold, fontSize: 14, fontWeight: "700" },
  text: { color: colors.text, fontSize: 14 },
  muted: { color: colors.muted, fontSize: 13 },
  small: { color: colors.muted, fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: colors.line, borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start" },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.ink, fontWeight: "700" },
  canvas: { width: "100%", backgroundColor: "#0f110e", borderColor: colors.line, borderWidth: 1, borderRadius: 6, overflow: "hidden" },
  gridLine: { position: "absolute", backgroundColor: colors.grid },
  zoneLabel: { position: "absolute", width: 96, textAlign: "center", color: colors.muted, fontSize: 10 },
  dot: { position: "absolute", width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: "#000" },
  dotMine: { borderColor: colors.text, borderWidth: 2 },
  dotPicked: { transform: [{ scale: 1.5 }] },
  pin: { position: "absolute", width: 18, height: 18, borderRadius: 9, backgroundColor: colors.red, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#000" },
  pinOld: { opacity: 0.55 },
  pinText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  picked: { color: colors.text, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  badge: { color: colors.ink, backgroundColor: colors.red, fontWeight: "800", fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" }
});
