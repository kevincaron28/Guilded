import type { Lang } from "../i18n.js";
import { foldText, wordFits } from "./answers.js";

// Free, deterministic product answers, a default FAQ seed and an unanswered-question log for the
// bot-faq channel. Content is inline {en, fr}: this file is not covered by the tx() key checks.
type Bilingual = { en: string; fr: string };
const pick = (text: Bilingual, lang: Lang) => (lang === "fr" ? text.fr : text.en);

const POE2_ANSWER: Bilingual = {
  en: "**Path of Exile 2 companion**: run the Guilded companion (desktop app) while you play. It reads PoE2's Client.txt log, records your areas and level-ups for your diary and uploads them to the bot. Pair it first with `/character pair`, then check `/poe` for your diary.",
  fr: "**Compagnon Path of Exile 2** : lance le compagnon Guilded (application bureau) pendant que tu joues. Il lit le journal Client.txt de PoE2, note tes zones et niveaux pour ton journal et les envoie au bot. Jumelle-le d'abord avec `/character pair`, puis consulte `/poe` pour ton journal."
};
const PAIRING_ANSWER: Bilingual = {
  en: "**Pairing**: use `/character pair` in Discord to get a one-time code, then enter it in the Guilded companion (or addon). Each player has a personal pairing; there is no shared upload token. If it stopped working, run `/character pair` again for a new code.",
  fr: "**Jumelage** : utilise `/character pair` dans Discord pour obtenir un code à usage unique, puis entre-le dans le compagnon Guilded (ou l'addon). Chaque joueur a son jumelage personnel; il n'y a pas de jeton partagé. S'il ne marche plus, refais `/character pair` pour un nouveau code."
};
const SYNC_ANSWER: Bilingual = {
  en: "**Data not syncing?** 1) Make sure the companion is running and paired (`/character pair`). 2) In WoW, `/reload` or log out so SavedVariables are written to disk. 3) Check the companion shows no error and your addon version matches the bot (`/help`). 4) Wait a minute and try `/profile`. Still stuck? Ask an officer to run `/system`.",
  fr: "**Les données ne se synchronisent pas?** 1) Vérifie que le compagnon tourne et est jumelé (`/character pair`). 2) Dans WoW, fais `/reload` ou déconnecte-toi pour écrire les SavedVariables. 3) Vérifie que le compagnon n'affiche pas d'erreur et que la version de l'addon correspond au bot (`/help`). 4) Attends une minute et essaie `/profile`. Toujours bloqué? Demande à un officier de lancer `/system`."
};

export function looksLikePoe2Question(text: string): boolean {
  return /\b(poe ?2|poe|path of exile)\b/.test(foldText(text)) && /\b(companion|compagnon|diary|journal|client txt|log|upload|track|sync|install|pair|pairing|jumel\w*|overlay)\b/.test(foldText(text));
}
export const poe2Answer = (lang: Lang): string => pick(POE2_ANSWER, lang);

export function looksLikePairingQuestion(text: string): boolean {
  const folded = foldText(text);
  return /\b(pair|pairing|paired|pairage|jumel\w*|link code)\b/.test(folded) && /\b(how|comment|code|why|pourquoi|work|marche|fonctionne|fix|expired|expire|invalid|install|setup)\b/.test(folded);
}
export const pairingAnswer = (lang: Lang): string => pick(PAIRING_ANSWER, lang);

export function looksLikeSyncQuestion(text: string): boolean {
  const folded = foldText(text);
  return /\b(sync|syncing|synced|synchronis\w*|upload\w*|televers\w*)\b/.test(folded) && /\b(not|isnt|doesnt|dont|won t|wont|fail\w*|stuck|broken|pas|marche|fonctionne|jamais|probleme|problem|why|pourquoi)\b/.test(folded);
}
export const syncAnswer = (lang: Lang): string => pick(SYNC_ANSWER, lang);

