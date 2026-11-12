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
  "signup.footer.open": { en: "Click a button below to sign up.", fr: "Cliquez un bouton ci-dessous pour vous inscrire." },
  "signup.footer.closed": { en: "Raid ID: {id}", fr: "ID du raid : {id}" },
  "signup.localTime": { en: "Local time", fr: "Heure locale" },
  "signup.lock": { en: "Signups lock {hours} h before the start ({when}).", fr: "Les inscriptions ferment {hours} h avant le début ({when})." },
  "signup.attendees": { en: "Attendees", fr: "Participants" },
  "signup.itemLevel": { en: "Avg item level", fr: "Niveau d'objet moyen" },
  "signup.itemLevelValue": { en: "{value} ({count} checked)", fr: "{value} ({count} vérifiés)" },
  "signup.column.TANK": { en: "TANKS", fr: "TANKS" },
  "signup.column.HEALER": { en: "HEALERS", fr: "SOIGNEURS" },
  "signup.column.DPS": { en: "DPS", fr: "DPS" },
  "signup.column.MELEE": { en: "MELEE", fr: "MÊLÉE" },
  "signup.column.RANGED": { en: "RANGED", fr: "DISTANCE" },
  "signup.column.DPS_UNKNOWN": { en: "DPS · SPEC UNKNOWN", fr: "DPS · SPÉ INCONNUE" },
  "role.MELEE": { en: "Melee DPS", fr: "DPS mêlée" },
  "role.RANGED": { en: "Ranged DPS", fr: "DPS distance" },
  "signup.dpsSplit": { en: "{melee} melee · {ranged} ranged", fr: "{melee} mêlée · {ranged} distance" },
  "signup.specPrompt": { en: "Playing a different spec for this raid?", fr: "Tu joues une autre spé pour ce raid?" },
  "signup.specCurrent": { en: "Current spec ({spec})", fr: "Spé actuelle ({spec})" },
  "reply.specSaved": { en: "Spec for this raid: **{spec}** ({kind}).", fr: "Spé pour ce raid : **{spec}** ({kind})." },
  "reply.specCleared": { en: "Back to your character's current spec.", fr: "Retour à la spé actuelle de ton personnage." },
  "reply.kindFull": { en: "{kind} spots are full for this raid, so your spec was not changed.", fr: "Les places {kind} sont pleines pour ce raid : ta spé n’a pas changé." },
  "signup.section.late": { en: "LATE", fr: "EN RETARD" },
  "signup.section.tentative": { en: "TENTATIVE", fr: "PEUT-ÊTRE" },
  "signup.section.waitlist": { en: "WAITLIST", fr: "LISTE D'ATTENTE" },
  "signup.section.bench": { en: "BENCH", fr: "BANC" },
  "signup.section.declined": { en: "DECLINED", fr: "ABSENTS" },
  "signup.section.pending": { en: "PENDING", fr: "SANS RÉPONSE" },
  "signup.section.openSpots": { en: "OPEN SPOTS", fr: "PLACES LIBRES" },
  "signup.waitlistOrder": { en: "first in line gets the next free spot", fr: "le premier de la file prend la prochaine place" },
  "signup.openSpotsNote": { en: "anyone in the guild can sign up to fill", fr: "tout membre de la guilde peut s'inscrire pour compléter" },
  "signup.more": { en: "+{count} more", fr: "+{count} de plus" },
  "signup.issuesLegend": { en: "⚠️ N: open warnings from the addon's gear check (last 24 h, /readiness)", fr: "⚠️ N : alertes de la vérification d'équipement de l'addon (dernières 24 h, /readiness)" },
  "signup.fullRoster": { en: "Full roster: /raid roster", fr: "Liste complète : /raid roster" },
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
  "fill.command": { en: "Sign up with the buttons on the raid post.", fr: "Inscrivez-vous avec les boutons de l'annonce du raid." },
  "fill.bench": { en: "Bench, you're up:", fr: "Remplaçants, c'est votre tour :" },
  "reply.clash": { en: "⚠️ You are also signed up for **{raid}** at {time}, close to this one. Cancel one if you can't do both.", fr: "⚠️ Vous êtes aussi inscrit à **{raid}** à {time}, proche de celui-ci. Annulez-en un si vous ne pouvez pas faire les deux." },
  "reply.waitlisted": { en: "{role} is full, so you're on the **waitlist**. You'll get a DM if a spot opens.", fr: "{role} est complet : vous êtes sur la **liste d'attente**. Vous recevrez un message privé si une place se libère." },
  "reply.notSignedUp": { en: "You weren't signed up, so there's nothing to cancel.", fr: "Vous n'étiez pas inscrit, rien à annuler." },
  "signup.closes": { en: "Signups close", fr: "Fin des inscriptions" },
  "signup.lateLegend": { en: "⏰ arriving late", fr: "⏰ arrivera en retard" },
  "button.late": { en: "⏰ Late", fr: "⏰ En retard" },
  "reply.late": { en: "Marked as **late**. Click Late again to undo.", fr: "Noté **en retard**. Cliquez En retard de nouveau pour annuler." },
  "reply.notLate": { en: "You're no longer marked late.", fr: "Vous n'êtes plus noté en retard." },
  "reply.lateNeedsSignup": { en: "Pick a role first, then click Late.", fr: "Choisissez d'abord un rôle, puis cliquez En retard." },
  "reply.signupsClosed": { en: "Signups closed {when}. Ask a raid leader if you still need a spot; Can't come and Late still work.", fr: "Inscriptions fermées {when}. Demandez à un chef de raid s'il vous faut une place; Absent et En retard fonctionnent encore." },
  "dm.outbid": { en: "You were outbid on **{item}**: the top bid is now {amount} GP. Bid again with `/loot bid` before it closes {when}.", fr: "Votre offre sur **{item}** a été dépassée : la meilleure offre est maintenant de {amount} GP. Enchérissez de nouveau avec `/loot bid` avant la fermeture {when}." },
  "worldbuff.unsupported": { en: "World-buff drops are for Classic Era and Forever guilds.", fr: "Les buffs mondiaux concernent les guildes Classic Era et Forever." },
  "worldbuff.announced": { en: "World-buff drop announced:", fr: "Buff mondial annoncé :" },
  "worldbuff.title": { en: "Upcoming world-buff drops (shown in your time zone)", fr: "Prochains buffs mondiaux (dans votre fuseau horaire)" },
  "worldbuff.none": { en: "No drops announced. Add one with /raid worldbuff.", fr: "Aucune annonce. Ajoutez-en une avec /raid worldbuff." },
  "worldbuff.removed": { en: "Removed:", fr: "Retiré :" },
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
  "weekly.leaderboard": { en: "🏆 Full rankings on the public leaderboards: {url}", fr: "🏆 Classement complet sur les classements publics : {url}" },
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
  "onboard.button.chat": { en: "💬 WoW chat ↔ Discord", fr: "💬 Chat WoW ↔ Discord" },
  "onboard.panel.chat": { en: "💬 **WoW chat ↔ Discord** — how guild chat reaches Discord, and how to link your character.", fr: "💬 **Chat WoW ↔ Discord** — comment le chat de guilde arrive sur Discord, et comment lier ton personnage." },
  "onboard.chat.guide": {
    en: "**Guild chat and Discord**\n1) **Blizzard's own link:** if your guild's leader connected the guild to this Discord with Blizzard's guild Discord integration, guild chat can show up in a Discord channel. Ask an officer where it is. Blizzard's link does not know which Discord member you are.\n2) **Tell Guilded who you are** so your name, gear and stats show up with you here. Easiest: ask for your guild invite with the **Request a guild invite** button (or type your full character name in <#{channel}>). When your character joins the guild and a guildmate's addon or companion sees it, I link it to you and send you one message. Already in the guild? Use `/character pair` and paste the `/guilded verify` line in WoW chat once.\nNot your character? `/character unlink`.",
    fr: "**Chat de guilde et Discord**\n1) **Le lien de Blizzard :** si le chef de ta guilde a relié la guilde à ce Discord avec l'intégration Discord de guilde de Blizzard, le chat de guilde peut apparaître dans un salon Discord. Demande à un officier où il se trouve. Le lien de Blizzard ne sait pas qui tu es sur Discord.\n2) **Dis à Guilded qui tu es** pour que ton nom, ton équipement et tes stats apparaissent avec toi ici. Le plus simple : demande ton invitation de guilde avec le bouton **Demander une invitation de guilde** (ou écris le nom complet de ton personnage dans <#{channel}>). Quand ton personnage rejoint la guilde et qu'un addon ou un compagnon de guildien le voit, je le lie à toi et je t'envoie un message. Déjà dans la guilde ? Utilise `/character pair` et colle la ligne `/guilded verify` dans le chat WoW une fois.\nCe n'est pas ton personnage ? `/character unlink`."
  },
  "onboard.chat.guideNoChannel": {
    en: "**Guild chat and Discord**\n1) **Blizzard's own link:** if your guild's leader connected the guild to this Discord with Blizzard's guild Discord integration, guild chat can show up in a Discord channel. Ask an officer where it is. Blizzard's link does not know which Discord member you are.\n2) **Tell Guilded who you are** so your name, gear and stats show up with you here: use `/character pair` and paste the `/guilded verify` line in WoW chat once.\nNot your character? `/character unlink`.",
    fr: "**Chat de guilde et Discord**\n1) **Le lien de Blizzard :** si le chef de ta guilde a relié la guilde à ce Discord avec l'intégration Discord de guilde de Blizzard, le chat de guilde peut apparaître dans un salon Discord. Demande à un officier où il se trouve. Le lien de Blizzard ne sait pas qui tu es sur Discord.\n2) **Dis à Guilded qui tu es** pour que ton nom, ton équipement et tes stats apparaissent avec toi ici : utilise `/character pair` et colle la ligne `/guilded verify` dans le chat WoW une fois.\nCe n'est pas ton personnage ? `/character unlink`."
  },
  "onboard.panel.title": { en: "👋 Start here", fr: "👋 Commence ici" },
  "onboard.panel.intro": {
    en: "Welcome to **{guild}**! These buttons answer privately: only you see the replies.",
    fr: "Bienvenue sur **{guild}** ! Ces boutons répondent en privé : toi seul vois les réponses."
  },
  "onboard.panel.rules": { en: "📜 **Rules** — read {channel}, then confirm.", fr: "📜 **Règles** — lis {channel}, puis confirme." },
  "onboard.panel.games": { en: "🎮 **Pick my games** — each game you pick opens its channels.", fr: "🎮 **Choisir mes jeux** — chaque jeu choisi ouvre ses salons." },
  "onboard.panel.pair": { en: "🔗 **Link my WoW character** — optional: link your main/alts to Discord with the addon. The companion is optional too.", fr: "🔗 **Lier mon personnage WoW** — facultatif : lie ton principal et tes alts à Discord avec l'addon. Le compagnon est aussi facultatif." },
  "onboard.panel.steps": { en: "✅ **First steps** — your personal checklist.", fr: "✅ **Premiers pas** — ta liste personnelle." },
  "onboard.steps.title": { en: "**Your first steps on {guild}**", fr: "**Tes premiers pas sur {guild}**" },
  "onboard.steps.rules": { en: "Read and accept the rules", fr: "Lire et accepter les règles" },
  "onboard.steps.games": { en: "Pick your games", fr: "Choisir tes jeux" },
  "onboard.steps.character": { en: "Link your WoW character", fr: "Lier ton personnage WoW" },
  "onboard.steps.characterOptional": { en: "Link your WoW character (optional; the addon works on its own)", fr: "Lier ton personnage WoW (facultatif; l'addon fonctionne seul)" },
  "onboard.steps.professionsOptional": { en: "Share your professions (optional): `/profession set` or sync your addon", fr: "Partager tes métiers (facultatif) : `/profession set` ou synchroniser ton addon" },
  "onboard.steps.firstRaidOptional": { en: "Confirm your first raid signup (optional): open your guild's signup post and choose a role", fr: "Confirmer ta première inscription à un raid (facultatif) : ouvre l'annonce de ta guilde et choisis un rôle" },
  "onboard.steps.next": { en: "Use the buttons below for what is left.", fr: "Sers-toi des boutons ci-dessous pour ce qu'il reste." },
  "onboard.steps.done": { en: "Your Discord access is ready! WoW character linking and the companion are optional. `/help` lists your commands.", fr: "Ton accès Discord est prêt ! Le lien du personnage WoW et le compagnon sont facultatifs. `/help` montre tes commandes." },
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
  "pair.statusTitle": { en: "Where you stand", fr: "Où tu en es" },
  "pair.title": { en: "🔗 Your WoW characters", fr: "🔗 Tes personnages WoW" },
  "pair.linked": { en: "✅ **Already linked to your Discord account on this server:**", fr: "✅ **Déjà liés à ton compte Discord sur ce serveur :**" },
  "pair.main": { en: "⭐ Main: **{name}** — {realm}", fr: "⭐ Personnage principal : **{name}** — {realm}" },
  "pair.alt": { en: "• Alt: **{name}** — {realm}", fr: "• Alt : **{name}** — {realm}" },
  "pair.more": { en: "`/character list` shows the rest.", fr: "`/character list` montre les autres." },
  "pair.none": { en: "No WoW character is linked to your Discord account on this server yet.", fr: "Aucun personnage WoW n'est encore lié à ton compte Discord sur ce serveur." },
  "pair.addonDefault": {
    en: "**Install the [Guilded addon](https://www.curseforge.com/wow/addons/guilded)** (or your officers' matching download) for the WoW version you play, then link your characters below. The addon works in game even if you never link.",
    fr: "**Installe l'[addon Guilded](https://www.curseforge.com/wow/addons/guilded)** (ou la version de tes officiers) pour la version de WoW que tu joues, puis lie tes personnages ci-dessous. L'addon fonctionne en jeu même si tu ne lies jamais."
  },
  "pair.verifyTitle": { en: "🎮 No Windows PC? One line instead", fr: "🎮 Pas de PC Windows ? Une ligne à la place" },
  "pair.verifyCompanionTitle": { en: "🎮 No companion? 1 step instead", fr: "🎮 Pas de compagnon ? 1 étape à la place" },
  "pair.verify": {
    en: "Copy this line, paste it in WoW chat on any of your characters and press Enter:\n```\n/guilded verify {code}\n```That's all. Every character you play on this WoW account links itself, the first one as your main. It happens the next time anyone in the guild syncs with the Guilded companion (often within the hour) and I'll send you a DM. Once is enough, also for alts.",
    fr: "Copie cette ligne, colle-la dans le chat de WoW sur n'importe lequel de tes personnages et appuie sur Entrée :\n```\n/guilded verify {code}\n```C'est tout. Chaque personnage que tu joues sur ce compte WoW se lie tout seul, le premier comme principal. Ça se fait à la prochaine synchro d'un membre de la guilde avec le compagnon Guilded (souvent en moins d'une heure) et je t'envoie un MP. Une fois suffit, aussi pour les alts."
  },
  "pair.verifySlow": {
    en: "⏳ No officer's companion has synced in 2 weeks, so this can take longer if guildmates don't use the companion either. Can't wait? In WoW type `/guilded character`, then paste that line into `/character import` here.",
    fr: "⏳ Aucun compagnon d'officier n'a synchronisé depuis 2 semaines, ça peut donc prendre plus de temps si tes coéquipiers n'utilisent pas le compagnon non plus. Pressé ? Dans WoW tape `/guilded character`, puis colle cette ligne dans `/character import` ici."
  },
  "verify.linked": {
    en: "✅ **{name}** is now linked to your Discord account on **{server}** as {kind} (your `/guilded verify` code). Not your character? Use `/character unlink` there.",
    fr: "✅ **{name}** est maintenant lié à ton compte Discord sur **{server}** comme {kind} (ton code `/guilded verify`). Ce n'est pas ton personnage ? Utilise `/character unlink` là-bas."
  },
  // 8.5 track F / ROADMAP 5: the linked-characters DM and its button (companion-link-dm.ts).
  "invite.prelinked": {
    en: "✅ **{name}** joined **{server}** and is now linked to your Discord account as {kind}, because you asked for that invite. Not your character? Use `/character unlink` there.",
    fr: "✅ **{name}** a rejoint **{server}** et est maintenant lié à ton compte Discord comme {kind}, parce que tu as demandé cette invitation. Ce n'est pas ton personnage ? Utilise `/character unlink` là-bas."
  },
  "invite.notify.people": {
    en: "{mentions} — **{name}** is asking for a guild invite and you look online in game (any guild member can invite).",
    fr: "{mentions} — **{name}** demande une invitation de guilde et tu sembles en ligne dans le jeu (tout membre de la guilde peut inviter)."
  },
  "invite.done.note": {
    en: "✅ **{name}** joined the guild. Welcome!",
    fr: "✅ **{name}** a rejoint la guilde. Bienvenue!"
  },
  "invite.notify.role": {
    en: "{role} — **{name}** is asking for a guild invite. Nobody who can invite is known to be online in game right now.",
    fr: "{role} — **{name}** demande une invitation de guilde. Personne pouvant inviter n'est connu en ligne dans le jeu pour le moment."
  },
  "linked.first": {
    en: "✅ You're linked on **{server}**. Your Guilded companion proved these characters are yours, so there is nothing more to do:",
    fr: "✅ Tu es lié sur **{server}**. Ton compagnon Guilded a prouvé que ces personnages sont à toi, il n'y a donc plus rien à faire :"
  },
  "linked.added": {
    en: "✅ New on **{server}**: {names} now linked to you. All your linked characters:",
    fr: "✅ Nouveau sur **{server}** : {names} maintenant lié(s) à toi. Tous tes personnages liés :"
  },
  "linked.hint": {
    en: "Not yours? Press **Not mine** below (or `/character unlink` on the server): it is unlinked and never linked back automatically. `/character list` shows this list any time.",
    fr: "Pas à toi ? Appuie sur **Pas à moi** ci-dessous (ou `/character unlink` sur le serveur) : il est délié et ne sera plus relié automatiquement. `/character list` affiche cette liste en tout temps."
  },
  "linked.notMine": { en: "Not mine: {name}", fr: "Pas à moi : {name}" },
  "linked.notMineMenu": { en: "Not mine… pick a character", fr: "Pas à moi… choisis un personnage" },
  "linked.wrongServer": { en: "Wrong server", fr: "Mauvais serveur" },
  "linked.unlinked": {
    en: "✅ **{name}** is unlinked from you on **{server}** and won't be linked back automatically. An officer can still link it to someone.",
    fr: "✅ **{name}** n'est plus lié à toi sur **{server}** et ne sera pas relié automatiquement. Un officier peut encore le lier à quelqu'un."
  },
  "linked.gone": {
    en: "That character is already unlinked. `/character list` shows what is linked.",
    fr: "Ce personnage est déjà délié. `/character list` affiche ce qui est lié."
  },
  "linked.notYours": { en: "Only the member this message was sent to can use it.", fr: "Seul le membre à qui ce message est adressé peut l'utiliser." },
  "panel.title": { en: "**Your characters on {server}**", fr: "**Tes personnages sur {server}**" },
  "panel.empty": { en: "Nothing is linked to you yet. Press **Link a character**, or log in with the Guilded Companion once and they link by themselves.", fr: "Aucun personnage n'est encore lié à toi. Appuie sur **Lier un personnage**, ou ouvre le jeu une fois avec le compagnon Guilded : ils se lient tout seuls." },
  "panel.link": { en: "Link a character", fr: "Lier un personnage" },
  "panel.picture": { en: "Picture", fr: "Image" },
  "panel.refresh": { en: "Refresh", fr: "Actualiser" },
  "panel.mainMenu": { en: "Set as main…", fr: "Définir comme principal…" },
  "panel.unlinkMenu": { en: "Unlink…", fr: "Délier…" },
  "panel.mainDone": { en: "✅ **{name}** is now your main.", fr: "✅ **{name}** est maintenant ton principal." },
  "panel.unlinkAsk": { en: "Unlink **{name}**? Its history is kept and it is not linked back automatically.", fr: "Délier **{name}** ? Son historique est conservé et il ne sera pas relié automatiquement." },
  "panel.unlinkYes": { en: "Yes, unlink it", fr: "Oui, le délier" },
  "panel.cancel": { en: "Cancel", fr: "Annuler" },
  "panel.pick": { en: "Pick the character to link. Not in the list? Log in with it once and sync, then Refresh.", fr: "Choisis le personnage à lier. Pas dans la liste ? Ouvre le jeu avec lui une fois et synchronise, puis Actualise." },
  "panel.pickNone": { en: "No unlinked character is waiting yet. Log in with it once with the Guilded Companion; it shows up here within a minute. Or type its name.", fr: "Aucun personnage non lié n'attend pour l'instant. Ouvre le jeu avec lui une fois avec le compagnon Guilded : il apparaît ici en une minute. Ou écris son nom." },
  "panel.pickMenu": { en: "Pick a character…", fr: "Choisis un personnage…" },
  "panel.typeName": { en: "Type the name", fr: "Écrire le nom" },
  "panel.modalTitle": { en: "Link a character", fr: "Lier un personnage" },
  "panel.modalLabel": { en: "Character name", fr: "Nom du personnage" },
  "panel.linkedOne": { en: "✅ Linked **{name}** as {kind}. A message with a **Not mine** button follows.", fr: "✅ **{name}** lié comme {kind}. Un message avec un bouton **Pas à moi** suit." },
  "panel.kindMain": { en: "your main", fr: "ton principal" },
  "panel.kindAlt": { en: "an alt", fr: "un alt" },
  "panel.claimFailed": { en: "That character is not available to link. If it is yours, ask an officer.", fr: "Ce personnage n'est pas disponible à lier. S'il est à toi, demande à un officier." },
  "panel.tooMany": { en: "Too many tries. Wait a few minutes, or ask an officer.", fr: "Trop d'essais. Attends quelques minutes, ou demande à un officier." },
  "panel.page": { en: "Page {page} of {pages} ({hidden} more character(s) on the other pages)", fr: "Page {page} sur {pages} ({hidden} autre(s) personnage(s) sur les autres pages)" },
  "panel.prev": { en: "◀ Previous", fr: "◀ Précédent" },
  "panel.next": { en: "Next ▶", fr: "Suivant ▶" },
  "linked.officerLogPanel": {
    en: "{user} unlinked {name} from the character panel (it won't be linked back).",
    fr: "{user} a délié {name} depuis le panneau des personnages (il ne sera pas relié)."
  },

  "panel.hint": { en: "Tip: `/character list` opens your panel: link, set your main and unlink with buttons.", fr: "Astuce : `/character list` ouvre ton panneau : lier, définir ton principal et délier avec des boutons." },
  "panel.noServer": { en: "You are not a member of that server any more.", fr: "Tu n'es plus membre de ce serveur." },
  "linked.wrongServerHelp": {
    en: "Linked to the wrong server? Open the **Guilded Companion** on your PC, go to Advanced, select that server under *Active connection*, then press **Remove this server**. It only forgets the connection on your PC and stops uploading there; nothing is deleted on the server. For a single character, use **Not mine** instead.",
    fr: "Lié au mauvais serveur ? Ouvre le **compagnon Guilded** sur ton PC, va dans Avancé, choisis ce serveur sous *Active connection*, puis appuie sur **Remove this server**. Cela oublie seulement la connexion sur ton PC et arrête les envois là-bas ; rien n'est supprimé sur le serveur. Pour un seul personnage, utilise plutôt **Pas à moi**."
  },
  "linked.officerLog": {
    en: "{user} unlinked {name} with the \"Not mine\" button (it had been linked automatically; it won't be linked back).",
    fr: "{user} a délié {name} avec le bouton « Pas à moi » (il avait été lié automatiquement; il ne sera pas relié)."
  },
  "linked.button": { en: "My characters", fr: "Mes personnages" },
  "linked.add": { en: "Add another", fr: "Ajouter un autre" },
  "panel.moreServers": { en: "You are in more servers than shown. Use /character in the server you want.", fr: "Tu es dans plus de serveurs que ceux affichés. Utilise /character dans le serveur voulu." },
  "panel.whichServer": { en: "Which server?", fr: "Quel serveur ?" },
  "linked.level": { en: "level {level}", fr: "niveau {level}" },
  "linked.main": { en: "main", fr: "principal" },
  "linked.more": { en: "… and {count} more", fr: "… et {count} de plus" },
  // Linking audit T3: two members and one character (link-conflict-dm.ts). {proof} is one of linkmove.proof.*.
  "linkmove.proof.named": { en: "a name (typed, claimed or matched)", fr: "un nom (tapé, réclamé ou reconnu)" },
  "linkmove.proof.companion": { en: "their own Guilded app", fr: "sa propre application Guilded" },
  "linkmove.proof.heard": { en: "a `/guilded verify` code heard in game by a guildmate's addon", fr: "un code `/guilded verify` entendu en jeu par l'addon d'un coéquipier" },
  "linkmove.proof.officer": { en: "an officer", fr: "un officier" },
  "linkmove.gained": {
    en: "🔁 **{name}** is now linked to you on **{server}**. It was linked to another member; your proof ({proof}) is stronger than theirs ({other}), so it moved with its history. Not your character? Press the button and it goes back.",
    fr: "🔁 **{name}** est maintenant lié à toi sur **{server}**. Il était lié à un autre membre; ta preuve ({proof}) est plus forte que la sienne ({other}), il a donc été transféré avec son historique. Ce n'est pas ton personnage ? Appuie sur le bouton et il retourne d'où il vient."
  },
  "linkmove.lost": {
    en: "🔁 **{name}** was moved from you to another member on **{server}**: their proof ({proof}) is stronger than yours ({other}). Nothing was deleted. If it is yours, press the button: you get it back and an officer decides.",
    fr: "🔁 **{name}** a été transféré de toi à un autre membre sur **{server}** : sa preuve ({proof}) est plus forte que la tienne ({other}). Rien n'a été supprimé. S'il est à toi, appuie sur le bouton : tu le récupères et un officier tranche."
  },
  "linkmove.queued": {
    en: "⚖️ **{name}** is already linked to another member on **{server}**, with the same kind of proof as yours ({proof}). Nothing changed. The officers were told and will decide.",
    fr: "⚖️ **{name}** est déjà lié à un autre membre sur **{server}**, avec le même genre de preuve que la tienne ({proof}). Rien n'a changé. Les officiers ont été avisés et vont trancher."
  },
  "linkmove.weaker": {
    en: "**{name}** is already linked to another member on **{server}** with stronger proof ({other}) than yours ({proof}), so it stays there. If it is yours, paste your `/guilded verify` line in game with that character, or ask an officer.",
    fr: "**{name}** est déjà lié à un autre membre sur **{server}** avec une preuve plus forte ({other}) que la tienne ({proof}), il reste donc là. S'il est à toi, colle ta ligne `/guilded verify` en jeu avec ce personnage, ou demande à un officier."
  },
  "linkmove.notMine": { en: "Not mine, undo", fr: "Pas à moi, annuler" },
  "linkmove.mine": { en: "It is mine, undo", fr: "Il est à moi, annuler" },
  "linkmove.undone": { en: "Done: **{name}** went back to the member who had it. It will not be linked to you again by itself.", fr: "C'est fait : **{name}** est retourné au membre qui l'avait. Il ne sera plus lié à toi automatiquement." },
  "linkmove.contested": { en: "Done: **{name}** is linked to you again. The officers were told and will decide who keeps it.", fr: "C'est fait : **{name}** est de nouveau lié à toi. Les officiers ont été avisés et vont décider qui le garde." },
  "linkmove.tooLate": { en: "This can no longer be undone here (it was already undone, unlinked or decided by an officer). Ask an officer.", fr: "Ça ne peut plus être annulé ici (déjà annulé, délié ou décidé par un officier). Demande à un officier." },
  "linkmove.logMoved": { en: "🔁 {name} moved from <@{from}> to <@{to}>: stronger proof ({proof} over {other}). History kept; both were told and can undo.", fr: "🔁 {name} transféré de <@{from}> à <@{to}> : preuve plus forte ({proof} contre {other}). Historique conservé; les deux ont été avisés et peuvent annuler." },
  "linkmove.logQueued": { en: "⚖️ {name} is linked to <@{from}> and <@{to}> claims it with the same proof ({proof}). Nothing changed: decide with `/officer character move`.", fr: "⚖️ {name} est lié à <@{from}> et <@{to}> le réclame avec la même preuve ({proof}). Rien n'a changé : tranchez avec `/officer character move`." },
  "linkmove.logUndone": { en: "↩️ <@{to}> said {name} is not theirs: it went back to <@{from}>.", fr: "↩️ <@{to}> a dit que {name} n'est pas à lui : il est retourné à <@{from}>." },
  "linkmove.logContested": { en: "⚖️ <@{from}> took {name} back after it moved to <@{to}> on stronger proof. It stays with <@{from}> until an officer decides with `/officer character move`.", fr: "⚖️ <@{from}> a repris {name} après son transfert à <@{to}> sur une preuve plus forte. Il reste à <@{from}> jusqu'à ce qu'un officier tranche avec `/officer character move`." },
  "linked.none": {
    en: "You have no linked characters yet. Open the Guilded companion, or use `/character pair` on the server.",
    fr: "Tu n'as pas encore de personnage lié. Ouvre le compagnon Guilded, ou utilise `/character pair` sur le serveur."
  },
  // 8.5 batch 3 (#13/#14): the guild-invite channel (invite-channel.ts).
  "invite.hint": {
    en: "I could not read a full character name. Write it as **First Last** (WoW Forever names have both), for example `Lebowski Holyroller`. This message disappears in a moment.",
    fr: "Je n'ai pas pu lire un nom de personnage complet. Écris-le comme **Prénom Nom** (les noms de WoW Forever ont les deux), par exemple `Lebowski Holyroller`. Ce message disparaît dans un instant."
  },
  "invite.dm": {
    en: "Welcome to **{server}**! To be invited to the guild in game, post your **full character name** (first and last name) in <#{channel}>. An officer will invite you, and I will put a ✅ on your message when it is done.",
    fr: "Bienvenue sur **{server}** ! Pour être invité dans la guilde en jeu, écris le **nom complet de ton personnage** (prénom et nom) dans <#{channel}>. Un officier t'invitera, et je mettrai un ✅ sur ton message quand ce sera fait."
  },
  "invite.button": { en: "Request a guild invite", fr: "Demander une invitation de guilde" },
  "invite.modalTitle": { en: "Guild invite", fr: "Invitation de guilde" },
  "invite.modalLabel": { en: "Full character name (First Last)", fr: "Nom complet du personnage (Prénom Nom)" },
  "invite.invalid": {
    en: "That does not look like a full character name. Write it as **First Last**, for example `Lebowski Holyroller`.",
    fr: "Ça ne ressemble pas à un nom de personnage complet. Écris-le comme **Prénom Nom**, par exemple `Lebowski Holyroller`."
  },
  "invite.confirmed": {
    en: "✅ Your request is in <#{channel}>. An officer will invite you in game, and a ✅ will appear on it when it is done.",
    fr: "✅ Ta demande est dans <#{channel}>. Un officier t'invitera en jeu, et un ✅ apparaîtra dessus quand ce sera fait."
  },
  "invite.duplicate": { en: "You already asked for this character, so nothing was added. An officer will get to it.", fr: "Tu as déjà demandé pour ce personnage, rien n'a été ajouté. Un officier s'en occupera." },
  "invite.doneButton": { en: "✅ Invited / joined", fr: "✅ Invité / a joint la guilde" },
  "invite.doneOfficers": { en: "Only officers can mark an invite as done.", fr: "Seuls les officiers peuvent marquer une invitation comme faite." },
  "invite.unavailable": { en: "Guild invites are not open on this server right now. Ask an officer.", fr: "Les invitations de guilde ne sont pas ouvertes sur ce serveur pour le moment. Demande à un officier." },
  "verify.taken": {
    en: "**{name}** sent your `/guilded verify` code, but it is already linked to someone else on **{server}**. Ask an officer to move it to you.",
    fr: "**{name}** a envoyé ton code `/guilded verify`, mais il est déjà lié à quelqu'un d'autre sur **{server}**. Demande à un officier de te le transférer."
  },
  "pair.optionalTitle": { en: "Optional: sync with the Windows companion", fr: "Facultatif : synchroniser avec le compagnon Windows" },
  "pair.optional": {
    en: "Want to sync saved data and download standings? Press **Connect optional companion**, install the free Windows companion (Microsoft Store first, or the direct download that updates itself at https://guilded.kcaron.top/companion/) and choose **Sign in with Discord**, then press **Connect** on the page that opens. Nothing to type. The companion is Windows-only and optional for the addon alone. You keep your linked characters.",
    fr: "Tu veux synchroniser tes données et télécharger les classements ? Appuie sur **Connecter le compagnon (facultatif)**, installe le compagnon Windows gratuit (Microsoft Store d'abord, ou le téléchargement direct qui se met à jour seul sur https://guilded.kcaron.top/companion/?lang=fr) et choisis **Connexion avec Discord**, puis appuie sur **Relier** sur la page qui s'ouvre. Rien à taper. Le compagnon fonctionne sous Windows seulement et reste facultatif pour l'addon seul. Tes personnages liés restent liés."
  },
  "pair.connectOptional": { en: "Connect optional companion", fr: "Connecter le compagnon (facultatif)" },
  "pair.addAlts": {
    en: "Your main is already linked. Alts link by themselves: with the `/guilded verify` line above, or with your companion's next **Sync now** (every character that logged in on this PC). Nothing to do per alt.",
    fr: "Ton principal est déjà lié. Tes alts se lient tout seuls : avec la ligne `/guilded verify` ci-dessus, ou à la prochaine **Sync now** de ton compagnon (chaque personnage connecté sur ce PC). Rien à faire par alt."
  },
  "pair.codeTitle": { en: "🔑 Code for companions older than 7.2", fr: "🔑 Code pour les compagnons plus anciens que 7.2" },
  "pair.code": {
    en: "```\n{code}\n```Only if **Sign in with Discord** is missing in your companion: in **Connection & setup**, open **Older companions or your guild's own bot**, paste it and press **Connect**. Expires {expires} · one use · keep it private. Your other companions stay connected.",
    fr: "```\n{code}\n```Seulement si **Sign in with Discord** manque dans ton compagnon : dans **Connection & setup**, ouvre **Older companions or your guild's own bot**, colle-le et appuie sur **Connect**. Expire {expires} · usage unique · garde-le privé. Tes autres compagnons restent reliés."
  },
  "pair.codeButton": { en: "Older companion? Get a code", fr: "Ancien compagnon ? Obtenir un code" },
  "pair.online": { en: "Get the Windows companion", fr: "Obtenir le compagnon Windows" },
  "pair.openOnline": { en: "Get the Windows companion (Microsoft Store first) with the button below, then open it.", fr: "Obtiens le compagnon Windows (Microsoft Store d'abord) avec le bouton ci-dessous, puis ouvre-le." },
  "pair.askLink": { en: "Ask an officer where to download your guild's companion.", fr: "Demande à un officier où télécharger le compagnon de ta guilde." },
  "pair.syncTitle": { en: "🔗 Link all your characters: 2 steps (Windows)", fr: "🔗 Lier tous tes personnages : 2 étapes (Windows)" },
  "pair.sync": {
    en: "1. {companion} Open it and press **Sign in with Discord**, then **Connect** on the page that opens. Nothing to type; it finds your WoW folder by itself.\n2. In WoW, log in and type `/reload` once. The app shows a green **✓** when you are linked: your main and every alt that logged in on this PC link at once.",
    fr: "1. {companion} Ouvre-le et appuie sur **Sign in with Discord**, puis **Relier** sur la page qui s'ouvre. Rien à taper; il trouve tout seul ton dossier WoW.\n2. Dans WoW, connecte-toi et tape `/reload` une fois. L'appli affiche un **✓** vert quand tu es lié : ton principal et chaque alt connecté sur ce PC se lient d'un coup."
  },
  "pair.checkTitle": { en: "Check the result", fr: "Vérifier le résultat" },
  "pair.check": {
    en: "After a sync, `/character list` shows your main and alts.",
    fr: "Après une synchro, `/character list` montre ton principal et tes alts."
  },
  "character.created": { en: "Linked", fr: "Lié" },
  "character.updated": { en: "Updated", fr: "Mis à jour" },
  "character.mainKind": { en: "your main", fr: "ton principal" },
  "character.altKind": { en: "an alt", fr: "un alt" },
  "character.linkResult": { en: "✅ {action} **{name}** as {kind}.", fr: "✅ {action} **{name}** comme {kind}." },
  "character.mainNext": {
    en: "Check `/character list`. To add an alt, repeat `/guilded character` → `/character import` on that alt and leave **main** unset. The companion is optional.",
    fr: "Vérifie `/character list`. Pour ajouter un alt, répète `/guilded character` → `/character import` sur l'alt et laisse **main** vide. Le compagnon est facultatif."
  },
  "character.altNext": {
    en: "Your existing main stays the same. Check `/character list`. No companion is required for this link.",
    fr: "Ton principal existant reste le même. Vérifie `/character list`. Aucun compagnon n'est requis pour ce lien."
  },
  "gamerem.dm": {
    en: "Hi! You are in **{guild}** but have not picked a game yet. Pick yours to open its channels. It takes a few seconds.",
    fr: "Salut ! Tu es dans **{guild}**, mais tu n'as pas encore choisi de jeu. Choisis le tien pour ouvrir ses salons. Ça prend quelques secondes."
  },
  "gamerem.dm.again": {
    en: "Hi again! You still have no game picked in **{guild}**. Pick yours to open its channels, or press Stop reminders and we will not write again.",
    fr: "Re-salut ! Tu n'as toujours pas choisi de jeu dans **{guild}**. Choisis le tien pour ouvrir ses salons, ou appuie sur Arrêter les rappels et on ne t'écrira plus."
  },
  "gamerem.button.channel": { en: "Open the server", fr: "Ouvrir le serveur" },
  "gamerem.button.stop": { en: "Stop reminders", fr: "Arrêter les rappels" },
  "gamerem.stopped": { en: "Done: no more reminders from this server. You can still pick your games any time.", fr: "C'est fait : plus aucun rappel de ce serveur. Tu peux toujours choisir tes jeux en tout temps." },
  "gamerem.title": { en: "**Members with no game yet:** {count} (page {page}/{pages})", fr: "**Membres sans jeu choisi :** {count} (page {page}/{pages})" },
  "gamerem.empty": { en: "Everyone has picked a game. 🎉", fr: "Tout le monde a choisi un jeu. 🎉" },
  "gamerem.notConfigured": { en: "This server has no game roles yet: pick them in `/setup start` (games step).", fr: "Ce serveur n'a pas encore de rôles de jeu : choisissez-les dans `/setup start` (étape des jeux)." },
  "gamerem.unreadable": { en: "I could not read the member list right now. Try again in a minute.", fr: "Je n'ai pas pu lire la liste des membres. Réessayez dans une minute." },
  "gamerem.rules": { en: "rules", fr: "règles" },
  "gamerem.joined": { en: "joined {when}", fr: "arrivé {when}" },
  "gamerem.joinedUnknown": { en: "join date unknown", fr: "date d'arrivée inconnue" },
  "gamerem.state.none": { en: "no reminder", fr: "aucun rappel" },
  "gamerem.state.queued": { en: "reminder queued", fr: "rappel en attente" },
  "gamerem.state.sent": { en: "reminder sent ×{n} (last {when})", fr: "rappel envoyé ×{n} (dernier {when})" },
  "gamerem.state.closed": { en: "DMs closed", fr: "MP fermés" },
  "gamerem.state.stopped": { en: "stopped reminders", fr: "a arrêté les rappels" },
  "gamerem.button.these": { en: "Remind this page", fr: "Rappeler cette page" },
  "gamerem.button.all": { en: "Remind all ({count})", fr: "Rappeler tous ({count})" },
  "gamerem.button.confirm": { en: "Yes, remind {count}", fr: "Oui, rappeler {count}" },
  "gamerem.button.cancel": { en: "Cancel", fr: "Annuler" },
  "gamerem.confirm": { en: "Send a private reminder to up to {count} members? Those who stopped reminders, closed their DMs or were reminded in the last 24 hours are skipped.", fr: "Envoyer un rappel privé à {count} membres au plus? Ceux qui ont arrêté les rappels, fermé leurs MP ou reçu un rappel dans les dernières 24 h sont ignorés." },
  "gamerem.result.queued": { en: "Reminders queued: {count} (sent a few at a time).", fr: "Rappels en file : {count} (envoyés quelques-uns à la fois)." },
  "gamerem.result.stopped": { en: "Skipped, asked to stop: {count}.", fr: "Ignorés, ont demandé d'arrêter : {count}." },
  "gamerem.result.closed": { en: "Skipped, DMs closed: {count}.", fr: "Ignorés, MP fermés : {count}." },
  "gamerem.result.capped": { en: "Skipped, already reminded {max} times: {count}.", fr: "Ignorés, déjà rappelés {max} fois : {count}." },
  "gamerem.cooldown": { en: "\"Remind all\" was already used this week. You can use it again {when}. You can still remind a page or one member.", fr: "« Rappeler tous » a déjà été utilisé cette semaine. Vous pourrez le refaire {when}. Vous pouvez encore rappeler une page ou un membre." },
  "gamerem.result.recent": { en: "Skipped, reminded in the last 24 hours: {count}.", fr: "Ignorés, rappelés depuis moins de 24 h : {count}." },
  "gamerem.result.gone": { en: "Skipped, already picked a game, left or a bot: {count}.", fr: "Ignorés, jeu déjà choisi, parti ou robot : {count}." },
  "gamerem.auto.on": { en: "Automatic reminder **on**: a member with no game gets one private message a day after joining, and one more a week later at most. Never more.", fr: "Rappel automatique **activé** : un membre sans jeu reçoit un message privé un jour après son arrivée, puis un seul autre une semaine plus tard au plus. Jamais plus." },
  "gamerem.auto.off": { en: "Automatic reminder **off**. Officers can still send reminders from `/report games list`.", fr: "Rappel automatique **désactivé**. Les officiers peuvent toujours envoyer des rappels depuis `/report games list`." },
  "onboard.nudge": {
    en: "Hi! You joined **{guild}** yesterday and a step or two is still open. This is the only reminder you will get.",
    fr: "Salut ! Tu as rejoint **{guild}** hier et il te reste une étape ou deux. C'est le seul rappel que tu recevras."
  },

  // Getting started guide
  "guide.title": { en: "⚜️ Getting started with Guilded", fr: "⚜️ Bien commencer avec Guilded" },
  "guide.companionShort": {
    en: "**Optional companion:** `/character pair` opens the connection instructions. Choose **Sign in with Discord**, then the exact guild/edition. Use one connection profile per guild. Sync your main first, then alts with that connection; no new pairing for each alt.",
    fr: "**Compagnon facultatif :** `/character pair` ouvre les instructions. Choisis **Sign in with Discord**, puis la bonne guilde/édition. Utilise un profil de connexion par guilde. Synchronise ton principal, puis tes alts avec ce profil; aucun nouveau jumelage pour chaque alt."
  },
  "guide.installShort": {
    en: "**Install Guilded**\n1. Get the matching file at https://guilded.kcaron.top/#start (WoW Forever). Close WoW and extract `Guilded` into the active client's `Interface\\AddOns` folder. Check `Interface\\AddOns\\Guilded\\Guilded.toc`.\n2. Enable the addon, enter the game and `/reload`. **In-game only** works without Discord. Guilded Dungeons is the separate dungeon-only addon.\n3. To connect, `/character pair` shows your private instructions. In the Windows companion choose **Sign in with Discord**, then the right guild/edition. Select that client's SavedVariables and addon folders; keep a separate profile for each guild. Sync your main first, then alts.\n4. For several guilds in one Discord, `/wow list` and `/wow use` select the context; channel bindings take priority. Preserve Forever first/last names and Blizzard realm names from the addon. Never share pairing codes.",
    fr: "**Installer Guilded**\n1. Prends le bon fichier sur https://guilded.kcaron.top/#start (WoW Forever). Ferme WoW et décompresse `Guilded` dans `Interface\\AddOns` du client utilisé. Vérifie `Interface\\AddOns\\Guilded\\Guilded.toc`.\n2. Active l'addon, entre en jeu et fais `/reload`. **En jeu uniquement** fonctionne sans Discord. Guilded Dungeons est l'addon séparé pour les donjons.\n3. Pour connecter, `/character pair` donne les instructions privées. Dans le compagnon Windows, choisis **Sign in with Discord**, puis la bonne guilde/édition. Sélectionne les dossiers SavedVariables et addon de ce client; garde un profil par guilde. Synchronise ton principal, puis tes alts.\n4. Avec plusieurs guildes dans un Discord, `/wow list` et `/wow use` choisissent le contexte; les salons associés ont priorité. Garde les prénoms/noms Forever et les royaumes Blizzard fournis par l'addon. Ne partage jamais tes codes."
  },
  "guide.body": {
    en: "**Start with Discord** — accept the rules and pick your games with the welcome buttons. `/help` lists the commands available to your roles. WoW linking and companion sync are optional.\n\n**New here? Three steps: [guilded.kcaron.top/start](https://guilded.kcaron.top/start/)** (step by step: [install](https://guilded.kcaron.top/guides/install/) · [link](https://guilded.kcaron.top/guides/link/))\n1) Install the addon for your WoW version (required). 2) Optional: the Windows companion, latest from [Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) or the [direct download that updates itself](https://guilded.kcaron.top/companion/). 3) Sign in with Discord.\n\n**Install Guilded for WoW Forever**\nGuilded supports WoW Forever only. Get the file on {url}, or from the [download page](https://guilded.kcaron.top/editions/). Close WoW. Extract `Guilded` into the active client's `Interface\\AddOns`; check `Guilded\\Guilded.toc` is inside it. Enable the addon, choose **In-game only** in `/guilded setup` and `/reload`. For dungeon tools only, choose **Guilded Dungeons**. Keep your SavedVariables when updating.\n\n**Choose your guild, then link characters**\nA Discord server can host several WoW guilds/editions. `/wow list` shows them; `/wow use` selects yours. An associated channel takes priority. `/character pair` gives a `/guilded verify …` line for WoW chat; an online officer's addon and companion relay the link. Manual option: `/guilded character` → Discord `/character import` → **code**, main first, leaving **main** unset. Check `/character list`. Keep Forever's first and last name and Blizzard's realm-qualified names exactly as exported.\n\n**Optional companion: Discord sign-in**\n{companion} Or install the Windows companion from [Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) (direct download from the website as a fallback; it is unsigned and Windows may warn). It is Windows-only. In **Connection & setup**, choose **Sign in with Discord**, then the exact guild/edition. Select that client's SavedVariables and addon folders. Add a separate connection profile per guild/edition; enabled desktop profiles keep syncing in the background. Sync your main first, then alts using the same profile. Older companions or independently hosted bots can still use the private pairing code. Keep credentials private.\n\n**Play and share**\nUse raid signup buttons and `/dungeon leaderboard`. Public dungeon sharing is optional; ratings and benchmarks are provisional. `/report bug` reports a problem.",
    fr: "**Commence par Discord** — accepte les règles et choisis tes jeux avec les boutons d'accueil. `/help` montre les commandes de tes rôles. Le lien WoW et la synchronisation du compagnon sont facultatifs.\n\n**Nouveau ? Trois étapes : [guilded.kcaron.top/start](https://guilded.kcaron.top/start/?lang=fr)** (pas à pas : [installer](https://guilded.kcaron.top/guides/install/?lang=fr) · [lier](https://guilded.kcaron.top/guides/link/?lang=fr))\n1) Installe l'addon de ta version de WoW (obligatoire). 2) Facultatif : le compagnon Windows, dernière version du [Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) ou le [téléchargement direct qui se met à jour seul](https://guilded.kcaron.top/companion/?lang=fr). 3) Connecte-toi avec Discord.\n\n**Installe Guilded pour WoW Forever**\nGuilded prend en charge WoW Forever uniquement. Prends le fichier sur {url}, ou sur la [page de téléchargement](https://guilded.kcaron.top/editions/?lang=fr). Ferme WoW. Décompresse `Guilded` dans `Interface\\AddOns` du client utilisé; vérifie la présence de `Guilded\\Guilded.toc`. Active l'addon, choisis **En jeu uniquement** dans `/guilded setup`, puis `/reload`. Pour les donjons seulement, choisis **Guilded Dungeons**. Garde tes SavedVariables lors des mises à jour.\n\n**Choisis ta guilde, puis lie tes personnages**\nUn Discord peut accueillir plusieurs guildes/éditions WoW. `/wow list` les affiche; `/wow use` choisit la tienne. Un salon associé a priorité. `/character pair` donne une ligne `/guilded verify …` à coller dans WoW; l'addon et le compagnon d'un officier connecté transmettent le lien. Option manuelle : `/guilded character` → `/character import` → **code** dans Discord, principal d'abord, en laissant **main** vide. Vérifie `/character list`. Garde les prénoms et noms Forever et les noms avec royaume Blizzard tels qu'exportés.\n\n**Compagnon facultatif : connexion Discord**\n{companion} Ou installe le compagnon Windows depuis le [Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) (téléchargement direct depuis le site en solution de rechange; non signé, Windows peut avertir). Il fonctionne sous Windows seulement. Dans **Connection & setup**, choisis **Sign in with Discord**, puis la bonne guilde/édition. Sélectionne les dossiers SavedVariables et addon de ce client. Ajoute un profil par guilde/édition; les profils Windows activés continuent de synchroniser en arrière-plan. Synchronise ton principal, puis tes alts avec ce profil. Les anciens compagnons ou bots hébergés séparément peuvent encore utiliser un code privé. Garde tes accès pour toi.\n\n**Joue et partage**\nUtilise les boutons d'inscription aux raids et `/dungeon leaderboard`. Le partage public des donjons est facultatif; les scores et cibles restent provisoires. `/report bug` signale un problème."
  },

  // Help
  "help.title": { en: "⚜️ Guilded — commands", fr: "⚜️ Guilded — commandes" },
  "help.everyone": { en: "Everyone", fr: "Tout le monde" },
  "help.raidLeaders": { en: "Raid Leaders", fr: "Chefs de raid" },
  "help.epgpOfficers": { en: "EPGP Officers", fr: "Officiers EPGP" },
  "help.officers": { en: "Officers", fr: "Officiers" },
  "help.support": { en: "Guilded is free. A coffee helps pay for the bot's hosting and new features: [ko-fi.com/wowguilded](https://ko-fi.com/wowguilded)", fr: "Guilded est gratuit. Un café aide à payer l'hébergement du bot et les nouveautés : [ko-fi.com/wowguilded](https://ko-fi.com/wowguilded)" },
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
