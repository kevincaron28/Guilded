import type { Lang } from "../i18n";
import { SET1 } from "./set1";
import { SET1_FR } from "./set1-fr";
import type { ClashCard, CollectionCard, Intent, MatchEvent, MatchResponse, Rarity, Target } from "./types";
import { RARITIES } from "./types";

// Pure state for the Clash screens: which card or unit is picked, what can be tapped next, the pack-opening steps and
// the collection grouping. The legal moves always come from the server (`view.legal`); nothing here knows the rules.

// ---- cards ----

const BY_ID = new Map(SET1.map((card) => [card.id, card]));
/** A set card by id, in the app language (French names, rules text and flavour); an unknown id (a newer set than this app) shows as a blank card instead of crashing. */
export function cardOf(id: string, lang: Lang = "en"): ClashCard {
  const card = BY_ID.get(id);
  const fr = lang === "fr" ? SET1_FR[id] : undefined;
  if (card && fr) return { ...card, name: fr.name, text: fr.text, flavour: fr.flavour };
  return card ?? { id, name: id, type: "spell", rarity: "common", cost: 0, cls: "neutral", text: "", flavour: "", artUrl: null };
}

/** Rules text without the keyword line already shown above it ("Guard. Rally: ..." shows "Rally: ..."); the flavour when there is none. */
export function rulesText(card: Pick<ClashCard, "text" | "flavour">, keywords: string): string {
  let text = card.text;
  if (keywords && text.startsWith(keywords)) text = text.slice(keywords.length).replace(/^[.,]\s*/, "");
  return text || card.flavour;
}

// ---- targets ----

export const targetKey = (target: Target): string => "unit" in target ? `u:${target.unit}` : "champ" in target ? `c:${target.champ}` : `h:${target.hand}`;

export const playsOf = (legal: Intent[], hand: number) => legal.filter((i): i is Extract<Intent, { t: "play" }> => i.t === "play" && i.hand === hand);
export const attacksOf = (legal: Intent[], unit: number) => legal.filter((i): i is Extract<Intent, { t: "attack" }> => i.t === "attack" && i.unit === unit);
export const powersOf = (legal: Intent[]) => legal.filter((i): i is Extract<Intent, { t: "power" }> => i.t === "power");
export const canEnd = (legal: Intent[]) => legal.some((i) => i.t === "end");

/** Distinct modes of a modal card ("Choose: ..."), in order; empty when the card has one way to play. */
export function modesOf(legal: Intent[], hand: number): number[] {
  const modes = [...new Set(playsOf(legal, hand).map((i) => i.mode).filter((m): m is number => m !== undefined))];
  return modes.length > 1 ? modes.sort((a, b) => a - b) : [];
}

export type Selection =
  | { k: "none" }
  | { k: "hand"; hand: number; mode?: number }
  | { k: "attacker"; unit: number }
  | { k: "power" }
  | { k: "mulligan"; replace: number[] };

/** The moves the current selection can still become (filtered by the chosen mode, if any). */
export function candidates(selection: Selection, legal: Intent[]): Intent[] {
  switch (selection.k) {
    case "hand": return playsOf(legal, selection.hand).filter((i) => selection.mode === undefined || i.mode === undefined || i.mode === selection.mode);
    case "attacker": return attacksOf(legal, selection.unit);
    case "power": return powersOf(legal);
    default: return [];
  }
}

/** Board targets that light up for the current selection. */
export function targetsFor(selection: Selection, legal: Intent[]): Set<string> {
  const out = new Set<string>();
  for (const i of candidates(selection, legal)) if ("target" in i && i.target) out.add(targetKey(i.target));
  return out;
}

/** A selection that needs no target (and no mode choice) resolves to its single move at once. */
export function immediate(selection: Selection, legal: Intent[]): Intent | null {
  if (selection.k === "hand" && selection.mode === undefined && modesOf(legal, selection.hand).length) return null;
  const options = candidates(selection, legal);
  return options.length === 1 && !("target" in options[0]! && options[0]!.target) ? options[0]! : null;
}

/** The move a tap on a board target makes, or null when that target is not legal for the selection. */
export function resolveTap(selection: Selection, legal: Intent[], target: Target): Intent | null {
  const key = targetKey(target);
  return candidates(selection, legal).find((i) => "target" in i && i.target && targetKey(i.target) === key) ?? null;
}

// ---- the match screen reducer ----

export interface MatchUi { res: MatchResponse | null; selection: Selection; busy: boolean; error: string | null; log: string[] }
export type MatchUiAction =
  | { type: "loaded"; res: MatchResponse }
  | { type: "selectHand"; hand: number }
  | { type: "selectMode"; mode: number }
  | { type: "selectAttacker"; unit: number }
  | { type: "selectPower" }
  | { type: "toggleMulligan"; hand: number }
  | { type: "cancel" }
  | { type: "sending" }
  | { type: "failed"; message: string };

export const initialMatchUi: MatchUi = { res: null, selection: { k: "none" }, busy: false, error: null, log: [] };
const MAX_LOG = 12;

