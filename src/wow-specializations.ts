import type { CLASSES } from "./wow-data.js";

export type WowClass = typeof CLASSES[number];
export type SpecEmojiKey = `${WowClass}:${string}`;
export interface WowSpecialization {
  className: WowClass;
  name: string;
  french: string;
  emojiName: string;
  icon: string;
  aliases: string[];
  key: SpecEmojiKey;
}
function spec(className: WowClass, name: string, french: string, suffix: string, icon: string, ...aliases: string[]): WowSpecialization {
  return { className, name, french, emojiName: `wow_spec_${suffix}`, icon, aliases, key: `${className}:${name}` };
}

// Class-scoped names: Holy, Protection, Frost and Restoration are ambiguous alone.
// Combat remains distinct from Outlaw for Classic clients.
export const WOW_SPECIALIZATIONS: readonly WowSpecialization[] = [
  spec("Warrior", "Arms", "Armes", "war_arms", "ability_warrior_savageblow"),
  spec("Warrior", "Fury", "Fureur", "war_fury", "ability_warrior_innerrage"),
  spec("Warrior", "Protection", "Protection", "war_prot", "ability_warrior_defensivestance", "Prot"),
  spec("Paladin", "Holy", "Sacré", "pal_holy", "spell_holy_holybolt"),
  spec("Paladin", "Protection", "Protection", "pal_prot", "ability_paladin_shieldofthetemplar", "Prot"),
  spec("Paladin", "Retribution", "Vindicte", "pal_ret", "spell_holy_auraoflight", "Ret"),
  spec("Hunter", "Beast Mastery", "Maîtrise des bêtes", "hunt_bm", "ability_hunter_bestialdiscipline", "BM"),
  spec("Hunter", "Marksmanship", "Précision", "hunt_mm", "ability_hunter_focusedaim", "MM"),
  spec("Hunter", "Survival", "Survie", "hunt_surv", "ability_hunter_camouflage"),
  spec("Rogue", "Assassination", "Assassinat", "rogue_assass", "ability_rogue_deadlybrew"),
  spec("Rogue", "Combat", "Combat", "rogue_combat", "ability_backstab"),
  spec("Rogue", "Outlaw", "Hors-la-loi", "rogue_outlaw", "ability_rogue_waylay"),
  spec("Rogue", "Subtlety", "Finesse", "rogue_sub", "ability_stealth"),
  spec("Priest", "Discipline", "Discipline", "priest_disc", "spell_holy_powerwordshield", "Disc"),
  spec("Priest", "Holy", "Sacré", "priest_holy", "spell_holy_guardianspirit"),
  spec("Priest", "Shadow", "Ombre", "priest_shadow", "spell_shadow_shadowwordpain"),
  spec("Shaman", "Elemental", "Élémentaire", "sham_ele", "spell_nature_lightning", "Ele"),
  spec("Shaman", "Enhancement", "Amélioration", "sham_enh", "spell_nature_lightningshield", "Enh"),
  spec("Shaman", "Restoration", "Restauration", "sham_resto", "spell_nature_magicimmunity", "Resto"),
  spec("Mage", "Arcane", "Arcanes", "mage_arcane", "spell_holy_magicalsentry"),
  spec("Mage", "Fire", "Feu", "mage_fire", "spell_fire_firebolt02"),
  spec("Mage", "Frost", "Givre", "mage_frost", "spell_frost_frostbolt02"),
  spec("Warlock", "Affliction", "Affliction", "lock_aff", "spell_shadow_deathcoil", "Aff"),
  spec("Warlock", "Demonology", "Démonologie", "lock_demo", "spell_shadow_metamorphosis", "Demo"),
  spec("Warlock", "Destruction", "Destruction", "lock_destro", "spell_shadow_rainoffire", "Destro"),
  spec("Druid", "Balance", "Équilibre", "druid_balance", "spell_nature_starfall", "Boomkin"),
  spec("Druid", "Feral", "Farouche", "druid_feral", "ability_druid_catform", "Feral Combat", "Combat farouche"),
  spec("Druid", "Guardian", "Gardien", "druid_guardian", "ability_racial_bearform"),
  spec("Druid", "Restoration", "Restauration", "druid_resto", "spell_nature_healingtouch", "Resto"),
  spec("Death Knight", "Blood", "Sang", "dk_blood", "spell_deathknight_bloodpresence"),
  spec("Death Knight", "Frost", "Givre", "dk_frost", "spell_deathknight_frostpresence"),
  spec("Death Knight", "Unholy", "Impie", "dk_unholy", "spell_deathknight_unholypresence"),
  spec("Monk", "Brewmaster", "Maître brasseur", "monk_brew", "spell_monk_brewmaster_spec"),
  spec("Monk", "Mistweaver", "Tisse-brume", "monk_mist", "spell_monk_mistweaver_spec"),
  spec("Monk", "Windwalker", "Marche-vent", "monk_wind", "spell_monk_windwalker_spec"),
  spec("Demon Hunter", "Havoc", "Dévastation", "dh_havoc", "ability_demonhunter_specdps"),
  spec("Demon Hunter", "Vengeance", "Vengeance", "dh_vengeance", "ability_demonhunter_spectank"),
  spec("Demon Hunter", "Devourer", "Dévoration", "dh_devourer", "spell_shadow_soulleech_3"),
  spec("Evoker", "Devastation", "Dévastation", "evoker_dev", "classicon_evoker_devastation"),
  spec("Evoker", "Preservation", "Préservation", "evoker_pres", "classicon_evoker_preservation"),
  spec("Evoker", "Augmentation", "Augmentation", "evoker_aug", "classicon_evoker_augmentation")
];

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/gi, "").toLowerCase();
export function canonicalSpecialization(className: WowClass | undefined, value?: string | null): WowSpecialization | undefined {
  if (!className || !value?.trim()) return undefined;
  const key = normalize(value);
  return WOW_SPECIALIZATIONS.find(spec => spec.className === className && [spec.name, spec.french, ...spec.aliases].some(name => normalize(name) === key));
}
