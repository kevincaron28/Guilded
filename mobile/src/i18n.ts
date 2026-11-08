export type Lang = "en" | "fr";

const copy = {
  guildKicker: { en: "YOUR GUILD", fr: "VOTRE GUILDE" },
  signInTitle: { en: "Sign in", fr: "Connexion" },
  signInIntro: { en: "Use the same Discord account as the Windows companion. Guilded opens its website, you choose your server, and you type the code shown here. This phone does not read a browser cookie.", fr: "Utilisez le même compte Discord que le compagnon Windows. Guilded ouvre son site, vous choisissez votre serveur, puis vous tapez le code affiché ici. Ce téléphone ne lit pas un cookie du navigateur." },
  signInButton: { en: "Sign in with Discord", fr: "Connexion avec Discord" },
  codeHelp: { en: "Type this code on the Guilded page. It proves this phone started the sign-in.", fr: "Tapez ce code sur la page Guilded. Il prouve que ce téléphone a commencé la connexion." },
  openPage: { en: "Open the sign-in page", fr: "Ouvrir la page de connexion" },
  waiting: { en: "Waiting for you to press Connect…", fr: "En attente que vous appuyiez sur Relier…" },
  expired: { en: "This sign-in expired. Start again.", fr: "Cette connexion a expiré. Recommencez." },
  cancel: { en: "Cancel", fr: "Annuler" },
  pairingLabel: { en: "Or paste a code from /character pair", fr: "Ou collez un code de /character pair" },
  pairingPlaceholder: { en: "Pairing code", fr: "Code de jumelage" },
  serverIdPlaceholder: { en: "Discord server ID, if the code asks for one", fr: "ID du serveur Discord, si le code le demande" },
  connect: { en: "Connect", fr: "Relier" },
  advanced: { en: "Server address", fr: "Adresse du serveur" },
  serverAddressHelp: { en: "Leave this as guilded.kcaron.top unless your guild runs its own bot.", fr: "Laissez guilded.kcaron.top, sauf si votre guilde héberge son propre bot." },
  preview: { en: "Look at a sample guild", fr: "Voir une guilde d'exemple" },
  previewNote: { en: "Sample names on this phone only. It does not sign in and does not change a guild.", fr: "Des noms d'exemple, sur ce téléphone seulement. Aucune connexion, aucune guilde modifiée." },
  sampleBanner: { en: "Sample guild. Not your Discord account.", fr: "Guilde d'exemple. Pas votre compte Discord." },
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
  loading: { en: "Loading your guild…", fr: "Chargement de votre guilde…" },
  personalTitle: { en: "Public leaderboards only", fr: "Classements publics seulement" },
  personalBody: { en: "This sign-in is for the public dungeon leaderboards, not a guild. Sign in again and choose your Discord server to see characters, reserves and raids.", fr: "Cette connexion sert aux classements publics de donjons, pas à une guilde. Reconnectez-vous et choisissez votre serveur Discord pour voir les personnages, les réserves et les raids." },
  noCharacters: { en: "No linked character yet. Link one in game with /guilded verify, or sign the Windows companion in so an upload can attach your characters.", fr: "Aucun personnage lié. Liez-en un en jeu avec /guilded verify, ou connectez le compagnon Windows pour qu'un envoi attache vos personnages." },
  main: { en: "Main", fr: "Principal" },
  rank: { en: "Guild rank", fr: "Rang de guilde" },
  noRank: { en: "No guild rank recorded yet", fr: "Aucun rang de guilde enregistré" },
  level: { en: "Level", fr: "Niveau" },
  otherServer: { en: "Other server", fr: "Autre serveur" },
  battleNet: { en: "Battle.net", fr: "Battle.net" },
  reservesIntro: { en: "Soft reserves stay in the game addon. Your raid leader opens the list with /guilded reserve, and the next officer upload replaces it. This phone shows the list. Reserve in game.", fr: "Les soft reserves restent dans l'addon. Votre responsable de raid ouvre la liste avec /guilded reserve, et le prochain envoi d'un officier la remplace. Ce téléphone affiche la liste. Réservez en jeu." },
  noReserveList: { en: "No soft-reserve list is open. An officer starts one in game with /guilded reserve open.", fr: "Aucune liste de soft reserves n'est ouverte. Un officier en démarre une en jeu avec /guilded reserve open." },
  reserveOpen: { en: "Open", fr: "Ouverte" },
  reserveLocked: { en: "Locked", fr: "Verrouillée" },
  yourReserves: { en: "Your reserves", fr: "Vos réserves" },
  nobodyReserved: { en: "Nobody has reserved yet.", fr: "Personne n'a réservé." },
  perPlayer: { en: "{count} per player", fr: "{count} par joueur" },
  whereToReserve: { en: "Where to reserve", fr: "Où réserver" },
  coresUsing: { en: "Cores using soft reserves", fr: "Cores en soft reserves" },
  noSoftReserveCores: { en: "No raid core uses soft reserves right now.", fr: "Aucun core de raid n'utilise les soft reserves pour le moment." },
  wishlistIntro: { en: "Your wishlist is saved with the guild. Priority 1 is the item you want most.", fr: "Votre liste de souhaits est enregistrée avec la guilde. La priorité 1 est l'objet que vous voulez le plus." },
  noWishes: { en: "No wishlist items yet.", fr: "Aucun objet sur la liste." },
  itemPlaceholder: { en: "Item name", fr: "Nom de l'objet" },
  priority: { en: "Priority", fr: "Priorité" },
  add: { en: "Add", fr: "Ajouter" },
  remove: { en: "Remove", fr: "Retirer" },
  raidIntro: { en: "Upcoming raids and EP/GP standings for your guild. Signing up still happens in Discord.", fr: "Raids à venir et classement EP/GP de votre guilde. L'inscription se fait encore dans Discord." },
  nextRaid: { en: "Next raid", fr: "Prochain raid" },
  noNextRaid: { en: "No raid is scheduled in the next day and a half.", fr: "Aucun raid n'est prévu dans le prochain jour et demi." },
  upcoming: { en: "Upcoming", fr: "À venir" },
  noUpcoming: { en: "No upcoming raid in the next three weeks.", fr: "Aucun raid dans les trois prochaines semaines." },
  signedUp: { en: "Signed up", fr: "Inscrits" },
  maybe: { en: "Maybe", fr: "Peut-être" },
  standings: { en: "Standings", fr: "Classement" },
  noStandings: { en: "No standings yet.", fr: "Pas encore de classement." },
  you: { en: "You", fr: "Vous" },
  alertsIntro: { en: "Turn this on and this phone reminds you 60 minutes before each upcoming raid it can already see. Nothing is scheduled until you allow notifications. Open the app now and then so the list stays current.", fr: "Activez ceci et ce téléphone vous rappelle 60 minutes avant chaque raid à venir qu'il peut déjà voir. Rien n'est planifié tant que vous n'autorisez pas les notifications. Ouvrez l'application de temps en temps pour garder la liste à jour." },
  alertsWeb: { en: "This browser lists the reminders. An iPhone or Android install delivers them.", fr: "Ce navigateur affiche les rappels. Une installation iPhone ou Android les envoie." },
  alertsDenied: { en: "Notifications are off for Guilded in the phone settings.", fr: "Les notifications sont désactivées pour Guilded dans les réglages du téléphone." },
  remindMe: { en: "Remind me 60 minutes before", fr: "Me rappeler 60 minutes avant" },
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
  tabNews: { en: "News", fr: "Nouvelles" },
  roster: { en: "Roster", fr: "Membres" },
  signInCardTitle: { en: "Sign in to see this", fr: "Connectez-vous pour voir ceci" },
  signInCardBody: { en: "Your characters, badges, wishlist and raid reminders need the Discord sign-in. Leaderboards and news work without it.", fr: "Vos personnages, badges, liste de souhaits et rappels de raid demandent la connexion Discord. Les classements et les nouvelles fonctionnent sans elle." },
  signInGo: { en: "Sign in or look at a sample guild", fr: "Se connecter ou voir une guilde d'exemple" },
  profile: { en: "Profile", fr: "Profil" },
  badges: { en: "Badges", fr: "Badges" },
  settings: { en: "Settings", fr: "Réglages" },
  language: { en: "Language", fr: "Langue" },
  webProfile: { en: "Open your profile on the web", fr: "Ouvrir votre profil sur le site" },
  mapShareHere: { en: "Sharing your map position is switched in the Map section of the Guild tab.", fr: "Le partage de votre position se règle dans la section Carte de l'onglet Guilde." },
  pushTitle: { en: "Needs push notifications", fr: "Demande les notifications push" },
  pushBody: { en: "These arrive with a future update of the app. They are listed here so you know what is coming.", fr: "Elles arrivent avec une prochaine mise à jour de l'appli. Elles sont listées ici pour annoncer la suite." },
  pushHelp: { en: "Call for help from a guildmate nearby", fr: "Appel à l'aide d'un membre proche" },
  pushDungeon: { en: "A dungeon group needs your role", fr: "Un groupe de donjon cherche votre rôle" },
  pushRaid: { en: "A spot opens in a raid you signed up for", fr: "Une place se libère dans un raid où vous êtes inscrit" },
  thisWeek: { en: "This week on Guilded", fr: "Cette semaine sur Guilded" },
  ratedRuns: { en: "Rated runs", fr: "Donjons cotés" },
  guilds: { en: "Guilds", fr: "Guildes" },
  summaryDown: { en: "The weekly summary is unavailable right now.", fr: "Le résumé de la semaine est indisponible pour le moment." },
  players: { en: "Find a player profile", fr: "Trouver un profil de joueur" }
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

export function roleLabel(role: string, lang: Lang): string {
  if (role === "TANK") return "Tank";
  if (role === "HEALER") return lang === "fr" ? "Soigneur" : "Healer";
  if (role === "DPS") return "DPS";
  return role;
}
