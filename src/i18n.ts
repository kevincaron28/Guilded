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
  "fill.command": { en: "Sign up with /raid signup.", fr: "Inscrivez-vous avec /raid signup." },
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
  "pair.title": { en: "🔗 Your WoW characters", fr: "🔗 Tes personnages WoW" },
  "pair.linked": { en: "✅ **Already linked to your Discord account on this server:**", fr: "✅ **Déjà liés à ton compte Discord sur ce serveur :**" },
  "pair.main": { en: "⭐ Main: **{name}** — {realm}", fr: "⭐ Personnage principal : **{name}** — {realm}" },
  "pair.alt": { en: "• Alt: **{name}** — {realm}", fr: "• Alt : **{name}** — {realm}" },
  "pair.more": { en: "`/character list` shows the rest.", fr: "`/character list` montre les autres." },
  "pair.none": { en: "No WoW character is linked to your Discord account on this server yet.", fr: "Aucun personnage WoW n'est encore lié à ton compte Discord sur ce serveur." },
  "pair.addonDefault": {
    en: "**Start with the addon only (default).** Install [Guilded](https://www.curseforge.com/wow/addons/guilded) or your officers' matching download. **In-game only** works without Discord linking or a companion. The choices below are optional.",
    fr: "**Commence avec l'addon seul (par défaut).** Installe [Guilded](https://www.curseforge.com/wow/addons/guilded) ou la version de tes officiers. **En jeu uniquement** fonctionne sans lien Discord ni compagnon. Les choix ci-dessous sont facultatifs."
  },
  "pair.verifyTitle": { en: "🎮 Link your characters: 1 step", fr: "🎮 Lier tes personnages : 1 étape" },
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
  "verify.moved": {
    en: "**{name}** was unlinked from your Discord account on **{server}**: an officer's Guilded heard another member's `/guilded verify` code from that character. If it is yours, ask an officer.",
    fr: "**{name}** a été délié de ton compte Discord sur **{server}** : le Guilded d'un officier a reçu le code `/guilded verify` d'un autre membre depuis ce personnage. S'il est à toi, demande à un officier."
  },
  "verify.taken": {
    en: "**{name}** sent your `/guilded verify` code, but it is already linked to someone else on **{server}**. Ask an officer to move it to you.",
    fr: "**{name}** a envoyé ton code `/guilded verify`, mais il est déjà lié à quelqu'un d'autre sur **{server}**. Demande à un officier de te le transférer."
  },
  "pair.optionalTitle": { en: "Optional: sync with the online companion", fr: "Facultatif : synchroniser avec le compagnon en ligne" },
  "pair.optional": {
    en: "Want to sync saved data and download standings? Press **Connect optional companion**: in the companion choose **Sign in with Discord**, then press **Connect** on the page that opens. Nothing to type. The online companion runs in your browser; the Windows app is optional. You keep your linked characters.",
    fr: "Tu veux synchroniser tes données et télécharger les classements ? Appuie sur **Connecter le compagnon (facultatif)** : dans le compagnon, choisis **Connexion avec Discord**, puis appuie sur **Relier** sur la page qui s'ouvre. Rien à taper. Le compagnon en ligne fonctionne dans ton navigateur; l'appli Windows est facultative. Tes personnages liés restent liés."
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
  "pair.online": { en: "Open online companion", fr: "Ouvrir le compagnon en ligne" },
  "pair.openOnline": { en: "Open the online companion with the button below.", fr: "Ouvre le compagnon en ligne avec le bouton ci-dessous." },
  "pair.askLink": { en: "Ask an officer for your guild's online companion link.", fr: "Demande à un officier le lien du compagnon en ligne de ta guilde." },
  "pair.syncTitle": { en: "Connect the companion: 3 steps", fr: "Relier le compagnon : 3 étapes" },
  "pair.sync": {
    en: "1. {companion} Choose **Sign in with Discord**, then press **Connect** on the page that opens. Nothing to type.\n2. Pick your WoW folder (the Windows app finds it with **Find it**).\n3. Log in on your main, `/reload`, then **Sync now**. Your main and every alt that logged in on this PC link at once, and the addon uses the Discord standings from your next `/reload`.",
    fr: "1. {companion} Choisis **Sign in with Discord**, puis appuie sur **Relier** sur la page qui s'ouvre. Rien à taper.\n2. Choisis ton dossier WoW (l'appli Windows le trouve avec **Find it**).\n3. Connecte-toi sur ton principal, fais `/reload`, puis **Sync now**. Ton principal et chaque alt connecté sur ce PC se lient d'un coup, et l'addon utilise les classements Discord dès ton prochain `/reload`."
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
    en: "**Install Guilded**\n1. Choose your edition at https://guilded.kcaron.top/#start: Forever, Era/Hardcore, TBC, Mists or Retail. Close WoW and extract `Guilded` into the active client's `Interface\\AddOns` folder. Check `Interface\\AddOns\\Guilded\\Guilded.toc`.\n2. Enable the addon, enter the game and `/reload`. **In-game only** works without Discord. Guilded Dungeons is the separate dungeon-only addon.\n3. To connect, `/character pair` shows your private instructions. In the browser or Windows companion choose **Sign in with Discord**, then the right guild/edition. Select that client's SavedVariables and addon folders; keep a separate profile for each guild. Sync your main first, then alts.\n4. For several guilds in one Discord, `/wow list` and `/wow use` select the context; channel bindings take priority. Preserve Forever first/last names and Blizzard realm names from the addon. Never share pairing codes.",
    fr: "**Installer Guilded**\n1. Choisis ton édition sur https://guilded.kcaron.top/#start : Forever, Era/Hardcore, TBC, Mists ou Retail. Ferme WoW et décompresse `Guilded` dans `Interface\\AddOns` du client utilisé. Vérifie `Interface\\AddOns\\Guilded\\Guilded.toc`.\n2. Active l'addon, entre en jeu et fais `/reload`. **En jeu uniquement** fonctionne sans Discord. Guilded Dungeons est l'addon séparé pour les donjons.\n3. Pour connecter, `/character pair` donne les instructions privées. Dans le compagnon web ou Windows, choisis **Sign in with Discord**, puis la bonne guilde/édition. Sélectionne les dossiers SavedVariables et addon de ce client; garde un profil par guilde. Synchronise ton principal, puis tes alts.\n4. Avec plusieurs guildes dans un Discord, `/wow list` et `/wow use` choisissent le contexte; les salons associés ont priorité. Garde les prénoms/noms Forever et les royaumes Blizzard fournis par l'addon. Ne partage jamais tes codes."
  },
  "guide.body": {
    en: "**Start with Discord** — accept the rules and pick your games with the welcome buttons. `/help` lists the commands available to your roles. WoW linking and companion sync are optional.\n\n**Install the matching WoW edition**\nForever, Classic Era/Hardcore, TBC Anniversary, Mists Classic and Retail are published. Choose the matching file on {url}, or use [edition downloads and the Windows companion](https://guilded.kcaron.top/#start). Close WoW. Extract `Guilded` into the active client's `Interface\\AddOns`; check `Guilded\\Guilded.toc` is inside it. Enable the addon, choose **In-game only** in `/guilded setup` and `/reload`. For dungeon tools only, choose **Guilded Dungeons**. Keep your SavedVariables when updating.\n\n**Choose your guild, then link characters**\nA Discord server can host several WoW guilds/editions. `/wow list` shows them; `/wow use` selects yours. An associated channel takes priority. `/character pair` gives a `/guilded verify …` line for WoW chat; an online officer's addon and companion relay the link. Manual option: `/guilded character` → Discord `/character import` → **code**, main first, leaving **main** unset. Check `/character list`. Keep Forever's first and last name and Blizzard's realm-qualified names exactly as exported.\n\n**Optional companion: Discord sign-in**\n{companion} Or install the Windows companion from the downloads page. In **Connection & setup**, choose **Sign in with Discord**, then the exact guild/edition. Select that client's SavedVariables and addon folders. Add a separate connection profile per guild/edition; enabled desktop profiles keep syncing in the background. Sync your main first, then alts using the same profile. Older companions or independently hosted bots can still use the private pairing code. Keep credentials private.\n\n**Play and share**\nUse raid signup buttons and `/dungeon leaderboard`; Retail also has `/dungeon keystones`. Public dungeon sharing is optional; ratings and benchmarks are provisional. `/report bug` reports a problem.",
    fr: "**Commence par Discord** — accepte les règles et choisis tes jeux avec les boutons d'accueil. `/help` montre les commandes de tes rôles. Le lien WoW et la synchronisation du compagnon sont facultatifs.\n\n**Installe la bonne édition de WoW**\nForever, Classic Era/Hardcore, TBC Anniversary, Mists Classic et Retail sont publiés. Choisis le fichier correspondant sur {url}, ou les [téléchargements par édition et le compagnon Windows](https://guilded.kcaron.top/#start). Ferme WoW. Décompresse `Guilded` dans `Interface\\AddOns` du client utilisé; vérifie la présence de `Guilded\\Guilded.toc`. Active l'addon, choisis **En jeu uniquement** dans `/guilded setup`, puis `/reload`. Pour les donjons seulement, choisis **Guilded Dungeons**. Garde tes SavedVariables lors des mises à jour.\n\n**Choisis ta guilde, puis lie tes personnages**\nUn Discord peut accueillir plusieurs guildes/éditions WoW. `/wow list` les affiche; `/wow use` choisit la tienne. Un salon associé a priorité. `/character pair` donne une ligne `/guilded verify …` à coller dans WoW; l'addon et le compagnon d'un officier connecté transmettent le lien. Option manuelle : `/guilded character` → `/character import` → **code** dans Discord, principal d'abord, en laissant **main** vide. Vérifie `/character list`. Garde les prénoms et noms Forever et les noms avec royaume Blizzard tels qu'exportés.\n\n**Compagnon facultatif : connexion Discord**\n{companion} Ou installe le compagnon Windows depuis les téléchargements. Dans **Connection & setup**, choisis **Sign in with Discord**, puis la bonne guilde/édition. Sélectionne les dossiers SavedVariables et addon de ce client. Ajoute un profil par guilde/édition; les profils Windows activés continuent de synchroniser en arrière-plan. Synchronise ton principal, puis tes alts avec ce profil. Les anciens compagnons ou bots hébergés séparément peuvent encore utiliser un code privé. Garde tes accès pour toi.\n\n**Joue et partage**\nUtilise les boutons d'inscription aux raids et `/dungeon leaderboard`; Retail propose aussi `/dungeon keystones`. Le partage public des donjons est facultatif; les scores et cibles restent provisoires. `/report bug` signale un problème."
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
