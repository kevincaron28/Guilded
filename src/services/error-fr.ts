import { frenchTypography } from "../fr-typography.js";

// French for the short English messages that commands throw as plain Errors and that
// replyWithCommandError shows to members as is. Exact texts first, then patterns for messages
// that carry a name or a number. A message with no entry is shown unchanged (English).
// Tu register, Quebec voice. Member-reachable messages only; officer-only ones may stay English.

const EXACT: Record<string, string> = {
  // Crafting
  "Craft request not found.": "Demande d'artisanat introuvable.",
  "Craft offer not found.": "Offre d'artisanat introuvable.",
  "Name the item you want crafted.": "Nomme l'objet que tu veux faire fabriquer.",
  "Quantity must be 1-200.": "La quantité doit être entre 1 et 200.",
  "Quantity must be 1-1000.": "La quantité doit être entre 1 et 1000.",
  "You already have 10 open craft requests.": "Tu as déjà 10 demandes d'artisanat ouvertes.",
  "You can't claim your own request.": "Tu ne peux pas prendre ta propre demande.",
  "Someone else just claimed it.": "Quelqu'un d'autre vient de la prendre.",
  "Only claimed requests can be released.": "Seules les demandes prises peuvent être remises.",
  "Only the crafter or an officer can release it.": "Seul l'artisan ou un officier peut la remettre.",
  "Claim the request before marking it done.": "Prends la demande avant de la marquer terminée.",
  "Only the crafter or an officer can mark it done.": "Seul l'artisan ou un officier peut la marquer terminée.",
  "That request is already closed.": "Cette demande est déjà fermée.",
  "Only the requester or an officer can cancel it.": "Seul le demandeur ou un officier peut l'annuler.",
  "Crafter offers are off on this server.": "Les offres d'artisans sont désactivées sur ce serveur.",
  "Crafter offers are off on this server. An officer can turn them on with /config craft offers.": "Les offres d'artisans sont désactivées sur ce serveur. Un officier peut les activer avec /config craft offers.",
  "Name the item you can craft.": "Nomme l'objet que tu peux fabriquer.",
  "You have posted a lot of offers today. Try again tomorrow.": "Tu as publié beaucoup d'offres aujourd'hui. Réessaie demain.",
  "You already have an active offer for that item.": "Tu as déjà une offre active pour cet objet.",
  "That offer is already closed.": "Cette offre est déjà fermée.",
  "Only the crafter or an officer can withdraw it.": "Seul l'artisan ou un officier peut la retirer.",
  "That offer has ended.": "Cette offre est terminée.",
  "That is your own offer.": "C'est ta propre offre.",
  "You already answered this offer: see /craft mine.": "Tu as déjà répondu à cette offre : vois /craft mine.",
  "No craft board is set. Run /setup start first.": "Aucun tableau d'artisanat n'est configuré. Lance d'abord /setup start.",
  // Guild bank
  "Name the item you need.": "Nomme l'objet dont tu as besoin.",
  "You already have 10 open requests. Wait for some to be handled.": "Tu as déjà 10 demandes ouvertes. Attends que certaines soient traitées.",
  "Bank request not found.": "Demande à la banque introuvable.",
  "You have no request with that ID.": "Tu n'as aucune demande avec cet ID.",
  "Only open requests can be cancelled.": "Seules les demandes ouvertes peuvent être annulées.",
  // Characters
  "Nobody has a character linked yet, so I don't know your realm: add the realm option once (or use /character link).": "Personne n'a encore de personnage lié, alors je ne connais pas ton royaume : ajoute l'option royaume une fois (ou utilise /character link).",
  "A bot cannot own a character.": "Un bot ne peut pas posséder de personnage.",
  "Your guild profile could not be found.": "Ton profil de guilde est introuvable.",
  "Your member profile was not found.": "Ton profil de membre est introuvable.",
  "Attunement name is required": "Le nom de l'harmonisation est requis.",
  "DM your character's full name (First Last) to the bot, or type it in the guild-invite channel.": "Envoie le nom complet de ton personnage (Prénom Nom) au bot en MP, ou écris-le dans le salon d'invitations de la guilde.",
  "You have several characters and no main set: pick one in the character option (`/character list` sets your main).": "Tu as plusieurs personnages et aucun principal : choisis-en un dans l'option personnage (`/character list` définit ton principal).",
  "The game garbled that line (it swallowed part of it). Update the addon to 2.3 and run /guilded character again: the new line uses semicolons.": "Le jeu a abîmé cette ligne (il en a avalé une partie). Mets l'addon à jour vers 2.3 et relance /guilded character : la nouvelle ligne utilise des points-virgules.",
  "The character line is missing the name, realm or class. Run /guilded character again in game.": "Il manque le nom, le royaume ou la classe dans la ligne du personnage. Relance /guilded character en jeu.",
  "The character line looks damaged. Run /guilded character again in game.": "La ligne du personnage semble abîmée. Relance /guilded character en jeu.",
  "Select the matching WoW guild with /character guild before importing this character.": "Choisis la bonne guilde WoW avec /character guild avant d'importer ce personnage.",
  "Pairing code is invalid, expired, or already used. Generate a new one with /character link.": "Le code de liaison est invalide, expiré ou déjà utilisé. Génères-en un nouveau avec /character link.",
  "That item is not on this character's wishlist.": "Cet objet n'est pas dans la liste de souhaits de ce personnage.",
  "Item name must be 2-100 characters.": "Le nom de l'objet doit compter de 2 à 100 caractères.",
  "Priority must be 1 (high), 2 (medium), or 3 (low).": "La priorité doit être 1 (haute), 2 (moyenne) ou 3 (basse).",
  // Guild / server access
  "Use this command in your Discord server.": "Utilise cette commande dans ton serveur Discord.",
  "You need this in-game guild's member role.": "Tu as besoin du rôle de membre de cette guilde en jeu.",
  "You need this in-game guild's member role to use its tools.": "Tu as besoin du rôle de membre de cette guilde en jeu pour utiliser ses outils.",
  "Run /setup start first.": "Lance d'abord /setup start.",
  "An approved Guilded server is required.": "Un serveur Guilded approuvé est requis.",
  "Guild settings have not been initialized.": "Les réglages de la guilde ne sont pas encore initialisés.",
  "The command could not be completed. Please try again or contact an officer.": "La commande n'a pas pu être exécutée. Réessaie ou contacte un officier.",
  // EPGP and loot
  "EPGP transaction not found": "Transaction EPGP introuvable.",
  "That entry is already a reversal and can't be reversed again.": "Cette entrée est déjà une annulation et ne peut pas être annulée de nouveau.",
  "That entry has already been reversed.": "Cette entrée a déjà été annulée.",
  "Nothing is left to take back: decay already removed those points.": "Il ne reste rien à reprendre : la dépréciation a déjà retiré ces points.",
  "Finish the active raid before applying decay to this pool.": "Termine le raid en cours avant d'appliquer la dépréciation à ce bassin.",
  "Item name is required": "Le nom de l'objet est requis.",
  "Bid must be a positive integer": "La mise doit être un entier positif.",
  "Auction is not active": "L'enchère n'est pas active.",
  "Auction was already closed": "L'enchère était déjà fermée.",
  "You cannot bid in this guild": "Tu ne peux pas miser dans cette guilde.",
  "That player is not in this guild": "Ce joueur n'est pas dans cette guilde.",
  "That raid does not belong to this guild.": "Ce raid n'appartient pas à cette guilde.",
  "That auction does not belong to this guild.": "Cette enchère n'appartient pas à cette guilde.",
  "Choose raid: to use this core's loot rules and history.": "Choisis raid: pour utiliser les règles et l'historique de butin de ce noyau.",
  // Dungeons
  "That dungeon group no longer exists.": "Ce groupe de donjon n'existe plus.",
  "That dungeon group is closed.": "Ce groupe de donjon est fermé.",
  "A group title must be 3 to 80 characters.": "Le titre d'un groupe doit compter de 3 à 80 caractères.",
  "You are not in this group.": "Tu n'es pas dans ce groupe.",
  "I can't post in that channel. Set a dungeon signups channel in /setup.": "Je ne peux pas publier dans ce salon. Définis un salon d'inscriptions aux donjons dans /setup.",
  "I can't post in the configured group finder channel. Check /setup start status:true and channel permissions.": "Je ne peux pas publier dans le salon de recherche de groupe configuré. Vérifie /setup start status:true et les permissions du salon.",
  "Only the group leader or a raid leader can start the group.": "Seul le chef du groupe ou un chef de raid peut démarrer le groupe.",
  "Only the group leader or a raid leader can close the group.": "Seul le chef du groupe ou un chef de raid peut fermer le groupe.",
  "This group has already started.": "Ce groupe a déjà commencé.",
  "Pick the dungeon from the list.": "Choisis le donjon dans la liste.",
  "That season does not belong to this guild.": "Cette saison n'appartient pas à cette guilde.",
  "Rating is weekly or per season; choose another period.": "La cote se consulte par semaine ou par saison; choisis une autre période.",
  "This season uses legacy community points.": "Cette saison utilise les anciens points de communauté.",
  "Officers only.": "Réservé aux officiers.",
  "Player not found.": "Joueur introuvable.",
  "Set a dungeon signups channel with /config channel, then run /dungeon guide again.": "Définis un salon d'inscriptions aux donjons avec /config channel, puis relance /dungeon guide.",
  // Raids
  "Raid not found in this guild.": "Raid introuvable dans cette guilde.",
  "Raid not found in this server.": "Raid introuvable dans ce serveur.",
  "Raid not found in this guild: pick it from the list.": "Raid introuvable dans cette guilde : choisis-le dans la liste.",
  "Pick a raid or give a report link.": "Choisis un raid ou donne le lien d'un rapport.",
  "No Warcraft Logs report is linked to that raid yet. Use /lead wcl-report url:<link> and pick the raid first.": "Aucun rapport Warcraft Logs n'est lié à ce raid. Utilise d'abord /lead wcl-report url:<lien> et choisis le raid.",
  "Pick a core raid: each core keeps its own EP/GP.": "Choisis un raid de core : chaque core garde ses propres EP/GP.",
  "The signup deadline must be 1 to 168 hours before the start.": "La limite d'inscription doit être de 1 à 168 heures avant le début.",
  "That signup deadline is already past: choose fewer hours, or none.": "Cette limite d'inscription est déjà passée : choisis moins d'heures, ou aucune.",
  "Role limits must be non-negative integers.": "Les limites par rôle doivent être des entiers positifs ou nuls.",
  "Raid title must be at least 3 characters.": "Le titre du raid doit avoir au moins 3 caractères.",
  "Raid time must be in the future.": "L'heure du raid doit être dans le futur.",
  "That raid core was not found in this guild.": "Ce core de raid est introuvable dans cette guilde.",
  "Only planned raids can be edited.": "Seuls les raids prévus peuvent être modifiés.",
  "Completed raids cannot be cancelled.": "Un raid terminé ne peut pas être annulé.",
  "Raid is already cancelled.": "Ce raid est déjà annulé.",
  "This character is already signed up for this raid: one signup per character and one spot per person.": "Ce personnage est déjà inscrit à ce raid. Une inscription par personnage et une place par personne.",
  "Sign up for this raid first, then choose your spec.": "Inscris-toi d'abord à ce raid, puis choisis ta spécialisation.",
  "Link your character first (/character link), so Guilded knows your class.": "Lie d'abord ton personnage (/character link) pour que Guilded connaisse ta classe.",
  "That spec does not fit your class and role for this raid.": "Cette spécialisation ne convient pas à ta classe et à ton rôle pour ce raid.",
  "This raid is no longer accepting signup changes.": "Les inscriptions à ce raid ne peuvent plus être modifiées.",
  "You are not signed up for this raid.": "Tu n'es pas inscrit à ce raid.",
  "Write a note first.": "Écris d'abord une note.",
  "Only planned raids can be started.": "Seuls les raids prévus peuvent être commencés.",
  "Only active raids can be ended.": "Seuls les raids en cours peuvent être terminés.",
  "Attendance can only be recorded for an active or completed raid.": "Les présences ne peuvent être notées que pour un raid en cours ou terminé.",
  "This raid is cancelled.": "Ce raid est annulé.",
  "A boss name is 2 to 60 characters.": "Le nom d'un boss a de 2 à 60 caractères.",
  "This raid already has 40 bosses.": "Ce raid a déjà 40 boss.",
  "Boss not found for this raid.": "Boss introuvable pour ce raid.",
  "Could not update your signup.": "Impossible de modifier ton inscription.",
  "Could not change your spec.": "Impossible de changer ta spécialisation.",
  "Could not record the EP award.": "Impossible d'enregistrer les EP.",
  "Could not apply that change.": "Impossible d'appliquer ce changement.",
  "Could not post the dungeon group.": "Impossible de publier le groupe de donjon.",
  "Could not save the answer.": "Impossible d'enregistrer la réponse.",
  "Signups are closed for this raid.": "Les inscriptions sont fermées pour ce raid.",
  "Every slot of this raid is taken: no call needed.": "Toutes les places de ce raid sont prises : aucun appel nécessaire.",
  "Join the raid's voice channel, or pick it with channel:.": "Rejoins le salon vocal du raid, ou choisis-le avec channel:.",
  "I can't post in the raid signup channel. Check my permissions there.": "Je ne peux pas publier dans le salon d'inscription du raid. Vérifie mes permissions là-bas.",
  "Only Raid Leaders, Officers, Guild Masters, or Administrators can manage raids.": "Seuls les chefs de raid, officiers, maîtres de guilde ou administrateurs peuvent gérer les raids.",
  "Only Raid Leaders, Officers, Guild Masters, or Administrators can manage raid cores.": "Seuls les chefs de raid, officiers, maîtres de guilde ou administrateurs peuvent gérer les noyaux de raid.",
  "Only officers and server administrators can manage public recruitment.": "Seuls les officiers et les administrateurs du serveur peuvent gérer le recrutement public.",
  "Application not found": "Candidature introuvable.",
  "This application cannot be changed": "Cette candidature ne peut pas être modifiée.",
  "A core name must be 2 to 50 characters.": "Le nom d'un noyau doit compter de 2 à 50 caractères.",
  "A core name is 2 to 50 characters.": "Le nom d'un noyau compte de 2 à 50 caractères.",
  "That player is no longer in this core.": "Ce joueur n'est plus dans ce noyau.",
  "That player is not in this core.": "Ce joueur n'est pas dans ce noyau.",
  "Reopen the character picker before changing this selection.": "Rouvre le sélecteur de personnage avant de changer cette sélection.",
  "A selected character is no longer linked. Reopen the character picker.": "Un personnage choisi n'est plus lié. Rouvre le sélecteur de personnage.",
  "Pick the backup character.": "Choisis le personnage de rechange.",
  // Polls
  "A poll needs at least 2 options.": "Un sondage a besoin d'au moins 2 options.",
  "Poll options must be different.": "Les options du sondage doivent être différentes.",
  "Write the question first (at least 3 characters).": "Écris d'abord la question (au moins 3 caractères).",
  "That poll no longer exists.": "Ce sondage n'existe plus.",
  "This poll is closed.": "Ce sondage est fermé.",
  "That poll is already closed.": "Ce sondage est déjà fermé.",
  "That option does not exist.": "Cette option n'existe pas.",
  "Poll not found in this guild.": "Sondage introuvable dans cette guilde.",
  "I can't post in this channel.": "Je ne peux pas publier dans ce salon.",
  // Do-not-invite, teams, misc
  "That entry was not found.": "Cette entrée est introuvable.",
  "Give a character name of 2 to 60 characters.": "Donne un nom de personnage de 2 à 60 caractères.",
  "Give a short reason (officers see it when there is a match).": "Donne une courte raison (les officiers la voient quand il y a une correspondance).",
  "Give a different character name.": "Donne un autre nom de personnage.",
  "Bots cannot join a team.": "Les bots ne peuvent pas rejoindre une équipe.",
  "Invalid team button.": "Bouton d'équipe invalide.",
  "Session not found in this channel.": "Séance introuvable dans ce salon.",
  "Only officers can do that.": "Seuls les officiers peuvent faire ça.",
  "Only Officers or Guild Masters can turn crafter offers on or off.": "Seuls les officiers ou maîtres de guilde peuvent activer ou désactiver les offres d'artisans.",
  "Only Officers or Guild Masters can change these.": "Seuls les officiers ou maîtres de guilde peuvent changer ces réglages.",
  "Only Officers or Guild Masters can turn the profession posts on or off.": "Seuls les officiers ou maîtres de guilde peuvent activer ou désactiver les publications par métier.",
  "Only Officers or Guild Masters can turn in-game crafting orders on or off.": "Seuls les officiers ou maîtres de guilde peuvent activer ou désactiver les commandes d'artisanat en jeu."
};

