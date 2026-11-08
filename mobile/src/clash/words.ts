import type { Lang } from "../i18n";

// Guilded Clash screen text, English and French (card names and rules text stay English until the set's French pass).
const words = {
  title: { en: "Guilded Clash", fr: "Guilded Clash" },
  intro: { en: "Duel the AI, beat the dungeon gauntlet and open free packs. Nothing is for sale.", fr: "Affrontez l'IA, battez le défi des donjons et ouvrez des paquets gratuits. Rien n'est à vendre." },
  sample: { en: "Sample game: made-up cards and a simple practice opponent. Sign in to play on your server.", fr: "Partie d'exemple : cartes inventées et adversaire d'entraînement simple. Connectez-vous pour jouer sur votre serveur." },
  open: { en: "Open Guilded Clash", fr: "Ouvrir Guilded Clash" },
  back: { en: "← Back", fr: "← Retour" },
  play: { en: "Play", fr: "Jouer" },
  collection: { en: "Collection", fr: "Collection" },
  packs: { en: "Packs", fr: "Paquets" },
  resume: { en: "Your matches", fr: "Vos matchs" },
  resumeOne: { en: "Resume", fr: "Reprendre" },
  noActive: { en: "No match in progress.", fr: "Aucun match en cours." },
  aiTitle: { en: "Practice against the AI", fr: "Entraînement contre l'IA" },
  yourClass: { en: "Your class", fr: "Votre classe" },
  level: { en: "Level", fr: "Niveau" },
  easy: { en: "Easy", fr: "Facile" }, normal: { en: "Normal", fr: "Normal" }, hard: { en: "Hard", fr: "Difficile" },
  startAi: { en: "AI match", fr: "Match contre l'IA" },
  gauntlet: { en: "Dungeon gauntlet", fr: "Défi des donjons" },
  gauntletIntro: { en: "Five bosses, each in its own Zone. Beat one to unlock the next.", fr: "Cinq boss, chacun dans sa Zone. Battez-en un pour débloquer le suivant." },
  fight: { en: "Fight", fr: "Combattre" },
  cleared: { en: "Cleared", fr: "Vaincu" },
  locked: { en: "Locked", fr: "Verrouillé" },
  featured: { en: "This week", fr: "Cette semaine" },
  reward: { en: "Reward", fr: "Récompense" },
  dust: { en: "dust", fr: "poussière" },
  pack: { en: "pack", fr: "paquet" },
  quests: { en: "Today's quests", fr: "Quêtes du jour" },
  packProgress: { en: "Pack from play", fr: "Paquet par le jeu" },
  record: { en: "Wins / losses", fr: "Victoires / défaites" },
  owned: { en: "owned", fr: "possédées" },
  all: { en: "All", fr: "Toutes" }, mine: { en: "Owned", fr: "Possédées" }, missing: { en: "Missing", fr: "Manquantes" },
  craft: { en: "Craft", fr: "Fabriquer" },
  crafted: { en: "Crafted.", fr: "Fabriquée." },
  notCraftable: { en: "Earned from achievements, not crafted.", fr: "Obtenue par les succès, pas fabriquée." },
  needDust: { en: "Not enough dust yet.", fr: "Pas encore assez de poussière." },
  close: { en: "Close", fr: "Fermer" },
  copies: { en: "copies", fr: "exemplaires" },
  ready: { en: "packs ready", fr: "paquets prêts" },
  nextPack: { en: "Next free pack", fr: "Prochain paquet gratuit" },
  openPack: { en: "Open a pack", fr: "Ouvrir un paquet" },
  noPack: { en: "No pack ready. A new one arrives every 20 hours (up to 3 are kept).", fr: "Aucun paquet prêt. Un nouveau arrive toutes les 20 heures (jusqu'à 3 gardés)." },
  tear: { en: "Tap the pack to tear it open", fr: "Touchez le paquet pour l'ouvrir" },
  flip: { en: "Tap each card to turn it over", fr: "Touchez chaque carte pour la retourner" },
  flipAll: { en: "Turn all", fr: "Tout retourner" },
  isNew: { en: "NEW", fr: "NOUVEAU" },
  dustGained: { en: "Dust from extra copies", fr: "Poussière des doublons" },
  done: { en: "Done", fr: "Terminé" },
  odds: { en: "Odds", fr: "Probabilités" },
  oddsLine: { en: "4 cards: Common or Uncommon. 1 card: Rare or better. Epic at least every {epic} packs, Legendary every {legendary}.", fr: "4 cartes : Commune ou Inhabituelle. 1 carte : Rare ou mieux. Épique au moins tous les {epic} paquets, Légendaire tous les {legendary}." },
  pity: { en: "Epic guaranteed in {epic} packs, Legendary in {legendary}.", fr: "Épique garantie dans {epic} paquets, Légendaire dans {legendary}." },
  mulligan: { en: "Starting hand: tap cards to replace, then Keep.", fr: "Main de départ : touchez les cartes à remplacer, puis Garder." },
  keep: { en: "Keep", fr: "Garder" },
  replaceN: { en: "Replace {n}", fr: "Remplacer {n}" },
  yourTurn: { en: "Your turn", fr: "Votre tour" },
  theirTurn: { en: "Opponent's turn", fr: "Tour de l'adversaire" },
  choosing: { en: "Opponent is choosing…", fr: "L'adversaire choisit…" },
  round: { en: "Round", fr: "Manche" },
  endTurn: { en: "End turn", fr: "Fin du tour" },
  power: { en: "Power", fr: "Pouvoir" },
  concede: { en: "Concede", fr: "Abandonner" },
  concedeAsk: { en: "Concede this match? It counts as a loss.", fr: "Abandonner ce match ? Il compte comme une défaite." },
  cancel: { en: "Cancel", fr: "Annuler" },
  pickTarget: { en: "Pick a target (highlighted).", fr: "Choisissez une cible (en surbrillance)." },
  pickMode: { en: "Choose one:", fr: "Choisissez :" },
  mode: { en: "Option {n}", fr: "Option {n}" },
  pickAttacker: { en: "Tap a ready unit (green) to attack, or a card to play.", fr: "Touchez une unité prête (verte) pour attaquer, ou une carte à jouer." },
  loot: { en: "Loot: keep one card.", fr: "Butin : gardez une carte." },
  zone: { en: "Zone", fr: "Zone" },
  noZone: { en: "No Zone", fr: "Aucune Zone" },
  hand: { en: "hand", fr: "main" },
  deck: { en: "deck", fr: "deck" },
  won: { en: "Victory!", fr: "Victoire !" },
  lost: { en: "Defeat", fr: "Défaite" },
  draw: { en: "Draw", fr: "Match nul" },
  rewards: { en: "Rewards", fr: "Récompenses" },
  playAgain: { en: "Back to Clash", fr: "Retour à Clash" },
  log: { en: "Battle log", fr: "Journal" },
  failed: { en: "The card game is unavailable right now.", fr: "Le jeu de cartes est indisponible pour le moment." },
  retry: { en: "Try again", fr: "Réessayer" },
  useSample: { en: "Try the sample game", fr: "Essayer la partie d'exemple" }
} as const;

