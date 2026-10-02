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
      "`/character pair` — link your companion once so future uploads link your character automatically (do this first)",
      "`/character add` — link a character by hand, or `/character import` — paste the line `/guilded character` shows, or the code from `/guilded share`",
      "Raid posts have buttons to sign up (or use `/raid signup`)",
      "`/epgp balance` · `/epgp leaderboard` · `/profile` · `/character who <name>`",
      "`/raid progress` · `/raid report` · `/report stats` · `/loot history`",
      "`/loot bid` — bid GP on a Discord loot auction",
      "`/character wishlist add` · `/character profession set` · `/character profession who <prof>`",
      "`/bank request` — ask the guild bank · `/craft request` — ask a crafter",
      "`/dungeon leaderboard` · `/dungeon records` · `/dungeon player` — dungeon challenge · `/dungeon group` — form a group with its own voice channel · `/dungeon alerts` — get pinged for groups you fit",
      "`/character readiness me` — your latest gear check from the addon",
      "`/apply` — apply to a raid core (or press **Apply** on that core's own roster post in the raid roster channel)",
      "`/report bug` — report a bug or problem with the bot",
      "`/community seasons` · `/community leaderboard` · `/community wallet` · `/community dice` — game seasons, scores and daily dice",
      "Lottery, gaming night, quiz and challenge posts have participation buttons",
      "`/participation status` · `/participation nominate` · `/participation history` — capped Discord points, helper recognition and guild goals",
      "`/poe status` · `/poe pair` · `/poe runs` · `/poe summary` — PoE2 companion mapping journal"
    ],
    fr: [
      "`/character pair` — liez votre companion une fois pour que les prochains envois lient votre personnage automatiquement (à faire en premier)",
      "`/character add` — liez un personnage manuellement, ou `/character import` — collez la ligne de `/guilded character`, ou le code de `/guilded share`",
      "Les annonces de raid ont des boutons pour s'inscrire (ou `/raid signup`)",
      "`/epgp balance` · `/epgp leaderboard` · `/profile` · `/character who <nom>`",
      "`/raid progress` · `/raid report` · `/report stats` · `/loot history`",
      "`/loot bid` — miser des GP sur une enchère Discord",
      "`/character wishlist add` · `/character profession set` · `/character profession who <métier>`",
      "`/bank request` — demander à la banque de guilde · `/craft request` — demander à un artisan",
      "`/dungeon leaderboard` · `/dungeon records` · `/dungeon player` — défi des donjons · `/dungeon group` — former un groupe avec son salon vocal · `/dungeon alerts` — être mentionné pour les groupes qui vous conviennent",
      "`/character readiness me` — votre dernière vérification d'équipement (addon)",
      "`/apply` — postuler à un core de raid (ou appuyez sur **Postuler** sur le message du core dans le salon des cores de raid)",
      "`/report bug` — signaler un bug ou un problème avec le bot",
      "`/community seasons` · `/community leaderboard` · `/community wallet` · `/community dice` — saisons, classements et dé quotidien",
      "Les annonces de loterie, soirée gaming, quiz et défi ont des boutons pour participer",
      "`/participation status` · `/participation nominate` · `/participation history` — points Discord plafonnés, entraide et objectifs de guilde",
      "`/poe status` · `/poe pair` · `/poe runs` · `/poe summary` — journal de mapping PoE2 du compagnon"
    ]
  },
  raidLeader: {
    en: [
      "`/raid create` (times like `friday 8pm`) · `/raid edit` · `/raid start` · `/raid end` (shows the EP to approve)",
      "`/raid attendance` · `/raid boss` · `/raid note` · `/raid award-ep`",
      "`/core setup` raid nights: `Tuesday 8pm; Thursday 8pm` — creates only the next 7 days automatically; change or pause in `/core edit` → 📅",
      "`/core setup` — guided raid core (name, players, rules) · `/core add` · `/core remove` · `/core character` (the character or backup characters a player brings; one player can be in several cores) · members join with the roster's Apply button · `/raid create core:` (priority signups)",
      "`/character readiness raid` — who's ready for tonight"
    ],
    fr: [
      "`/raid create` (heures comme `vendredi 20h`) · `/raid edit` · `/raid start` · `/raid end` (propose les EP à approuver)",
      "`/raid attendance` · `/raid boss` · `/raid note` · `/raid award-ep`",
      "`/core setup`, horaire : `mardi 20h; jeudi 20h` — raids automatiques pour les 7 prochains jours; ajuste ou arrête dans `/core edit` → 📅",
      "`/core setup` — noyau de raid guidé (nom, joueurs, règles) · `/core add` · `/core remove` · `/core character` (le personnage ou les personnages de secours d'un joueur ; plusieurs noyaux possibles) · les membres postulent avec le bouton du roster · `/raid create core:` (inscription prioritaire)",
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
      "`/bank list` / `handle` · `/mod application list` · `/mod` · `/mod faq` — answer channel · `/tag set` · `/setup selfroles`",
      "`/raid wcl report url:` — pull a Warcraft Logs report into the raid history",
      "`/report inactive` · `/report export` · `/report guild` · `/poll create` · `/loot award` (loot council)",
      "`/community start-season` · `/community lottery create` · `/community gaming create` · `/community challenge create` · `/community quiz` — organize activities",
      "`/participation settings` · `/participation claims` · `/participation review` · `/participation reverse` — participation controls and helper approvals"
    ],
    fr: [
      "`/setup start` — configuration guidée et liste de vérification · `/setup config` — tous les réglages",
      "`/loot auction` · `/loot close` · `/import apply` (données de l'addon)",
      "`/setup testraid start` — faux raid pour tout essayer, puis `/setup testraid cleanup`",
      "`/dungeon admin` — annuler un donjon, donner des points, règles, temps cibles, nouvelle saison",
      "`/bank list` / `handle` · `/mod application list` · `/mod` · `/mod faq` — salon des réponses · `/tag set` · `/setup selfroles`",
      "`/raid wcl report url:` — importer un rapport Warcraft Logs dans l'historique des raids",
      "`/report inactive` · `/report export` · `/report guild` · `/poll create` · `/loot award` (conseil de loot)",
      "`/community start-season` · `/community lottery create` · `/community gaming create` · `/community challenge create` · `/community quiz` — organiser les activités",
      "`/participation settings` · `/participation claims` · `/participation review` · `/participation reverse` — réglages de participation et validation d'entraide"
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
  addSection(embed, t(lang, "help.everyone"), LINES.everyone[lang]);
  if (can("raidLeader")) addSection(embed, t(lang, "help.raidLeaders"), LINES.raidLeader[lang]);
  if (can("dkpOfficer")) addSection(embed, t(lang, "help.epgpOfficers"), LINES.dkpOfficer[lang]);
  if (can("officer")) addSection(embed, t(lang, "help.officers"), LINES.officer[lang]);
  embed.setFooter({ text: t(lang, "help.footer") });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
