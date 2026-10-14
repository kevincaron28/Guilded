// Community polish for the owner's server, approved 14 October 2026. REST only, never starts a second bot session.
//   npx tsx scripts/polish-community.ts           dry run: prints every change
//   npx tsx scripts/polish-community.ts --apply   applies them
// Idempotent. Topics are only written on channels that have none, so later edits by the owner are kept.
import { REST, Routes, ChannelType, type APIChannel, type APIRole } from "discord.js";
import { config } from "../src/config.js";

// Rank roles anyone could ping (Exilé alone reaches ~200 members). Raid-team roles stay mentionable.
const QUIET_ROLES = ["Grand Templier", "Chef de Guerre", "Ancien", "Exalté", "Champion", "Errant", "Exilé"];

const RENAMES: Record<string, string> = {
  "⏩ Acceuil ⏪": "⏩ Accueil ⏪",
  "🖥️liens-utile": "🖥️liens-utiles",
  "activites": "activités",
  "chat-communaute": "chat-communauté",
  "🏅・palmares": "🏅・palmarès"
};

const team = (name: string, display: string): Record<string, string> => ({
  [`${name}-chat`]: `Discussion de l'équipe ${display} : stratégie, disponibilités et bonne humeur.`,
  [`${name}-signups`]: `Inscriptions aux raids de l'équipe : réponds avec les boutons sous chaque annonce.`,
  [`${name}-roster`]: `Composition de l'équipe, rôles et remplaçants, mise à jour par les responsables.`,
  [`${name}-butin`]: `Butin des raids de l'équipe : attributions, priorités et historique.`,
  [`${name}-rapports`]: `Rapports et journaux de raid de l'équipe (Warcraft Logs, bilans).`
});

// Keyed by the channel's name after the renames above.
const TOPICS: Record<string, string> = {
  // Bienvenue
  "👋bienvenue": "Bienvenue sur Quebec Gold ! Présente-toi, puis choisis tes jeux dans 🎮choix-de-jeu pour débloquer leurs salons.",
  "🎮choix-de-jeu": "Choisis tes jeux ici pour débloquer leurs salons. Tu peux changer d'avis en tout temps.",
  "📃guild-info": "Qui nous sommes : nos jeux, nos guildes, nos équipes et comment participer.",
  "🔴règles": "Les règles du serveur. En restant ici, tu acceptes de les respecter.",
  "🎧music-bot": "Commandes du bot de musique, pour garder les autres salons propres.",
  // Admin
  "general-admin": "Discussion de l'administration du serveur.",
  // Path of Exile 2
  "📢annonces": "Annonces Path of Exile 2 : ligues, événements et nouvelles de la communauté.",
  "📰patch-notes": "Notes de mise à jour officielles de Path of Exile 2.",
  "🎥streamer-hub": "Partage tes streams et vidéos PoE 2 : liens et horaires de diffusion.",
  "📋noms-ingame": "Ton nom de personnage PoE 2, pour qu'on puisse t'ajouter en jeu.",
  "💸loto-liste": "Liste des participants à la loterie PoE 2 en cours.",
  "🖥️liens-utiles": "Outils et sites utiles pour PoE 2 : builds, filtres de butin, échange et cartes.",
  "🗨chat-général": "Discussion générale Path of Exile 2.",
  "🤝question-aide": "Une question sur PoE 2 ? Builds, mécaniques, atlas : demande ici, la communauté répond.",
  "🤣humour": "Mèmes et moments drôles de PoE 2.",
  "🎨art-et-créations": "Tes créations : art, captures, montages et projets liés à PoE 2.",
  "👀multimédia": "Captures et clips PoE 2. Les drops vont dans 💎drops.",
  "🆙exp-boost": "Demande ou offre un boost d'expérience. Indique ton niveau, ta ligue et ton horaire.",
  "🏹map-clearing": "Groupes de cartes : indique ta ligue, le palier et l'heure.",
  "👹boss-kill": "Groupes pour les boss : indique le boss, ta ligue et l'heure.",
  "💎drops": "Tes plus beaux drops PoE 2, avec capture.",
  "📊builds": "Partage et discute de builds PoE 2 : lien PoB et explications bienvenus.",
  "hideout": "Montre ton repaire PoE 2 et partage tes idées de décoration.",
  "💰vente-achat": "Achat et vente en jeu entre membres. Aucune vente contre de l'argent réel.",
  "💵price-check": "Demande la valeur d'un objet avant de le vendre : capture et ligue, s'il te plaît.",
  // World of Warcraft
  "infos-wow": "Informations de la guilde WoW : royaume, horaires et liens utiles.",
  "🔴wow-règles": "Règles de la guilde WoW : raids, butin et comportement.",
  "📋wow-personnages": "Tes personnages WoW (nom, royaume, classe), pour qu'on puisse te retrouver en jeu.",
  "wow-patch-notes": "Notes de mise à jour officielles de World of Warcraft.",
  "chat-wow": "Discussion générale World of Warcraft.",
  "chat-raids": "Discussion des raids : stratégies, boss, préparation et retours.",
  "🏴wow-pvp": "JcJ WoW : champs de bataille, arènes et groupes.",
  "📈wow-leveling": "Montée de niveau WoW : conseils, itinéraires et groupes.",
  "💛wow-question-aide": "Une question sur WoW ? Classes, addons, contenu : demande ici.",
  "👀wow-multimédia": "Captures et clips WoW.",
  ...team("les-aggros-anonyme", "Les Aggros Anonyme"),
  ...team("les-pulliticiens", "Les Pulliticiens")
};