type Rule = [RegExp, (...groups: string[]) => string];

const PATTERNS: Rule[] = [
  [/^That request is already (\w+)\.$/, (status) => `Cette demande est déjà ${STATUS_FR[status] ?? status}.`],
  [/^You already have (\d+) active offers\. Withdraw one with \/craft withdraw first\.$/, (n) => `Tu as déjà ${n} offres actives. Retires-en une d'abord avec /craft withdraw.`],
  [/^None of your characters has "(.+)" recorded\. Open your profession window with Guilded so the recipe is scanned, or set unverified:true to post it labelled as unverified\.$/, (item) => `Aucun de tes personnages n'a « ${item} » d'enregistré. Ouvre ta fenêtre de métier avec Guilded pour que la recette soit lue, ou mets unverified:true pour la publier comme non vérifiée.`],
  [/^That request is (\w+); it can't be marked (\w+)\.$/, (a, b) => `Cette demande est ${STATUS_FR[a] ?? a}; elle ne peut pas être marquée ${STATUS_FR[b] ?? b}.`],
  [/^No linked character called "(.+)"\. \/character list shows what is linked\.$/, (name) => `Aucun personnage lié nommé « ${name} ». /character list montre ce qui est lié.`],
  [/^(.+) is linked to (.+)\. Only Officers and Guild Masters can unlink someone else's character\.$/, (c, m) => `${c} est lié à ${m}. Seuls les officiers et maîtres de guilde peuvent délier le personnage de quelqu'un d'autre.`],
  [/^No unclaimed character called "(.+)"\.$/, (name) => `Aucun personnage non réclamé nommé « ${name} ».`],
  [/^That character is not linked to your profile\. (.*)$/, (rest) => `Ce personnage n'est pas lié à ton profil. ${translate(rest)}`],
  [/^You have no linked character yet\. (.*)$/, (rest) => `Tu n'as pas encore de personnage lié. ${translate(rest)}`],
  [/^Pick one from the list, or leave the character out to use your main\.$/, () => "Choisis-en un dans la liste, ou laisse le personnage vide pour utiliser ton principal."],
  [/^That doesn't look like a (.+) character line\. In game, type \/guilded character and copy the line it shows\.$/, (brand) => `Ça ne ressemble pas à une ligne de personnage ${brand}. En jeu, tape /guilded character et copie la ligne affichée.`],
  [/^(.+) \((.+)\) is already linked to another member\. Ask an officer if that's a mistake\.$/, (n, r) => `${n} (${r}) est déjà lié à un autre membre. Demande à un officier si c'est une erreur.`],
  [/^No linked character matches "(.+)"\.$/, (name) => `Aucun personnage lié ne correspond à « ${name} ».`],
  [/^(.+) has no dungeon runs yet\.$/, (name) => `${name} n'a pas encore de runs de donjon.`],
  [/^Bid must be at least (\d+) GP$/, (n) => `La mise doit être d'au moins ${n} GP.`],
  [/^No raid core "(.+)"\. See \/core list\.$/, (name) => `Aucun noyau de raid « ${name} ». Vois /core list.`],
  [/^A core called "(.+)" already exists\.$/, (name) => `Un noyau nommé « ${name} » existe déjà.`],
  [/^That player is not in (.+)\. Add them first\.$/, (core) => `Ce joueur n'est pas dans ${core}. Ajoute-le d'abord.`],
  [/^That player is not in (.+)\.$/, (core) => `Ce joueur n'est pas dans ${core}.`],
  [/^You can pick up to (\d+) options\. Click a picked option again to remove it first\.$/, (n) => `Tu peux choisir jusqu'à ${n} options. Clique de nouveau sur une option choisie pour la retirer d'abord.`],
  [/^(.+) shares the guild pool\. Turn on its own pool with \/core rules pool:separate first\.$/, (core) => `${core} partage le bassin de la guilde. Active d'abord son propre bassin avec /core rules pool:separate.`]
];

const STATUS_FR: Record<string, string> = {
  open: "ouverte", claimed: "prise", done: "terminée", cancelled: "annulée", closed: "fermée", fulfilled: "remplie", denied: "refusée", approved: "approuvée", pending: "en attente"
};

function translateWhole(message: string): string | undefined {
  const exact = EXACT[message];
  if (exact !== undefined) return exact;
  for (const [pattern, build] of PATTERNS) {
    const match = pattern.exec(message);
    if (match) return build(...match.slice(1));
  }
  return undefined;
}

function translate(message: string): string {
  const whole = translateWhole(message);
  if (whole !== undefined) return whole;
  // A message of several sentences: translate each one that has an entry, keep the others.
  const parts = message.split(/(?<=[.!?])\s+/);
  if (parts.length < 2) return message;
  let changed = false;
  const out = parts.map((part) => {
    const found = translateWhole(part);
    if (found !== undefined) changed = true;
    return found ?? part;
  });
  return changed ? out.join(" ") : message;
}

/** The French text for an English member-facing error, or the message unchanged when there is none. */
export function frenchErrorMessage(message: string): string {
  const translated = translate(message);
  return translated === message ? message : frenchTypography(translated);
}
