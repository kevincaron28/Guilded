import type { Ability, Aura, CardDef, ClassKey, Cond, Eff, GearDef, Keyword, Rarity, Role, Sel, StandardFlag, To, ZoneFlag } from "./tcg-engine-types.js";
import { CLASS_KEYS } from "./tcg-engine-types.js";

// Guilded Clash set 1, "Dawn of Forever": the 150 cards of docs/plans/APP_TCG_GAME.md section 8 as data, with the owner's
// 8 November decision applied (27 neutral cards moved into the class columns, three per class). Names are original;
// the flavour lines are placeholders for the writing pass. No art refs here (art is separate and owner-approved).

// ---- effect shorthands ----
const dmg = (n: number, to: To = "target", recoil?: number): Eff => recoil ? { k: "dmg", n, to, recoil } : { k: "dmg", n, to };
const mend = (n: number, to: To = "target"): Eff => ({ k: "mend", n, to });
const armor = (n: number): Eff => ({ k: "armor", n });
const draw = (n: number): Eff => ({ k: "draw", n });
const buff = (a: number, h: number, to: To = "target", turn = false): Eff => ({ k: "buff", a, h, to, ...(turn ? { turn } : {}) });
const kw = (word: Keyword, to: To = "target", turn = false): Eff => ({ k: "kw", kw: word, to, ...(turn ? { turn } : {}) });
const summon = (token: string, n = 1): Eff => ({ k: "summon", token, n });
const when = (cond: Cond, e: Eff): Eff => ({ ...e, if: cond });
const A = (effects: Eff[], target?: Sel): Ability => (target ? { target, effects } : { effects });

const cards: CardDef[] = [];
interface Opts { kw?: Keyword[]; onPlay?: Ability[]; lastStand?: Eff[]; frenzy?: Eff[]; startTurn?: Eff[]; endTurn?: Eff[]; aura?: Aura[]; role?: Role; cooldown?: number }
const unit = (id: string, name: string, cls: CardDef["cls"], rarity: Rarity, cost: number, atk: number, hp: number, text: string, flavour: string, o: Opts = {}): void => {
  cards.push({ id, name, type: "unit", rarity, cost, cls, atk, hp, text, flavour, ...o });
};
const spell = (id: string, name: string, cls: CardDef["cls"], rarity: Rarity, cost: number, text: string, flavour: string, onPlay: Ability[], o: Opts = {}): void => {
  cards.push({ id, name, type: "spell", rarity, cost, cls, text, flavour, onPlay, ...o });
};
const gear = (id: string, name: string, cls: CardDef["cls"], rarity: Rarity, cost: number, g: GearDef, text: string, flavour: string): void => {
  cards.push({ id, name, type: "gear", rarity, cost, cls, gear: g, text, flavour });
};
const zone = (id: string, name: string, rarity: Rarity, cost: number, flag: ZoneFlag, text: string, flavour: string): void => {
  cards.push({ id, name, type: "zone", rarity, cost, cls: "neutral", zone: flag, text, flavour });
};
const standard = (id: string, name: string, rarity: Rarity, family: NonNullable<CardDef["family"]>, text: string, flavour: string, o: { flag?: StandardFlag; startTurn?: Eff[] }): void => {
  cards.push({ id, name, type: "standard", rarity, cost: 2, cls: "neutral", family, ...(o.flag ? { standard: o.flag } : {}), ...(o.startTurn ? { startTurn: o.startTurn } : {}), text, flavour });
};

// ---- Warrior ----
unit("001", "Gate Brawler", "warrior", "common", 1, 2, 1, "", "He lost the argument and found the door.");
spell("002", "Cleaving Strike", "warrior", "common", 2, "Deal 3 damage to a unit. If it survives, it deals 2 damage to your Champion.", "Not every swing is clean.", [A([dmg(3, "target", 2)], "anyUnit")]);
unit("003", "Shield Wall Recruit", "warrior", "common", 2, 2, 2, "Guard", "Stand where you are told.", { kw: ["guard"] });
unit("004", "Scarred Veteran", "warrior", "common", 3, 3, 3, "Frenzy: gain +2 Attack the first time this survives damage.", "Every scar is a lesson.", { frenzy: [buff(2, 0, "self")] });
spell("005", "Battle Cry", "warrior", "uncommon", 3, "Give all friendly units +1 Attack this turn and Swift.", "Charge!", [A([buff(1, 0, "allFriendlyUnits", true), kw("swift", "allFriendlyUnits", true)])]);
unit("006", "Ironhide Captain", "warrior", "uncommon", 3, 2, 3, "Guard. Rally: gain +1 Health per damaged friendly unit.", "He counts the wounded twice.", { kw: ["guard"], onPlay: [A([{ k: "hpPerDamaged" }])] });
unit("007", "Banner Carrier", "warrior", "common", 4, 3, 4, "Rally: your Champion gains 2 Armor.", "Up the colours!", { onPlay: [A([armor(2)])] });
unit("008", "Berserker Chieftain", "warrior", "rare", 5, 4, 4, "Twin Strike", "Two swings, no questions.", { kw: ["twin"] });
unit("009", "Unbroken Bulwark", "warrior", "rare", 6, 5, 6, "Guard, Shield", "It outlasts the war.", { kw: ["guard", "shield"] });
unit("010", "Warlord of the Pass", "warrior", "epic", 7, 7, 7, "Guard. Rally: your Champion gains 6 Armor.", "The road ends here.", { kw: ["guard"], onPlay: [A([armor(6)])] });
unit("011", "Last Shield of the Vale", "warrior", "legendary", 8, 6, 8, "Guard, Shield. Last Stand: your Champion gains 10 Armor.", "One more stand.", { kw: ["guard", "shield"], lastStand: [armor(10)] });

