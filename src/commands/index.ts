import { gameEventsCommand } from "./game-events.js";
import { wowCommand } from "./wow.js";
import { healthCommand, executeHealth } from "./health.js";
import { profileCommand, executeProfile } from "./profile.js";
import { characterCommand, executeCharacter } from "./character.js";
import { professionCommand, executeProfession } from "./profession.js";
import { configCommand } from "./settings.js";
import { raidCommand, executeRaid } from "./raid.js";
import { worldBuffCommand, executeWorldBuff } from "./world-buffs.js";
import { importCommand, executeImport } from "./import.js";
import { lootCommand, executeLoot } from "./loot.js";
import { applicationCommand, applyCommand, executeApplication } from "./application.js";
import { importApplyCommand, executeImportApply } from "./import-apply.js";
import { importHeldCommand, executeImportHeld } from "./import-held.js";
import { epgpCommand, executeEpgp } from "./epgp.js";
import { readinessCommand, executeReadiness } from "./readiness.js";
import { attunementCommand, executeAttunement } from "./attunement.js";
import { moderationCommand, executeModeration } from "./moderation.js";
import { tagCommand } from "./tag.js";
import { wishlistCommand, executeWishlist } from "./wishlist.js";
import { selfRolesCommand, executeSelfRoles } from "./selfroles.js";
import { whoCommand, executeWho } from "./who.js";
import { wclCommand, executeWcl } from "./wcl.js";
import { coreCommand } from "./core.js";
import { teamCommand } from "./team.js";
import { inactiveCommand, executeInactive } from "./inactive.js";
import { exportCommand, executeExport } from "./export.js";
import { guildHealthCommand, executeGuildHealth } from "./guild-health.js";
import { pollCommand } from "./poll.js";
import { statsCommand, executeStats } from "./stats.js";
import { bankCommand } from "./bank.js";
import { testRaidCommand, executeTestRaid } from "./testraid.js";
import { craftCommand } from "./craft.js";
import { setupCommand, executeSetup } from "./setup.js";
import { uninstallCommand, resetCommand, executeSetupReset, executeUninstall } from "./uninstall.js";
import { executeGuildPage, guildPageCommand } from "./guild-page.js";
import { helpCommand } from "./help.js";
import { dungeonCommand, executeDungeon } from "./dungeon.js";
import { dungeonAdminCommand, executeDungeonAdmin } from "./dungeon-admin.js";
import { dungeonScheduleCommand, executeDungeonSchedule } from "./dungeon-schedule.js";
import { bugCommand, executeBug } from "./bugreport.js";
import { faqCommand, executeFaq } from "./faq.js";
import { systemCommand, executeSystem } from "./system.js";
import { communityCommand, lotteryCommand, gamingCommand, challengeCommand, executeCommunity } from "./community.js";

import { PermissionFlagsBits } from "discord.js";
import { MergedCommand, type AnyCommand } from "./router.js";
import { BRAND } from "../brand.js";
import { poeCommand } from "./poe.js";
import { participationCommand } from "./participation.js";
import { executeRecruit, recruitCommand } from "./recruit.js";
import { executePublicLeaderboard, publicLeaderboardCommand } from "./public-leaderboard.js";
import { executePug, pugCommand } from "./pug.js";

// One parent per area, with the smaller commands mounted under it (see router.ts).
// /config stays its own command: under /setup it came close to Discord's 4000-character limit
// (moved out on 8 October 2026). /system and /uninstall moved here in 7.3.0.
const setup = new MergedCommand("setup", `${BRAND.name} setup, sync status, reset and uninstall.`, [
  { command: setupCommand, handler: executeSetup, as: "start" },
  { command: testRaidCommand, handler: executeTestRaid, as: "testraid" },
  { command: selfRolesCommand, handler: executeSelfRoles, as: "selfroles" },
  { command: systemCommand, handler: executeSystem, as: "system" },
  { command: resetCommand, handler: executeSetupReset, as: "reset" },
  { command: uninstallCommand, handler: executeUninstall, as: "uninstall" }
]);