const apply = process.argv.includes("--apply");
const rest = new REST({ version: "10", timeout: 15000 }).setToken(config.DISCORD_TOKEN);
const gid = config.DISCORD_GUILD_ID;
const reason = "Guilded: community polish";
const log = (line: string) => console.log(`${apply ? "" : "[dry run] "}${line}`);

const roles = await rest.get(Routes.guildRoles(gid)) as APIRole[];
const channels = await rest.get(Routes.guildChannels(gid)) as APIChannel[];
const named = (name: string) => channels.filter(c => "name" in c && c.name === name);
const me = await rest.get(Routes.guildMember(gid, config.DISCORD_CLIENT_ID)) as { roles: string[] };
const botTop = Math.max(0, ...roles.filter(r => me.roles.includes(r.id)).map(r => r.position));
const manual: string[] = [];

for (const name of QUIET_ROLES) {
  const role = roles.find(r => r.name === name);
  if (!role) { console.warn(`role @${name} not found; skipped`); continue; }
  if (!role.mentionable) { log(`@${name} already not mentionable`); continue; }
  // Discord never lets a bot edit a role at or above its own highest role, even with Administrator.
  if (role.position >= botTop) { manual.push(`@${name}`); continue; }
  log(`@${name}: turn off "anyone can mention"`);
  if (apply) await rest.patch(Routes.guildRole(gid, role.id), { body: { mentionable: false }, reason });
}

const finalName = new Map<string, string>(); // channel id -> name after renames
for (const c of channels) if ("name" in c && c.name) finalName.set(c.id, c.name);
for (const [from, to] of Object.entries(RENAMES)) {
  const found = named(from);
  if (found.length !== 1) { if (named(to).length) log(`#${to} already renamed`); else console.warn(`#${from}: ${found.length} matches; skipped`); continue; }
  log(`rename #${from} -> #${to}`);
  finalName.set(found[0]!.id, to);
  if (apply) await rest.patch(Routes.channel(found[0]!.id), { body: { name: to }, reason });
}

let written = 0;
const textual = channels.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
for (const [name, topic] of Object.entries(TOPICS)) {
  const found = textual.filter(c => finalName.get(c.id) === name);
  if (found.length !== 1) { console.warn(`#${name}: ${found.length} matches; skipped`); continue; }
  const channel = found[0]!;
  if ("topic" in channel && channel.topic) continue;
  log(`topic #${name}: ${topic}`);
  written++;
  if (apply) await rest.patch(Routes.channel(channel.id), { body: { topic }, reason });
}
const stillEmpty = textual.filter(c => !("topic" in c && c.topic) && !TOPICS[finalName.get(c.id) ?? ""]).map(c => `#${finalName.get(c.id)}`);
console.log(`\n${written} topic(s) ${apply ? "written" : "to write"}. Text channels left without a topic: ${stillEmpty.join(", ") || "none"}`);
if (manual.length) console.log(`Above the bot, change by hand (Server Settings → Roles → "Allow anyone to @mention"): ${manual.join(", ")}`);