// ---- Paladin ----
unit("012", "Chapel Acolyte", "paladin", "common", 1, 1, 2, "", "Keeps the candles lit.");
spell("013", "Boon of Strength", "paladin", "common", 2, "Give a unit +3 Attack this turn.", "A hand on the shoulder.", [A([buff(3, 0, "target", true)], "anyUnit")]);
unit("014", "Oathsworn Squire", "paladin", "common", 2, 2, 2, "Shield", "Sworn on his first day.", { kw: ["shield"] });
unit("015", "Shieldmaiden", "paladin", "common", 3, 3, 4, "Guard", "Shoulders first.", { kw: ["guard"] });
unit("016", "Dawn Healer", "paladin", "common", 4, 3, 3, "Rally: Mend 4 a friendly character.", "Light finds the hurt.", { onPlay: [A([mend(4)], "friendlyChar")] });
spell("017", "Reckoning", "paladin", "uncommon", 4, "Destroy a unit with 5 or more Attack.", "The scales tilt.", [A([{ k: "destroy", to: "target" }], "bigUnit")]);
unit("018", "Dawn Avenger", "paladin", "rare", 4, 3, 3, "Shield. Rally: give a friendly unit Shield.", "Take mine too.", { kw: ["shield"], onPlay: [A([kw("shield")], "friendlyOtherUnit")] });
unit("019", "Crusader of the Ember", "paladin", "uncommon", 5, 5, 5, "Shield", "Burns brighter hurt.", { kw: ["shield"] });
unit("020", "Sunward Marshal", "paladin", "rare", 6, 5, 5, "Guard. Rally: give your other units +1/+1.", "League standard.", { kw: ["guard"], onPlay: [A([buff(1, 1, "otherFriendlyUnits")])] });
unit("021", "Archon of the Sunspire", "paladin", "epic", 7, 6, 6, "Shield, Drain", "A star pretending to be a man.", { kw: ["shield", "drain"] });
unit("022", "Avatar of Aegis", "paladin", "legendary", 8, 7, 7, "Guard, Shield. Rally: Mend 8 your Champion.", "The light bows to no one.", { kw: ["guard", "shield"], onPlay: [A([mend(8, "myChamp")])] });

// ---- Hunter ----
unit("023", "Trail Scout", "hunter", "common", 1, 2, 1, "", "First to the clearing.");
unit("024", "Hunting Wolf", "hunter", "common", 2, 3, 1, "Swift", "Faster than the arrow.", { kw: ["swift"] });
spell("025", "Snare Trap", "hunter", "uncommon", 2, "Deal 4 damage to a unit that attacked this turn.", "Mind the grass.", [A([dmg(4)], "attackedUnit")]);
unit("026", "Pack Rat Trapper", "hunter", "common", 3, 3, 3, "Rally: deal 1 damage to an enemy unit.", "Sets traps; trips on his own.", { onPlay: [A([dmg(1)], "enemyUnit")] });
spell("027", "Skewer Shot", "hunter", "common", 3, "Deal 4 damage to a unit.", "One arrow. Plenty.", [A([dmg(4)], "anyUnit")]);
unit("028", "Bow Master", "hunter", "common", 4, 4, 3, "Rally: deal 2 damage to the enemy Champion.", "He never counts the arrows.", { onPlay: [A([dmg(2, "oppChamp")])] });
unit("029", "Hawk Ranger", "hunter", "uncommon", 4, 3, 3, "Swift. Rally: deal 1 damage to an enemy unit.", "Eyes on the road.", { kw: ["swift"], onPlay: [A([dmg(1)], "enemyUnit")] });
unit("030", "Cave Stalker", "hunter", "rare", 5, 4, 3, "Shadow, Swift", "You hear it after.", { kw: ["shadow", "swift"] });
unit("031", "Wildheart Beastmaster", "hunter", "rare", 6, 4, 5, "Rally: summon a 3/3 Beast with Guard.", "The pack answers.", { onPlay: [A([summon("tk-beast-guard")])] });
unit("032", "King of the Marches", "hunter", "epic", 6, 6, 4, "Swift. Rally: deal 3 damage to each enemy unit.", "The wild answers to him.", { kw: ["swift"], onPlay: [A([dmg(3, "allEnemyUnits")])] });
unit("033", "Ancient Stag-Spirit", "hunter", "legendary", 7, 5, 5, "Guard. Last Stand: summon two 3/3 Beasts with Swift.", "It never really dies.", { kw: ["guard"], lastStand: [summon("tk-beast-swift", 2)] });