// Leader and officer subcommands live under /lead, /officer and /organize (below), which
// Discord hides from members; the member parents keep only what members can run.
const RAID_LEAD = ["create", "edit", "cancel", "start", "end", "attendance", "attendance-voice", "boss", "note", "award-ep", "fill", "season", "history"];
const EPGP_OFFICER = ["award-ep", "award-gp", "decay", "reverse"];
const LOOT_OFFICER = ["auction", "award", "close", "priority"];
const CHARACTER_OFFICER = ["unclaimed", "link", "autolink"];
const COMMUNITY_ORGANIZER = ["start-season", "season-settings", "end-season", "quiz", "close-quiz", "honors-preview", "honors-settings"];
const LOTTERY_ORGANIZER = ["create", "confirm", "payments", "close", "cancel"];
const GAMING_ORGANIZER = ["create", "edit", "attendance", "close", "cancel"];
const CHALLENGE_ORGANIZER = ["create", "review", "claims", "close", "cancel"];
const same = (names: string[]) => Object.fromEntries(names.map((name) => [name, name]));

const character = new MergedCommand("character", "Your profile, characters, professions, attunements, wishlist and readiness.", [
  { command: profileCommand, handler: executeProfile, as: "profile" },
  { command: whoCommand, handler: executeWho, as: "who" },
  { command: professionCommand, handler: executeProfession, as: "profession" },
  { command: attunementCommand, handler: executeAttunement, as: "attunement" },
  { command: wishlistCommand, handler: executeWishlist, as: "wishlist" },
  { command: readinessCommand, handler: executeReadiness, as: "readiness", only: ["me"] }
], { command: characterCommand, handler: executeCharacter, except: CHARACTER_OFFICER });

const raid = new MergedCommand("raid", "Raids: signups, progress, reports and Warcraft Logs.", [
  { command: pugCommand, handler: executePug, as: "pug" },
  { command: wclCommand, handler: executeWcl, as: "wcl", except: ["report"] },
  { command: worldBuffCommand, handler: executeWorldBuff, flat: { add: "worldbuff", list: "worldbuffs", remove: "worldbuff-remove" } }
], { command: raidCommand, handler: executeRaid, except: RAID_LEAD });

const epgp = new MergedCommand("epgp", "Your EPGP: balance, history and the leaderboard.", [],
  { command: epgpCommand, handler: executeEpgp, except: EPGP_OFFICER });

const loot = new MergedCommand("loot", "Bid on loot, see loot history and soft reserves.", [],
  { command: lootCommand, handler: executeLoot, except: LOOT_OFFICER });

const dungeon = new MergedCommand("dungeon", "Dungeon challenge: leaderboard, records, groups and alerts.", [],
  { command: dungeonCommand, handler: executeDungeon });

const lead = new MergedCommand("lead", "Raid Leaders: run raids, seasons, logs and readiness.", [
  { command: raidCommand, handler: executeRaid, flat: same(RAID_LEAD) },
  { command: wclCommand, handler: executeWcl, flat: { report: "wcl-report" } },
  { command: readinessCommand, handler: executeReadiness, flat: { member: "readiness-member", raid: "readiness-raid" } }
]).setDescriptionLocalizations({ fr: "Chefs de raid : raids, saisons, journaux et préparation." });

const officer = new MergedCommand("officer", "Officers: EPGP, loot, dungeon challenge, character links and CSV exports.", [
  { command: epgpCommand, handler: executeEpgp, as: "epgp", only: EPGP_OFFICER },
  { command: lootCommand, handler: executeLoot, as: "loot", only: LOOT_OFFICER },
  { command: dungeonAdminCommand, handler: executeDungeonAdmin, as: "dungeon" },
  { command: characterCommand, handler: executeCharacter, as: "character", only: CHARACTER_OFFICER },
  { command: exportCommand, handler: executeExport, as: "export" }
]).setDescriptionLocalizations({ fr: "Officiers : EPGP, butin, défi des donjons, liens de personnages et exports." });

const mod = new MergedCommand("mod", "Officers: moderation, applications, answer channel, web page, recruitment and leaderboards.", [
  { command: applicationCommand, handler: executeApplication, as: "application" },
  { command: faqCommand, handler: executeFaq, as: "faq" },
  { command: guildPageCommand, handler: executeGuildPage, as: "page" },
  { command: recruitCommand, handler: executeRecruit, as: "recruit" },
  { command: publicLeaderboardCommand, handler: executePublicLeaderboard, as: "leaderboard" }
], { command: moderationCommand, handler: executeModeration });

