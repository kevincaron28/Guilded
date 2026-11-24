export type Lang = "en" | "fr";

const copy = {
  guildKicker: { en: "YOUR GUILD", fr: "TA GUILDE" },
  signInTitle: { en: "Sign in", fr: "Connexion" },
  signInIntro: { en: "Use the same Discord account as the Windows companion. Guilded opens its website, you choose your server, and you type the code shown here. This phone does not read a browser cookie.", fr: "Utilise le même compte Discord que le compagnon Windows. Guilded ouvre son site, tu choisis ton serveur, puis tu tapes le code affiché ici. Ce téléphone ne lit pas un cookie du navigateur." },
  signInButton: { en: "Sign in with Discord", fr: "Connexion avec Discord" },
  codeHelp: { en: "Type this code on the Guilded page. It proves this phone started the sign-in.", fr: "Tape ce code sur la page Guilded. Il prouve que ce téléphone a commencé la connexion." },
  openPage: { en: "Open the sign-in page", fr: "Ouvrir la page de connexion" },
  waiting: { en: "Waiting for you to press Connect…", fr: "En attente que tu appuies sur Relier…" },
  expired: { en: "This sign-in expired. Start again.", fr: "Cette connexion a expiré. Recommence." },
  cancel: { en: "Cancel", fr: "Annuler" },
  retry: { en: "Try again", fr: "Réessayer" },
  pairingLabel: { en: "Or paste a code from /character link", fr: "Ou colle un code de /character link" },
  pairingHide: { en: "Hide the pairing code", fr: "Masquer le code de jumelage" },
  openPageFailed: { en: "This phone could not open the page. Open guildedwow.com in a browser and choose Sign in there.", fr: "Ce téléphone n'a pas pu ouvrir la page. Ouvre guildedwow.com dans un navigateur et choisis la connexion." },
  pairingPlaceholder: { en: "Pairing code", fr: "Code de jumelage" },
  serverIdPlaceholder: { en: "Discord server ID, if the code asks for one", fr: "ID du serveur Discord, si le code le demande" },
  connect: { en: "Connect", fr: "Relier" },
  advanced: { en: "Server address", fr: "Adresse du serveur" },
  serverAddressHelp: { en: "Leave this as guildedwow.com unless your guild runs its own bot.", fr: "Laisse guildedwow.com, sauf si ta guilde héberge son propre bot." },
  preview: { en: "Look at a sample guild", fr: "Voir une guilde d'exemple" },
  previewNote: { en: "Sample names on this phone only. It does not sign in and does not change a guild.", fr: "Des noms d'exemple, sur ce téléphone seulement. Aucune connexion, aucune guilde modifiée." },
  sampleBanner: { en: "Sample guild. Not your Discord account.", fr: "Guilde d'exemple. Pas ton compte Discord." },
  characters: { en: "Characters", fr: "Personnages" },
  reserves: { en: "Reserves", fr: "Réserves" },
  wishlist: { en: "Wishlist", fr: "Liste de souhaits" },
  raids: { en: "Raids", fr: "Raids" },
  alerts: { en: "Alerts", fr: "Alertes" },
  album: { en: "Album", fr: "Album" },
  map: { en: "Map", fr: "Carte" },
  signOut: { en: "Sign out", fr: "Déconnexion" },
  closeSample: { en: "Close sample", fr: "Fermer l'exemple" },
  refresh: { en: "Refresh", fr: "Actualiser" },
  loading: { en: "Loading your guild…", fr: "Chargement de ta guilde…" },
  personalTitle: { en: "Public leaderboards only", fr: "Classements publics seulement" },
  personalBody: { en: "This sign-in is for the public dungeon leaderboards, not a guild. Sign in again and choose your Discord server to see characters, reserves and raids.", fr: "Cette connexion sert aux classements publics de donjons, pas à une guilde. Reconnecte-toi et choisis ton serveur Discord pour voir les personnages, les réserves et les raids." },
  noCharacters: { en: "No linked character yet. Send the Guilded bot your character's full name in a Discord message, or sign the Windows companion in so an upload can attach your characters.", fr: "Aucun personnage lié. Envoie au bot Guilded le nom complet du personnage en message privé Discord, ou connecte le compagnon Windows pour qu'un envoi attache tes personnages." },
  main: { en: "Main", fr: "Principal" },
  rank: { en: "Guild rank", fr: "Rang de guilde" },
  noRank: { en: "No guild rank recorded yet", fr: "Aucun rang de guilde enregistré" },
  level: { en: "Level", fr: "Niveau" },
  otherServer: { en: "Other server", fr: "Autre serveur" },
  battleNet: { en: "Battle.net", fr: "Battle.net" },
  reservesIntro: { en: "Soft reserves stay in the game addon. Your raid leader opens the list with /guilded reserve, and the next officer upload replaces it. This phone shows the list. Reserve in game.", fr: "Les soft reserves restent dans l'addon. Ton responsable de raid ouvre la liste avec /guilded reserve, et le prochain envoi d'un officier la remplace. Ce téléphone affiche la liste. Réserve en jeu." },
  noReserveList: { en: "No soft-reserve list is open. An officer starts one in game with /guilded reserve open.", fr: "Aucune liste de soft reserves n'est ouverte. Un officier en démarre une en jeu avec /guilded reserve open." },
  reserveOpen: { en: "Open", fr: "Ouverte" },
  reserveLocked: { en: "Locked", fr: "Verrouillée" },
  yourReserves: { en: "Your reserves", fr: "Tes réserves" },
  nobodyReserved: { en: "Nobody has reserved yet.", fr: "Personne n'a réservé." },
  perPlayer: { en: "{count} per player", fr: "{count} par joueur" },
  whereToReserve: { en: "Where to reserve", fr: "Où réserver" },
  coresUsing: { en: "Cores using soft reserves", fr: "Cores en soft reserves" },
  noSoftReserveCores: { en: "No raid core uses soft reserves right now.", fr: "Aucun core de raid n'utilise les soft reserves pour le moment." },
  wishlistIntro: { en: "Your wishlist is saved with the guild. Priority 1 is the item you want most.", fr: "Ta liste de souhaits est enregistrée avec la guilde. La priorité 1 est l'objet que tu veux le plus." },
  noWishes: { en: "No wishlist items yet.", fr: "Aucun objet sur la liste." },
  itemPlaceholder: { en: "Item name", fr: "Nom de l'objet" },
  priority: { en: "Priority", fr: "Priorité" },
  add: { en: "Add", fr: "Ajouter" },
  remove: { en: "Remove", fr: "Retirer" },
  raidIntro: { en: "Upcoming raids and EP/GP standings for your guild. Sign up here or in Discord.", fr: "Raids à venir et classement EP/GP de ta guilde. Tu peux t'inscrire ici ou dans Discord." },
  nextRaid: { en: "Next raid", fr: "Prochain raid" },
  noNextRaid: { en: "No raid is scheduled in the next day and a half.", fr: "Aucun raid n'est prévu dans le prochain jour et demi." },
  upcoming: { en: "Upcoming", fr: "À venir" },
  noUpcoming: { en: "No upcoming raid in the next three weeks.", fr: "Aucun raid dans les trois prochaines semaines." },
  signedUp: { en: "Signed up", fr: "Inscrits" },
  maybe: { en: "Maybe", fr: "Peut-être" },
  standings: { en: "Standings", fr: "Classement" },
  noStandings: { en: "No standings yet.", fr: "Pas encore de classement." },
  you: { en: "You", fr: "Toi" },
  alertsIntro: { en: "Turn this on and this phone reminds you a day, two hours and an hour before each upcoming raid it can already see. A raid you answered Can't come gets no reminder. Nothing is scheduled until you allow notifications. Open the app now and then so the list stays current.", fr: "Active ceci et ce téléphone te rappelle un jour, deux heures et une heure avant chaque raid à venir qu'il peut déjà voir. Un raid où tu as répondu « Je ne peux pas » n'a aucun rappel. Rien n'est planifié tant que tu n'autorises pas les notifications. Ouvre l'application de temps en temps pour garder la liste à jour." },
  alertsWeb: { en: "This browser lists the reminders. An iPhone or Android install delivers them.", fr: "Ce navigateur affiche les rappels. Une installation iPhone ou Android les envoie." },
  alertsDenied: { en: "Notifications are off for Guilded in the phone settings.", fr: "Les notifications sont désactivées pour Guilded dans les réglages du téléphone." },
  remindMe: { en: "Remind me before each raid", fr: "Me rappeler avant chaque raid" },
  on: { en: "On", fr: "Activé" },
  off: { en: "Off", fr: "Désactivé" },
  noReminders: { en: "No raid is far enough out to schedule. Raids that start within the hour are listed below.", fr: "Aucun raid n'est assez loin pour un rappel. Les raids qui commencent dans l'heure sont listés plus bas." },
  startsSoon: { en: "Starting within the hour", fr: "Commence dans l'heure" },
  openDiscord: { en: "Open in Discord", fr: "Ouvrir dans Discord" },
  leaderNote: { en: "Item prices and roster edits stay on the Windows companion or in Discord.", fr: "Les prix des objets et les modifications de roster restent sur le compagnon Windows ou dans Discord." },
  bench: { en: "Bench", fr: "Banc" },
  trial: { en: "Trial", fr: "Essai" },
  backup: { en: "Backup", fr: "Remplaçant" },
  linked: { en: "Linked", fr: "Lié" },
  notLinked: { en: "Not linked", fr: "Non lié" },
  tabGuild: { en: "Guild", fr: "Guilde" },
  tabStats: { en: "Stats", fr: "Stats" },
  tabMe: { en: "Me", fr: "Moi" },
  goHome: { en: "go to the start screen", fr: "aller à l'écran d'accueil" },
  tabNews: { en: "News", fr: "Nouvelles" },
  roster: { en: "Roster", fr: "Membres" },
  signInCardTitle: { en: "Sign in to see this", fr: "Connecte-toi pour voir ceci" },
  signInCardBody: { en: "Your characters, badges, wishlist and raid reminders need the Discord sign-in. Leaderboards and news work without it.", fr: "Tes personnages, badges, liste de souhaits et rappels de raid demandent la connexion Discord. Les classements et les nouvelles fonctionnent sans elle." },
  signInGo: { en: "Sign in or look at a sample guild", fr: "Se connecter ou voir une guilde d'exemple" },
  profile: { en: "Profile", fr: "Profil" },
  badges: { en: "Badges", fr: "Badges" },
  settings: { en: "Settings", fr: "Réglages" },
  language: { en: "Language", fr: "Langue" },
  privacyPolicy: { en: "Privacy policy", fr: "Politique de confidentialité" },
  deleteMyData: { en: "Delete my data", fr: "Supprimer mes données" },
  deleteMyDataHelp: { en: "Erases your Guilded account, your characters and your personal records on the server, then signs this phone out.", fr: "Efface ton compte Guilded, tes personnages et tes données personnelles sur le serveur, puis déconnecte ce téléphone." },
  deleteMyDataSignedOut: { en: "Sign in first to delete your data from this phone. This page explains the other ways.", fr: "Connecte-toi d'abord pour supprimer tes données depuis ce téléphone. Cette page explique les autres moyens." },
  deleteMyDataHow: { en: "How to delete your data", fr: "Comment supprimer tes données" },
  deleteConfirmTitle: { en: "Delete all your Guilded data?", fr: "Supprimer toutes tes données Guilded ?" },
  deleteConfirmBody: { en: "This cannot be undone. Your account, characters, achievements, wishlist, map positions and device sign-ins are erased. Points, loot and raid attendance stay in each guild's history under the name \"Deleted member\". Backups and Discord messages already posted are not changed.", fr: "C'est définitif. Ton compte, tes personnages, tes succès, ta liste de souhaits, tes positions sur la carte et tes connexions d'appareils sont effacés. Les points, le butin et les présences aux raids restent dans l'historique de chaque guilde sous le nom « Deleted member ». Les sauvegardes et les messages Discord déjà publiés ne sont pas modifiés." },
  deleteConfirmYes: { en: "Delete everything", fr: "Tout supprimer" },
  deleteConfirmNo: { en: "Keep my data", fr: "Garder mes données" },
  deleteWorking: { en: "Deleting…", fr: "Suppression…" },
  deleteUnavailable: { en: "This server cannot delete from the phone yet. The page below explains how.", fr: "Ce serveur ne peut pas encore supprimer depuis le téléphone. La page ci-dessous explique comment faire." },
  mapShareHere: { en: "Sharing your map position is switched in the Map section of the Guild tab.", fr: "Le partage de ta position se règle dans la section Carte de l'onglet Guilde." },
  pushTitle: { en: "Raid alerts from your guild server", fr: "Alertes de raid de ton serveur de guilde" },
  pushBody: { en: "Raid changes, cancellations and reminders reach you even when the app is closed. Push replaces the on-device reminders so nothing arrives twice.", fr: "Changements, annulations et rappels de raid te parviennent même appli fermée. Le push remplace les rappels de l'appareil pour éviter les doublons." },
  pushLater: { en: "Coming later", fr: "À venir" },
  pushLaterBody: { en: "These alerts are not sent yet. They will appear here when your guild server sends them.", fr: "Ces alertes ne sont pas encore envoyées. Elles apparaîtront ici quand ton serveur de guilde les enverra." },
  pushRemote: { en: "Push alerts for raids", fr: "Alertes push pour les raids" },
  pushHelp: { en: "Call for help from a guildmate nearby", fr: "Appel à l'aide d'un membre proche" },
  pushDungeon: { en: "A dungeon group needs your role", fr: "Un groupe de donjon cherche ton rôle" },
  pushRaid: { en: "A spot opens in a raid you signed up for", fr: "Une place se libère dans un raid où tu es inscrit" },
  thisWeek: { en: "This week on Guilded", fr: "Cette semaine sur Guilded" },
  ratedRuns: { en: "Rated runs", fr: "Donjons cotés" },
  guilds: { en: "Guilds", fr: "Guildes" },
  summaryDown: { en: "The weekly summary is unavailable right now.", fr: "Le résumé de la semaine est indisponible pour le moment." },
  players: { en: "Find a player profile", fr: "Trouver un profil de joueur" },
  openSettings: { en: "Open phone settings", fr: "Ouvrir les réglages du téléphone" },
  searchPlaceholder: { en: "Search by name", fr: "Rechercher par nom" },
  filterClass: { en: "Class", fr: "Classe" },
  filterRole: { en: "Role", fr: "Rôle" },
  filterAll: { en: "All", fr: "Tous" },
  sortBy: { en: "Sort", fr: "Tri" },
  sortName: { en: "Name", fr: "Nom" },
  sortLevel: { en: "Level", fr: "Niveau" },
  sortPr: { en: "Priority", fr: "Priorité" },
  sortEp: { en: "EP", fr: "EP" },
  noMatches: { en: "Nobody matches. Clear the search or a filter.", fr: "Aucun résultat. Efface la recherche ou un filtre." },
  introSkip: { en: "Skip", fr: "Passer" },
  introNext: { en: "Next", fr: "Suivant" },
  introBack: { en: "Back", fr: "Retour" },
  introStart: { en: "Get started", fr: "Commencer" },
  introPage: { en: "Step {n} of {total}", fr: "Étape {n} sur {total}" },
  intro1Title: { en: "Your guild in your pocket", fr: "Ta guilde dans ta poche" },
  intro1Body: { en: "See your characters, raids and loot standings, follow the public dungeon and duel leaderboards, and get raid reminders, even without a signal.", fr: "Vois tes personnages, tes raids et le classement du butin, suis les classements publics des donjons et des duels, et reçois des rappels de raid, même sans signal." },
  intro2Title: { en: "Sign in with your Discord account", fr: "Connecte-toi avec ton compte Discord" },
  intro2Body: { en: "Open the Guild tab and press Sign in with Discord. The phone shows a short code: choose your server on the Guilded page and type that code there. Use the same Discord account as the Windows companion. Leaderboards and news need no sign-in.", fr: "Ouvre l'onglet Guilde et touche Connexion avec Discord. Le téléphone affiche un court code : choisis ton serveur sur la page Guilded et tape ce code. Utilise le même compte Discord que le compagnon Windows. Les classements et les nouvelles n'exigent aucune connexion." },
  intro3Title: { en: "Look around first", fr: "Jette d'abord un coup d'œil" },
  intro3Body: { en: "Not signed in yet? Open the sample guild to see every screen with made-up names. It changes nothing and signs nobody in.", fr: "Pas encore connecté ? Ouvre la guilde d'exemple pour voir chaque écran avec des noms inventés. Elle ne change rien et ne connecte personne." },
  introSample: { en: "Try the sample guild", fr: "Essayer la guilde d'exemple" },
  signInSteps: { en: "How to sign in", fr: "Comment se connecter" },
  signInStep1: { en: "Press Sign in with Discord below. A short code appears on this phone.", fr: "Touche Connexion avec Discord ci-dessous. Un court code s'affiche sur ce téléphone." },
  signInStep2: { en: "On the Guilded page that opens, choose your server and type the code.", fr: "Sur la page Guilded qui s'ouvre, choisis ton serveur et tape le code." },
  signInStep3: { en: "Come back here. The app signs in by itself within a few seconds.", fr: "Reviens ici. L'application se connecte d'elle-même en quelques secondes." },
  errorTitle: { en: "Something went wrong", fr: "Un problème est survenu" },
  errorBody: { en: "Guilded hit an unexpected error. Your sign-in and data are safe. Try again, and if it keeps happening you can send the error to the developer.", fr: "Guilded a rencontré une erreur inattendue. Ta connexion et tes données sont en sécurité. Réessaie; si cela se reproduit, tu peux envoyer l'erreur au développeur." },
  errorRetry: { en: "Try again", fr: "Réessayer" },
  errorSend: { en: "Send error report", fr: "Envoyer le rapport d'erreur" },
  errorSending: { en: "Sending…", fr: "Envoi…" },
  errorSent: { en: "Report sent. Reference {ref}. Thank you.", fr: "Rapport envoyé. Référence {ref}. Merci." },
  signupRole: { en: "Role", fr: "Rôle" },
  signupYes: { en: "I'm in", fr: "J'y vais" },
  signupMaybe: { en: "Maybe", fr: "Peut-être" },
  signupNo: { en: "Can't come", fr: "Je ne peux pas" },
  signupDone: { en: "You're signed up as {role}.", fr: "Tu es inscrit comme {role}." },
  signupWaitlisted: { en: "You're on the waitlist as {role}. You move up if a place opens.", fr: "Tu es sur la liste d'attente comme {role}. Tu avances si une place se libère." },
  signupMaybeDone: { en: "You answered Maybe.", fr: "Tu as répondu Peut-être." },
  signupNoDone: { en: "You said you can't come.", fr: "Tu as dit que tu ne peux pas venir." },
  signupClosed: { en: "Signups are closed for this raid.", fr: "Les inscriptions sont fermées pour ce raid." },
  signupFailed: { en: "Your answer was not saved. Try again.", fr: "Ta réponse n'a pas été enregistrée. Réessaie." },
  errOffline: { en: "Guilded could not be reached. Check the connection and try again.", fr: "Impossible de joindre Guilded. Vérifie la connexion et réessaie." },
  errServer: { en: "Guilded is busy right now. Try again in a moment.", fr: "Guilded est occupé en ce moment. Réessaie dans un instant." },
  errBusy: { en: "Too many tries. Wait a minute and try again.", fr: "Trop d'essais. Attends une minute et réessaie." },
  errorSendFailed: { en: "The report could not be sent. Try again later.", fr: "Le rapport n'a pas pu être envoyé. Réessaie plus tard." },
  errorPrivacy: { en: "The report holds the error text, the app version and the screen. Nothing is sent unless you press the button.", fr: "Le rapport contient le texte de l'erreur, la version de l'application et l'écran. Rien n'est envoyé sans que tu touches le bouton." },
  updatedLine: { en: "Last updated {when}", fr: "Dernière mise à jour : {when}" },
  savedCopy: { en: "saved copy, could not refresh", fr: "copie enregistrée, actualisation impossible" }
} as const;

