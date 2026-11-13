// ONE language-independent identity for a profession (owner report, 9 November 2026: "Cooking" and "Cuisine"
// were two professions because French and English WoW Forever clients report their own localized names).
//
// The canonical key is the English name, which is what the bot has always stored and shown first. Every
// client's localized name, and the game's skill line id, maps to it. The addon (addon/Guilded/Util.lua,
// `ns.professions`) carries the same table and sends the English name; the bot also maps on arrival so an older
// addon or companion cannot split a profession again. A test keeps the two tables equal.

export interface ProfessionIdentity {
  /** The skill line id (same in every game language). */
  skillLine: number;
  /** Names per client locale, canonical English first. */
  names: Record<"enUS" | "frFR" | "deDE" | "esES" | "esMX" | "ptBR" | "itIT" | "ruRU", string[]>;
}

export const PROFESSION_IDENTITIES: Record<string, ProfessionIdentity> = {
  Alchemy: { skillLine: 171, names: { enUS: ["Alchemy"], frFR: ["Alchimie"], deDE: ["Alchimie"], esES: ["Alquimia"], esMX: ["Alquimia"], ptBR: ["Alquimia"], itIT: ["Alchimia"], ruRU: ["Алхимия"] } },
  Blacksmithing: { skillLine: 164, names: { enUS: ["Blacksmithing"], frFR: ["Forge"], deDE: ["Schmiedekunst"], esES: ["Herrería"], esMX: ["Herrería"], ptBR: ["Ferraria"], itIT: ["Forgiatura"], ruRU: ["Кузнечное дело"] } },
  Enchanting: { skillLine: 333, names: { enUS: ["Enchanting"], frFR: ["Enchantement"], deDE: ["Verzauberkunst"], esES: ["Encantamiento"], esMX: ["Encantamiento"], ptBR: ["Encantamento"], itIT: ["Incantamento"], ruRU: ["Наложение чар"] } },
  Engineering: { skillLine: 202, names: { enUS: ["Engineering"], frFR: ["Ingénierie"], deDE: ["Ingenieurskunst"], esES: ["Ingeniería"], esMX: ["Ingeniería"], ptBR: ["Engenharia"], itIT: ["Ingegneria"], ruRU: ["Инженерное дело"] } },
  Herbalism: { skillLine: 182, names: { enUS: ["Herbalism"], frFR: ["Herboristerie"], deDE: ["Kräuterkunde"], esES: ["Herboristería"], esMX: ["Herboristería"], ptBR: ["Herborismo"], itIT: ["Erboristeria"], ruRU: ["Травничество"] } },
  Inscription: { skillLine: 773, names: { enUS: ["Inscription"], frFR: ["Calligraphie"], deDE: ["Inschriftenkunde"], esES: ["Inscripción"], esMX: ["Inscripción"], ptBR: ["Escrivania"], itIT: ["Runografia"], ruRU: ["Начертание"] } },
  Jewelcrafting: { skillLine: 755, names: { enUS: ["Jewelcrafting"], frFR: ["Joaillerie"], deDE: ["Juwelenschleifen"], esES: ["Joyería"], esMX: ["Joyería"], ptBR: ["Joalheria"], itIT: ["Oreficeria"], ruRU: ["Ювелирное дело"] } },
  Leatherworking: { skillLine: 165, names: { enUS: ["Leatherworking"], frFR: ["Travail du cuir"], deDE: ["Lederverarbeitung"], esES: ["Peletería"], esMX: ["Peletería"], ptBR: ["Couraria"], itIT: ["Conciatura"], ruRU: ["Кожевничество"] } },
  Mining: { skillLine: 186, names: { enUS: ["Mining"], frFR: ["Minage"], deDE: ["Bergbau"], esES: ["Minería"], esMX: ["Minería"], ptBR: ["Mineração"], itIT: ["Estrazione"], ruRU: ["Горное дело"] } },
  Skinning: { skillLine: 393, names: { enUS: ["Skinning"], frFR: ["Dépeçage"], deDE: ["Kürschnerei"], esES: ["Desuello"], esMX: ["Desuello", "Desollar"], ptBR: ["Esfolamento"], itIT: ["Scuoiatura"], ruRU: ["Снятие шкур"] } },
  Tailoring: { skillLine: 197, names: { enUS: ["Tailoring"], frFR: ["Couture"], deDE: ["Schneiderei"], esES: ["Sastrería"], esMX: ["Sastrería"], ptBR: ["Alfaiataria"], itIT: ["Sartoria"], ruRU: ["Портняжное дело"] } },
  Cooking: { skillLine: 185, names: { enUS: ["Cooking"], frFR: ["Cuisine"], deDE: ["Kochkunst"], esES: ["Cocina"], esMX: ["Cocina"], ptBR: ["Culinária"], itIT: ["Cucina"], ruRU: ["Кулинария"] } },
  "First Aid": { skillLine: 129, names: { enUS: ["First Aid"], frFR: ["Premiers soins", "Secourisme"], deDE: ["Erste Hilfe"], esES: ["Primeros auxilios"], esMX: ["Primeros auxilios"], ptBR: ["Primeiros Socorros"], itIT: ["Primo Soccorso"], ruRU: ["Первая помощь"] } },
  Fishing: { skillLine: 356, names: { enUS: ["Fishing"], frFR: ["Pêche"], deDE: ["Angeln"], esES: ["Pesca"], esMX: ["Pesca"], ptBR: ["Pesca"], itIT: ["Pesca"], ruRU: ["Рыбная ловля"] } },
  Archaeology: { skillLine: 794, names: { enUS: ["Archaeology"], frFR: ["Archéologie"], deDE: ["Archäologie"], esES: ["Arqueología"], esMX: ["Arqueología"], ptBR: ["Arqueologia"], itIT: ["Archeologia"], ruRU: ["Археология"] } },
  // Added 13 November 2026: the production database already held "Poisons" rows (migration 20270212000000 maps the other spellings).
  Poisons: { skillLine: 40, names: { enUS: ["Poisons"], frFR: ["Poisons"], deDE: ["Gifte"], esES: ["Venenos"], esMX: ["Venenos"], ptBR: ["Venenos"], itIT: ["Veleni"], ruRU: ["Яды"] } }
};