const importer = new MergedCommand("import", "Bring addon data into Discord: preview a file, then apply it (officers).", [
  { command: importCommand, handler: executeImport, as: "upload" },
  { command: importApplyCommand, handler: executeImportApply, as: "apply" },
  { command: importHeldCommand, handler: executeImportHeld, as: "held" }
]);

const report = new MergedCommand("report", "Guild reports: activity, inactive members, health, bot status and bug reports.", [
  { command: statsCommand, handler: executeStats, as: "stats" },
  { command: inactiveCommand, handler: executeInactive, as: "inactive" },
  { command: guildHealthCommand, handler: executeGuildHealth, as: "guild" },
  { command: healthCommand, handler: executeHealth, as: "ping" },
  { command: bugCommand, handler: executeBug, as: "bug" }
]);

const community = new MergedCommand("community", "Gaming nights, lotteries, challenges, seasons and Discord games.", [
  { command: lotteryCommand, handler: executeCommunity, as: "lottery", except: LOTTERY_ORGANIZER },
  { command: gamingCommand, handler: executeCommunity, as: "gaming", except: GAMING_ORGANIZER },
  { command: challengeCommand, handler: executeCommunity, as: "challenge", except: CHALLENGE_ORGANIZER }
], { command: communityCommand, handler: executeCommunity, except: COMMUNITY_ORGANIZER });

const organize = new MergedCommand("organize", "Organizers: community seasons, quizzes, honors and activities.", [
  { command: communityCommand, handler: executeCommunity, flat: same(COMMUNITY_ORGANIZER) },
  { command: lotteryCommand, handler: executeCommunity, as: "lottery", only: LOTTERY_ORGANIZER },
  { command: gamingCommand, handler: executeCommunity, as: "gaming", only: GAMING_ORGANIZER },
  { command: challengeCommand, handler: executeCommunity, as: "challenge", only: CHALLENGE_ORGANIZER },
  { command: dungeonScheduleCommand, handler: executeDungeonSchedule, as: "dungeon-seasons" }
]).setDescriptionLocalizations({ fr: "Organisateurs : saisons, quiz, palmarès et activités." });

// Top level: the merged parents above, plus the commands main.ts handles itself.
export const commands: AnyCommand[] = [
  wowCommand,
  gameEventsCommand, setup, configCommand, helpCommand, character, raid, epgp, loot, dungeon, craftCommand,
  bankCommand, applyCommand, pollCommand, report, mod, coreCommand, tagCommand, importer,
  community, poeCommand, participationCommand, teamCommand, lead, officer, organize
];

// Commands whose every subcommand checks a leader role (Raid Leader for /lead, Officer or Guild
// Master for the rest; /setup uninstall and reset: the server owner or Administrator). Discord hides them from
// members without these permissions; a server admin can show one to a role in Server Settings >
// Integrations > Guilded. Those roles are role names, not Discord permissions, so the handlers
// keep their checks. /lead uses Manage Events so a server can also just give that to Raid Leaders.
export const HIDDEN_FROM_MEMBERS: Record<string, bigint> = {
  events: PermissionFlagsBits.ManageGuild,
  setup: PermissionFlagsBits.ManageGuild,
  config: PermissionFlagsBits.ManageGuild,
  mod: PermissionFlagsBits.ManageGuild,
  import: PermissionFlagsBits.ManageGuild,
  poll: PermissionFlagsBits.ManageGuild,
  lead: PermissionFlagsBits.ManageEvents,
  officer: PermissionFlagsBits.ManageGuild,
  organize: PermissionFlagsBits.ManageGuild
};
for (const command of commands) {
  const permissions = HIDDEN_FROM_MEMBERS[command.name];
  if (permissions !== undefined) (command as { setDefaultMemberPermissions(value: bigint): unknown }).setDefaultMemberPermissions(permissions);
}

const commandNames = commands.map((command) => command.name);
if (new Set(commandNames).size !== commandNames.length) {
  throw new Error(`Duplicate Discord command name detected: ${commandNames.join(", ")}`);
}
