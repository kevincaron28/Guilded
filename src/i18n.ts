// Member-facing text in English and French (GuildSettings.language).
// Officer/admin replies stay in English. Placeholders look like {name}.

import { FR_TEXT } from "./i18n-fr.js";

export type Lang = "en" | "fr";

export function asLang(value: string | null | undefined): Lang {
  return value === "fr" ? "fr" : "en";
}

const STRINGS = {
  // Raid signup post
  "signup.status": { en: "Status", fr: "Statut" },
  "signup.start": { en: "Start", fr: "Début" },
  "signup.total": { en: "Total signed up", fr: "Inscrits" },
  "signup.roles": { en: "Roles", fr: "Rôles" },
  "signup.maybe": { en: "Maybe", fr: "Peut-être" },
  "signup.full": { en: "FULL", fr: "COMPLET" },
  "signup.core": { en: "Raid core", fr: "Core de raid" },
  "signup.coreLegend": { en: "⭐ core member (signup priority) · 🪑 bench (replacement)", fr: "⭐ membre du core (priorité) · 🪑 remplaçant" },
  "signup.coreMissing": { en: "Core members not signed up yet ({count})", fr: "Membres du core pas encore inscrits ({count})" },
  "signup.benchFree": { en: "Bench available ({count})", fr: "Remplaçants disponibles ({count})" },
  "signup.openSpots": { en: "Open spots: anyone in the guild can sign up to fill", fr: "Places libres : tout membre de la guilde peut s'inscrire pour compléter" },
  "signup.waitlist": { en: "Waitlist (in order)", fr: "Liste d'attente (en ordre)" },
  "signup.footer.open": { en: "Click a button below to sign up, or use /raid signup.", fr: "Cliquez un bouton ci-dessous pour vous inscrire, ou utilisez /raid signup." },
  "signup.footer.closed": { en: "Raid ID: {id}", fr: "ID du raid : {id}" },
  "status.PLANNED": { en: "Planned", fr: "Prévu" },
  "status.ACTIVE": { en: "In progress", fr: "En cours" },
  "status.COMPLETED": { en: "Completed", fr: "Terminé" },
  "status.CANCELLED": { en: "Cancelled", fr: "Annulé" },
  "role.TANK": { en: "Tank", fr: "Tank" },
  "role.HEALER": { en: "Healer", fr: "Soigneur" },
  "role.DPS": { en: "DPS", fr: "DPS" },
  "button.tank": { en: "🛡️ Tank", fr: "🛡️ Tank" },
  "button.healer": { en: "💚 Healer", fr: "💚 Soigneur" },
  "button.dps": { en: "⚔️ DPS", fr: "⚔️ DPS" },
  "button.maybe": { en: "❔ Maybe", fr: "❔ Peut-être" },
  "button.cancel": { en: "✖ Can't come", fr: "✖ Absent" },
  "reply.signedUp": { en: "You're signed up as **{role}**. Click another role to switch, or Can't come to drop out.", fr: "Vous êtes inscrit comme **{role}**. Cliquez un autre rôle pour changer, ou Absent pour vous retirer." },
  "reply.maybe": { en: "You're marked as **maybe** ({role}). Click a role when you're sure.", fr: "Vous êtes noté **peut-être** ({role}). Cliquez un rôle quand vous serez certain." },
  "fill.title": { en: "📣 **Players wanted: {raid}**{core}, {time} ({relative})", fr: "📣 **Joueurs recherchés : {raid}**{core}, {time} ({relative})" },
  "fill.spots": { en: "Open spots: {spots}", fr: "Places libres : {spots}" },
  "fill.any": { en: "any role", fr: "tous les rôles" },
  "fill.missing": { en: "{count} core member(s) have not signed up yet: anyone in the guild can fill in.", fr: "{count} membre(s) du core ne sont pas encore inscrits : tout membre de la guilde peut compléter." },
  "fill.link": { en: "Sign up here: {link}", fr: "Inscrivez-vous ici : {link}" },
  "fill.command": { en: "Sign up with /raid signup.", fr: "Inscrivez-vous avec /raid signup." },
  "fill.bench": { en: "Bench, you're up:", fr: "Remplaçants, c'est votre tour :" },
  "reply.clash": { en: "⚠️ You are also signed up for **{raid}** at {time}, close to this one. Cancel one if you can't do both.", fr: "⚠️ Vous êtes aussi inscrit à **{raid}** à {time}, proche de celui-ci. Annulez-en un si vous ne pouvez pas faire les deux." },
  "reply.waitlisted": { en: "{role} is full, so you're on the **waitlist**. You'll get a DM if a spot opens.", fr: "{role} est complet : vous êtes sur la **liste d'attente**. Vous recevrez un message privé si une place se libère." },
  "reply.notSignedUp": { en: "You weren't signed up, so there's nothing to cancel.", fr: "Vous n'étiez pas inscrit, rien à annuler." },
  "reply.cancelled": { en: "Got it, you're marked as not coming.", fr: "C'est noté, vous ne venez pas." },
  "dm.bumped": { en: "A core member took your {role} slot in **{raid}**. You're now first on the waitlist and will move up if a slot opens.", fr: "Un membre du noyau a pris votre place de {role} pour **{raid}**. Vous êtes maintenant premier sur la liste d'attente et passerez en tête si une place se libère." },
  "dm.promoted": { en: "A {role} slot opened in **{raid}** ({when}). You're off the waitlist and signed up.", fr: "Une place de {role} s'est libérée pour **{raid}** ({when}). Vous n'êtes plus en attente : vous êtes inscrit." },

  // Reminders
  "reminder": { en: "⏰ **{raid}** starts {when}. See you there: {mentions}", fr: "⏰ **{raid}** commence {when}. On vous attend : {mentions}" },

  // Notifications
  "notify.raidStarted": { en: "⚔️ Raid started: **{raid}**", fr: "⚔️ Raid commencé : **{raid}**" },
  "notify.raidEnded": { en: "🏁 Raid ended: **{raid}**", fr: "🏁 Raid terminé : **{raid}**" },
  "notify.bossKilled": { en: "💀 **{boss}** killed ({raid})", fr: "💀 **{boss}** vaincu ({raid})" },
  "notify.loot": { en: "🎁 **{item}** → {winner} for **{gp} GP**", fr: "🎁 **{item}** → {winner} pour **{gp} GP**" },
  "notify.epgp": { en: "💰 {who}: {change} ({reason})", fr: "💰 {who} : {change} ({reason})" },
  "notify.decay": { en: "📉 EPGP decay of {percent}% applied to {count} member(s)", fr: "📉 Dépréciation EPGP de {percent} % appliquée à {count} membre(s)" },
  "notify.import": { en: "📥 Addon import applied: {count} EPGP entries{raids}", fr: "📥 Import de l'addon appliqué : {count} entrée(s) EPGP{raids}" },
  "notify.importRaids": { en: ", attendance for {count} raid(s)", fr: ", présences pour {count} raid(s)" },
  "notify.epAwarded": { en: "💰 EP awarded for **{raid}**: {count} raider(s), {total} EP total", fr: "💰 EP attribués pour **{raid}** : {count} raideur(s), {total} EP au total" },

  // Raid report
  "report.title": { en: "⚜️ Guilded — {raid}", fr: "⚜️ Guilded — {raid}" },
  "report.completed": { en: "Raid completed", fr: "Raid terminé" },
  "report.inProgress": { en: "Raid in progress", fr: "Raid en cours" },
  "report.duration": { en: "🕐 Duration", fr: "🕐 Durée" },
  "report.raiders": { en: "👥 Raiders", fr: "👥 Raideurs" },
  "report.late": { en: "{count} late", fr: "{count} en retard" },
  "report.bosses": { en: "🏆 Bosses killed", fr: "🏆 Boss vaincus" },
  "report.noneRecorded": { en: "none recorded", fr: "aucun" },
  "report.epgp": { en: "💰 EPGP", fr: "💰 EPGP" },
  "report.epValue": { en: "+{ep} EP to {count} raider(s)", fr: "+{ep} EP à {count} raideur(s)" },
  "report.epPending": { en: "EP not approved yet", fr: "EP pas encore approuvés" },
  "report.loot": { en: "🎁 Loot", fr: "🎁 Butin" },
  "report.lootValue": { en: "{count} item(s), {gp} GP spent", fr: "{count} objet(s), {gp} GP dépensés" },
  "report.topItems": { en: "Top items", fr: "Meilleurs objets" },

  // Weekly stats
  "stats.titleDays": { en: "⚜️ Guilded — last {days} day(s)", fr: "⚜️ Guilded — {days} dernier(s) jour(s)" },
  "stats.titleWeekly": { en: "⚔️ Guilded — WoW weekly report", fr: "⚔️ Guilded — bilan hebdo WoW" },
  "stats.since": { en: "Since {date}", fr: "Depuis le {date}" },
  "stats.raids": { en: "⚔️ Raids", fr: "⚔️ Raids" },
  "stats.raidsValue": { en: "{count} (avg {avg} raiders)", fr: "{count} (moy. {avg} raideurs)" },
  "stats.kills": { en: "💀 Boss kills", fr: "💀 Boss vaincus" },
  "stats.ep": { en: "💰 EP awarded", fr: "💰 EP attribués" },
  "stats.loot": { en: "🎁 Loot", fr: "🎁 Butin" },
  "stats.newMembers": { en: "👋 New members", fr: "👋 Nouveaux membres" },
  "stats.applications": { en: "📝 Applications", fr: "📝 Candidatures" },
  "stats.mostRaids": { en: "Most raids attended", fr: "Plus de raids" },
  "stats.mostLoot": { en: "Most loot", fr: "Plus de butin" },
  "weekly.week": { en: "Week of {start} to {end} (weekly reset to weekly reset)", fr: "Semaine du {start} au {end} (d'une réinitialisation à l'autre)" },
  "weekly.players": { en: "🏆 Players of the week", fr: "🏆 Joueurs de la semaine" },
  "weekly.raider": { en: "**Raider of the week:** {name}, +{ep} EP ({raids} raid(s))", fr: "**Raideur de la semaine :** {name}, +{ep} EP ({raids} raid(s))" },
  "weekly.hero": { en: "**Dungeon hero:** {name}, {points} point(s)", fr: "**Héros des donjons :** {name}, {points} point(s)" },
  "weekly.cores": { en: "⚔️ Raid cores", fr: "⚔️ Groupes de raid" },
  "weekly.coreLine": { en: "{raids} raid(s), {kills} boss kill(s), attendance {attendance}, {loot} item(s) for {gp} GP", fr: "{raids} raid(s), {kills} boss vaincu(s), présence {attendance}, {loot} objet(s) pour {gp} GP" },
  "weekly.perfect": { en: "Every raid: {names}", fr: "Tous les raids : {names}" },
  "weekly.dungeons": { en: "🗝️ Dungeon week", fr: "🗝️ Semaine des donjons" },
  "weekly.dungeonRuns": { en: "{completed} run(s) completed ({runs} recorded)", fr: "{completed} donjon(s) terminé(s) ({runs} enregistré(s))" },
  "weekly.fastest": { en: "Fastest", fr: "Plus rapides" },
  "weekly.topPoints": { en: "Most points", fr: "Plus de points" },
  "weekly.firsts": { en: "First completions", fr: "Premières réussites" },
  "weekly.records": { en: "Records", fr: "Records" },
  "weekly.nothing": { en: "A quiet week: nothing recorded.", fr: "Semaine calme : rien d'enregistré." },

  // Welcome
  "welcome.default": {
    en: "Welcome to {guild}, {mention}! Use the buttons below to get started: they answer privately, only you see the replies.",
    fr: "Bienvenue sur {guild}, {mention} ! Sers-toi des boutons ci-dessous pour bien commencer : les réponses sont privées, toi seul les vois."
  },
  "welcome.added": { en: "Added **{role}**. You can pick more, or click again to remove it.", fr: "**{role}** ajouté. Vous pouvez en choisir d'autres, ou recliquer pour le retirer." },
  "welcome.removed": { en: "Removed **{role}**. Click again to get it back.", fr: "**{role}** retiré. Recliquez pour le récupérer." },

  // Onboarding (services/onboarding.ts): the welcome buttons, the pinned panel and their private answers.
  "onboard.button.rules": { en: "📜 Rules", fr: "📜 Règles" },
  "onboard.button.games": { en: "🎮 Pick my games", fr: "🎮 Choisir mes jeux" },
  "onboard.button.pair": { en: "🔗 Link my WoW character", fr: "🔗 Lier mon personnage WoW" },
  "onboard.button.steps": { en: "✅ First steps", fr: "✅ Premiers pas" },
  "onboard.button.accept": { en: "I have read and accept the rules", fr: "J'ai lu et j'accepte les règles" },
  "onboard.panel.title": { en: "👋 Start here", fr: "👋 Commence ici" },
  "onboard.panel.intro": {
    en: "Welcome to **{guild}**! These buttons answer privately: only you see the replies.",
    fr: "Bienvenue sur **{guild}** ! Ces boutons répondent en privé : toi seul vois les réponses."
  },
  "onboard.panel.rules": { en: "📜 **Rules** — read {channel}, then confirm.", fr: "📜 **Règles** — lis {channel}, puis confirme." },
  "onboard.panel.games": { en: "🎮 **Pick my games** — each game you pick opens its channels.", fr: "🎮 **Choisir mes jeux** — chaque jeu choisi ouvre ses salons." },
  "onboard.panel.pair": { en: "🔗 **Link my WoW character** — get your pairing code for the Guilded Companion.", fr: "🔗 **Lier mon personnage WoW** — obtiens ton code de pairage pour Guilded Companion." },
  "onboard.panel.steps": { en: "✅ **First steps** — your personal checklist.", fr: "✅ **Premiers pas** — ta liste personnelle." },
  "onboard.steps.title": { en: "**Your first steps on {guild}**", fr: "**Tes premiers pas sur {guild}**" },
  "onboard.steps.rules": { en: "Read and accept the rules", fr: "Lire et accepter les règles" },
  "onboard.steps.games": { en: "Pick your games", fr: "Choisir tes jeux" },
  "onboard.steps.character": { en: "Link your WoW character", fr: "Lier ton personnage WoW" },
  "onboard.steps.characterOptional": { en: "Link your WoW character (only if you play WoW)", fr: "Lier ton personnage WoW (seulement si tu joues à WoW)" },
  "onboard.steps.next": { en: "Use the buttons below for what is left.", fr: "Sers-toi des boutons ci-dessous pour ce qu'il reste." },
  "onboard.steps.done": { en: "You're all set! `/help` lists the commands you can use.", fr: "Tout est fait ! `/help` montre les commandes auxquelles tu as accès." },
  "onboard.rules.prompt": {
    en: "Read the rules in {channel}, then press the button below.",
    fr: "Lis les règles dans {channel}, puis appuie sur le bouton ci-dessous."
  },
  "onboard.rules.first": { en: "One thing first: the rules.", fr: "Une chose d'abord : les règles." },
  "onboard.rules.thanks": { en: "Thanks, your acceptance of the rules is recorded.", fr: "Merci, ton acceptation des règles est enregistrée." },
  "onboard.rules.already": { en: "You already accepted the rules. They stay in {channel}.", fr: "Tu as déjà accepté les règles. Elles restent dans {channel}." },
  "onboard.roleFailed": {
    en: "I couldn't give you your role: an officer needs to move my role above it (Server Settings > Roles).",
    fr: "Je n'ai pas pu te donner ton rôle : un officier doit placer mon rôle au-dessus (Paramètres du serveur > Rôles)."
  },
  "onboard.games.prompt": {
    en: "Pick what you play (several choices are fine). Untick a game to leave its channels.",
    fr: "Choisis ce à quoi tu joues (plusieurs choix possibles). Décoche un jeu pour quitter ses salons."
  },
  "onboard.games.placeholder": { en: "Your games", fr: "Tes jeux" },
  "onboard.games.saved": { en: "Saved: {roles}.", fr: "Enregistré : {roles}." },
  "onboard.games.none": { en: "You have no game selected.", fr: "Tu n'as aucun jeu sélectionné." },
  "onboard.games.failed": {
    en: "I couldn't change {roles}: an officer needs to move my role above them (Server Settings > Roles).",
    fr: "Je n'ai pas pu modifier {roles} : un officier doit placer mon rôle au-dessus (Paramètres du serveur > Rôles)."
  },
  "onboard.gone": { en: "That isn't offered here anymore. Ask an officer.", fr: "Ce n'est plus offert ici. Demande à un officier." },
  "onboard.pair": {
    en: "**Link your WoW character**\n1. Install the Guilded addon and the Guilded Companion (your officers supply both; published versions: https://www.curseforge.com/wow/addons/guilded).\n2. In Companion Settings, enter **{code}** under **Discord account pairing code**, then choose **Link Discord account**.\n3. Log in to WoW on your character, then `/reload` or log out so the game saves the data.\n\nThis code expires {expires}, works once, and is yours alone: keep it private. Need another one later? Press the button again or use `/character pair`.",
    fr: "**Lier ton personnage WoW**\n1. Installe l'addon Guilded et Guilded Companion (fournis par les responsables; versions publiées : https://www.curseforge.com/wow/addons/guilded).\n2. Dans les paramètres du compagnon, entre **{code}** sous **Discord account pairing code**, puis choisis **Link Discord account**.\n3. Connecte-toi à WoW sur ton personnage, puis fais `/reload` ou déconnecte-toi pour que le jeu enregistre les données.\n\nCe code expire {expires}, sert une seule fois et n'appartient qu'à toi : garde-le pour toi. Besoin d'un autre plus tard ? Rappuie sur le bouton ou utilise `/character pair`."
  },
  "onboard.nudge": {
    en: "Hi! You joined **{guild}** yesterday and a step or two is still open. This is the only reminder you will get.",
    fr: "Salut ! Tu as rejoint **{guild}** hier et il te reste une étape ou deux. C'est le seul rappel que tu recevras."
  },

  // Getting started guide
  "guide.title": { en: "⚜️ Getting started with Guilded", fr: "⚜️ Bien commencer avec Guilded" },
  "guide.body": {
    en: "**Welcome to Guilded** — this guide and the bot question channel are for every member, whatever game you play. Use `/help` for the commands available to you. Ask about the bot, addon or companion in `#bot-faq`.\n\n**WoW addon installation**\n1. Close WoW. Get the ZIP supplied by your officers for the version used by your guild; published versions are at {url}.\n2. Extract the `Guilded` folder into `Interface\\AddOns` of the WoW client you actually use. Check that `Interface\\AddOns\\Guilded\\Guilded.toc` exists, without a second nested Guilded folder.\n3. Start WoW, enable Guilded in AddOns, then click its gold minimap coin or type `/guilded help`.\n\n**Connect the companion** — install the Guilded Companion supplied by your officers. Use `/character pair` on Discord and follow its private instructions in the companion. Keep your pairing credentials private. Run `/reload` or log out so WoW saves the data. The companion uploads that saved file; it is not a live connection from the addon.\n\n**WoW activities** — raid signups, `/epgp balance`, `/profile`, `/bank request` and `/craft request` belong to your WoW section. Choosing a game role opens that game's section, not staff channels. New here? Ask in `#bot-faq`.",
    fr: "**Bienvenue avec Guilded !** Ce guide et le salon de questions au bot sont pour toute la gang, peu importe ton jeu. Tape `/help` pour voir les commandes auxquelles tu as accès. Pour comprendre le bot, l’addon ou le compagnon, pose ta question dans `#bot-faq`.\n\n**Installer l’addon WoW**\n1. Ferme WoW. Prends le ZIP fourni par les responsables pour la version utilisée par la guilde; les versions publiées sont sur {url}.\n2. Décompresse le dossier `Guilded` dans `Interface\\AddOns` du client WoW que tu utilises. Vérifie que `Interface\\AddOns\\Guilded\\Guilded.toc` existe, sans un deuxième dossier Guilded imbriqué.\n3. Rouvre WoW, active Guilded dans AddOns, puis clique sur la pièce d’or près de la minicarte ou tape `/guilded help`.\n\n**Connecter le compagnon** — installe Guilded Companion fourni par les responsables. Sur Discord, lance `/character pair`, puis suis les instructions privées dans le compagnon. Garde tes codes et accès de pairage pour toi. Fais `/reload` ou déconnecte ton personnage pour que WoW enregistre les données. Le compagnon envoie ce fichier sauvegardé; l’addon n’est pas connecté au serveur en direct.\n\n**Pour les activités WoW** — inscriptions aux raids, `/epgp balance`, `/profile`, `/bank request` et `/craft request` se trouvent dans ta section WoW. Ton rôle de jeu ouvre sa section, sans donner accès aux salons des officiers. Tu débutes ? Gêne-toi pas pour demander dans `#bot-faq`."
  },

  // Help
  "help.title": { en: "⚜️ Guilded — commands", fr: "⚜️ Guilded — commandes" },
  "help.everyone": { en: "Everyone", fr: "Tout le monde" },
  "help.raidLeaders": { en: "Raid Leaders", fr: "Chefs de raid" },
  "help.epgpOfficers": { en: "EPGP Officers", fr: "Officiers EPGP" },
  "help.officers": { en: "Officers", fr: "Officiers" },
  "help.footer": { en: "In game: click the gold coin on the minimap, or type /guilded help. Get the addon: curseforge.com/wow/addons/guilded", fr: "En jeu : cliquez la pièce d'or près de la minicarte, ou tapez /guilded help. Obtenez l'addon : curseforge.com/wow/addons/guilded" },

  // Dungeon challenge
  "dungeon.board.week": { en: "🏰 Dungeon points — this week", fr: "🏰 Points de donjon — cette semaine" },
  "dungeon.board.season": { en: "🏰 Dungeon points — {season}", fr: "🏰 Points de donjon — {season}" },
  "dungeon.board.all": { en: "🏰 Dungeon points — all time", fr: "🏰 Points de donjon — depuis le début" },
  "dungeon.board.dungeon": { en: "Only {dungeon}", fr: "Seulement {dungeon}" },
  "dungeon.board.empty": { en: "No points yet. Run a dungeon with the addon installed, then an officer imports it.", fr: "Aucun point pour l'instant. Faites un donjon avec l'addon installé, puis un officier l'importe." },
  "dungeon.records.title": { en: "⏱️ Guild records", fr: "⏱️ Records de la guilde" },
  "dungeon.records.one": { en: "⏱️ Fastest {dungeon} clears", fr: "⏱️ {dungeon} les plus rapides" },
  "dungeon.records.empty": { en: "No completed runs yet.", fr: "Aucun donjon terminé pour l'instant." },
  "dungeon.player.title": { en: "🏰 {name} — dungeons", fr: "🏰 {name} — donjons" },
  "dungeon.player.points": { en: "Points", fr: "Points" },
  "dungeon.player.pointsValue": { en: "Week {week} · Season {season} · All time {all}", fr: "Semaine {week} · Saison {season} · Total {all}" },
  "dungeon.player.runs": { en: "Runs", fr: "Donjons" },
  "dungeon.player.runsValue": { en: "{count} completed, {deathless} without dying", fr: "{count} terminés, {deathless} sans mourir" },
  "dungeon.player.bests": { en: "Best times", fr: "Meilleurs temps" },
  "dungeon.player.recent": { en: "Recent runs", fr: "Donjons récents" },
  "dungeon.player.none": { en: "{name} has no dungeon runs yet.", fr: "{name} n'a aucun donjon pour l'instant." },
  "dungeon.history.title": { en: "📜 Recent dungeon runs", fr: "📜 Donjons récents" },
  "dungeon.history.empty": { en: "No runs recorded yet.", fr: "Aucun donjon enregistré pour l'instant." },
  "dungeon.state.COMPLETED": { en: "completed", fr: "terminé" },
  "dungeon.state.ABANDONED": { en: "abandoned", fr: "abandonné" },
  "dungeon.state.INVALID": { en: "invalid", fr: "invalide" },
  "dungeon.notCounted": { en: "not counted", fr: "non compté" },
  "dungeon.deaths": { en: "{count} death(s)", fr: "{count} mort(s)" },
  "dungeon.season.title": { en: "🏆 {season}", fr: "🏆 {season}" },
  "dungeon.season.since": { en: "Started {date}. {runs} completed run(s) so far.", fr: "Commencée le {date}. {runs} donjon(s) terminé(s) jusqu'ici." },
  "dungeon.season.none": { en: "No season has started yet. It starts by itself with the first imported run.", fr: "Aucune saison n'a commencé. Elle démarre toute seule avec le premier donjon importé." },
  "dungeon.season.top": { en: "Top players", fr: "Meilleurs joueurs" },
  "dungeon.post.title": { en: "🏰 Dungeon runs", fr: "🏰 Donjons terminés" },
  "dungeon.post.flawless": { en: "no deaths", fr: "aucune mort" },
  "dungeon.post.more": { en: "…and {count} more", fr: "…et {count} de plus" },
  "dungeon.post.records": { en: "Records", fr: "Records" },
  "dungeon.post.achievements": { en: "🎖️ Achievements", fr: "🎖️ Hauts faits" },
  "dungeon.player.achievements": { en: "Achievements", fr: "Hauts faits" },
  "dungeon.post.guildRecord": { en: "🏆 New guild record in **{dungeon}**: {before} → **{now}**", fr: "🏆 Nouveau record de guilde dans **{dungeon}** : {before} → **{now}**" },
  "dungeon.post.personal": { en: "⭐ Personal best in {dungeon}: {names}", fr: "⭐ Record personnel dans {dungeon} : {names}" },
  "dungeon.post.footer": { en: "/dungeon leaderboard · /dungeon records", fr: "/dungeon leaderboard · /dungeon records" }
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

export function t(lang: Lang, key: StringKey, vars: Record<string, string | number> = {}): string {
  const template = STRINGS[key][lang] ?? STRINGS[key].en;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

// English-first text for screens with many long sentences (the /setup guide and similar):
// the English wording stays in the code, and French is looked up by that exact English text
// in i18n-fr.ts. Text without a French entry is shown in English. {name} placeholders work as in t().
export function tx(lang: Lang, english: string, vars: Record<string, string | number> = {}): string {
  const template = (lang === "fr" ? FR_TEXT[english] : undefined) ?? english;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
