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
import { uninstallCommand } from "./uninstall.js";
import { helpCommand } from "./help.js";
import { dungeonCommand, executeDungeon } from "./dungeon.js";
import { dungeonAdminCommand, executeDungeonAdmin } from "./dungeon-admin.js";

import { MergedCommand, type AnyCommand } from "./router.js";
import { BRAND } from "../brand.js";

// One parent per area, with the smaller commands mounted under it (see router.ts).
const setup = new MergedCommand("setup", `Set up ${BRAND.name} and change its settings (admins and officers).`, [
  { command: setupCommand, handler: executeSetup, as: "start" },
  { command: configCommand, handler: executeConfig, as: "config" },
  { command: testRaidCommand, handler: executeTestRaid, as: "testraid" },
  { command: selfRolesCommand, handler: executeSelfRoles, as: "selfroles" }
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

const mod = new MergedCommand("mod", "Moderation and guild applications (officers).", [
  { command: applicationCommand, handler: executeApplication, as: "application" }
], { command: moderationCommand, handler: executeModeration });

const importer = new MergedCommand("import", "Bring addon data into Discord: preview a file, then apply it (officers).", [
  { command: importCommand, handler: executeImport, as: "upload" },
  { command: importApplyCommand, handler: executeImportApply, as: "apply" }
]);

const report = new MergedCommand("report", "Guild reports: activity, inactive members, health, exports and bot status.", [
  { command: statsCommand, handler: executeStats, as: "stats" },
  { command: inactiveCommand, handler: executeInactive, as: "inactive" },
  { command: guildHealthCommand, handler: executeGuildHealth, as: "guild" },
  { command: exportCommand, handler: executeExport, as: "export" },
  { command: healthCommand, handler: executeHealth, as: "ping" }
]);

// Top level: the merged parents above, plus the commands main.ts handles itself.
export const commands: AnyCommand[] = [
  setup, helpCommand, profileCommand, character, raid, epgpCommand, lootCommand, dungeon, craftCommand,
  bankCommand, applyCommand, pollCommand, report, mod, coreCommand, tagCommand, importer, uninstallCommand
];

const commandNames = commands.map((command) => command.name);
if (new Set(commandNames).size !== commandNames.length) {
  throw new Error(`Duplicate Discord command name detected: ${commandNames.join(", ")}`);
}
