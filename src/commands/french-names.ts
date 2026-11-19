import { bugCommand } from "./bugreport.js";
import { craftCommand } from "./craft.js";
import { characterCommand, characterLinkCommand } from "./character.js";
import { helpCommand } from "./help.js";
import { professionCommand } from "./profession.js";
import { profileCommand } from "./profile.js";
import { promotionStatusCommand } from "./promotion.js";
import { wishlistCommand } from "./wishlist.js";
import { attunementCommand } from "./attunement.js";

// French names for the member commands (Discord shows them to members whose app is in French).
// Names stay lowercase with no spaces, at most 32 characters (Discord's rule, checked in
// tests/command-french-names.test.ts). The handlers still read the English names, so nothing else changes.
export const FRENCH_NAME = /^[-_\p{L}\p{N}]{1,32}$/u;

interface Localizable {
  name: string;
  options?: Localizable[];
  setNameLocalizations?(value: Record<string, string>): unknown;
  setDescriptionLocalizations?(value: Record<string, string>): unknown;
}

interface Spec {
  name?: string;
  description?: string;
  /** Subcommand (or group) name -> French name / description. */
  subs?: Record<string, { name?: string; description?: string }>;
  /** Option name -> French name, wherever it appears under this command. */
  options?: Record<string, string>;
}

function walk(node: Localizable, spec: Spec, top: boolean): void {
  for (const child of node.options ?? []) {
    // Subcommands and groups carry their own options array; plain options do not.
    if (Array.isArray(child.options)) {
      const sub = top ? spec.subs?.[child.name] : undefined;
      if (sub?.name) child.setNameLocalizations?.({ fr: sub.name });
      if (sub?.description) child.setDescriptionLocalizations?.({ fr: sub.description });
      walk(child, spec, false);
      continue;
    }
    const option = spec.options?.[child.name];
    if (option) child.setNameLocalizations?.({ fr: option });
  }
}

function localize(command: Localizable, spec: Spec): void {
  if (spec.name) command.setNameLocalizations?.({ fr: spec.name });
  if (spec.description) command.setDescriptionLocalizations?.({ fr: spec.description });
  walk(command, spec, true);
}

const MEMBER_OPTIONS = { character: "personnage", item: "objet", profession: "metier" };

let applied = false;
export function applyFrenchNames(): void {
  if (applied) return;
  applied = true;
  localize(helpCommand as unknown as Localizable, { name: "aide", description: "Que puis-je faire ici ? Liste les commandes à votre disposition." });
  localize(profileCommand as unknown as Localizable, { name: "profil", description: "Voir votre profil de membre." });
  localize(professionCommand as unknown as Localizable, { name: "metier", description: "Gérer les métiers de vos personnages.", options: MEMBER_OPTIONS });
  localize(attunementCommand as unknown as Localizable, { description: "Suivre les harmonisations de raid de vos personnages.", options: MEMBER_OPTIONS });
  localize(wishlistCommand as unknown as Localizable, { name: "souhaits", description: "Les objets que vos personnages souhaitent obtenir.", options: MEMBER_OPTIONS });
  localize(characterCommand as unknown as Localizable, { subs: { unlink: { name: "delier", description: "Délier un personnage (le vôtre ; un officier peut délier celui d'un autre)." } } });
  // Commands restructure (November 2026): /personnage lier replaces pair, import and claim; /personnage guilde replaces /wow.
  localize(characterLinkCommand as unknown as Localizable, {
    subs: {
      link: { name: "lier", description: "Comment lier vos personnages, ou collez une ligne ou un code de l'addon." },
      guild: { name: "guilde", description: "Votre guilde en jeu : la liste, ou en choisir une." }
    },
    options: { line_or_code: "ligne_ou_code", main: "principal", guild: "guilde" }
  });
  localize(craftCommand as unknown as Localizable, {
    name: "artisanat",
    description: "Demandez aux artisans de la guilde de fabriquer un objet, ou prenez des demandes.",
    subs: {
      request: { name: "demander", description: "Demander à un artisan de la guilde de fabriquer un objet." },
      list: { name: "liste", description: "Les demandes ouvertes que les artisans peuvent prendre." },
      who: { name: "qui", description: "Qui, dans la guilde, peut fabriquer un objet." },
      mine: { name: "mes-demandes", description: "Vos demandes ouvertes et celles que vous fabriquez." },
      offer: { name: "proposer", description: "Proposer un objet que vous savez fabriquer." }
    },
    options: { item: "objet", profession: "metier" }
  });
  localize(promotionStatusCommand as unknown as Localizable, { name: "promotion", description: "Voyez ce qu'il vous reste à faire pour être promu.", subs: { status: { name: "statut", description: "Votre progression vers le prochain rang (privé)." } } });
  localize(bugCommand as unknown as Localizable, { name: "bug", description: "Aperçu, puis envoi privé d'un signalement de bogue au développeur." });
}
