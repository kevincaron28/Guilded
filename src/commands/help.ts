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

// Forever-only focus (companion/active-games.mjs): lines and mentions of a switched-off game are not listed.
export const visibleLines = (lines: string[], poe = POE_TRACKING_ENABLED): string[] => poe ? lines : lines.filter(line => !line.includes("`/poe ")).map(line => line.replace(" · `/poe`", ""));

// Commands restructure (November 2026): members are taught seven commands and three links; the
// rest is there for those who use it. Officers and leaders also see where their tools are.
const LINES: Record<"everyone" | "raidLeader" | "dkpOfficer" | "officer", Record<Lang, string[]>> = {
  everyone: {
    en: [
      "**New here?** [guildedwow.com/start](https://guildedwow.com/start/) — install the addon, then [the Windows companion](https://guildedwow.com/companion/) (\"Guild Sync Companion\" in the Microsoft Store; it syncs by itself). Every command: [guildedwow.com/reference](https://guildedwow.com/reference/)",
      "`/character link` — link your WoW characters: DM me your character's full name, or type it in the guild-invite channel · `/character profile` · `/character privacy`",
      "`/promotion status` — what's left before your next rank",
      "`/craft request` — ask a guild crafter · `/craft who` — who can make it",
      "`/leaderboard` — dungeon rating; `board:` guild records, PvP, community points or EPGP",
      "`/raid progress` · `/raid report` — sign up with the buttons on raid posts",
      "`/report bug` — tell the developer about a problem · `/help` — this list",
      "Also there when you need them: `/dungeon` · `/bank` · `/community` · `/epgp` · `/loot` · `/apply` · `/team` · `/bg` · `/participation` · `/tag` · `/poe`"
    ],
    fr: [
      "**Nouveau ?** [guildedwow.com/start](https://guildedwow.com/start/?lang=fr) — installez l'addon, puis [le compagnon Windows](https://guildedwow.com/companion/?lang=fr) (« Guild Sync Companion » dans le Microsoft Store; il synchronise tout seul). Toutes les commandes : [guildedwow.com/reference](https://guildedwow.com/reference/?lang=fr)",
      "`/character link` — liez vos personnages WoW : envoyez-moi en MP le nom complet du personnage, ou écrivez-le dans le salon d'invitation · `/character profile` · `/character privacy`",
      "`/promotion status` — ce qu'il vous reste avant le prochain rang",
      "`/craft request` — demander à un artisan · `/craft who` — qui peut le fabriquer",
      "`/leaderboard` — cote des donjons; `board:` records de la guilde, JcJ, points de communauté ou EPGP",
      "`/raid progress` · `/raid report` — inscrivez-vous avec les boutons des annonces de raid",
      "`/report bug` — signaler un problème au développeur · `/help` — cette liste",
      "Aussi là au besoin : `/dungeon` · `/bank` · `/community` · `/epgp` · `/loot` · `/apply` · `/team` · `/bg` · `/participation` · `/tag` · `/poe`"
    ]
  },
  raidLeader: {
    en: [
      "Raid Leader tools are under `/lead`. Discord shows it to people with Manage Events: give the Raid Leader role that permission, or allow the role on `/lead` in Server Settings → Integrations → Guilded",
      "`/lead create` (times like `friday 8pm`) · `/lead edit` · `/lead start` · `/lead end` (shows the EP to approve)",
      "`/lead attendance` · `/lead boss` · `/lead note` · `/lead award-ep` · `/lead readiness-raid` — who's ready for tonight",
      "`/lead season` · `/lead history` — attendance over a season · `/lead wcl-report url:` — a Warcraft Logs report",
      "`/core setup` — guided raid core and raid nights (`Tuesday 8pm; Thursday 8pm`); change or pause in `/core edit` → 📅 · members join with the roster's Apply button",
      "`/team create` · `/team schedule` · `/team lineup` — weekly dungeon/PvP teams"
    ],
    fr: [
      "Les outils des chefs de raid sont sous `/lead`. Discord le montre à qui a « Gérer les événements » : donnez cette permission au rôle Chef de raid, ou autorisez le rôle sur `/lead` dans Paramètres du serveur → Intégrations → Guilded",
      "`/lead create` (heures comme `vendredi 20h`) · `/lead edit` · `/lead start` · `/lead end` (propose les EP à approuver)",
      "`/lead attendance` · `/lead boss` · `/lead note` · `/lead award-ep` · `/lead readiness-raid` — qui est prêt pour ce soir",
      "`/lead season` · `/lead history` — présences sur une saison · `/lead wcl-report url:` — un rapport Warcraft Logs",
      "`/core setup` — noyau de raid guidé et soirées (`mardi 20h; jeudi 20h`); ajustez ou arrêtez dans `/core edit` → 📅 · les membres postulent avec le bouton du roster",
      "`/team create` · `/team schedule` · `/team lineup` — cores de donjon/JcJ"
    ]
  },
  dkpOfficer: {
    en: ["`/lead epgp award-ep` · `/lead epgp award-gp` · `/lead epgp reverse` · `/lead epgp decay` · `/lead loot auction` · `/lead loot award` (loot council)", "`/epgp history player:` — anyone's history"],
    fr: ["`/lead epgp award-ep` · `/lead epgp award-gp` · `/lead epgp reverse` · `/lead epgp decay` · `/lead loot auction` · `/lead loot award` (conseil de butin)", "`/epgp history player:` — l'historique de n'importe qui"]
  },
  officer: {
    en: [
      "`/setup start` — guided setup and checklist · `/config` — every setting (`/config craft`: the craft board) · `/setup guild` — in-game guilds",
      "Members don't see `/officer`, `/lead`, `/organize`, `/mod`, `/setup` or `/config`. An Officer without Manage Server doesn't either: allow the Officer role on them in Server Settings → Integrations → Guilded",
      "`/officer character link` — link a reported character to its owner · `/officer character unclaimed` · `/officer roster gaps`",
      "`/officer reports inactive` · `/officer reports guild` · `/officer bank handle` · `/officer dungeon` · `/officer export table:` (CSV)",
      "`/setup import upload` · `/setup import held` (addon data) · `/setup testraid start` · `/setup system status`",
      "`/mod application list` · `/mod faq` — answers · `/mod dni` · `/setup tags set` · `/setup participation claims` · `/setup selfroles`",
      "`/organize poll create` · `/organize start-season` · `/organize lottery create` · `/organize gaming create` · `/organize quiz` · `/organize honors-settings`",
      "An officer's guild-wide off switch for chat milestones wins over members' settings"
    ],
    fr: [
      "`/setup start` — configuration guidée · `/config` — tous les réglages (`/config craft` : l'artisanat) · `/setup guild` — guildes en jeu",
      "Les membres ne voient pas `/officer`, `/lead`, `/organize`, `/mod`, `/setup` ni `/config`. Officier sans « Gérer le serveur » non plus : autorisez le rôle dans Paramètres → Intégrations → Guilded",
      "`/officer character link` — lier un personnage signalé à son propriétaire · `/officer character unclaimed` · `/officer roster gaps`",
      "`/officer reports inactive` · `/officer reports guild` · `/officer bank handle` · `/officer dungeon` · `/officer export table:` (CSV)",
      "`/setup import upload` · `/setup import held` (données de l'addon) · `/setup testraid start` · `/setup system status`",
      "`/mod application list` · `/mod faq` — réponses · `/mod dni` · `/setup tags set` · `/setup participation claims` · `/setup selfroles`",
      "`/organize poll create` · `/organize start-season` · `/organize lottery create` · `/organize gaming create` · `/organize quiz` · `/organize honors-settings`",
      "Le réglage d'un officier pour couper les jalons l'emporte"
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