// ---- Rogue ----
unit("034", "Alley Cutpurse", "rogue", "common", 1, 2, 1, "", "Your purse is in my pocket.");
spell("035", "Cutthroat Strike", "rogue", "common", 1, "Deal 3 damage to an undamaged unit.", "The oldest trick.", [A([dmg(3)], "undamagedUnit")]);
unit("036", "Shadow Footpad", "rogue", "common", 2, 2, 2, "Shadow", "Gone before you blink.", { kw: ["shadow"] });
spell("037", "Quick Fingers", "rogue", "uncommon", 2, "Draw 2 cards.", "Look away.", [A([draw(2)])]);
unit("038", "Swindler", "rogue", "common", 3, 2, 4, "Rally: Loot a card from your deck: choose 1 of 3.", "Fingers fast.", { onPlay: [A([{ k: "loot" }])] });
unit("039", "Venom Dagger Acolyte", "rogue", "common", 3, 2, 2, "Venom", "Poisoned wit, poisoned blade.", { kw: ["venom"] });
unit("040", "Assassin of the Veil", "rogue", "uncommon", 4, 3, 2, "Shadow, Venom", "Whispers, then silence.", { kw: ["shadow", "venom"] });
unit("041", "Master Lockpick", "rogue", "uncommon", 4, 3, 3, "Rally: draw a card.", "No lock stays shut.", { onPlay: [A([draw(1)])] });
unit("042", "Nightblade Legend", "rogue", "legendary", 5, 5, 2, "Shadow, Venom, Twin Strike", "They never saw the second cut.", { kw: ["shadow", "venom", "twin"] });
unit("043", "Veilmaster", "rogue", "rare", 6, 5, 3, "Shadow, Twin Strike", "Two strokes from nowhere.", { kw: ["shadow", "twin"] });
unit("044", "Prince of Thieves", "rogue", "epic", 6, 5, 7, "Shadow. Rally: steal a random card from the enemy hand.", "Everything is a loan.", { kw: ["shadow"], onPlay: [A([{ k: "steal" }])] });

// ---- Priest ----
unit("045", "Temple Novice", "priest", "common", 1, 1, 2, "", "Lights the candles.");
unit("046", "Hospice Healer", "priest", "common", 2, 1, 3, "At the end of your turn, Mend 1 a damaged friendly character.", "Every ward needs one.", { endTurn: [mend(1, "randomDamagedFriendlyChar")] });
spell("047", "Radiant Lash", "priest", "common", 2, "Deal 3 damage to a unit.", "Burn.", [A([dmg(3)], "anyUnit")]);
spell("048", "Circle of Mending", "priest", "uncommon", 3, "Mend 3 each friendly character.", "For the whole room.", [A([mend(3, "allFriendlyChars")])]);
unit("049", "Spirit Warden", "priest", "uncommon", 3, 2, 2, "Last Stand: Mend 5 your Champion.", "Still watching.", { lastStand: [mend(5, "myChamp")] });
unit("050", "Cleric of the Veil", "priest", "common", 4, 3, 3, "Rally: Mend 4 a friendly character.", "Light finds the hurt.", { onPlay: [A([mend(4)], "friendlyChar")] });
unit("051", "Herald of the Dawn", "priest", "uncommon", 5, 4, 4, "Rally: give a friendly unit +2 Health.", "His voice carries.", { onPlay: [A([buff(0, 2)], "friendlyOtherUnit")] });
unit("052", "Soul Binder", "priest", "rare", 5, 3, 4, "Drain. Last Stand: return this to your hand.", "Death is a door.", { kw: ["drain"], lastStand: [{ k: "returnSelf" }] });
unit("053", "Shadowhymn Confessor", "priest", "rare", 6, 4, 6, "Rally: Dispel an enemy unit and deal 2 damage to it.", "Silence, please.", { onPlay: [A([{ k: "dispel", to: "target" }, dmg(2)], "enemyUnit")] });
unit("054", "Resurrected Saint", "priest", "legendary", 6, 4, 4, "Shield. Last Stand: summon a copy of this with Shield.", "Sainthood is a process.", { kw: ["shield"], lastStand: [{ k: "summonCopy", shield: true }] });
unit("055", "Matriarch of the Order", "priest", "epic", 7, 5, 8, "Drain. Rally: Mend 5 each friendly character.", "Order, now.", { kw: ["drain"], onPlay: [A([mend(5, "allFriendlyChars")])] });

// ---- Shaman ----
unit("056", "Totem Tender", "shaman", "common", 1, 1, 2, "", "Always one stone away.");
spell("057", "Lightning Lance", "shaman", "common", 2, "Deal 3 damage to a unit. Cooldown 1.", "Sky unspooled.", [A([dmg(3)], "anyUnit")], { cooldown: 1 });
unit("058", "Stoneward Totem", "shaman", "common", 2, 0, 4, "Guard", "Hums when it is angry.", { kw: ["guard"] });
unit("059", "Wind Rider", "shaman", "common", 3, 3, 2, "Twin Strike", "Two for one.", { kw: ["twin"] });
spell("060", "Spirit Link", "shaman", "uncommon", 3, "Give a unit Shield and +2 Attack this turn.", "Not alone.", [A([kw("shield"), buff(2, 0, "target", true)], "anyUnit")]);
unit("061", "Stormcaller", "shaman", "uncommon", 3, 2, 2, "Rally: deal 2 damage randomly split among enemy characters.", "Thunder is a promise.", { onPlay: [A([{ k: "splitDmg", n: 2 }])] });
unit("062", "Spirit Wolf Pack", "shaman", "common", 4, 3, 3, "Guard. Rally: summon a 2/2 Wolf.", "They run together.", { kw: ["guard"], onPlay: [A([summon("tk-wolf")])] });
unit("063", "Emberbrand Adept", "shaman", "rare", 4, 3, 4, "Your Gear costs 1 less. Rally: gain +1 Attack for each Gear you control.", "Hands warm.", { aura: [{ k: "gearCost", n: 1 }], onPlay: [A([{ k: "atkPerGear" }])] });
unit("064", "Tempest Spirit", "shaman", "rare", 5, 4, 4, "Twin Strike. Cooldown 1.", "Steel, wind and tempers.", { kw: ["twin"], cooldown: 1 });
unit("065", "Earthmother's Avatar", "shaman", "epic", 7, 6, 7, "Guard. Rally: summon two 2/3 Stone Totems with Guard.", "The mountain nods.", { kw: ["guard"], onPlay: [A([summon("tk-stone-totem", 2)])] });
unit("066", "Storm Colossus", "shaman", "legendary", 8, 8, 10, "Twin Strike. Cooldown 2.", "Thunder wears a face.", { kw: ["twin"], cooldown: 2 });