export type CopyKey = keyof typeof copy;

export function t(lang: Lang, key: CopyKey, vars?: Record<string, string | number>): string {
  const template: string = copy[key][lang];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars[name] ?? ""));
}

export function formatWhen(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-CA", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  }).format(date);
}

export function formatPr(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value >= 100 ? String(Math.round(value)) : value.toFixed(2);
}

export function lootModeLabel(mode: string | null, lang: Lang): string {
  const labels: Record<string, { en: string; fr: string }> = {
    EPGP: { en: "GP bids", fr: "Enchères GP" },
    COUNCIL: { en: "Loot council", fr: "Conseil" },
    RESERVE: { en: "Soft reserves", fr: "Soft reserves" },
    PRIORITY: { en: "EPGP priority", fr: "Priorité EP/GP" }
  };
  return labels[mode ?? ""]?.[lang] ?? mode ?? (lang === "fr" ? "Règle de la guilde" : "Guild default");
}

const CLASS_NAMES: Record<string, { en: string; fr: string }> = {
  warrior: { en: "Warrior", fr: "Guerrier" }, paladin: { en: "Paladin", fr: "Paladin" }, hunter: { en: "Hunter", fr: "Chasseur" },
  rogue: { en: "Rogue", fr: "Voleur" }, priest: { en: "Priest", fr: "Prêtre" }, shaman: { en: "Shaman", fr: "Chaman" },
  mage: { en: "Mage", fr: "Mage" }, warlock: { en: "Warlock", fr: "Démoniste" }, druid: { en: "Druid", fr: "Druide" }
};

/** A WoW class in the member's language ("PALADIN", "paladin" and "Paladin" all read "Paladin"; "WARLOCK" reads "Démoniste" in French). */
export function classLabel(className: string | null | undefined, lang: Lang): string {
  if (!className) return "";
  const known = CLASS_NAMES[className.toLowerCase().replace(/[^a-z]/g, "")];
  if (known) return known[lang];
  return className.charAt(0).toUpperCase() + className.slice(1).toLowerCase();
}

/** Guilded is WoW Forever only (since 7 November 2026): the edition ("forever", "WoW Forever") on every row says nothing, so it is not shown. */
export function shownEdition(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^(wow\s*)?forever$/i.test(value.trim()) ? null : value;
}

export function roleLabel(role: string, lang: Lang): string {
  if (role === "TANK") return "Tank";
  if (role === "HEALER") return lang === "fr" ? "Soigneur" : "Healer";
  if (role === "DPS") return "DPS";
  return role;
}
