// Shared planning/observation catalog; generate the addon's Lua copy with
// node scripts/build-raid-buff-catalog.mjs. These are aura families, not promises
// that a class has learned a spell or that a party aura covers a whole raid.
export const BUFF_SOURCES = {
  era: "https://github.com/rgd87/LibClassicDurations/blob/master/classAbilities.lua",
  tbc: "https://github.com/WeakAuras/WeakAuras2/blob/main/WeakAurasTemplates/TriggerTemplatesDataTBC.lua",
  mists: "https://github.com/WeakAuras/WeakAuras2/blob/main/WeakAurasTemplates/TriggerTemplatesDataMists.lua"
};
const buff = (key, label, french, classes, spells, scope = "target") => ({ key, label, french, classes, spells, scope });
const classic = [
  buff("sta", "Fortitude", "Robustesse", ["PRIEST"], [1243, 1244, 1245, 2791, 10937, 10938, 21562, 21564]),
  buff("int", "Arcane intellect", "Intelligence des arcanes", ["MAGE"], [1459, 1460, 1461, 10156, 10157, 23028]),
  buff("wild", "Mark / Gift of the Wild", "Marque / Don du fauve", ["DRUID"], [1126, 5232, 5234, 6756, 8907, 9884, 9885, 21849, 21850]),
  buff("spirit", "Divine spirit (talent)", "Esprit divin (talent)", ["PRIEST"], [14752, 14818, 14819, 27841, 27681]),
  buff("ap", "Battle Shout (party)", "Cri de guerre (groupe)", ["WARRIOR"], [6673, 5242, 6192, 11549, 11550, 11551, 25289], "party"),
  buff("kings", "Blessing of Kings", "Bénédiction des rois", ["PALADIN"], [20217, 25898]),
  buff("might", "Blessing of Might", "Bénédiction de puissance", ["PALADIN"], [19740, 19834, 19835, 19836, 19837, 19838, 25291, 25782, 25916]),
  buff("wisdom", "Blessing of Wisdom", "Bénédiction de sagesse", ["PALADIN"], [19742, 19850, 19852, 19853, 19854, 25290, 25894, 25918])
];
// Optional observations. These effects compete for aura/totem slots, depend on
// party range or come from the world; absence is never a readiness failure.
// Aura IDs (not totem summon IDs), verified against LibClassicDurations on 2026-10-26.
const optional = (key, label, french, classes, spells, scope = "party") => ({ ...buff(key, label, french, classes, spells, scope), optional: true });
const classicUtility = [
  optional("fire-res", "Fire resistance", "Résistance au feu", ["PALADIN", "SHAMAN"], [19891, 19899, 19900, 8185, 10534, 10535]),
  optional("frost-res", "Frost resistance", "Résistance au givre", ["PALADIN", "SHAMAN"], [19888, 19897, 19898, 8182, 10476, 10477]),
  optional("shadow-res", "Shadow Resistance Aura", "Aura de résistance à l'ombre", ["PALADIN"], [19876, 19895, 19896]),
  optional("nature-res", "Nature Resistance Totem", "Totem de résistance à la nature", ["SHAMAN"], [10596, 10598, 10599]),
  optional("strength-earth", "Strength of Earth Totem", "Totem de force de la terre", ["SHAMAN"], [8076, 8162, 8163, 10441, 25362]),
  optional("grace-air", "Grace of Air Totem", "Totem de grâce aérienne", ["SHAMAN"], [8836, 10626, 25360]),
  optional("mana-spring", "Mana Spring Totem", "Totem Fontaine de mana", ["SHAMAN"], [5677, 10491, 10493, 10494]),
  optional("healing-stream", "Healing Stream Totem", "Totem guérisseur", ["SHAMAN"], [5672, 6371, 6372, 10460, 10461]),
  optional("stoneskin", "Stoneskin Totem", "Totem de peau de pierre", ["SHAMAN"], [8072, 8156, 8157, 10403, 10404, 10405])
];
const classicWorld = [
  // Do not treat Chronoboon's suspended aura IDs as active world buffs.
  optional("dragonslayer", "Rallying Cry of the Dragonslayer", "Cri de ralliement du tueur de dragons", [], [22888], "world"),
  optional("zandalar", "Spirit of Zandalar", "Esprit des Zandalar", [], [24425], "world"),
  optional("warchief", "Warchief's Blessing", "Bénédiction du chef de guerre", [], [16609], "world")
];
const mists = [
  buff("sta", "Stamina", "Endurance", ["PRIEST", "WARRIOR"], [21562, 469], "group"),
  buff("int", "Arcane Brilliance", "Illumination des arcanes", ["MAGE"], [1459], "group"),
  buff("stats", "Primary stats", "Caractéristiques principales", ["DRUID", "PALADIN", "MONK"], [1126, 20217, 117666], "group"),
  buff("ap", "Attack power", "Puissance d'attaque", ["WARRIOR", "HUNTER", "DEATHKNIGHT"], [6673, 19506, 57330], "group"),
  buff("might", "Blessing of Might", "Bénédiction de puissance", ["PALADIN"], [19740], "group"),
  buff("tiger", "Legacy of the White Tiger", "Héritage du Tigre blanc", ["MONK"], [116781], "group")
];
const retail = [
  buff("ap", "Attack power", "Puissance d'attaque", ["WARRIOR"], [6673], "group"),
  buff("sta", "Stamina", "Endurance", ["PRIEST"], [21562], "group"),
  buff("int", "Intellect", "Intelligence", ["MAGE"], [1459], "group"),
  buff("vers", "Versatility", "Polyvalence", ["DRUID"], [1126], "group"),
  buff("mast", "Mastery", "Maîtrise", ["SHAMAN"], [462854], "group"),
  buff("move", "Movement", "Déplacement", ["EVOKER"], [381748,381758,381732,381741,381746,381750,381749,381751,381752,381753,381754,381756,381757], "group")
];
export const BUFF_CATALOGS = {
  forever: { provisional: true, source: BUFF_SOURCES.era, buffs: [...classic, ...classicUtility, ...classicWorld] },
  "classic-era": { provisional: false, source: BUFF_SOURCES.era, buffs: [...classic, ...classicUtility, ...classicWorld] },
  // Shared base/rank ids plus client-resolved spell names recognize later TBC
  // ranks. Unresolved or hidden names remain unknown, never assumed equivalent.
  "classic-tbc": { provisional: false, source: BUFF_SOURCES.tbc, buffs: [...classic, ...classicUtility] },
  "classic-mists": { provisional: false, source: BUFF_SOURCES.mists, buffs: mists },
  retail: { provisional: false, source: "addon/Guilded/Modules/ConsumableData.lua", buffs: retail }
};
export function raidBuffCatalog(edition) {
  return Object.hasOwn(BUFF_CATALOGS, edition) ? BUFF_CATALOGS[edition] : null;
}