// ---- Mage ----
unit("067", "Apprentice Spark", "mage", "common", 1, 1, 2, "", "Please stop touching that.");
spell("068", "Ember Bolt", "mage", "common", 2, "Deal 3 damage to any target.", "The classic.", [A([dmg(3)], "anyChar")]);
unit("069", "Rime Adept", "mage", "common", 3, 2, 3, "Rally: Chill an enemy unit.", "Cold as a creditor.", { onPlay: [A([{ k: "chill", to: "target" }], "enemyUnit")] });
gear("070", "Staff of the Archive", "mage", "common", 3, { atk: 1, hp: 2, onSpell: [dmg(1, "randomEnemyChar")] }, "+1/+2. Equipped unit: whenever you cast a spell, deal 1 damage to a random enemy.", "Overdue.");
unit("071", "Archmage Disciple", "mage", "uncommon", 3, 2, 3, "Your spells cost 1 less.", "Quick study.", { aura: [{ k: "spellCost", n: 1 }] });
spell("072", "Rime Lance", "mage", "uncommon", 3, "Deal 2 damage to a unit and Chill it.", "Cold shoulder.", [A([dmg(2), { k: "chill", to: "target" }], "anyUnit")]);
unit("073", "Mirror Illusionist", "mage", "uncommon", 4, 2, 3, "Rally: summon a copy of this with 1 Health.", "Look again.", { onPlay: [A([{ k: "summonCopy", hp1: true }])] });
unit("074", "Chronomancer", "mage", "rare", 5, 4, 4, "Rally: your next spell this turn is free.", "Time is a courtesy.", { onPlay: [A([{ k: "nextSpellFree" }])] });
unit("075", "Whiteout Weaver", "mage", "rare", 6, 4, 5, "Rally: Chill all enemy units.", "Winter takes the floor.", { onPlay: [A([{ k: "chill", to: "allEnemyUnits" }])] });
spell("076", "Meteor Fall", "mage", "epic", 7, "Deal 6 damage to each enemy unit.", "Night sky, brought down.", [A([dmg(6, "allEnemyUnits")])]);
unit("077", "Archmage of the Tower", "mage", "legendary", 7, 5, 8, "Rally: Loot a spell: choose 1 of 3 from your deck.", "Knowledge is power. Power is knowledge.", { onPlay: [A([{ k: "loot", spell: true }])] });

// ---- Warlock ----
unit("078", "Cult Initiate", "warlock", "common", 1, 2, 1, "", "Reads the wrong books.");
spell("079", "Blood Tithe", "warlock", "uncommon", 1, "Deal 3 damage to your Champion. Draw 2 cards.", "What are friends for?", [A([{ k: "selfDmg", n: 3 }, draw(2)])]);
gear("080", "Cursed Grimoire", "warlock", "common", 2, { atk: 0, hp: 2, lastStand: [draw(1)] }, "+0/+2. Equipped unit: Last Stand: draw a card.", "Bound in something.");
spell("081", "Gloom Bolt", "warlock", "common", 3, "Deal 4 damage to a unit.", "The oldest fear.", [A([dmg(4)], "anyUnit")]);
unit("082", "Void Shade", "warlock", "common", 3, 2, 4, "Guard", "Never asked for this.", { kw: ["guard"] });
unit("083", "Pact Binder", "warlock", "uncommon", 3, 3, 4, "Rally: sacrifice a friendly unit to draw 2 cards.", "The price was clear.", { onPlay: [A([{ k: "destroy", to: "target" }, draw(2)], "friendlyOtherUnit")] });
unit("084", "Soul Siphoner", "warlock", "common", 4, 3, 3, "Drain", "A little for me.", { kw: ["drain"] });
unit("085", "Pact Overseer", "warlock", "rare", 5, 4, 4, "Rally: destroy a friendly unit and gain +3/+3.", "Everything is a trade.", { onPlay: [A([{ k: "destroy", to: "target" }, buff(3, 3, "self")], "friendlyOtherUnit")] });
unit("086", "Infernal Brute", "warlock", "rare", 6, 6, 7, "Rally: deal 3 damage to each other unit.", "Subtle it is not.", { onPlay: [A([dmg(3, "otherUnits")])] });
unit("087", "Dread Pretender", "warlock", "epic", 7, 7, 7, "Drain. Rally: deal 4 damage to your Champion.", "Try again.", { kw: ["drain"], onPlay: [A([{ k: "selfDmg", n: 4 }])] });
unit("088", "Void Sovereign", "warlock", "legendary", 8, 7, 11, "Drain. Rally: destroy all other units.", "The hollow king.", { kw: ["drain"], onPlay: [A([{ k: "destroy", to: "otherUnits" }])] });