// Built-in starting FAQ, imported by officers with `/mod faq list defaults:true` and editable after.
type Seed = { triggers: { en: string[]; fr: string[] }; answer: Bilingual };
const SEEDS: Seed[] = [
  { triggers: { en: ["poe2 companion", "path of exile companion", "poe2 diary"], fr: ["compagnon poe2", "journal poe2", "compagnon path of exile"] }, answer: POE2_ANSWER },
  { triggers: { en: ["how to pair", "pairing code", "pair companion"], fr: ["comment jumeler", "code de jumelage", "jumelage compagnon"] }, answer: PAIRING_ANSWER },
  { triggers: { en: ["upload not working", "data not syncing", "sync not working"], fr: ["televersement ne marche pas", "synchronisation ne marche pas", "donnees ne synchronisent pas"] }, answer: SYNC_ANSWER },
  {
    triggers: { en: ["install addon", "addon install", "addon zip"], fr: ["installer addon", "installation addon", "zip addon"] },
    answer: {
      en: "**Addon install**: download the Guilded addon zip, extract the `Guilded` folder into `World of Warcraft/_classic_/Interface/AddOns` (use the folder for your client), restart WoW and enable it on the character screen.",
      fr: "**Installation de l'addon** : télécharge le zip de l'addon Guilded, extrais le dossier `Guilded` dans `World of Warcraft/_classic_/Interface/AddOns` (selon ton client), redémarre WoW et active-le à l'écran des personnages."
    }
  },
  {
    triggers: { en: ["attunement", "attunements", "attuned"], fr: ["attunement", "attunements", "harmonisation"] },
    answer: { en: "**Attunements**: `/character attunement` shows your progress toward each raid key and who is ready. The addon keeps it up to date from your game data.", fr: "**Attunements** : `/character attunement` montre ta progression vers chaque clé de raid et qui est prêt. L'addon la met à jour depuis tes données de jeu." }
  },
  {
    triggers: { en: ["warcraft logs", "wcl", "logs link"], fr: ["warcraft logs", "wcl", "lien logs"] },
    answer: { en: "**Warcraft Logs**: officers link reports with `/raid wcl`; the bot then posts parses and attendance for the raid.", fr: "**Warcraft Logs** : les officiers lient les rapports avec `/raid wcl`; le bot publie ensuite les parses et la présence du raid." }
  },
  {
    triggers: { en: ["wishlist", "wish list", "my wishlist"], fr: ["wishlist", "liste de souhaits", "ma wishlist"] },
    answer: { en: "**Wishlist**: set the items you want with `/character wishlist`. Officers see them when loot drops.", fr: "**Wishlist** : indique les objets que tu veux avec `/character wishlist`. Les officiers les voient quand le butin tombe." }
  },
  {
    triggers: { en: ["group alerts", "dungeon alert", "lfg alert"], fr: ["alertes de groupe", "alerte donjon", "alerte lfg"] },
    answer: { en: "**Group alerts**: use `/dungeon` to open or join a group; the bot pings members who opted in for that dungeon.", fr: "**Alertes de groupe** : utilise `/dungeon` pour ouvrir ou rejoindre un groupe; le bot mentionne les membres inscrits à ce donjon." }
  },
  {
    triggers: { en: ["dkp", "epgp", "my points"], fr: ["dkp", "epgp", "mes points"] },
    answer: { en: "**EPGP / DKP**: `/epgp` shows your standing and priority. Points are awarded for raids and loot costs GP.", fr: "**EPGP / DKP** : `/epgp` montre ton rang et ta priorité. Les points sont donnés pour les raids et le butin coûte du GP." }
  },
  {
    triggers: { en: ["professions", "profession", "who crafts"], fr: ["metiers", "metier", "qui fabrique"] },
    answer: { en: "**Professions**: record yours with `/character profession`, and ask for crafts with `/craft`.", fr: "**Métiers** : enregistre les tiens avec `/character profession`, et demande des fabrications avec `/craft`." }
  }
];

export function defaultFaqEntries(lang: Lang): { triggers: string[]; answer: string }[] {
  return SEEDS.map((seed) => ({ triggers: lang === "fr" ? seed.triggers.fr : seed.triggers.en, answer: pick(seed.answer, lang) }));
}

// Entries whose trigger set already exists are skipped, so importing twice adds nothing.
export function newDefaultEntries(existing: { triggers: string[] }[], lang: Lang) {
  const have = new Set(existing.map((entry) => entry.triggers.map(foldText).sort().join("|")));
  return defaultFaqEntries(lang).filter((entry) => !have.has(entry.triggers.map(foldText).sort().join("|")));
}

// "Did you mean": an entry sharing a (prefix-)word with the question when nothing matched fully.
export function suggestFaq<T extends { triggers: string[] }>(entries: T[], text: string): T | null {
  const words = foldText(text).split(" ").filter((word) => word.length >= 4);
  let best: T | null = null;
  let bestScore = 0;
  for (const entry of entries) {
    let score = 0;
    for (const trigger of entry.triggers) {
      for (const triggerWord of foldText(trigger).split(" ").filter((word) => word.length >= 4)) {
        if (words.some((word) => wordFits(word, triggerWord) > 0)) score += triggerWord.length;
      }
    }
    if (score > bestScore) { best = entry; bestScore = score; }
  }
  return best;
}
export const suggestionText = (triggers: string[], lang: Lang): string =>
  lang === "fr" ? `Je ne suis pas sûr, voulais-tu dire : **${triggers[0]}** ? Demande avec ces mots et je te répondrai.` : `I'm not sure, did you mean: **${triggers[0]}**? Ask with those words and I'll answer.`;

// Unanswered questions (in memory, per guild) so officers can see what members ask that has no answer.
const unanswered = new Map<string, string[]>();
const UNANSWERED_CAP = 25;
export function recordUnanswered(guildId: string, question: string): void {
  const text = question.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!text) return;
  const folded = foldText(text);
  const list = (unanswered.get(guildId) ?? []).filter((item) => foldText(item) !== folded);
  list.unshift(text);
  unanswered.set(guildId, list.slice(0, UNANSWERED_CAP));
}
export const listUnanswered = (guildId: string): string[] => unanswered.get(guildId) ?? [];
export const unansweredHeader = (lang: Lang): string => (lang === "fr" ? "Questions sans réponse récentes :" : "Recent unanswered questions:");
export const importedText = (added: number, lang: Lang): string =>
  lang === "fr" ? `${added} réponse(s) par défaut ajoutée(s). Modifie-les avec /mod faq edit.` : `Added ${added} default answer(s). Edit them with /mod faq edit.`;
