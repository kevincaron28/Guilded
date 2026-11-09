import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Lang } from "../i18n";
import { classColor } from "../publicApi";
import { ProgressBar, SegmentedTabs, colors } from "../ui";
import { STONE } from "./CardFrame";
import type { AiLevel, ClassKey, MatchInfo, PveProgress, StartInput } from "./types";
import { CLASS_KEYS } from "./types";
import { CLASS_LABEL, w } from "./words";

/** Play: resume a match, an AI match with class and level, the PvE gauntlet map and today's quests. */
export function PlayView({ lang, pve, matches, cls, setCls, busy, onStart, onResume }: {
  lang: Lang; pve: PveProgress | null; matches: MatchInfo[]; cls: ClassKey; setCls: (cls: ClassKey) => void; busy: boolean;
  onStart: (input: StartInput) => void; onResume: (id: string) => void;
}) {
  const [level, setLevel] = useState<AiLevel>("normal");
  const active = matches.filter((m) => m.status === "active");
  return <View style={{ gap: 14 }}>
    {active.length ? <View style={styles.panel}>
      <Text style={styles.label}>{w("resume", lang).toUpperCase()}</Text>
      {active.map((m) => <Pressable key={m.id} onPress={() => onResume(m.id)} accessibilityRole="button" style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.text}>{m.boss ? m.boss.name : `${w("startAi", lang)} · ${w(m.aiLevel, lang)}`}</Text>
          <Text style={styles.muted}>{w("round", lang)} {m.round}</Text>
        </View>
        <Text style={styles.link}>{w("resumeOne", lang)} ›</Text>
      </Pressable>)}
    </View> : null}

    <View style={styles.panel}>
      <Text style={styles.label}>{w("aiTitle", lang).toUpperCase()}</Text>
      <Text style={styles.muted}>{w("yourClass", lang)}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {CLASS_KEYS.map((key) => <Pressable key={key} onPress={() => setCls(key)} accessibilityRole="button" accessibilityState={{ selected: cls === key }}
          style={[styles.cls, { borderColor: classColor(key) }, cls === key && { backgroundColor: classColor(key) }]}>
          <Text style={[styles.clsText, { color: cls === key ? colors.ink : classColor(key) }]}>{CLASS_LABEL[key]![lang]}</Text>
        </Pressable>)}
      </ScrollView>
      <Text style={styles.muted}>{w("level", lang)}</Text>
      <SegmentedTabs options={(["easy", "normal", "hard"] as const).map((value) => ({ value, label: w(value, lang) }))} value={level} onChange={setLevel} />
      <Pressable onPress={() => onStart({ mode: "ai", cls, level })} disabled={busy} accessibilityRole="button" style={styles.button}>
        {busy ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.buttonText}>{w("startAi", lang)}</Text>}
      </Pressable>
    </View>

    {pve ? <View style={styles.panel}>
      <Text style={styles.label}>{w("gauntlet", lang).toUpperCase()}</Text>
      <Text style={styles.muted}>{w("gauntletIntro", lang)}</Text>
      <View style={styles.path}>
        {pve.bosses.map((boss, i) => {
          const tint = classColor(boss.cls);
          return <View key={boss.id} style={[styles.stop, i % 2 === 1 && styles.stopRight]}>
            {i > 0 ? <View style={[styles.trail, boss.unlocked && { backgroundColor: STONE.gold }]} /> : null}
            <View style={[styles.node, { borderColor: boss.cleared ? "#9fbd83" : boss.unlocked ? STONE.gold : colors.line }, boss.unlocked && !boss.cleared && styles.nodeOpen]}>
              <Text style={[styles.nodeText, { color: boss.unlocked ? tint : colors.muted }]}>{boss.cleared ? "✓" : boss.unlocked ? String(i + 1) : "🔒"}</Text>
            </View>
            <View style={[styles.bossCard, !boss.unlocked && { opacity: 0.5 }]}>
              <Text style={styles.bossName}>{boss.name}{boss.spotlight ? `  ★ ${w("featured", lang)}` : ""}</Text>
              <Text style={styles.muted} numberOfLines={2}>{boss.flavour}</Text>
              <Text style={styles.small}>{CLASS_LABEL[boss.cls]![lang]} · {w(boss.level, lang)} · {boss.health} HP · {w("reward", lang)}: {boss.reward.dust} {w("dust", lang)}{boss.reward.packs ? ` + ${boss.reward.packs} ${w("pack", lang)}` : ""}</Text>
              {boss.unlocked ? <Pressable onPress={() => onStart({ mode: "pve", cls, boss: boss.id })} disabled={busy} accessibilityRole="button" style={[styles.fight, boss.cleared && styles.fightAgain]}>
                <Text style={[styles.fightText, boss.cleared && { color: STONE.gold }]}>{boss.cleared ? `${w("cleared", lang)} · ${w("fight", lang)}` : w("fight", lang)}</Text>
              </Pressable> : <Text style={styles.small}>{w("locked", lang)}</Text>}
            </View>
          </View>;
        })}
      </View>
      {pve.featured.note ? <Text style={styles.muted}>★ {pve.featured.note}</Text> : null}
    </View> : null}

    {pve ? <View style={styles.panel}>
      <Text style={styles.label}>{w("quests", lang).toUpperCase()}</Text>
      {pve.daily.quests.map((q) => <View key={q.id} style={{ gap: 4 }}>
        <Text style={[styles.text, q.done && { color: "#9fbd83" }]}>{q.done ? "✓ " : ""}{q.text}  <Text style={styles.small}>{q.progress}/{q.target}</Text></Text>
        <ProgressBar done={q.progress} total={q.target} color={q.done ? "#9fbd83" : colors.gold} />
      </View>)}
      <Text style={styles.text}>{w("packProgress", lang)}: {pve.daily.packProgress}/{pve.daily.stepsPerPack} · {pve.daily.packsFromPlay}/{pve.daily.packCap}</Text>
      <Text style={styles.small}>{w("record", lang)}: {pve.wins} / {pve.losses}</Text>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  label: { color: colors.gold, fontSize: 9, letterSpacing: 1.7, fontWeight: "700" },
  text: { color: colors.text, fontSize: 14 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  small: { color: colors.muted, fontSize: 11 },
  link: { color: colors.gold, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", minHeight: 48, borderTopWidth: 1, borderColor: colors.line },
  cls: { borderWidth: 2, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
  clsText: { fontSize: 12, fontWeight: "700" },
  button: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 4 },
  buttonText: { color: colors.ink, fontWeight: "700", fontSize: 15 },
  path: { gap: 0, marginTop: 4 },
  stop: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8 },
  stopRight: { paddingLeft: 22 },
  trail: { position: "absolute", left: 21, top: -10, width: 3, height: 22, backgroundColor: colors.line },
  node: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, backgroundColor: STONE.brown, alignItems: "center", justifyContent: "center" },
  nodeOpen: { shadowColor: STONE.gold, shadowOpacity: 0.8, shadowRadius: 8 },
  nodeText: { fontSize: 16, fontWeight: "900" },
  bossCard: { flex: 1, backgroundColor: STONE.panel, borderColor: STONE.line, borderWidth: 1, borderRadius: 10, padding: 10, gap: 3 },
  bossName: { color: STONE.gold, fontSize: 14, fontWeight: "700", fontStyle: "italic" },
  fight: { alignSelf: "flex-start", backgroundColor: STONE.gold, borderRadius: 6, paddingHorizontal: 14, minHeight: 36, justifyContent: "center", marginTop: 4 },
  fightAgain: { backgroundColor: "transparent", borderWidth: 1, borderColor: STONE.gold },
  fightText: { color: colors.ink, fontWeight: "800" }
});
