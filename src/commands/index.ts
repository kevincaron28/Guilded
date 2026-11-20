import { automationCommand } from "./automation.js";
import { battlegroundCommand } from "./battleground.js";
import { wowCommand, executeWow } from "./wow.js";
import { healthCommand, executeHealth } from "./health.js";
import { profileCommand, executeProfile } from "./profile.js";
import { achievementsCommand, executeAchievements } from "./achievements.js";
import { characterCommand, characterLinkCommand, executeCharacter, executeCharacterLink } from "./character.js";
import { professionCommand, executeProfession } from "./profession.js";
import { configCommand, executeConfig } from "./settings.js";
import { raidCommand, executeRaid } from "./raid.js";
import { worldBuffCommand, executeWorldBuff } from "./world-buffs.js";
import { dniCommand, executeDni } from "./do-not-invite.js";
import { importCommand, executeImport } from "./import.js";
import { lootCommand, executeLoot } from "./loot.js";
import { applicationCommand, applyCommand, executeApplication } from "./application.js";
import { importApplyCommand, executeImportApply } from "./import-apply.js";
import { importHeldCommand, executeImportHeld } from "./import-held.js";
import { epgpCommand, executeEpgp } from "./epgp.js";
import { readinessCommand, executeReadiness } from "./readiness.js";
import { attunementCommand, executeAttunement } from "./attunement.js";
import { moderationCommand, executeModeration } from "./moderation.js";
import { tagCommand, executeTag } from "./tag.js";
import { wishlistCommand, executeWishlist } from "./wishlist.js";
import { selfRolesCommand, executeSelfRoles } from "./selfroles.js";
import { whoCommand, executeWho } from "./who.js";
import { wclCommand, executeWcl } from "./wcl.js";
import { coreCommand } from "./core.js";
import { teamCommand } from "./team.js";
import { inactiveCommand, executeInactive } from "./inactive.js";
import { gameRemindersCommand, executeGameReminders } from "./game-reminders.js";
import { exportCommand, executeExport } from "./export.js";
import { statsFeedCommand, executeStatsFeed } from "./stats-feed.js";
import { guildHealthCommand, executeGuildHealth } from "./guild-health.js";
import { pollCommand, executePoll } from "./poll.js";
import { statsCommand, statsPostsCommand, executeStats } from "./stats.js";
import { bankCommand, executeBank } from "./bank.js";
import { testRaidCommand, executeTestRaid } from "./testraid.js";
import { craftCommand, executeCraft } from "./craft.js";
import { setupCommand, executeSetup } from "./setup.js";
import { uninstallCommand, resetCommand, executeSetupReset, executeUninstall } from "./uninstall.js";
import { executeGuildPage, guildPageCommand } from "./guild-page.js";
import { helpCommand } from "./help.js";
import { dungeonCommand, dungeonOfficerCommand, executeDungeon, executeDungeonOfficer } from "./dungeon.js";
import { dungeonAdminCommand, executeDungeonAdmin } from "./dungeon-admin.js";
import { dungeonScheduleCommand, executeDungeonSchedule } from "./dungeon-schedule.js";
import { bugCommand, executeBug } from "./bugreport.js";
import { faqCommand, executeFaq } from "./faq.js";
import { systemCommand, executeSystem } from "./system.js";
import { communityCommand, lotteryCommand, gamingCommand, challengeCommand, executeCommunity } from "./community.js";

import { PermissionFlagsBits } from "discord.js";
import { MergedCommand, type AnyCommand, type Base, type Group, type Mount, type Pick } from "./router.js";
import { leaderboardCommand } from "./leaderboard.js";
import { applyFrenchNames } from "./french-names.js";
import { BRAND } from "../brand.js";
import { poeCommand } from "./poe.js";
import { POE_TRACKING_ENABLED } from "../../companion/active-games.mjs";
import { participationCommand, executeParticipation } from "./participation.js";
import { executeRecruit, recruitCommand } from "./recruit.js";
import { executePublicLeaderboard, publicLeaderboardCommand } from "./public-leaderboard.js";
import { executeRankRoles, rankRolesCommand } from "./rank-roles.js";
import { executeRoster, rosterCommand } from "./roster.js";
import { executePromotion, promotionCommand, promotionStatusCommand } from "./promotion.js";
import { executeInvites, invitesCommand } from "./invites.js";
import { executePug, pugCommand } from "./pug.js";
import { executePugs, pugsCommand } from "./pug-requests.js";

applyFrenchNames();