// ---- Druid ----
unit("089", "Sapling Guardian", "druid", "common", 1, 1, 2, "", "Takes root.");
gear("090", "Thornbark Vest", "druid", "common", 2, { atk: 0, hp: 3, thorns: true }, "+0/+3. Equipped unit deals 1 damage to any attacker.", "Hug it.");
unit("091", "Bear Form Guardian", "druid", "common", 3, 3, 4, "Guard", "Has words with trespassers.", { kw: ["guard"] });
spell("092", "Spring Bloom", "druid", "common", 3, "Mend 5 a friendly character and draw a card.", "Good rain.", [A([mend(5), draw(1)], "friendlyChar")]);
unit("093", "Wild Growth Sage", "druid", "uncommon", 3, 2, 3, "Rally: draw a card; your next card this turn costs 1 less.", "Patience grows.", { onPlay: [A([draw(1), { k: "nextDiscount", n: 1 }])] });
unit("094", "Grove Keeper", "druid", "common", 4, 3, 3, "Rally: give a friendly unit +2/+2.", "Water and wait.", { onPlay: [A([buff(2, 2)], "friendlyOtherUnit")] });
spell("095", "Grove's Fury", "druid", "uncommon", 4, "Choose: deal 4 damage to a unit; or give a friendly unit +3/+3.", "Choose a face.", [A([dmg(4)], "anyUnit"), A([buff(3, 3)], "friendlyUnit")]);
unit("096", "Treant Matriarch", "druid", "rare", 5, 3, 4, "Rally: summon two 1/2 Treants with Guard.", "The grove listens.", { onPlay: [A([summon("tk-treant-small", 2)])] });
unit("097", "Elder of Lore", "druid", "rare", 6, 5, 5, "Rally: choose: draw 2 cards; or Mend 6 your Champion.", "Old as the oak.", { onPlay: [A([draw(2)]), A([mend(6, "myChamp")])] });
unit("098", "Archdruid of the Moon", "druid", "epic", 7, 6, 8, "Shadow. Rally: Mend 6 your Champion and gain 2 temporary mana.", "The moon bends.", { kw: ["shadow"], onPlay: [A([mend(6, "myChamp"), { k: "tempMana", n: 2 }])] });
unit("099", "Elder Tree Spirit", "druid", "legendary", 8, 6, 8, "Guard. Last Stand: summon a 4/4 Treant with Guard.", "One acorn, one forest.", { kw: ["guard"], lastStand: [summon("tk-treant-big")] });

// ---- Neutral units (some are moved into class columns below) ----
unit("100", "Roadside Mercenary", "neutral", "common", 1, 1, 2, "", "Pays double after dark.");
unit("101", "Tavern Bard", "neutral", "common", 1, 1, 1, "Rally: Mend 1 your Champion.", "A little song for the road.", { onPlay: [A([mend(1, "myChamp")])] });
unit("102", "Militia Guard", "neutral", "common", 2, 2, 3, "", "Nine-to-five.");
unit("103", "Village Defender", "neutral", "common", 2, 1, 3, "Guard", "It's his house.", { kw: ["guard"] });
unit("104", "Wanderer of the Waste", "neutral", "uncommon", 2, 2, 2, "Shadow", "Where is he? There.", { kw: ["shadow"] });
unit("105", "Field Medic", "neutral", "common", 3, 2, 2, "Rally: Mend 3 a friendly character.", "Hold still.", { onPlay: [A([mend(3)], "friendlyChar")] });
unit("106", "Fort Archer", "neutral", "common", 3, 3, 2, "Rally: deal 1 damage to the enemy Champion.", "Aim high.", { onPlay: [A([dmg(1, "oppChamp")])] });
unit("107", "Sellsword", "neutral", "common", 3, 3, 4, "", "Reliable until payday.");
unit("108", "Dungeon Warden", "neutral", "uncommon", 3, 2, 3, "Guard. Rally: Mend 2 your Champion if you control a Zone.", "Keys on a ring.", { kw: ["guard"], onPlay: [A([when("zone", mend(2, "myChamp"))])] });
unit("109", "Sapper", "neutral", "uncommon", 3, 2, 3, "Last Stand: deal 3 damage to a random enemy unit.", "Fuse lit.", { lastStand: [dmg(3, "randomEnemyUnit")] });
unit("110", "Cavalry Rider", "neutral", "common", 4, 4, 3, "Swift", "Charge!", { kw: ["swift"] });
unit("111", "Ogre Bruiser", "neutral", "common", 4, 5, 4, "", "Thinks slowly, hits fast.");
unit("112", "Relic Hunter", "neutral", "common", 4, 3, 3, "Rally: Loot a card: choose 1 of 3 from your deck.", "Always brings something.", { onPlay: [A([{ k: "loot" }])] });
unit("113", "Caravan Master", "neutral", "uncommon", 4, 3, 3, "At the start of your turn, gain 1 temporary mana.", "Always one more crate.", { startTurn: [{ k: "tempMana", n: 1 }] });
unit("114", "Tomb Raider", "neutral", "uncommon", 4, 3, 3, "Swift", "Loves a vault.", { kw: ["swift"] });
unit("115", "Duelist of the Third Gate", "neutral", "rare", 4, 4, 2, "Swift. Role: Damage. +2 Attack while you control a Tank and a Healer.", "Hits hardest, falls first.", { kw: ["swift"], role: "damage", aura: [{ k: "atkIfTankHealer", n: 2 }] });
unit("116", "Priest of the Third Gate", "neutral", "rare", 4, 2, 3, "Role: Healer. At the end of your turn, Mend 2 each friendly unit.", "Heals through anything.", { role: "healer", endTurn: [mend(2, "allFriendlyUnits")] });
unit("117", "Tank of the Third Gate", "neutral", "rare", 4, 3, 4, "Guard. Role: Tank. Your Healer and Damage units gain +1 Health.", "Takes the hit.", { kw: ["guard"], role: "tank", aura: [{ k: "hpRoles", n: 1, roles: ["healer", "damage"] }] });
unit("118", "Raiding Party", "neutral", "common", 5, 5, 4, "Rally: deal 2 damage to the enemy Champion.", "They ask nicely twice.", { onPlay: [A([dmg(2, "oppChamp")])] });
unit("119", "Stone Golem", "neutral", "common", 5, 5, 6, "", "Not for sale.");
unit("120", "Bandit Captain", "neutral", "uncommon", 5, 5, 4, "Rally: summon a 2/1 Bandit with Swift.", "Bring a friend.", { onPlay: [A([summon("tk-bandit")])] });
unit("121", "The Tavern Keeper", "neutral", "legendary", 5, 3, 5, "Rally: both players Mend 8 their Champions.", "Sit. Eat. Don't break anything.", { onPlay: [A([{ k: "bothMend", n: 8 }])] });
unit("122", "Mountain Giant", "neutral", "uncommon", 6, 7, 7, "", "Rarely visited, never forgotten.");
unit("123", "Hero of the Hollow", "neutral", "legendary", 6, 6, 8, "Shield. Rally: draw a card.", "Legend before lunchtime.", { kw: ["shield"], onPlay: [A([draw(1)])] });
unit("124", "Wyrm of the Ashen Peak", "neutral", "rare", 7, 7, 7, "Rally: deal 4 damage to the enemy Champion.", "It remembers the village.", { onPlay: [A([dmg(4, "oppChamp")])] });
unit("125", "Wandering Dragon", "neutral", "epic", 8, 8, 10, "Swift", "Drops by.", { kw: ["swift"] });