/** Lower-case, accent-tolerant comparison key ("Dépeçage" and "depecage" match, trailing spaces and case do not matter). */
export const professionLookupKey = (name: string): string =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const BY_NAME = new Map<string, string>();
const BY_SKILL_LINE = new Map<number, string>();
for (const [canonical, identity] of Object.entries(PROFESSION_IDENTITIES)) {
  BY_SKILL_LINE.set(identity.skillLine, canonical);
  for (const names of Object.values(identity.names)) for (const name of names) BY_NAME.set(professionLookupKey(name), canonical);
}

/** The canonical (English) profession for a name in any client language, or undefined when it is not a known profession. */
export const canonicalProfessionName = (name: string): string | undefined => BY_NAME.get(professionLookupKey(name));
/** The canonical profession for a skill line id. */
export const professionBySkillLine = (skillLine: number): string | undefined => BY_SKILL_LINE.get(skillLine);
/** The canonical name when known, otherwise the trimmed input (a name the guild typed by hand stays as it was). */
export const normalizeProfessionName = (name: string): string => canonicalProfessionName(name) ?? name.trim();

/** Every spelling stored in the wild for a canonical profession, for queries that must still find old rows. */
export const professionSpellings = (canonical: string): string[] => {
  const identity = PROFESSION_IDENTITIES[canonical];
  return identity ? [...new Set(Object.values(identity.names).flat())] : [canonical];
};

/** "Cuisine:300,cooking:150" style lists (the digest format) merged by canonical name, keeping the highest skill. */
export function mergeProfessionSkills<T extends { name: string; skillLevel: number }>(skills: T[]): T[] {
  const merged = new Map<string, T>();
  for (const skill of skills) {
    const name = normalizeProfessionName(skill.name);
    if (!name) continue;
    const key = name.toLowerCase();
    const before = merged.get(key);
    if (!before || skill.skillLevel > before.skillLevel) merged.set(key, { ...skill, name });
  }
  return [...merged.values()];
}

/** The key two spellings of one profession share ("Cuisine", "cooking " and "Cooking" are all "cooking"). Names that are not known stay as typed. */
export const professionSlug = (name: string): string => normalizeProfessionName(name).toLowerCase();

/** "Cuisine 300, Pêche 150" (any language) as the canonical English names with the highest skill each: "Cooking 300, Fishing 150". Unreadable parts are kept. */
export function canonicalProfessionText(text: string | null | undefined): string {
  const order: string[] = [];
  const best = new Map<string, number | null>();
  for (const raw of (text ?? "").split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const match = /^(.*?)\s+(\d+)$/.exec(part);
    const name = normalizeProfessionName(match?.[1] ?? part);
    const skill = match?.[2] ? Number(match[2]) : null;
    if (!best.has(name)) order.push(name);
    const before = best.get(name);
    if (!best.has(name) || (skill !== null && (before === null || before === undefined || skill > before))) best.set(name, skill);
  }
  return order.map(name => { const skill = best.get(name); return skill === null || skill === undefined ? name : `${name} ${skill}`; }).join(", ");
}
