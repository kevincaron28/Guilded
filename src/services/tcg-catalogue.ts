import { ACHIEVEMENTS, TIER_LABEL, achievementGameVisible, type AchievementTier } from "./achievements-catalogue.js";
import { CLASSES } from "../wow-data.js";

// Guilded Collection (docs/plans/APP_TCG.md option 2): the card catalogue, in code like the achievements, so there is
// nothing to seed and every server agrees. Two families: the 9 Forever classes in three art treatments (Common, Rare,
// Epic, see docs/plans/APP_TCG_ART.md) and one badge card per achievement. Cards are collectibles only: they have no
// cash, EP or GP value and never convert into anything that affects raid fairness.

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
export type CardFamily = "class" | "badge";

export interface CardDef {
  key: string; family: CardFamily; rarity: Rarity;
  /** The set shown in the collection: "Classes" or "Badges". */
  set: "classes" | "badges";
  en: { name: string; flavour?: string }; fr: { name: string; flavour?: string };
  classKey?: string; achievementId?: string;
}

const FR_CLASS: Record<string, string> = { Warrior: "Guerrier", Paladin: "Paladin", Hunter: "Chasseur", Rogue: "Voleur", Priest: "Prêtre", Shaman: "Chaman", Mage: "Mage", Warlock: "Démoniste", Druid: "Druide" };
const CLASS_TREATMENTS: readonly Rarity[] = ["common", "rare", "epic"];
const TIER_RARITY: Record<AchievementTier, Rarity> = { bronze: "common", silver: "uncommon", gold: "rare", platinum: "epic", epic: "epic", legendary: "legendary" };

/** The 9 classes WoW Forever has, each in three treatments. */
export const FOREVER_CLASSES = CLASSES.slice(0, 9);

const classCards: CardDef[] = FOREVER_CLASSES.flatMap(name => CLASS_TREATMENTS.map((rarity): CardDef => ({
  key: `class:${name.toLowerCase()}:${rarity}`, family: "class", rarity, set: "classes", classKey: name.toLowerCase(),
  en: { name }, fr: { name: FR_CLASS[name] ?? name }
})));

/** One card per achievement the album shows (Forever and guild sets; retired rows never become cards). */
const badgeCards: CardDef[] = ACHIEVEMENTS
  .filter(def => achievementGameVisible(def) && (def.edition ? def.edition === "forever" : def.game === "guild") && !def.legacy)
  .map((def): CardDef => ({
    key: `badge:${def.id}`, family: "badge", rarity: TIER_RARITY[def.tier], set: "badges", achievementId: def.id,
    en: { name: def.en.name, flavour: def.en.description }, fr: { name: def.fr.name, flavour: def.fr.description }
  }));

export const CARDS: readonly CardDef[] = [...classCards, ...badgeCards];
export const CARD_BY_KEY: ReadonlyMap<string, CardDef> = new Map(CARDS.map(card => [card.key, card]));
export const cardsOfRarity = (rarity: Rarity): CardDef[] => CARDS.filter(card => card.rarity === rarity);
export const RARITY_LABEL: Record<Rarity, { en: string; fr: string }> = {
  common: { en: "Common", fr: "Commune" }, uncommon: { en: "Uncommon", fr: "Inhabituelle" }, rare: { en: "Rare", fr: "Rare" },
  epic: { en: "Epic", fr: "Épique" }, legendary: { en: "Legendary", fr: "Légendaire" }
};
export { TIER_LABEL };
