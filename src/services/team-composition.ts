import type { TeamView } from "./guild-tools-store.js";
import { canonicalClass } from "./character-display.js";
import { CLASS_NAMES_FR } from "../permissions.js";
import { raidBuffCatalog } from "../../companion/raid-buffs.mjs";

// Planning from explicitly assigned characters only. Linked mains, backups and
// bench spots are alternatives, not additional players in the active team.
const CLASSES = ["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"];
export function teamClassLabel(value: string, lang: string): string {
  const name = canonicalClass(value);
  return name ? lang === "fr" ? CLASS_NAMES_FR[name] ?? name : name : value;
}
export function teamComposition(core: TeamView, edition: string) {
  const allowed = new Set([...CLASSES, ...(["classic-mists", "retail"].includes(edition) ? ["DEATHKNIGHT", "MONK"] : []), ...(edition === "retail" ? ["DEMONHUNTER", "EVOKER"] : [])]);
  const classes = new Map<string, string[]>();
  const seen = new Set<string>();
  let unknown = 0, duplicates = 0;
  for (const member of core.members) {
    if (member.bench) continue;
    if (!member.assigned || !member.characterId) { unknown++; continue; }
    if (seen.has(member.characterId)) { duplicates++; continue; }
    seen.add(member.characterId);
    const className = (canonicalClass(member.className) ?? "").replace(/[\s_-]/g, "").toUpperCase();
    if (!allowed.has(className)) { unknown++; continue; }
    const names = classes.get(className) ?? []; names.push(member.name); classes.set(className, names);
  }
  const incomplete = core.truncated || unknown > 0 || duplicates > 0;
  const catalog = raidBuffCatalog(edition) as { provisional: boolean; buffs: { label: string; french: string; classes: string[]; scope: string; optional?: boolean }[] } | null;
  return { classes: [...classes].sort(([a], [b]) => a.localeCompare(b)), unknown, duplicates, incomplete,
    provisional: catalog?.provisional ?? false,
    buffs: catalog ? catalog.buffs.map(buff => {
      const providers = buff.classes.flatMap(name => classes.get(name) ?? []);
      return { en: buff.label, fr: buff.french, className: buff.classes[0], scope: buff.scope, optional: buff.optional === true, providers,
        status: buff.scope === "world" ? "world" as const : providers.length ? "potential" as const : incomplete ? "unknown" as const : "absent" as const };
    }) : null };
}
