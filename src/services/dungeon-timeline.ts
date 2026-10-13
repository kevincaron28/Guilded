import { escapeMarkdown } from "discord.js";
import type { Lang } from "../i18n.js";
import type { DungeonImportResult } from "./dungeon-import.js";
import { formatDuration } from "./dungeon-rules.js";

// Kill timestamps are useful even without a start event. Never label travel,
// trash or an interval between kills as the duration of a boss fight.
export function dungeonTimeline(run: DungeonImportResult, lang: Lang): string | null {
  const start = run.startedAt;
  const end = run.endedAt;
  if (!start || !end || end < start) return null;
  const events = (run.encounters ?? []).filter(event => event.at && event.at >= start && event.at <= end)
    .sort((a, b) => a.at! - b.at!);
  const unique = events.filter((event, index) => !events.slice(0, index).some(previous =>
    event.success && previous.success && event.id === previous.id && Math.abs(event.at! - previous.at!) <= 10));
  if (!unique.length) return null;
  const fr = lang === "fr";
  const lines = [fr ? "Temps écoulé · résultat · durée du combat" : "Elapsed time · result · fight duration", "`00:00` ▶ " + (fr ? "Premier combat" : "First pull")];
  let shown = 0;
  for (const event of unique) {
    const duration = event.startedAt && event.startedAt >= start && event.startedAt <= event.at!
      ? formatDuration(event.at! - event.startedAt) : null;
    const boss = escapeMarkdown(event.name || `${fr ? "Boss" : "Boss"} #${event.id}`);
    const result = event.success ? "✅" : "↺";
    const text = `├ \`${formatDuration(event.at! - start)}\` ${result} **${boss}** · ${duration ? `⚔️ ${duration}` : fr ? "combat non chronométré" : "fight not timed"}${event.success ? "" : fr ? " · échec" : " · failed attempt"}`;
    if (lines.join("\n").length + text.length > 830) break;
    lines.push(text); shown++;
  }
  if (shown < unique.length) lines.push(fr ? `… ${unique.length - shown} autres événements` : `… ${unique.length - shown} more events`);
  lines.push(`└ \`${formatDuration(end - start)}\` 🏁 ${fr ? "Terminé" : "Finished"}`);
  return lines.join("\n");
}