// Commands restructure (November 2026, owner: "Yes, full restructure"). Members are taught seven
// commands (/help, /character, /promotion, /craft, /leaderboard, /raid, /report bug); everything an
// officer runs lives in a tree members don't see (/officer, /lead, /mod, /organize, /setup, /config).
// Retired top-level command names still get a private "moved" answer (moved.ts).

type Buildable = { name: string; toJSON(): unknown };
const same = (names: string[]) => Object.fromEntries(names.map((name) => [name, name]));
// old subcommand -> its name in the group, or [name, shorter description] (4000-character limit).
const picks = (command: Buildable, handler: Base["handler"], subs: Record<string, string | [string, string]>): Pick[] =>
  Object.entries(subs).map(([sub, value]) => typeof value === "string" ? { command, handler, sub, as: value } : { command, handler, sub, as: value[0], description: value[1] });

/** A command whose own subcommands stay on it, minus the officer ones (moved), plus new mounts. */
function memberParent(command: Buildable, handler: Base["handler"], except: string[], mounts: (Mount | Group)[] = []): MergedCommand {
  const json = command.toJSON() as { description: string; name_localizations?: Record<string, string>; description_localizations?: Record<string, string> };
  const merged = new MergedCommand(command.name, json.description, mounts, { command, handler, except });
  if (json.name_localizations) merged.setNameLocalizations(json.name_localizations);
  if (json.description_localizations) merged.setDescriptionLocalizations(json.description_localizations);
  return merged;
}

// One parent per area, with the smaller commands mounted under it (see router.ts).
// /config stays its own command: under /setup it came close to Discord's 4000-character limit
// (moved out on 8 October 2026). /system and /uninstall moved here in 7.3.0; the admin parts of
// /wow (guild), /import and the participation and tag settings in November 2026.
const setup = new MergedCommand("setup", `${BRAND.name} setup: guilds, imports, participation, tags, reset.`, [
  { command: setupCommand, handler: executeSetup, as: "start" },
  { command: testRaidCommand, handler: executeTestRaid, as: "testraid" },
  { command: selfRolesCommand, handler: executeSelfRoles, as: "selfroles" },
  { command: systemCommand, handler: executeSystem, as: "system" },
  { command: resetCommand, handler: executeSetupReset, as: "reset" },
  { command: uninstallCommand, handler: executeUninstall, as: "uninstall" },
  { group: "guild", description: "In-game guilds: add one, bind a channel, change its roles (was /wow).", picks: picks(wowCommand, executeWow, same(["add", "channel", "roles"])) },
  { group: "import", description: "Addon data: preview a file, apply it, entries held (was /import).", picks: [
    { command: importCommand, handler: executeImport, as: "upload" },
    { command: importApplyCommand, handler: executeImportApply, as: "apply" },
    { command: importHeldCommand, handler: executeImportHeld, as: "held" }
  ] },
  { group: "participation", description: "Discord participation: settings, coverage, nominations.", picks: picks(participationCommand, executeParticipation, same(["settings", "channels", "claims", "review", "reverse"])) },
  { group: "tags", description: "Saved text snippets: create, replace or delete.", picks: picks(tagCommand, executeTag, same(["set", "delete"])) }
]);

const CRAFT_OFFICER: Record<string, string> = { "offer-setting": "offers", "posts-setting": "posts", "orders-setting": "orders", permissions: "permissions", "notify-setting": "notify" };
const config = memberParent(configCommand, executeConfig, [], [
  { group: "craft", description: "Craft board switches: offers, posts, in-game orders, pings, permissions.", picks: picks(craftCommand, executeCraft, CRAFT_OFFICER) }
]);

// Leader and officer subcommands live under /lead, /officer and /organize (below), which
// Discord hides from members; the member parents keep only what members can run.
const RAID_LEAD = ["create", "edit", "cancel", "start", "end", "attendance", "attendance-voice", "boss", "note", "award-ep", "fill", "season", "history"];
const EPGP_OFFICER = ["award-ep", "award-gp", "decay", "reverse"];
const LOOT_OFFICER = ["auction", "award", "close", "priority"];
const CHARACTER_OFFICER = ["unclaimed", "link", "move", "autolink", "claimdm"];
const COMMUNITY_ORGANIZER = ["start-season", "season-settings", "end-season", "quiz", "close-quiz", "honors-preview", "honors-settings", "badge-settings"];
const LOTTERY_ORGANIZER = ["create", "confirm", "payments", "close", "cancel"];
const GAMING_ORGANIZER = ["create", "edit", "attendance", "close", "cancel"];
const CHALLENGE_ORGANIZER = ["create", "review", "claims", "close", "cancel"];
const BANK_OFFICER = ["list", "handle", "stock", "settings"];
const PARTICIPATION_OFFICER = ["settings", "channels", "claims", "review", "reverse"];