export function matchUiReducer(state: MatchUi, action: MatchUiAction): MatchUi {
  const legal = state.res?.view.legal ?? [];
  switch (action.type) {
    case "loaded": {
      const lines = describeEvents(action.res.events);
      const selection: Selection = action.res.view.phase === "mulligan" && action.res.view.yourTurn ? { k: "mulligan", replace: [] } : { k: "none" };
      return { res: action.res, selection, busy: false, error: null, log: [...state.log, ...lines].slice(-MAX_LOG) };
    }
    case "selectHand":
      if (state.selection.k === "hand" && state.selection.hand === action.hand) return { ...state, selection: { k: "none" } };
      return playsOf(legal, action.hand).length ? { ...state, selection: { k: "hand", hand: action.hand }, error: null } : state;
    case "selectMode":
      return state.selection.k === "hand" ? { ...state, selection: { ...state.selection, mode: action.mode } } : state;
    case "selectAttacker":
      if (state.selection.k === "attacker" && state.selection.unit === action.unit) return { ...state, selection: { k: "none" } };
      return attacksOf(legal, action.unit).length ? { ...state, selection: { k: "attacker", unit: action.unit }, error: null } : state;
    case "selectPower":
      if (state.selection.k === "power") return { ...state, selection: { k: "none" } };
      return powersOf(legal).length ? { ...state, selection: { k: "power" }, error: null } : state;
    case "toggleMulligan": {
      if (state.selection.k !== "mulligan") return state;
      const has = state.selection.replace.includes(action.hand);
      const replace = has ? state.selection.replace.filter((i) => i !== action.hand) : [...state.selection.replace, action.hand].sort((a, b) => a - b);
      return { ...state, selection: { k: "mulligan", replace } };
    }
    case "cancel":
      return state.selection.k === "mulligan" ? state : { ...state, selection: { k: "none" } };
    case "sending":
      return { ...state, busy: true, error: null };
    case "failed":
      return { ...state, busy: false, error: action.message, selection: state.selection.k === "mulligan" ? state.selection : { k: "none" } };
  }
}

/** Short lines for the battle log. Seat 0 is always the player. */
export function describeEvents(events: MatchEvent[]): string[] {
  const who = (p: unknown) => p === 0 ? "You" : "Foe";
  const name = (id: unknown) => typeof id === "string" ? cardOf(id).name : "a card";
  return events.flatMap((e): string[] => {
    switch (e.t) {
      case "play": return [`${who(e.p)} played ${name(e.card)}.`];
      case "power": return [`${who(e.p)} used the class power.`];
      case "death": return [`${name(e.card)} died.`];
      case "damage": return typeof e.champ === "number" ? [`${e.champ === 0 ? "Your" : "Foe's"} Champion took ${String(e.n)}.`] : [];
      case "secondWind": return [`${who(e.p)}: Second Wind!`];
      case "exhaustion": return [`${who(e.p)} took ${String(e.n)} Exhaustion.`];
      case "turn": return e.p === 0 ? [`Your turn ${String(e.turn ?? "")}: ${String(e.mana ?? "")} mana.`] : [];
      case "over": return [e.winner === 0 ? "Victory!" : e.winner === "draw" ? "Draw." : "Defeat."];
      default: return [];
    }
  });
}

// ---- pack opening ----

export type PackStage = "sealed" | "torn" | "fanned" | "done";
export interface PackUi { stage: PackStage; flipped: boolean[] }
export type PackAction = { type: "tear" } | { type: "fan" } | { type: "flip"; index: number } | { type: "flipAll" } | { type: "reset"; size: number };

export const packStart = (size: number): PackUi => ({ stage: "sealed", flipped: Array.from({ length: size }, () => false) });

export function packReducer(state: PackUi, action: PackAction): PackUi {
  switch (action.type) {
    case "reset": return packStart(action.size);
    case "tear": return state.stage === "sealed" ? { ...state, stage: "torn" } : state;
    case "fan": return state.stage === "torn" ? { ...state, stage: "fanned" } : state;
    case "flip": {
      if (state.stage !== "fanned" || state.flipped[action.index] !== false) return state;
      const flipped = state.flipped.map((f, i) => f || i === action.index);
      return { stage: flipped.every(Boolean) ? "done" : "fanned", flipped };
    }
    case "flipAll": return state.stage === "fanned" || state.stage === "torn" ? { stage: "done", flipped: state.flipped.map(() => true) } : state;
  }
}

/** Reveal order: commons first, the best card last (the "rare slot" moment). */
export function revealOrder(rarities: Rarity[]): number[] {
  return rarities.map((r, i) => [RARITIES.indexOf(r), i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i);
}

// ---- collection ----

export type OwnedFilter = "all" | "owned" | "missing";
export interface CollectionGroup { key: string; title: string; cards: CollectionCard[]; owned: number }

const CLASS_ORDER = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
/** The class a collection card belongs to (`class:mage:rare` → mage), or null for badge cards. */
export const classOfKey = (key: string): string | null => key.startsWith("class:") ? key.split(":")[1] ?? null : null;

/** Cards grouped by class (then badges), each group sorted by rarity then name. Filters keep empty groups out. */
export function groupCollection(cards: CollectionCard[], filter: OwnedFilter, rarity: Rarity | "all" = "all"): CollectionGroup[] {
  const keep = cards.filter((c) => (filter === "all" || (filter === "owned") === c.owned) && (rarity === "all" || c.rarity === rarity));
  const groups = new Map<string, CollectionCard[]>();
  for (const card of keep) {
    const key = classOfKey(card.key) ?? "badges";
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const order = [...CLASS_ORDER, "badges"];
  return [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([key, list]) => ({
    key, title: key === "badges" ? "Badges" : key.charAt(0).toUpperCase() + key.slice(1),
    cards: [...list].sort((a, b) => RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) || a.name.localeCompare(b.name)),
    owned: list.filter((c) => c.owned).length
  }));
}

/** Whether the member can craft this card now. */
export const craftable = (card: CollectionCard, dust: number): boolean => !card.owned && card.craftCost !== null && card.craftCost <= dust;
