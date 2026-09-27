import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { asLang, t, type Lang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { guildService } from "./context.js";

// Short, rank-aware command list in the guild's language: everyone sees the
// member section; officers and leaders also see what they're allowed to run.
export const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("What can I do here? Lists the commands you can use.");

const LINES: Record<"everyone" | "raidLeader" | "dkpOfficer" | "officer", Record<Lang, string[]>> = {
  everyone: {
    en: [
      "`/character add` — link your WoW character (do this first), or `/character import` with the line `/guilded character` shows in game, or `/character sync` with `/guilded share`",
      "Raid posts have buttons to sign up (or use `/raid signup`)",
      "`/epgp balance` · `/epgp leaderboard` · `/profile` · `/character who <name>`",
      "`/raid progress` · `/raid report` · `/report stats` · `/loot history`",
      "`/loot bid` — bid GP on a Discord loot auction",
      "`/character wishlist add` · `/character profession set` · `/character profession who <prof>`",
      "`/bank request` — ask the guild bank · `/craft request` — ask a crafter",
      "`/dungeon leaderboard` · `/dungeon records` · `/dungeon player` — dungeon challenge · `/dungeon group` — form a group with its own voice channel",
      "`/character readiness me` — your latest gear check from the addon",
      "`/apply` — apply to a raid core (or press **Apply to a core** on the pinned post in the apply channel)",
      "`/report bug` — report a bug or problem with the bot"
    ],
    fr: [
      "`/character add` — liez votre personnage WoW (à faire en premier), ou `/character import` avec la ligne de `/guilded character` en jeu, ou `/character sync` avec `/guilded share`",
      "Les annonces de raid ont des boutons pour s'inscrire (ou `/raid signup`)",
      "`/epgp balance` · `/epgp leaderboard` · `/profile` · `/character who <nom>`",
      "`/raid progress` · `/raid report` · `/report stats` · `/loot history`",
      "`/loot bid` — miser des GP sur une enchère Discord",
      "`/character wishlist add` · `/character profession set` · `/character profession who <métier>`",
      "`/bank request` — demander à la banque de guilde · `/craft request` — demander à un artisan",
      "`/dungeon leaderboard` · `/dungeon records` · `/dungeon player` — défi des donjons · `/dungeon group` — former un groupe avec son salon vocal",
      "`/character readiness me` — votre dernière vérification d'équipement (addon)",
      "`/apply` — postuler à un core de raid (ou appuyez sur **Postuler à un core** sur le message épinglé du salon de candidature)",
      "`/report bug` — signaler un bug ou un problème avec le bot"
    ]
  },
  raidLeader: {
    en: [
      "`/raid create` (times like `friday 8pm`) · `/raid edit` · `/raid start` · `/raid end` (shows the EP to approve)",
      "`/raid attendance` · `/raid boss` · `/raid note` · `/raid award-ep`",
      "`/core setup` — guided raid core (name, players, rules) · `/core add` · `/core remove` · `/raid create core:` (priority signups)",
      "`/character readiness raid` — who's ready for tonight"
    ],
    fr: [
      "`/raid create` (heures comme `vendredi 20h`) · `/raid edit` · `/raid start` · `/raid end` (propose les EP à approuver)",
      "`/raid attendance` · `/raid boss` · `/raid note` · `/raid award-ep`",
      "`/core setup` — noyau de raid guidé (nom, joueurs, règles) · `/core add` · `/core remove` · `/raid create core:` (inscription prioritaire)",
      "`/character readiness raid` — qui est prêt pour ce soir"
    ]
  },
  dkpOfficer: {
    en: ["`/epgp award-ep` · `/epgp award-gp` · `/epgp reverse` · `/epgp decay`", "`/epgp history player:` — anyone's history"],
    fr: ["`/epgp award-ep` · `/epgp award-gp` · `/epgp reverse` · `/epgp decay`", "`/epgp history player:` — l'historique de n'importe qui"]
  },
  officer: {
    en: [
      "`/setup start` — guided setup and checklist · `/setup config` — every setting",
      "`/loot auction` · `/loot close` · `/import apply` (addon data)",
      "`/setup testraid start` — fake raid to try everything, `/setup testraid cleanup` after",
      "`/dungeon admin` — invalidate a run, award points, rules, target times, new season",
      "`/bank list` / `handle` · `/mod application list` · `/mod` · `/tag set` · `/setup selfroles`",
      "`/raid wcl report url:` — pull a Warcraft Logs report into the raid history",
      "`/report inactive` · `/report export` · `/report guild` · `/poll create` · `/loot award` (loot council)"
    ],
    fr: [
      "`/setup start` — configuration guidée et liste de vérification · `/setup config` — tous les réglages",
      "`/loot auction` · `/loot close` · `/import apply` (données de l'addon)",
      "`/setup testraid start` — faux raid pour tout essayer, puis `/setup testraid cleanup`",
      "`/dungeon admin` — annuler un donjon, donner des points, règles, temps cibles, nouvelle saison",
      "`/bank list` / `handle` · `/mod application list` · `/mod` · `/tag set` · `/setup selfroles`",
      "`/raid wcl report url:` — importer un rapport Warcraft Logs dans l'historique des raids",
      "`/report inactive` · `/report export` · `/report guild` · `/poll create` · `/loot award` (conseil de loot)"
    ]
  }
};

export async function executeHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  let lang: Lang = "en";
  if (interaction.guildId && interaction.guild) {
    const guild = await guildService.ensureGuild(interaction.guildId, interaction.guild.name);
    lang = asLang((await guildService.getSettings(guild.id))?.language);
  }
  const member = interaction.member as GuildMember | null;
  const can = (permission: Parameters<typeof hasPermission>[1]) => !!member && hasPermission(member, permission);
  const embed = new EmbedBuilder().setTitle(t(lang, "help.title")).setColor(0xd4af37)
    .addFields({ name: t(lang, "help.everyone"), value: LINES.everyone[lang].join("\n") });
  if (can("raidLeader")) embed.addFields({ name: t(lang, "help.raidLeaders"), value: LINES.raidLeader[lang].join("\n") });
  if (can("dkpOfficer")) embed.addFields({ name: t(lang, "help.epgpOfficers"), value: LINES.dkpOfficer[lang].join("\n") });
  if (can("officer")) embed.addFields({ name: t(lang, "help.officers"), value: LINES.officer[lang].join("\n") });
  embed.setFooter({ text: t(lang, "help.footer") });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