const character = new MergedCommand("character", "Link your characters; profile, professions, wishlist and readiness.", [
  { command: characterLinkCommand, handler: executeCharacterLink, flat: { link: "link", guild: "guild" } },
  { command: profileCommand, handler: executeProfile, as: "profile" },
  { command: achievementsCommand, handler: executeAchievements, as: "achievements" },
  { command: whoCommand, handler: executeWho, as: "who" },
  { command: professionCommand, handler: executeProfession, as: "profession" },
  { command: attunementCommand, handler: executeAttunement, as: "attunement" },
  { command: wishlistCommand, handler: executeWishlist, as: "wishlist" },
  { command: readinessCommand, handler: executeReadiness, as: "readiness", only: ["me"] }
], { command: characterCommand, handler: executeCharacter, except: CHARACTER_OFFICER })
  .setNameLocalizations({ fr: "personnage" })
  .setDescriptionLocalizations({ fr: "Lier vos personnages; profil, métiers, souhaits et préparation." });

const raid = new MergedCommand("raid", "Raids: signups, progress, reports and Warcraft Logs.", [
  { command: pugCommand, handler: executePug, as: "pug" },
  { command: pugsCommand, handler: executePugs, as: "pugs" },
  { command: wclCommand, handler: executeWcl, as: "wcl", except: ["report"] },
  { command: worldBuffCommand, handler: executeWorldBuff, flat: { add: "worldbuff", list: "worldbuffs", remove: "worldbuff-remove" } }
], { command: raidCommand, handler: executeRaid, except: RAID_LEAD });

const epgp = new MergedCommand("epgp", "Your EPGP: balance, history and the leaderboard.", [],
  { command: epgpCommand, handler: executeEpgp, except: EPGP_OFFICER });

const loot = new MergedCommand("loot", "Bid on loot, see loot history and soft reserves.", [],
  { command: lootCommand, handler: executeLoot, except: LOOT_OFFICER });

const dungeon = new MergedCommand("dungeon", "Dungeon challenge: leaderboard, records, groups and alerts.", [],
  { command: dungeonCommand, handler: executeDungeon });

const craft = memberParent(craftCommand, executeCraft, Object.keys(CRAFT_OFFICER));
const bank = memberParent(bankCommand, executeBank, BANK_OFFICER);
const tag = memberParent(tagCommand, executeTag, ["set", "delete"]);
const participation = memberParent(participationCommand, executeParticipation, PARTICIPATION_OFFICER);

// Raid Leaders (Manage Events): raids, logs and readiness, and since November 2026 the EPGP and
// loot officer tools (each handler still checks its own role, as before).
const lead = new MergedCommand("lead", "Raid Leaders: raids, EPGP, loot, logs and readiness.", [
  { command: raidCommand, handler: executeRaid, flat: same(RAID_LEAD) },
  { command: wclCommand, handler: executeWcl, flat: { report: "wcl-report" } },
  { command: readinessCommand, handler: executeReadiness, flat: { member: "readiness-member", raid: "readiness-raid" } },
  { command: epgpCommand, handler: executeEpgp, as: "epgp", only: EPGP_OFFICER },
  { command: lootCommand, handler: executeLoot, as: "loot", only: LOOT_OFFICER }
]).setDescriptionLocalizations({ fr: "Chefs de raid : raids, EPGP, butin, journaux et préparation." });

const officer = new MergedCommand("officer", "Officers: characters, roster, bank, dungeon, reports and exports.", [
  { group: "dungeon", description: "Dungeon corrections, rewards and switches", picks: [
    ...picks(dungeonAdminCommand, executeDungeonAdmin, same(["invalidate", "award", "audit", "config", "flagged", "sync", "bracket-preview", "recalibrate"])),
    ...picks(dungeonOfficerCommand, executeDungeonOfficer, same(["goal", "announce"]))
  ] },
  { command: characterCommand, handler: executeCharacter, as: "character", only: CHARACTER_OFFICER },
  { group: "bank", description: "Guild bank requests, stock minimums and switches", picks: picks(bankCommand, executeBank, {
    list: ["list", "Open requests"], handle: ["handle", "Approve, fulfil or deny a request"], stock: ["stock", "Low items; set a minimum per item"], settings: ["settings", "Bank switches"]
  }) },
  { group: "reports", description: "Inactive members, guild health, game reminders, recap posts", picks: [
    { command: inactiveCommand, handler: executeInactive, as: "inactive", description: "Members not seen in game for a while (report only)" },
    { command: guildHealthCommand, handler: executeGuildHealth, as: "guild", description: "Class mix, retention and what needs attention" },
    ...picks(gameRemindersCommand, executeGameReminders, { list: "games", remind: ["remind", "Remind one member to pick a game"], auto: ["auto-remind", "Automatic game reminders on or off"] }),
    { command: statsPostsCommand, handler: executeStats, as: "posts" }
  ] },
  { command: exportCommand, handler: executeExport, as: "export" },
  { command: statsFeedCommand, handler: executeStatsFeed, as: "stats" },
  { command: rosterCommand, handler: executeRoster, as: "roster" },
  { command: promotionCommand, handler: executePromotion, as: "promotion" }
]).setDescriptionLocalizations({ fr: "Officiers : personnages, effectif, banque, donjons, rapports et exports." });