// ---- Neutral spells and gear ----
spell("126", "Gambit", "neutral", "common", 1, "Discard a card, draw 2 cards.", "Toss away the stale.", [A([{ k: "discard" }, draw(2)], "handOther")]);
spell("127", "Waylay", "neutral", "common", 2, "Deal 2 damage to a unit and draw a card.", "Never fair.", [A([dmg(2), draw(1)], "anyUnit")]);
spell("128", "Fireside Rest", "neutral", "uncommon", 3, "Mend 6 your Champion.", "Rest, in a hurry.", [A([mend(6, "myChamp")])]);
spell("129", "Grave Robbery", "neutral", "uncommon", 4, "Return the last friendly unit that died to your hand.", "Dig again.", [A([{ k: "returnLastDied" }])]);
spell("130", "Whirling Blades", "neutral", "epic", 5, "Deal 3 damage to each unit.", "Everyone, everywhere.", [A([dmg(3, "allUnits")])]);
gear("131", "Battered Shield", "neutral", "common", 2, { atk: 0, hp: 3, kw: ["guard"] }, "+0/+3. Equipped unit has Guard.", "Dented, not dead.");
gear("132", "Dragonscale Mail", "neutral", "epic", 4, { atk: 0, hp: 5, kw: ["shield", "guard"] }, "+0/+5. Equipped unit has Shield and Guard.", "A dragon's regrets.");

// ---- Zones ----
zone("133", "Emberdeep Chasm", "common", 2, "burning", "Burning: at the start of each turn, deal 1 damage to the unit with the lowest Health.", "Warm, in the worst way.");
zone("134", "The Sunken Mine", "common", 2, "narrow", "Narrow: each side can control at most 4 units.", "Single file, please.");
zone("135", "Briar Hollow", "uncommon", 3, "overgrown", "Overgrown: at the end of your turn, Mend 1 each friendly unit.", "Gentle as thorns.");
zone("136", "Wailing Warrens", "uncommon", 3, "echoes", "Echoes: Rally effects trigger twice.", "Say it again.");
zone("137", "Ashfall Plain", "rare", 4, "smoke", "Smoke: Shadow units have +1 Attack; Rally damage dealt to Champions is reduced by 1.", "Cough, cough.");
zone("138", "Cairn of Kings", "rare", 4, "cairn", "Ancient Ward: units entering play gain Shield until the end of the next turn.", "They are watching.");

