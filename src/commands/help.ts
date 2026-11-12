import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { asLang, t, type Lang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { guildService } from "./context.js";
import { POE_TRACKING_ENABLED } from "../../companion/active-games.mjs";
import { CURRENT_VERSION } from "../services/version-announce.js";

// Short, rank-aware command list in the guild's language: everyone sees the
// member section; officers and leaders also see what they're allowed to run.
export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("What can I do here? Lists the commands you can use.");

// Forever-only focus (companion/active-games.mjs): lines about a switched-off game are not listed.
export const visibleLines = (lines: string[], poe = POE_TRACKING_ENABLED): string[] => poe ? lines : lines.filter(line => !line.includes("`/poe "));

const LINES: Record<"everyone" | "raidLeader" | "dkpOfficer" | "officer", Record<Lang, string[]>> = {
  everyone: {
    en: [
      "**New here? https://guilded.kcaron.top/start/** — 1) install the addon for your WoW version (required) · 2) sync with Discord: [download the Windows companion](https://guilded.kcaron.top/companion/) (or search \"Guild Sync Companion\" in the Microsoft Store) and run the installer · 3) keep it open, it starts with Windows. Signing in with Discord is optional",
      "The addon works alone. The companion syncs by itself; **Sign in with Discord** is optional and confirms your characters (no code). A character missing? `/character claim` and pick it; `/character list` checks them",
      "`/wow list` · `/wow use` — choose your guild; channel bindings take priority. Keep Forever first/last names and Blizzard realms from the addon",
      "`/character add` — link a character by hand, or `/character import` — paste the line `/guilded character` shows, or the code from `/guilded share`",
      "Raid posts have buttons to sign up",
      "`/epgp balance` · `/epgp leaderboard` · `/character profile` · `/character achievements` · `/character who <name>`",
      "`/raid progress` · `/raid report` · `/report stats` · `/loot history`",
      "`/loot bid` — bid GP on a Discord loot auction",
      "`/character wishlist add` · `/character profession set` · `/character profession who <prof>`",
      "`/bank search` · `/bank request` — search and ask the guild bank · `/craft request` — ask a crafter",
      "`/dungeon leaderboard` · `/dungeon records` · `/dungeon player` — dungeon challenge · `/dungeon group` — form a group with its own voice channel · `/dungeon alerts` — get pinged for groups you fit",
      "`/bg history` · `/bg duels` — your battleground records (paired companion; nothing is awarded automatically), duels and ladder",
      "Guild chat milestones are on by default; turn them off with `/guilded announce off`",
      "In game: call for help (Shift+right-click the minimap button), layer invite and raid sign-up",
      "`/character readiness me` — your latest gear check from the addon",
      "`/team list` · `/team sessions` · `/team respond` — weekly dungeon and PvP cores; confirm for each session",
      "`/apply` — apply to a raid core (or press **Apply** on that core's own roster post in the raid roster channel)",
      "`/report bug` — report a bug or problem with the bot",
      "`/community seasons` · `/community leaderboard` · `/community wallet` · `/community dice` — game seasons, scores and daily dice",
      "`/community honors` — hall of fame: weekly MVPs, rookies and monthly podiums",
      "Lottery, gaming night, quiz and challenge posts have participation buttons",
      "`/participation status` · `/participation nominate` · `/participation history` — capped Discord points, helper recognition and guild goals",
      "`/poe status` · `/poe pair` · `/poe runs` · `/poe summary` — PoE2 companion mapping journal"
    ],
    fr: [
      "**Nouveau ? https://guilded.kcaron.top/start/?lang=fr** — 1) installez l'addon de votre version de WoW (obligatoire) · 2) [téléchargez le compagnon Windows](https://guilded.kcaron.top/companion/?lang=fr) (ou « Guild Sync Companion » dans le Microsoft Store) et lancez-le · 3) laissez-le ouvert. Connexion Discord facultative",
      "L'addon fonctionne seul. Le compagnon synchronise tout seul; **Sign in with Discord** est facultatif et confirme tes personnages (aucun code). Il en manque un ? `/character claim` et choisis-le; `/character list` les affiche",
      "`/wow list` · `/wow use` — choisir sa guilde; les salons associés ont priorité. Gardez les prénoms/noms Forever et les royaumes Blizzard de l'addon",
      "`/character add` — liez un personnage manuellement, ou `/character import` — collez la ligne de `/guilded character`, ou le code de `/guilded share`",
      "Les annonces de raid ont des boutons pour s'inscrire",
      "`/epgp balance` · `/epgp leaderboard` · `/character profile` · `/character achievements` · `/character who <nom>`",
      "`/raid progress` · `/raid report` · `/report stats` · `/loot history`",
      "`/loot bid` — miser des GP sur une enchère Discord",
      "`/character wishlist add` · `/character profession set` · `/character profession who <métier>`",
      "`/bank search` · `/bank request` — chercher et demander à la banque de guilde · `/craft request` — demander à un artisan",
      "`/dungeon leaderboard` · `/dungeon records` · `/dungeon player` — défi des donjons · `/dungeon group` — former un groupe avec son salon vocal · `/dungeon alerts` — être mentionné pour les groupes qui vous conviennent",
      "`/bg history` · `/bg duels` — champs de bataille (compagnon lié; rien n'est attribué), duels et classement",
      "Jalons de guilde en clavardage activés; coupez-les avec `/guilded announce off`",
      "En jeu : appel à l'aide (Maj + clic droit sur la minicarte), invitation de couche, inscription aux raids",
      "`/character readiness me` — votre dernière vérification d'équipement (addon)",
      "`/team list` · `/team sessions` · `/team respond` — cores donjon et JcJ; confirmez chaque séance",
      "`/apply` — postuler à un core de raid (ou appuyez sur **Postuler** sur le message du core dans le salon des cores de raid)",
      "`/report bug` — signaler un bug ou un problème avec le bot",
      "`/community seasons` · `/community leaderboard` · `/community wallet` · `/community dice` — saisons, classements et dé quotidien",
      "`/community honors` — palmarès : MVP de la semaine, recrues et podiums du mois",
      "Les annonces de loterie, soirée gaming, quiz et défi ont des boutons pour participer",
      "`/participation status` · `/participation nominate` · `/participation history` — points Discord plafonnés, entraide et objectifs de guilde",
      "`/poe status` · `/poe pair` · `/poe runs` · `/poe summary` — journal de mapping PoE2 du compagnon"
    ]
  },
  raidLeader: {
    en: [
      "Raid Leader tools are under `/lead`. Discord shows it to people with Manage Events: give the Raid Leader role that permission, or allow the role on `/lead` in Server Settings → Integrations → Guilded",
      "`/lead create` (times like `friday 8pm`) · `/lead edit` · `/lead start` · `/lead end` (shows the EP to approve)",
      "`/lead attendance` · `/lead boss` · `/lead note` · `/lead award-ep`",
      "`/lead season` · `/lead history` — officers: attendance over a season, per raid and per player",
      "`/core setup` raid nights: `Tuesday 8pm; Thursday 8pm` — creates only the next 6 days automatically; change or pause in `/core edit` → 📅",
      "`/core setup` — guided raid core (name, players, rules) · `/core add` · `/core remove` · `/core character` (the character or backup characters a player brings; one player can be in several cores) · members join with the roster's Apply button · `/lead create core:` (priority signups)",
      "`/lead readiness-raid` — who's ready for tonight",
      "`/team create` · `/team member` · `/team schedule` · `/team lineup` · `/team attendance` — manage weekly dungeon/PvP teams"
    ],
    fr: [
      "Les outils des chefs de raid sont sous `/lead`. Discord le montre à qui a « Gérer les événements » : donnez cette permission au rôle Chef de raid, ou autorisez le rôle sur `/lead` dans Paramètres du serveur → Intégrations → Guilded",
      "`/lead create` (heures comme `vendredi 20h`) · `/lead edit` · `/lead start` · `/lead end` (propose les EP à approuver)",
      "`/lead attendance` · `/lead boss` · `/lead note` · `/lead award-ep`",
      "`/lead season` · `/lead history` — officiers : présences sur une saison, par raid et par joueur",
      "`/core setup`, horaire : `mardi 20h; jeudi 20h` — raids automatiques pour les 6 prochains jours; ajuste ou arrête dans `/core edit` → 📅",
      "`/core setup` — noyau de raid guidé (nom, joueurs, règles) · `/core add` · `/core remove` · `/core character` (le personnage ou les personnages de secours d'un joueur ; plusieurs noyaux possibles) · les membres postulent avec le bouton du roster · `/lead create core:` (inscription prioritaire)",
      "`/lead readiness-raid` — qui est prêt pour ce soir",
      "`/team create` · `/team member` · `/team schedule` · `/team lineup` · `/team attendance` — gérer les cores de donjon/JcJ"
    ]
  },
  dkpOfficer: {
    en: ["`/officer epgp award-ep` · `/officer epgp award-gp` · `/officer epgp reverse` · `/officer epgp decay`", "`/epgp history player:` — anyone's history"],
    fr: ["`/officer epgp award-ep` · `/officer epgp award-gp` · `/officer epgp reverse` · `/officer epgp decay`", "`/epgp history player:` — l'historique de n'importe qui"]
  },
  officer: {
    en: [
      "`/setup start` — guided setup and checklist · `/config` — every setting",
      "Members don't see `/officer`, `/organize`, `/setup`, `/config`, `/mod`, `/import` or `/poll`. An Officer without Manage Server doesn't either: allow the Officer role on them in Server Settings → Integrations → Guilded",
      "`/officer loot auction` · `/officer loot close` · `/import apply` · `/import held` (addon data)",
      "`/setup testraid start` — fake raid to try everything, `/setup testraid cleanup` after · `/setup system status` — sync and delivery status",
      "`/officer dungeon` — invalidate a run, adjust points, view locked rules",
      "An officer's guild-wide off switch for chat milestones wins over members' settings",
      "`/bank list` / `handle` · `/mod application list` · `/mod` · `/mod faq` — answers · `/tag set` · `/setup selfroles`",
      "`/lead wcl-report url:` — pull a Warcraft Logs report into the raid history",
      "`/report inactive` · `/report guild` · `/poll create` · `/officer loot award` (loot council)",
      "`/officer export table:` — CSV for Excel or Google Sheets: standings, EPGP ledger, loot, attendance or roster (only you see it)",
      "`/organize start-season` · `/organize lottery create` · `/organize gaming create` · `/organize challenge create` · `/organize quiz` — organize activities",
      "`/events board` · `/events reminders` · `/events status` — Upcoming Events; Manage Server required, reminders opt-in only",
      "`/organize honors-preview` · `/organize honors-settings` — preview the weekly MVP post; weekly on/off, week start, MVP ping",
      "`/participation settings` · `/participation channels` · `/participation claims` · `/participation review` · `/participation reverse` — earning coverage, controls and helper approvals"
    ],
    fr: [
      "`/setup start` — configuration guidée et liste de vérification · `/config` — tous les réglages",
      "Les membres ne voient pas `/officer`, `/organize`, `/setup`, `/config`, `/mod`, `/import` ni `/poll`. Officier sans « Gérer le serveur » non plus : autorisez le rôle dans Paramètres → Intégrations → Guilded",
      "`/officer loot auction` · `/officer loot close` · `/import apply` · `/import held` (données de l'addon)",
      "`/setup testraid start` — faux raid pour tout essayer, puis `/setup testraid cleanup` · `/setup system status` — état de la synchro",
      "`/officer dungeon` — annuler un donjon, ajuster les points, consulter les règles fixes",
      "Le réglage d'un officier pour couper les jalons l'emporte",
      "`/bank list` / `handle` · `/mod application list` · `/mod` · `/mod faq` — réponses · `/tag set` · `/setup selfroles`",
      "`/lead wcl-report url:` — importer un rapport Warcraft Logs dans l'historique des raids",
      "`/report inactive` · `/report guild` · `/poll create` · `/officer loot award` (conseil de loot)",
      "`/officer export table:` — CSV pour Excel ou Sheets : classement, registre EPGP, butin, présences ou effectif (vous seul)",
      "`/organize start-season` · `/organize lottery create` · `/organize gaming create` · `/organize challenge create` · `/organize quiz` — organiser les activités",
      "`/events board` · `/events reminders` · `/events status` — événements à venir; Gérer le serveur requis",
      "`/organize honors-preview` · `/organize honors-settings` — aperçu du MVP de la semaine et réglages",
      "`/participation settings` · `/participation channels` · `/participation claims` · `/participation review` · `/participation reverse` — couverture des gains, réglages, entraide"
    ]
  }
};

// A field's value has a hard 1024-char Discord limit; French translations run
// longer than English and have crashed this command in the past by going
// just over it. Split into as many fields as needed instead of assuming any
// given language list fits in one.
function addSection(embed: EmbedBuilder, name: string, lines: string[]): void {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > 1024 && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  chunks.forEach((value, index) => {
    embed.addFields({ name: index === 0 ? name : `${name} (${index + 1})`, value });
  });
}

export async function executeHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  let lang: Lang = "en";
  if (interaction.guildId && interaction.guild) {
    const guild = await guildService.ensureGuild(interaction.guildId, interaction.guild.name);
    lang = asLang((await guildService.getSettings(guild.id))?.language);
  }
  const member = interaction.member as GuildMember | null;
  const can = (permission: Parameters<typeof hasPermission>[1]) => !!member && hasPermission(member, permission);
  const embed = new EmbedBuilder().setTitle(t(lang, "help.title")).setColor(0xd4af37);
  addSection(embed, t(lang, "help.everyone"), visibleLines(LINES.everyone[lang]));
  if (can("raidLeader")) addSection(embed, t(lang, "help.raidLeaders"), visibleLines(LINES.raidLeader[lang]));
  if (can("dkpOfficer")) addSection(embed, t(lang, "help.epgpOfficers"), visibleLines(LINES.dkpOfficer[lang]));
  if (can("officer")) addSection(embed, t(lang, "help.officers"), visibleLines(LINES.officer[lang]));
  embed.setDescription(t(lang, "help.support"));
  embed.setFooter({ text: `Guilded ${CURRENT_VERSION} · ${t(lang, "help.footer")}` });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
