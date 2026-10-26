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
  forever: { provisional: true, source: BUFF_SOURCES.era, buffs: classic },
  "classic-era": { provisional: false, source: BUFF_SOURCES.era, buffs: classic },
  // Shared base/rank ids plus client-resolved spell names recognize later TBC
  // ranks. Unresolved or hidden names remain unknown, never assumed equivalent.
  "classic-tbc": { provisional: false, source: BUFF_SOURCES.tbc, buffs: classic },
  "classic-mists": { provisional: false, source: BUFF_SOURCES.mists, buffs: mists },
  retail: { provisional: false, source: "addon/Guilded/Modules/ConsumableData.lua", buffs: retail }
};
export function raidBuffCatalog(edition) {
  return Object.hasOwn(BUFF_CATALOGS, edition) ? BUFF_CATALOGS[edition] : null;
}