export type WordKey = keyof typeof words;
export function w(key: WordKey, lang: Lang, vars?: Record<string, string | number>): string {
  const text: string = words[key][lang];
  return vars ? text.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name] ?? "")) : text;
}

export const CLASS_LABEL: Record<string, { en: string; fr: string }> = {
  warrior: { en: "Warrior", fr: "Guerrier" }, paladin: { en: "Paladin", fr: "Paladin" }, hunter: { en: "Hunter", fr: "Chasseur" },
  rogue: { en: "Rogue", fr: "Voleur" }, priest: { en: "Priest", fr: "Prêtre" }, shaman: { en: "Shaman", fr: "Chaman" },
  mage: { en: "Mage", fr: "Mage" }, warlock: { en: "Warlock", fr: "Démoniste" }, druid: { en: "Druid", fr: "Druide" }
};
/** Class powers (docs/plans/APP_TCG_GAME.md 2.8), shown on the Power button. */
export const POWER: Record<string, { en: string; fr: string }> = {
  warrior: { en: "Brace: +2 Armor", fr: "Parade : +2 Armure" }, paladin: { en: "Ward: Shield a unit", fr: "Égide : Bouclier" },
  hunter: { en: "Call Companion: 1/1", fr: "Compagnon : 1/1" }, rogue: { en: "Sinister Jab: 1 dmg", fr: "Coup bas : 1 dégât" },
  priest: { en: "Mending Word: Mend 3", fr: "Mot de soin : Soin 3" }, shaman: { en: "Stone Totem: 0/2 Guard", fr: "Totem de pierre : 0/2" },
  mage: { en: "Ember Spark: 1 dmg", fr: "Étincelle : 1 dégât" }, warlock: { en: "Soul Pact: draw", fr: "Pacte : pioche" }, druid: { en: "Growth: +1/+1", fr: "Croissance : +1/+1" }
};
