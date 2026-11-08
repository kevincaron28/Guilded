// Guilded Clash: shared types for the rules engine and the card data (docs/plans/APP_TCG_GAME.md).
// Everything in the match state is plain JSON (numbers, strings, arrays, objects) so a match can be stored, replayed and hashed.

export type ClassKey = "warrior" | "paladin" | "hunter" | "rogue" | "priest" | "shaman" | "mage" | "warlock" | "druid";
export const CLASS_KEYS: readonly ClassKey[] = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type CardType = "unit" | "spell" | "gear" | "zone" | "standard";
/** Keywords that live on a unit. Rally, Last Stand, Frenzy, Loot, Cooldown, Chill, Mend, Armor and Dispel are effects. */
export type Keyword = "guard" | "swift" | "shield" | "shadow" | "venom" | "drain" | "twin";
export type Role = "tank" | "healer" | "damage";

/** What a card or power can choose as its target. */
export type Sel =
  | "enemyUnit" | "friendlyUnit" | "friendlyOtherUnit" | "anyUnit" | "friendlyChar" | "anyChar"
  | "undamagedUnit" | "attackedUnit" | "bigUnit" | "friendlyNoGear" | "handOther";
/** Who or what an effect hits. "target" is the chosen target. */
export type To =
  | "target" | "self" | "myChamp" | "oppChamp"
  | "allEnemyUnits" | "allFriendlyUnits" | "otherFriendlyUnits" | "allUnits" | "otherUnits" | "allFriendlyChars"
  | "randomEnemyUnit" | "randomEnemyChar" | "randomDamagedFriendlyChar";
export type Cond = "zone" | "party" | "units3" | "low10";

export interface EffBase { if?: Cond }
export type Eff = EffBase & (
  | { k: "dmg"; n: number; to: To; recoil?: number }
  | { k: "mend"; n: number; to: To }
  | { k: "armor"; n: number }
  | { k: "draw"; n: number }
  | { k: "buff"; a: number; h: number; to: To; turn?: boolean }
  | { k: "kw"; kw: Keyword; to: To; turn?: boolean }
  | { k: "summon"; token: string; n: number }
  | { k: "summonCopy"; hp1?: boolean; shield?: boolean }
  | { k: "destroy"; to: To }
  | { k: "chill"; to: To }
  | { k: "dispel"; to: To }
  | { k: "selfDmg"; n: number }
  | { k: "tempMana"; n: number }
  | { k: "loot"; spell?: boolean }
  | { k: "steal" }
  | { k: "returnSelf" }
  | { k: "returnLastDied" }
  | { k: "discard" }
  | { k: "cooldown"; n: number }
  | { k: "nextDiscount"; n: number }
  | { k: "nextSpellFree" }
  | { k: "bothMend"; n: number }
  | { k: "splitDmg"; n: number }
  | { k: "hpPerDamaged" }
  | { k: "atkPerGear" }
);

/** One way of playing a card: its target (if any) and what it does. A card with several abilities is modal: the player picks one. */
export interface Ability { target?: Sel; effects: Eff[] }

export type Aura =
  | { k: "atkIfTankHealer"; n: number }
  | { k: "hpRoles"; n: number; roles: Role[] }
  | { k: "spellCost"; n: number }
  | { k: "gearCost"; n: number };

export interface GearDef { atk: number; hp: number; kw?: Keyword[]; thorns?: boolean; lastStand?: Eff[]; onSpell?: Eff[] }

/** Flags the engine checks by name for Zones and Standards, whose rules are not simple effect lists. */
export type ZoneFlag = "burning" | "narrow" | "overgrown" | "echoes" | "smoke" | "cairn";
export type StandardFlag = "powerCost" | "gearCost" | "survivor" | "armorOnKill" | "zoneDiscount" | "gearReturn" | "atkOnTurn" | "perfectRun";

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  rarity: Rarity;
  cost: number;
  /** A class, or "neutral" for the 11 neutral cards that every class can use. */
  cls: ClassKey | "neutral";
  atk?: number;
  hp?: number;
  kw?: Keyword[];
  /** Spell effect, or a unit's Rally (the player picks one ability when there are several). */
  onPlay?: Ability[];
  lastStand?: Eff[];
  frenzy?: Eff[];
  startTurn?: Eff[];
  endTurn?: Eff[];
  aura?: Aura[];
  gear?: GearDef;
  zone?: ZoneFlag;
  standard?: StandardFlag;
  /** Standards: which family of achievements earns it. */
  family?: "pvp" | "social" | "craft" | "dungeon" | "raid";
  role?: Role;
  cooldown?: number;
  /** Rules text in English (the French pass comes with the app screens). */
  text: string;
  flavour: string;
  /** Tokens are summoned by other cards and are never in a deck. */
  token?: boolean;
  /** The Loot Bag is not a "card played" for discounts and spell triggers. */
  bag?: boolean;
}

// ---- match state ----

export interface UnitState {
  uid: number;
  card: string;
  /** Printed Attack plus permanent buffs and gear. */
  atk: number;
  /** Maximum Health: printed plus permanent buffs and gear (auras are added on top when read). */
  hp: number;
  /** Damage taken; current Health is maximum Health minus this. */
  dmg: number;
  kw: Keyword[];
  tempKw: Keyword[];
  tempAtk: number;
  attacks: number;
  /** The global turn this unit entered play (summoning sickness unless Swift). */
  since: number;
  chilled: boolean;
  gear: string | null;
  gearOn: boolean;
  frenzied: boolean;
  doomed: boolean;
  survivor: boolean;
  zoneShieldUntil: number | null;
}

export interface PlayerState {
  cls: ClassKey;
  hp: number;
  armor: number;
  deck: string[];
  hand: string[];
  board: UnitState[];
  standard: string | null;
  mana: number;
  turns: number;
  exhaustion: number;
  secondWind: boolean;
  powerUsed: boolean;
  cooldown: number;
  lastDied: string | null;
  partyDiscount: boolean;
  played: number;
  nextDiscount: number;
  nextSpellFree: boolean;
  perfectTurn: number;
  attacked: number;
}

export interface PendingLoot { kind: "loot"; p: 0 | 1; options: string[] }

export interface MatchState {
  v: 1;
  rng: number;
  turn: number;
  first: 0 | 1;
  active: 0 | 1;
  phase: "mulligan" | "main" | "over";
  /** During the mulligan, which players have decided. */
  mulligan: [boolean, boolean];
  players: [PlayerState, PlayerState];
  zone: { card: string; owner: 0 | 1 } | null;
  nextUid: number;
  pending: PendingLoot[];
  winner: 0 | 1 | "draw" | null;
  reason: string | null;
}

export type Target = { unit: number } | { champ: 0 | 1 } | { hand: number };

export type Action =
  | { t: "mulligan"; replace: number[] }
  | { t: "play"; hand: number; target?: Target; mode?: number }
  | { t: "attack"; unit: number; target: Target }
  | { t: "power"; target?: Target }
  | { t: "choose"; index: number }
  | { t: "end" }
  | { t: "concede"; p: 0 | 1 };

export interface MatchEvent { t: string; [key: string]: unknown }

export interface DeckList { cls: ClassKey; cards: string[] }