const mod = new MergedCommand("mod", "Officers: moderation, applications, answers, web, recruiting.", [
  { command: applicationCommand, handler: executeApplication, as: "application" },
  { command: dniCommand, handler: executeDni, as: "dni" },
  { command: faqCommand, handler: executeFaq, as: "faq" },
  { command: guildPageCommand, handler: executeGuildPage, as: "page" },
  { command: recruitCommand, handler: executeRecruit, as: "recruit" },
  { command: invitesCommand, handler: executeInvites, as: "invites" },
  { command: rankRolesCommand, handler: executeRankRoles, as: "rankroles" },
  { command: publicLeaderboardCommand, handler: executePublicLeaderboard, as: "leaderboard" }
], { command: moderationCommand, handler: executeModeration });

const report = new MergedCommand("report", "Report a bug; guild activity and bot status.", [
  { command: statsCommand, handler: executeStats, as: "stats" },
  { command: healthCommand, handler: executeHealth, as: "ping" },
  { command: bugCommand, handler: executeBug, as: "bug" }
]).setNameLocalizations({ fr: "rapport" })
  .setDescriptionLocalizations({ fr: "Signaler un bogue; activité de la guilde et état du bot." });

const community = new MergedCommand("community", "Gaming nights, lotteries, challenges, seasons and Discord games.", [
  { command: lotteryCommand, handler: executeCommunity, as: "lottery", except: LOTTERY_ORGANIZER },
  { command: gamingCommand, handler: executeCommunity, as: "gaming", except: GAMING_ORGANIZER },
  { command: challengeCommand, handler: executeCommunity, as: "challenge", except: CHALLENGE_ORGANIZER }
], { command: communityCommand, handler: executeCommunity, except: COMMUNITY_ORGANIZER });

const organize = new MergedCommand("organize", "Organizers: community seasons, activities, honors and polls.", [
  { command: communityCommand, handler: executeCommunity, flat: same(COMMUNITY_ORGANIZER) },
  { command: lotteryCommand, handler: executeCommunity, as: "lottery", only: LOTTERY_ORGANIZER },
  { command: gamingCommand, handler: executeCommunity, as: "gaming", only: GAMING_ORGANIZER },
  { command: challengeCommand, handler: executeCommunity, as: "challenge", only: CHALLENGE_ORGANIZER },
  { command: dungeonScheduleCommand, handler: executeDungeonSchedule, as: "dungeon-seasons" },
  { command: pollCommand, handler: executePoll, as: "poll" }
]).setDescriptionLocalizations({ fr: "Organisateurs : saisons, activités, palmarès et sondages." });

// Top level: the merged parents above, plus the commands main.ts handles itself.
export const commands: AnyCommand[] = [
  setup, config, helpCommand, character, raid, epgp, loot, dungeon, craft, leaderboardCommand,
  bank, applyCommand, report, mod, coreCommand, tag, community,
  ...(POE_TRACKING_ENABLED ? [poeCommand] : []), participation, promotionStatusCommand, teamCommand, battlegroundCommand, automationCommand, lead, officer, organize
];

// The commands members are taught (/help, the pinned guide); everything else is there for those who use it.
export const MEMBER_COMMANDS = ["help", "character", "promotion", "craft", "leaderboard", "raid", "report"] as const;

// Commands whose every subcommand checks a leader role (Raid Leader for /lead, Officer or Guild
// Master for the rest; /setup uninstall and reset: the server owner or Administrator). Discord hides them from
// members without these permissions; a server admin can show one to a role in Server Settings >
// Integrations > Guilded. Those roles are role names, not Discord permissions, so the handlers
// keep their checks. /lead uses Manage Events so a server can also just give that to Raid Leaders.
export const HIDDEN_FROM_MEMBERS: Record<string, bigint> = {
  setup: PermissionFlagsBits.ManageGuild,
  config: PermissionFlagsBits.ManageGuild,
  mod: PermissionFlagsBits.ManageGuild,
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
