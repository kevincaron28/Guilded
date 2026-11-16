// WoW race -> faction (WoW Forever has the classic races; the later ones are listed so a future client still resolves).
// Accepts the race file token (UnitRace's second result: "NightElf", "Scourge") and the plain or localised English name ("Night Elf", "Undead").
const ALLIANCE = new Set(["human", "dwarf", "nightelf", "gnome", "draenei", "worgen"]);
const HORDE = new Set(["orc", "scourge", "undead", "forsaken", "tauren", "troll", "bloodelf", "goblin"]);

/** "ALLIANCE", "HORDE" or null (unknown or neutral). */
export function factionOfRace(race) {
  const key = String(race ?? "").normalize("NFKD").replace(/[^A-Za-z]/g, "").toLowerCase();
  if (ALLIANCE.has(key)) return "ALLIANCE";
  if (HORDE.has(key)) return "HORDE";
  return null;
}

/** The faction of a group of players: the one faction nearly all of the known ones share, else null. Needs `min` known players and `share` agreement. */
export function majorityFaction(factions, { min = 2, share = 0.75 } = {}) {
  const known = [...factions].filter((value) => value === "ALLIANCE" || value === "HORDE");
  if (known.length < min) return null;
  const alliance = known.filter((value) => value === "ALLIANCE").length;
  const horde = known.length - alliance;
  const top = Math.max(alliance, horde);
  if (top / known.length < share) return null;
  return alliance > horde ? "ALLIANCE" : "HORDE";
}