// ---- Guild Standards (earned from achievements, bound to the account) ----
standard("139", "Banner of the Duel", "rare", "pvp", "Your Champion's class power costs 1 less.", "Honour, then steel.", { flag: "powerCost" });
standard("140", "Flag of the Guild Hall", "rare", "social", "At the start of your turn, Mend 1 your Champion.", "Home is where the banners are.", { startTurn: [mend(1, "myChamp")] });
standard("141", "Sigil of the Forge", "rare", "craft", "Your Gear costs 1 less.", "Hammer and patience.", { flag: "gearCost" });
standard("142", "Standard of the First Delve", "rare", "dungeon", "Your units that survive a turn gain +1 Health (max once each).", "First clears are earned, not given.", { flag: "survivor" });
standard("143", "Banner of the Battleground", "epic", "pvp", "When you destroy an enemy unit, your Champion gains 1 Armor.", "Hold the line.", { flag: "armorOnKill" });
standard("144", "Flag of the Chronicle", "epic", "social", "Your first card each turn costs 1 less if you control a Zone.", "Written in the wall.", { flag: "zoneDiscount" });
standard("145", "Sigil of the Master Artisan", "epic", "craft", "When a unit with Gear dies, return its Gear to your hand.", "Mend and reuse.", { flag: "gearReturn" });
standard("146", "Standard of the Deep Run", "epic", "dungeon", "At the start of your turn, if you control 3+ units, draw a card.", "Deeper every time.", { startTurn: [when("units3", draw(1))] });
standard("147", "Banner of the Warlord's Ladder", "legendary", "pvp", "Your units have +1 Attack on your turn.", "Rank is a weapon.", { flag: "atkOnTurn" });
standard("148", "Flag of the Hall of Fame", "legendary", "social", "When your Champion is below 10 health, draw 1 extra card at your turn start.", "Remember me.", { startTurn: [when("low10", draw(1))] });
standard("149", "Sigil of the Raid", "legendary", "raid", "At the start of your turn, if you control a Tank, Healer and Damage unit, deal 2 damage to the enemy Champion.", "Full party, full power.", { startTurn: [when("party", dmg(2, "oppChamp"))] });
standard("150", "Standard of the Perfect Run", "legendary", "dungeon", "The first unit that would die each turn is returned to your hand instead.", "Not a scratch.", { flag: "perfectRun" });

// ---- Tokens and the Loot Bag ----
const token = (id: string, name: string, atk: number, hp: number, words: Keyword[]): void => {
  cards.push({ id, name, type: "unit", rarity: "common", cost: 0, cls: "neutral", atk, hp, kw: words, text: words.map(w => w[0]!.toUpperCase() + w.slice(1)).join(", "), flavour: "", token: true });
};
token("tk-beast-companion", "Beast", 1, 1, ["swift"]);
token("tk-totem", "Totem", 0, 2, ["guard"]);
token("tk-beast-guard", "Beast", 3, 3, ["guard"]);
token("tk-beast-swift", "Beast", 3, 3, ["swift"]);
token("tk-wolf", "Wolf", 2, 2, []);
token("tk-stone-totem", "Stone Totem", 2, 3, ["guard"]);
token("tk-treant-small", "Treant", 1, 2, ["guard"]);
token("tk-treant-big", "Treant", 4, 4, ["guard"]);
token("tk-bandit", "Bandit", 2, 1, ["swift"]);
cards.push({ id: "loot-bag", name: "Loot Bag", type: "spell", rarity: "common", cost: 0, cls: "neutral", text: "Gain 1 temporary mana.", flavour: "The second player's head start.", onPlay: [A([{ k: "tempMana", n: 1 }])], token: true, bag: true });

// ---- the owner's 8 November decision: three neutral cards per class move into the class columns ----
const MOVED: Record<ClassKey, [string, string, string]> = {
  warrior: ["111", "118", "131"], paladin: ["110", "123", "132"], hunter: ["106", "112", "127"],
  rogue: ["104", "114", "126"], priest: ["101", "105", "128"], shaman: ["103", "119", "122"],
  mage: ["102", "124", "130"], warlock: ["109", "120", "129"], druid: ["100", "108", "113"]
};
const moved = new Map<string, ClassKey>();
for (const cls of CLASS_KEYS) for (const id of MOVED[cls]) moved.set(id, cls);
for (const card of cards) if (moved.has(card.id)) card.cls = moved.get(card.id)!;

export const CARDS_SET1: readonly CardDef[] = cards.filter(card => !card.token);
export const TOKENS: readonly CardDef[] = cards.filter(card => card.token);
export const CARD_BY_ID: ReadonlyMap<string, CardDef> = new Map(cards.map(card => [card.id, card]));
export const LOOT_BAG = "loot-bag";
export const SET1_VERSION = 1;

export const cardOf = (id: string): CardDef => {
  const card = CARD_BY_ID.get(id);
  if (!card) throw new Error(`Unknown card ${id}`);
  return card;
};

/** A unit's role for the Full Party rule: explicit on the Third Gate trio, else Guard = Tank, Mend = Healer, otherwise Damage. */
export function roleOfCard(card: CardDef): Role {
  if (card.role) return card.role;
  if (card.kw?.includes("guard")) return "tank";
  const lists = [...(card.onPlay ?? []).flatMap(a => a.effects), ...(card.lastStand ?? []), ...(card.endTurn ?? []), ...(card.startTurn ?? [])];
  if (lists.some(e => e.k === "mend" || e.k === "bothMend")) return "healer";
  return "damage";
}

// ---- decks ----
export const DECK_SIZE = 24;
export const MAX_LEGENDARIES = 2;

/** Why a deck list is not legal, or null. Class cards plus neutral, 2 copies (1 of a Legendary), max 2 Legendaries, max 1 Standard. */
export function deckProblem(cls: ClassKey, list: readonly string[]): string | null {
  if (list.length !== DECK_SIZE) return `A deck has exactly ${DECK_SIZE} cards.`;
  const counts = new Map<string, number>();
  let legendaries = 0, standards = 0;
  for (const id of list) {
    const card = CARD_BY_ID.get(id);
    if (!card || card.token) return `Unknown card ${id}.`;
    if (card.cls !== "neutral" && card.cls !== cls) return `${card.name} belongs to another class.`;
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    if (n > (card.rarity === "legendary" ? 1 : 2)) return `Too many copies of ${card.name}.`;
    if (card.rarity === "legendary") legendaries++;
    if (card.type === "standard") standards++;
  }
  if (legendaries > MAX_LEGENDARIES) return `At most ${MAX_LEGENDARIES} Legendary cards.`;
  if (standards > 1) return "At most one Guild Standard.";
  return null;
}

