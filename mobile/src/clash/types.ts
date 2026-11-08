// Guilded Clash on the phone: the shapes the bot sends. Mirrors the server contract of
// src/services/tcg-store.ts (#626, collection, packs, crafting) and src/services/tcg-match.ts (#638, matches and the
// PvE gauntlet). The phone never runs the rules: it draws the projection and sends intents the server validates.

export type ClassKey = "warrior" | "paladin" | "hunter" | "rogue" | "priest" | "shaman" | "mage" | "warlock" | "druid";
export const CLASS_KEYS: readonly ClassKey[] = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
export type CardType = "unit" | "spell" | "gear" | "zone" | "standard";
export type Keyword = "guard" | "swift" | "shield" | "shadow" | "venom" | "drain" | "twin";
export type Role = "tank" | "healer" | "damage";
export type AiLevel = "easy" | "normal" | "hard";

/** Display data of a set card (generated into set1.ts). `artUrl` stays null until the owner approves the painted art. */
export interface ClashCard {
  id: string; name: string; type: CardType; rarity: Rarity; cost: number; cls: ClassKey | "neutral";
  atk?: number; hp?: number; kw?: Keyword[]; role?: Role; gear?: { atk: number; hp: number };
  text: string; flavour: string; token?: boolean; artUrl?: string | null;
}

// ---- collection (#626) ----

export interface CollectionCard {
  key: string; family: "class" | "badge"; rarity: Rarity; rarityLabel: string; set: "classes" | "badges"; name: string; flavour: string | null;
  owned: boolean; count: number; firstSeenAt: string | null; craftCost: number | null; artUrl: string | null;
}
export interface Collection {
  cards: CollectionCard[]; owned: number; total: number; dust: number;
  packs: { ready: number; max: number; nextAt: string | null };
  pity: { epicIn: number; legendaryIn: number };
  odds: { ordinarySlots: Record<string, number>; rarePlusSlot: Record<string, number>; packSize: number; epicPity: number; legendaryPity: number } | null;
}
export interface PulledCard { key: string; rarity: Rarity; isNew: boolean; dust: number; name: string; rarityLabel: string }
export interface OpenedPack { cards: PulledCard[]; dustGained: number; collection: Collection }

// ---- matches (#638) ----

export type Target = { unit: number } | { champ: 0 | 1 } | { hand: number };
export type Intent =
  | { t: "mulligan"; replace: number[] }
  | { t: "play"; hand: number; target?: Target; mode?: number }
  | { t: "attack"; unit: number; target: Target }
  | { t: "power"; target?: Target }
  | { t: "choose"; index: number }
  | { t: "end" };

export interface UnitView {
  uid: number; card: string; atk: number; hp: number; dmg: number; kw: Keyword[]; tempKw: Keyword[]; tempAtk: number;
  attacks: number; since: number; chilled: boolean; gear: string | null;
}
export interface SideView {
  cls: ClassKey; hp: number; maxHp: number; armor: number; board: UnitView[]; standard: string | null;
  mana: number; turns: number; powerUsed: boolean; deckCount: number; secondWind: boolean;
}
export interface OwnSide extends SideView { hand: string[] }
export interface OpponentSide extends SideView { handCount: number }
export interface PlayerView {
  phase: "mulligan" | "main" | "over"; turn: number; round: number; active: 0 | 1; actor: 0 | 1; yourTurn: boolean; first: 0 | 1;
  mulligan: [boolean, boolean]; zone: { card: string; owner: 0 | 1 } | null;
  me: OwnSide; opponent: OpponentSide; pending: { kind: "loot"; p: 0 | 1; options: string[] } | null; opponentChoosing: boolean;
  winner: 0 | 1 | "draw" | null; reason: string | null; legal: Intent[];
}
export type MatchKind = "ai" | "pve";
export type MatchStatus = "active" | "won" | "lost" | "draw";
export interface MatchInfo {
  id: string; kind: MatchKind; aiLevel: AiLevel; boss: { id: string; name: string } | null; status: MatchStatus; reason: string | null;
  round: number; version: number; turnSeconds: number; turnDeadlineAt: string | null; createdAt: string; finishedAt: string | null;
  rewards: { dust: number; packs: number } | null;
}
export interface MatchEvent { t: string; [key: string]: unknown }
export interface MatchRewards { dust: number; packs: number; overflowDust: number; questsCompleted: string[]; packProgress: number; won: boolean }
export interface MatchResponse { match: MatchInfo; view: PlayerView; events: MatchEvent[]; rewards: MatchRewards | null }
export interface StartInput { mode: MatchKind; cls: ClassKey; level?: AiLevel; opponent?: ClassKey; boss?: string }

export interface PveBoss {
  id: string; name: string; flavour: string; cls: ClassKey; level: AiLevel; health: number; reward: { dust: number; packs: number };
  cleared: boolean; unlocked: boolean; paidToday: boolean; spotlight: boolean;
}
export interface PveProgress {
  bosses: PveBoss[]; cleared: number; runs: number;
  featured: { week: number; boss: string; note: string };
  daily: { day: string; quests: { id: string; text: string; target: number; progress: number; done: boolean }[]; packsFromPlay: number; packCap: number; packProgress: number; stepsPerPack: number };
  wins: number; losses: number;
}
