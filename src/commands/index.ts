import { healthCommand, executeHealth } from "./health.js";
import { profileCommand } from "./profile.js";
import { characterCommand, executeCharacter } from "./character.js";
import { professionCommand, executeProfession } from "./profession.js";
import { configCommand, executeConfig } from "./settings.js";
import { raidCommand, executeRaid } from "./raid.js";
import { importCommand, executeImport } from "./import.js";
import { lootCommand } from "./loot.js";
import { applicationCommand, applyCommand, executeApplication } from "./application.js";
import { importApplyCommand, executeImportApply } from "./import-apply.js";
import { importHeldCommand, executeImportHeld } from "./import-held.js";
import { epgpCommand } from "./epgp.js";
import { readinessCommand, executeReadiness } from "./readiness.js";
import { attunementCommand, executeAttunement } from "./attunement.js";
import { moderationCommand, executeModeration } from "./moderation.js";
import { tagCommand } from "./tag.js";
import { wishlistCommand, executeWishlist } from "./wishlist.js";
import { selfRolesCommand, executeSelfRoles } from "./selfroles.js";
import { whoCommand, executeWho } from "./who.js";
import { wclCommand, executeWcl } from "./wcl.js";
import { coreCommand } from "./core.js";
import { inactiveCommand, executeInactive } from "./inactive.js";
import { exportCommand, executeExport } from "./export.js";
import { guildHealthCommand, executeGuildHealth } from "./guild-health.js";
import { pollCommand } from "./poll.js";
import { statsCommand, executeStats } from "./stats.js";
import { bankCommand } from "./bank.js";
import { testRaidCommand, executeTestRaid } from "./testraid.js";
import { craftCommand } from "./craft.js";
import { setupCommand, executeSetup } from "./setup.js";
import { uninstallCommand, resetCommand, executeSetupReset } from "./uninstall.js";
import { helpCommand } from "./help.js";
import { dungeonCommand, executeDungeon } from "./dungeon.js";
import { dungeonAdminCommand, executeDungeonAdmin } from "./dungeon-admin.js";
import { bugCommand, executeBug } from "./bugreport.js";
import { faqCommand, executeFaq } from "./faq.js";
import { systemCommand } from "./system.js";
import { communityCommand, lotteryCommand, gamingCommand, challengeCommand, executeCommunity } from "./community.js";

import { MergedCommand, type AnyCommand } from "./router.js";
import { BRAND } from "../brand.js";
import { poeCommand } from "./poe.js";
import { participationCommand } from "./participation.js";

// One parent per area, with the smaller commands mounted under it (see router.ts).
const setup = new MergedCommand("setup", `${BRAND.name} setup and settings.`, [
  { command: setupCommand, handler: executeSetup, as: "start" },
  { command: configCommand, handler: executeConfig, as: "config" },
  { command: testRaidCommand, handler: executeTestRaid, as: "testraid" },
  { command: selfRolesCommand, handler: executeSelfRoles, as: "selfroles" },
  { command: resetCommand, handler: executeSetupReset, as: "reset" }
]);

const character = new MergedCommand("character", "Your characters, professions, attunements, wishlist and readiness.", [
  { command: whoCommand, handler: executeWho, as: "who" },
  { command: professionCommand, handler: executeProfession, as: "profession" },
  { command: attunementCommand, handler: executeAttunement, as: "attunement" },
  { command: wishlistCommand, handler: executeWishlist, as: "wishlist" },
  { command: readinessCommand, handler: executeReadiness, as: "readiness" }
], { command: characterCommand, handler: executeCharacter });

const raid = new MergedCommand("raid", "Raids: signups, attendance, bosses, reports and Warcraft Logs.", [
  { command: wclCommand, handler: executeWcl, as: "wcl" }
], { command: raidCommand, handler: executeRaid });


const dungeon = new MergedCommand("dungeon", "Dungeon challenge: leaderboard, records, groups and officer tools.", [
  { command: dungeonAdminCommand, handler: executeDungeonAdmin, as: "admin" }
], { command: dungeonCommand, handler: executeDungeon });

const mod = new MergedCommand("mod", "Moderation, guild applications and the answer channel (officers).", [
  { command: applicationCommand, handler: executeApplication, as: "application" },
  { command: faqCommand, handler: executeFaq, as: "faq" }
], { command: moderationCommand, handler: executeModeration });

const importer = new MergedCommand("import", "Bring addon data into Discord: preview a file, then apply it (officers).", [
  { command: importCommand, handler: executeImport, as: "upload" },
  { command: importApplyCommand, handler: executeImportApply, as: "apply" },
  { command: importHeldCommand, handler: executeImportHeld, as: "held" }
]);

const report = new MergedCommand("report", "Guild reports: activity, inactive members, health, exports, bot status and bug reports.", [
  { command: statsCommand, handler: executeStats, as: "stats" },
  { command: inactiveCommand, handler: executeInactive, as: "inactive" },
  { command: guildHealthCommand, handler: executeGuildHealth, as: "guild" },
  { command: exportCommand, handler: executeExport, as: "export" },
  { command: healthCommand, handler: executeHealth, as: "ping" },
  { command: bugCommand, handler: executeBug, as: "bug" }
]);

const community = new MergedCommand("community", "Gaming nights, lotteries, challenges, seasons and Discord games.", [
  { command: lotteryCommand, handler: executeCommunity, as: "lottery" },
  { command: gamingCommand, handler: executeCommunity, as: "gaming" },
  { command: challengeCommand, handler: executeCommunity, as: "challenge" }
], { command: communityCommand, handler: executeCommunity });

// Top level: the merged parents above, plus the commands main.ts handles itself.
export const commands: AnyCommand[] = [
  setup, helpCommand, profileCommand, character, raid, epgpCommand, lootCommand, dungeon, craftCommand,
  bankCommand, applyCommand, pollCommand, report, mod, coreCommand, tagCommand, importer, uninstallCommand, systemCommand,
  community, poeCommand, participationCommand
];

const commandNames = commands.map((command) => command.name);
if (new Set(commandNames).size !== commandNames.length) {
  throw new Error(`Duplicate Discord command name detected: ${commandNames.join(", ")}`);
}