/**
 * A free starter deck. Commons and Uncommons of the class come first, two copies each; the class-column move left few neutral
 * Commons, so the deck is filled with the class's Rares (one copy, then two) and finally a Zone. Flagged in the stage A PR.
 */
export function starterDeck(cls: ClassKey): string[] {
  const byCost = (x: CardDef, y: CardDef) => x.cost - y.cost || x.id.localeCompare(y.id);
  const own = (rarity: Rarity) => CARDS_SET1.filter(card => card.cls === cls && card.rarity === rarity && card.type !== "standard" && card.type !== "zone").sort(byCost);
  const deck: string[] = [];
  const add = (card: CardDef) => { if (deck.length < DECK_SIZE && deck.filter(id => id === card.id).length < 2) deck.push(card.id); };
  for (const card of [...own("common"), ...own("uncommon")]) { add(card); add(card); }
  for (const card of own("rare")) add(card);
  for (const card of own("rare")) add(card);
  for (const card of CARDS_SET1.filter(c => c.type === "zone" && c.rarity === "common").sort(byCost)) { add(card); add(card); }
  return deck.sort();
}

/** Forbidden terms: protected names that no card may use (docs/plans/APP_TCG_GAME.md section 3.4). Enforced by a unit test. */
export const FORBIDDEN_TERMS: readonly string[] = [
  "warcraft", "azeroth", "alliance", "horde", "blizzard", "hearthstone", "battlecry", "deathrattle", "onyxia", "hyjal", "illidan", "thrall",
  "arthas", "sylvanas", "jaina", "uther", "stormwind", "orgrimmar", "ironforge", "deadmines", "wailing caverns", "molten core", "naxxramas",
  "ragnaros", "frostmourne", "ashbringer", "thunderfury", "doomhammer", "lich king", "forever"
];

/** The stat-point cost-curve check of section 7: a vanilla unit of cost c has Attack + Health = 2c + 1; text and keywords spend points. */
const KEYWORD_POINTS: Record<Keyword, number> = { guard: 1, swift: 1.5, shield: 2, shadow: 1, venom: 2, drain: 1, twin: 1.5 };
function effectPoints(e: Eff, sel?: Sel): number {
  switch (e.k) {
    case "dmg": return e.to === "oppChamp" ? 0.9 * e.n : e.to === "target" || e.to === "randomEnemyUnit" || e.to === "randomEnemyChar" ? e.n : e.to === "allEnemyUnits" ? e.n * 1.5 : e.n * 0.5;
    case "mend": return (e.to === "allFriendlyChars" || e.to === "allFriendlyUnits" ? 1.5 : 1) * 0.7 * e.n;
    case "armor": return 0.4 * e.n;
    case "draw": return 2 * e.n;
    case "buff": return e.turn ? 0.3 * e.a : (e.a + e.h) * (e.to === "otherFriendlyUnits" ? 1.5 : e.to === "self" ? 1 : 0.8);
    case "kw": return e.turn ? 0.5 : 1.2;
    case "summon": return e.n * ((cardOf(e.token).atk ?? 0) + (cardOf(e.token).hp ?? 0) + (cardOf(e.token).kw ?? []).reduce((s, w) => s + KEYWORD_POINTS[w], 0)) * 0.6;
    case "summonCopy": return e.hp1 ? 3 : 4;
    case "destroy": return e.to === "otherUnits" ? 1 : sel === "friendlyOtherUnit" ? -3 : 3;
    case "chill": return e.to === "allEnemyUnits" ? 3 : 1;
    case "dispel": return 1;
    case "selfDmg": return -0.8 * e.n;
    case "tempMana": return 1 * e.n;
    case "loot": return 2;
    case "steal": return 2;
    case "returnSelf": return 2;
    case "returnLastDied": return 2.5;
    case "discard": return -1;
    case "cooldown": return -1 * e.n;
    case "nextDiscount": return 1;
    case "nextSpellFree": return 2;
    case "bothMend": return 1;
    case "splitDmg": return e.n;
    case "hpPerDamaged": return 1.5;
    case "atkPerGear": return 1;
  }
}

/** Points a card spends: stats, keywords, rate-card effects. Compared with its budget in the tests. */
export function pointsOf(card: CardDef): number {
  let total = (card.atk ?? 0) + (card.hp ?? 0);
  for (const word of card.kw ?? []) total += KEYWORD_POINTS[word];
  const sum = (list: Eff[] | undefined) => (list ?? []).reduce((s, e) => s + effectPoints(e), 0);
  total += Math.max(...(card.onPlay ?? [{ effects: [] }]).map(a => a.effects.reduce((s, e) => s + effectPoints(e, a.target), 0)));
  total += sum(card.lastStand) + sum(card.frenzy) + sum(card.startTurn) + sum(card.endTurn);
  for (const aura of card.aura ?? []) total += aura.k === "atkIfTankHealer" ? 1 : aura.k === "hpRoles" ? 2 : 1.5;
  total -= (card.cooldown ?? 0);
  return total;
}
/** The point budget for a card of its type and cost. */
export function budgetOf(card: CardDef): number {
  if (card.type === "unit") return 2 * card.cost + 1;
  if (card.type === "spell") return 1.5 * card.cost + 1.5;
  if (card.type === "gear") return 1.5 * card.cost + 1;
  return 0;
}
