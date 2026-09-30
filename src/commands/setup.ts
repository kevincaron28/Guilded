import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Guild as DiscordGuild,
  type GuildMember,
  type MessageComponentInteraction,
  type OverwriteResolvable
} from "discord.js";
import type { GuildSettings } from "@prisma/client";
import { prisma } from "../database.js";
import { classLeaderRoleName, hasPermission, isPermissionRoleName, permissionRoleNames, roleNamesFor, type Permission } from "../permissions.js";
import { CLASSES } from "../wow-data.js";
import { formatChecks, setupChecks, setupComplete, type ChannelFact, type SetupFacts } from "../services/setup-status.js";
import { guildService, requireGuildContext } from "./context.js";
import { sendWelcome, welcomeDelivery } from "../services/housekeeping.js";
import { isValidTimeZone } from "../services/raid-time.js";
import { updateDungeonLeaderboard } from "../services/dungeon-leaderboard.js";
import { ensureDungeonSignupGuide } from "../services/dungeon-guide.js";
import { ensureAllCoresDiscord, syncAllCoreRosters } from "../services/raid-core.js";
import { botMessageFacts, ensureBotGuide, gettingStartedPost, updateBotMessages } from "../services/bot-messages.js";
import { dungeonGuideState, LFG_ROLE_NAMES } from "../services/dungeon-guide.js";
import { guideText as craftGuideText } from "./craft-board.js";
import { asLang, tx, type Lang } from "../i18n.js";
import { CATEGORY_NAMES, isSetupLeftover, categoryNames, channelNames, channelSpec, type Access, type CategoryKey, type ChannelField } from "../setup-names.js";
import { forgetAnswerSettings } from "./faq.js";
import { BRAND } from "../brand.js";
import { boardTagNames, postBoardGuide } from "./craft-board.js";

// Guided first-time setup. One private message that walks an admin through
// seven steps with buttons and dropdowns only (no IDs, no typing):
//   1 roles  2 channels  3 dungeon channels  4 extra channels  5 welcome  6 auto-roles  7 EPGP & automation  8 summary
// Safe to re-run any time: it shows what's already set and changes only
// what you click. `/setup start status:true` shows just the checklist.

export const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription(`Guided ${BRAND.name} setup (admins). Safe to rerun.`)
  .setDescriptionLocalizations({ fr: `Configuration guidée de ${BRAND.name} (administrateurs). Peut être relancée en tout temps.` })
  .addBooleanOption((o) => o.setName("status").setDescription("Only show the setup checklist"));

const REQUIRED_ROLES: Permission[] = ["guildMaster", "officer", "raidLeader", "dkpOfficer"];
const OPTIONAL_ROLES: Permission[] = ["lootLeader", "classLeader"];
const ADDON_URL = "https://www.curseforge.com/wow/addons/guilded";

const RECOMMENDED_EPGP = {
  attendanceDkp: 10,
  lateAttendanceDkp: 5,
  bossKillDkp: 5,
  epCompletionBonus: 10,
  baseGp: 100,
  epgpDecayPercent: 0.1,
  minimumBid: 10,
  bidIncrement: 5
};

const STEP_TITLES = [
  "Welcome", "Step 1 of 7 — Permission roles", "Step 2 of 7 — Channels", "Step 3 of 7 — Raid team channels",
  "Step 4 of 7 — Dungeon channels", "Step 5 of 7 — Welcome message", "Step 6 of 7 — New member roles",
  "Step 7 of 7 — EPGP, time & language", "All done"
];
const LAST_STEP = 7;
// The checklist's "use an existing channel for…" choice, until the channel is picked (per guild).
const pendingField = new Map<string, ChannelField>();
const SUMMARY_STEP = 8;

// Common choices; anything else can be set with /setup config timezone.
const TIMEZONES: [string, string][] = [
  ["Eastern — Quebec, Ontario, New York", "America/Toronto"],
  ["Atlantic — Maritimes", "America/Halifax"],
  ["Central — Manitoba, Texas", "America/Winnipeg"],
  ["Mountain — Alberta", "America/Edmonton"],
  ["Pacific — British Columbia, California", "America/Vancouver"],
  ["France / Central Europe", "Europe/Paris"],
  ["UK / Ireland", "Europe/London"],
  ["UTC", "UTC"]
];

// ---------------------------------------------------------------------
// Facts about the server, for the checklist
// ---------------------------------------------------------------------

async function channelFact(guild: DiscordGuild, channelId: string | null | undefined): Promise<ChannelFact | null> {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return { name: "deleted-channel", exists: false, botCanPost: false };
  const me = guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  return {
    name: channel.name,
    exists: true,
    botCanPost: !!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
  };
}

function botCanAssign(guild: DiscordGuild, roleId: string): { name: string; botCanAssign: boolean } | null {
  const role = guild.roles.cache.get(roleId);
  if (!role) return null;
  const me = guild.members.me;
  const ok = !!me && me.permissions.has(PermissionFlagsBits.ManageRoles) && me.roles.highest.comparePositionTo(role) > 0;
  return { name: role.name, botCanAssign: ok };
}

async function gatherFacts(guild: DiscordGuild, guildId: string, settings: GuildSettings): Promise<SetupFacts> {
  await guild.roles.fetch();
  const signupChannel = settings.dungeonSignupChannelId
    ? await guild.channels.fetch(settings.dungeonSignupChannelId).catch(() => null)
    : null;
  const guideState = signupChannel?.isTextBased() && "messages" in signupChannel
    ? await dungeonGuideState(signupChannel).catch(() => "missing" as const)
    : null;
  const signupGuide = guideState ? guideState !== "missing" : settings.dungeonSignupChannelId ? false : null;
  const lang = asLang(settings.language);
  const signupCanPin = signupChannel
    ? !!guild.members.me && !!signupChannel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.PinMessages)
    : null;
  const autoRoles = [settings.applicantRoleId, settings.memberRoleId, ...settings.welcomeRoleIds]
    .filter((id): id is string => !!id)
    .map((id) => botCanAssign(guild, id))
    .filter((role): role is { name: string; botCanAssign: boolean } => role !== null);
  return {
    existingRoleNames: guild.roles.cache.map((role) => role.name),
    // One entry per required role: either language's name satisfies it.
    requiredRoleNames: REQUIRED_ROLES.map((permission) => permissionRoleNames(permission)),
    notifyChannel: await channelFact(guild, settings.notifyChannelId),
    raidChannel: await channelFact(guild, settings.raidSignupChannelId),
    logChannel: await channelFact(guild, settings.logChannelId),
    raidLogChannel: await channelFact(guild, settings.raidLogChannelId),
    dungeonSignupChannel: await channelFact(guild, settings.dungeonSignupChannelId),
    dungeonSignupGuide: signupGuide,
    dungeonSignupCanPin: signupCanPin,
    dungeonLeaderboardChannel: await channelFact(guild, settings.dungeonLeaderboardChannelId),
    welcomeChannel: welcomeDelivery(settings) === "DM" ? null : await channelFact(guild, settings.welcomeChannelId),
    autoRoles,
    epgpConfigured: settings.baseGp > 0,
    remindersOn: settings.raidReminderMinutes > 0,
    weeklyReportOn: settings.weeklyReportEnabled,
    companionPaired: (await prisma.companionCredential.count({ where: { revokedAt: null, member: { guildId, status: "ACTIVE" } } })) > 0,
    linkedCharacters: await prisma.character.count({ where: { member: { guildId, isTest: false } } }),
    dungeonSignupGuideOutdated: guideState === "outdated",
    extraChannels: await Promise.all((["coreChannelId", "readinessChannelId", "lootChannelId", "craftChannelId", "applicationChannelId", "guideChannelId", "answerChannelId", "dungeonChannelId"] as const)
      .map(async (field) => ({ field, fact: await channelFact(guild, settings[field]) }))),
    botMessages: await botMessageFacts(guild, prisma, settings, lang, craftGuideText(lang)).catch(() => [])
  };
}

// ---------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------

const button = (id: string, label: string, style: ButtonStyle = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setCustomId(`setup:${id}`).setLabel(label).setStyle(style).setDisabled(disabled);

function navRow(step: number, lang: Lang, extra: ButtonBuilder[] = []) {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (step > 1) row.addComponents(button("back", tx(lang, "◀ Back")));
  row.addComponents(...extra);
  row.addComponents(button("next", step >= LAST_STEP ? tx(lang, "Finish ▶") : tx(lang, "Next ▶"), ButtonStyle.Primary));
  return row;
}

const channelLabel = (lang: Lang, id: string | null) => id ? `<#${id}>` : tx(lang, "*not set*");
const roleLabel = (lang: Lang, id: string | null) => id ? `<@&${id}>` : tx(lang, "*not set*");
const same = (lang: Lang, id: string | null | undefined, fallback: string) => id ? `<#${id}>` : tx(lang, fallback);

export async function renderStep(step: number, guild: DiscordGuild, guildId: string, note: string) {
  const settings = await guildService.getSettings(guildId);
  if (!settings) throw new Error("Guild settings are missing.");
  const lang = asLang(settings.language);
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const roleName = (permission: Permission) => roleNamesFor(lang)[permission];
  const embed = new EmbedBuilder().setTitle(`${BRAND.emoji} ${T("{name} setup", { name: BRAND.name })} — ${T(STEP_TITLES[step] ?? "")}`).setColor(BRAND.color);
  const components: ActionRowBuilder<ButtonBuilder | ChannelSelectMenuBuilder | RoleSelectMenuBuilder | StringSelectMenuBuilder>[] = [];

  if (step === 0) {
    embed.setDescription([
      "🗣️ **Language / Langue** — choose with the buttons below / choisissez avec les boutons ci-dessous. Roles, channels and messages will use it. / Les rôles, salons et messages l'utiliseront.",
      "",
      T("This takes about **2 minutes**. Every step is buttons and menus — nothing to type."),
      "",
      T("**1. Roles** — who counts as Guild Master, Officer, Raid Leader, DKP Officer."),
      T("**2. Channels** — where announcements, raid signups, raid logs, and officer logs go."),
      T("**3. Raid team channels** — raid roster (cores), raid readiness (private), loot log, craft board (optional)."),
      T("**4. Dungeon channels** — dungeon leaderboard, signups and runs (optional)."),
      T("**5. Welcome** — optional welcome message (in a channel or by DM) with buttons to pick game roles."),
      T("**6. New member roles** — optional automatic Applicant / Member roles."),
      T("**7. EPGP, time & language** — point values, reminders, your timezone, English or French."),
      "",
      T("You can **run /setup start again any time**: it shows what's already done and only changes what you click. Nothing gets deleted.")
    ].join("\n"));
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("lang-en", "English", lang === "en" ? ButtonStyle.Success : ButtonStyle.Secondary),
        button("lang-fr", "Français", lang === "fr" ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("next", T("Start ▶"), ButtonStyle.Primary),
        button("jump-summary", T("Just show me the checklist"))
      )
    );
  }

  if (step === 1) {
    await guild.roles.fetch();
    const has = (permission: Permission) => guild.roles.cache.some((role) => isPermissionRoleName(permission, role.name));
    const lines = [...REQUIRED_ROLES, ...OPTIONAL_ROLES].map((permission) =>
      `${has(permission) ? "✅" : REQUIRED_ROLES.includes(permission) ? "❌" : "➖"} **${roleName(permission)}**${OPTIONAL_ROLES.includes(permission) ? T(" (optional)") : ""}`);
    embed.setDescription([
      T("The bot decides who can do what **by role name**. Server admins can always do everything."),
      "",
      ...lines,
      "",
      T("• **{gm} / {officer}** — everything (settings, imports, moderation, loot).", { gm: roleName("guildMaster"), officer: roleName("officer") }),
      T("• **{raidLeader}** — create and run raids, attendance, EP proposals.", { raidLeader: roleName("raidLeader") }),
      T("• **{dkp}** — award and correct EP/GP.", { dkp: roleName("dkpOfficer") }),
      "",
      T("Press **Create missing roles**, then give them to your officers (right-click a member → Roles).")
    ].join("\n"));
    const missing = REQUIRED_ROLES.filter((permission) => !has(permission));
    const missingOptional = OPTIONAL_ROLES.filter((permission) => !has(permission));
    components.push(navRow(1, lang, [
      button("create-roles", missing.length ? T("Create missing roles ({count})", { count: missing.length }) : T("All roles exist"), ButtonStyle.Success, missing.length === 0),
      button("create-optional-roles", T("Create optional roles ({count})", { count: missingOptional.length }), ButtonStyle.Secondary, missingOptional.length === 0),
      button("give-gm", T("Give me {gm}", { gm: roleName("guildMaster") }), ButtonStyle.Secondary, !has("guildMaster"))
    ]));
    // One Class Leader role per class, picked from a menu (only the classes your guild plays).
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
      .setCustomId("setup:class-leaders").setPlaceholder(T("Create a Class Leader role per class..."))
      .setMinValues(1).setMaxValues(CLASSES.length)
      .addOptions(CLASSES.map((className) => ({
        label: classLeaderRoleName(className, lang),
        value: className,
        ...(guild.roles.cache.some((role) => role.name === classLeaderRoleName(className, "en") || role.name === classLeaderRoleName(className, "fr")) ? { description: T("Already exists") } : {})
      })))));
  }

  if (step === 2) {
    embed.setDescription([
      T("Already have channels for these? **Pick them from the menus below** — nothing gets created or moved. Don't have them yet? Skip the menus and press **\"Create the missing ones for me\"**: I'll make only the ones you haven't picked (the log channel will be private to officers), sorted into tidy categories."),
      "",
      T("📢 **Announcements** — raid started, boss kills, loot, EP awards: {channel}", { channel: channelLabel(lang, settings.notifyChannelId) }),
      T("📅 **Raid signups** — signup posts that update live, and raid reminders: {channel}", { channel: channelLabel(lang, settings.raidSignupChannelId) }),
      T("📜 **Raid logs** — the raid summary (report) posted after each raid: {channel}", { channel: same(lang, settings.raidLogChannelId, "same as announcements") }),
      T("🔒 **Officer log** — joins/leaves, moderation, bank and craft requests: {channel}", { channel: channelLabel(lang, settings.logChannelId) }),
      T("📖 **Bot guide** — the getting-started guide, pinned; also where update notices post: {channel} (\"Create the missing ones for me\" makes this one too, or pick it later with `/config channel`)", { channel: channelLabel(lang, settings.guideChannelId) }),
      T("💬 **Bot FAQ** — members ask questions and the bot answers automatically: {channel}", { channel: channelLabel(lang, settings.answerChannelId) })
    ].join("\n"));
    const select = (id: string, placeholder: string) => new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder().setCustomId(`setup:${id}`).setPlaceholder(placeholder)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1));
    components.push(
      select("ch-notify", T("📢 Pick the announcements channel")),
      select("ch-raid", T("📅 Pick the raid signups channel")),
      select("ch-raidlog", T("📜 Pick the raid logs channel")),
      select("ch-log", T("🔒 Pick the officer log channel")),
      navRow(2, lang, [button("create-channels", T("Create the missing ones for me"), ButtonStyle.Success)])
    );
  }

  const channelSelect = (id: string, placeholder: string) => new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(`setup:${id}`).setPlaceholder(placeholder)
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ...(id === "ch-craft" ? [ChannelType.GuildForum] : [])).setMinValues(1).setMaxValues(1));

  if (step === 3) {
    embed.setDescription([
      T("**Optional.** Skip with **Next** if you don't want these. Already have channels for these? Pick them from the menus below. Otherwise press **\"Create the missing ones for me\"**."),
      "",
      T("⭐ **Raid roster** — one live message per raid core (`/core create`); core members get signup priority: {channel}", { channel: channelLabel(lang, settings.coreChannelId) }),
      T("🛡️ **Raid readiness** — private, officers and raid leaders only: who is ready for raid night: {channel}", { channel: channelLabel(lang, settings.readinessChannelId) }),
      T("🎁 **Loot & EP log** — every loot award and EP/GP change: {channel}", { channel: same(lang, settings.lootChannelId, "same as announcements") }),
      T("🔨 **Craft board** — a forum where every craft request is its own post with tags and buttons (bank requests stay in the officer log): {channel}", { channel: same(lang, settings.craftChannelId, "the officer log") }),
      T("📋 **Applications** — private, officers only: a heads-up when someone applies with `/apply`: {channel}", { channel: same(lang, settings.applicationChannelId, "the officer log") })
    ].join("\n"));
    components.push(
      channelSelect("ch-core", T("⭐ Pick the raid roster channel")),
      channelSelect("ch-readiness", T("🛡️ Pick the raid readiness channel (keep it private)")),
      channelSelect("ch-loot", T("🎁 Pick the loot & EP log channel")),
      channelSelect("ch-craft", T("🔨 Pick the craft board channel")),
      navRow(3, lang, [button("create-raidteam-channels", T("Create the missing ones for me"), ButtonStyle.Success)])
    );
  }

  if (step === 4) {
    embed.setDescription([
      T("**Optional.** Skip with **Next** if you don't run the dungeon challenge. Already have channels for these? Pick them from the menus below. Otherwise press **\"Create the missing ones for me\"**."),
      "",
      T("🏆 **Dungeon leaderboard** — one message I keep updated after every imported dungeon run: {channel}", { channel: channelLabel(lang, settings.dungeonLeaderboardChannelId) }),
      T("📝 **Dungeon signups** — a pinned **Post a dungeon group** button starts a signup post; groups get a temporary voice channel: {channel}", { channel: channelLabel(lang, settings.dungeonSignupChannelId) }),
      T("🏰 **Dungeon runs** — each completed dungeon and new records: {channel}", { channel: same(lang, settings.dungeonChannelId, "same as announcements") })
    ].join("\n"));
    components.push(
      channelSelect("ch-dungeon-lb", T("🏆 Pick the dungeon leaderboard channel")),
      channelSelect("ch-dungeon-signup", T("📝 Pick the dungeon signups channel")),
      channelSelect("ch-dungeon", T("🏰 Pick the dungeon runs channel")),
      navRow(4, lang, [
        button("create-dungeon-channels", T("Create the missing ones for me"), ButtonStyle.Success),
        button("dungeon-guide", T("Post/repair signup guide"), ButtonStyle.Secondary, !settings.dungeonSignupChannelId)
      ])
    );
  }

  if (step === 5) {
    const delivery = welcomeDelivery(settings);
    const offered = settings.welcomeRoleIds.map((id) => `<@&${id}>`).join(", ");
    embed.setDescription([
      T("**Optional.** Skip with **Next** if you don't want a welcome message."),
      "",
      T("📨 **Sent to:** {where}", { where: delivery === "DM" ? T("a private message (DM)") : delivery === "BOTH" ? T("a private message and the welcome channel") : T("the welcome channel") }),
      T("👋 **Welcome channel:** {channel}{extra}", { channel: channelLabel(lang, settings.welcomeChannelId), extra: delivery === "DM" ? T(" (not needed for DM only; used if their DMs are closed)") : "" }),
      T("🎮 **Role buttons in the message:** {roles}", { roles: offered || T("*none*") }),
      "",
      T("Role buttons let new people pick what they're here for — for example one role per game, so they only see those channels. They can pick several, and click again to remove one. Pick up to 5 roles in the second menu (create the roles first in Server Settings → Roles)."),
      "",
      T("Press **Send me a preview** to see exactly what new people get.")
    ].join("\n"));
    const deliveryButton = (value: string, label: string) => button(`delivery-${value}`, label, delivery === value ? ButtonStyle.Success : ButtonStyle.Secondary);
    components.push(
      new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId("setup:ch-welcome")
        .setPlaceholder(T("👋 Pick the welcome channel")).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1)),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId("setup:welcome-roles")
        .setPlaceholder(T("🎮 Roles people can pick (up to 5; pick none to remove)")).setMinValues(0).setMaxValues(5)),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        deliveryButton("CHANNEL", T("Post in channel")),
        deliveryButton("DM", T("Private message")),
        deliveryButton("BOTH", T("Both")),
        button("welcome-preview", T("Send me a preview"), ButtonStyle.Primary)
      ),
      navRow(5, lang, [button("welcome-off", T("Turn welcome off"))])
    );
  }

  if (step === 6) {
    embed.setDescription([
      T("**Optional.** Skip with **Next** if you don't use these."),
      "",
      T("🆕 **Applicant role** — given automatically when someone joins: {role}", { role: roleLabel(lang, settings.applicantRoleId) }),
      T("🛡️ **Member role** — given when an application is approved (`/mod application approve`): {role}", { role: roleLabel(lang, settings.memberRoleId) }),
      "",
      T("**My role must be above these roles** (Server Settings → Roles, drag me higher). The final checklist tells you if it isn't.")
    ].join("\n"));
    components.push(
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId("setup:role-applicant")
        .setPlaceholder(T("🆕 Pick the applicant role")).setMinValues(1).setMaxValues(1)),
      new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(new RoleSelectMenuBuilder().setCustomId("setup:role-member")
        .setPlaceholder(T("🛡️ Pick the member role")).setMinValues(1).setMaxValues(1)),
      navRow(6, lang, [button("autoroles-off", T("Turn auto-roles off"))])
    );
  }

  if (step === 7) {
    const tzLabel = TIMEZONES.find(([, value]) => value === settings.timezone)?.[0] ?? settings.timezone;
    const onOff = (value: boolean) => (value ? T("on") : T("off"));
    embed.setDescription([
      T("**EPGP points** (current):"),
      T("• Raid attendance: **{ep} EP** (late: {late})", { ep: settings.attendanceDkp, late: settings.lateAttendanceDkp }),
      T("• Per boss killed: **{boss} EP**, full clear bonus: **{clear} EP**", { boss: settings.bossKillDkp, clear: settings.epCompletionBonus }),
      T("• Base GP: **{gp}** (stops new players with tiny GP from topping the list)", { gp: settings.baseGp }),
      T("• Weekly decay: **{percent}%**", { percent: Math.round(settings.epgpDecayPercent * 100) }),
      T("**Recommended:** 10 attendance / 5 late / 5 per boss / 10 full clear / base GP 100 / 10% decay. Fine-tune later with `/setup config set`."),
      "",
      T("⏰ **Raid reminders:** {reminders}   📊 **Weekly report:** {weekly}   🤖 **Auto-apply uploads:** {auto}", {
        reminders: settings.raidReminderMinutes > 0 ? T("on ({minutes} min before start)", { minutes: settings.raidReminderMinutes }) : T("off"),
        weekly: onOff(settings.weeklyReportEnabled), auto: onOff(settings.autoApplyImports)
      }),
      T("🕗 **Timezone** (for typing raid times like \"friday 8pm\"): **{zone}**", { zone: tzLabel }),
      T("🗣️ **Language** for member messages: **{language}**", { language: lang === "fr" ? "Français" : "English" })
    ].join("\n"));
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button("epgp-recommended", T("Use recommended values"), ButtonStyle.Success),
        button("reminders", settings.raidReminderMinutes > 0 ? T("Turn reminders off") : T("Turn reminders on (60 min)")),
        button("weekly", settings.weeklyReportEnabled ? T("Turn weekly report off") : T("Turn weekly report on")),
        button("auto-import", settings.autoApplyImports ? T("Auto-apply uploads: on") : T("Auto-apply uploads: off"), settings.autoApplyImports ? ButtonStyle.Success : ButtonStyle.Secondary)
      ),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("setup:tz")
        .setPlaceholder(T("🕗 Pick your timezone"))
        .addOptions(TIMEZONES.map(([label, value]) => ({ label: T(label), value, default: value === settings.timezone })))),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("setup:lang")
        .setPlaceholder("🗣️ Language / Langue")
        .addOptions(
          { label: "English", value: "en", default: lang !== "fr" },
          { label: "Français", value: "fr", default: lang === "fr" }
        )),
      navRow(7, lang)
    );
  }

  if (step === SUMMARY_STEP) {
    const checks = setupChecks(await gatherFacts(guild, guildId, settings), lang);
    const done = setupComplete(checks);
    const missingChannels = ALL_CHANNELS.filter((field) => !settings[field]).length;
    await guild.roles.fetch();
    const missingRoles = REQUIRED_ROLES.filter((permission) => !guild.roles.cache.some((role) => isPermissionRoleName(permission, role.name))).length;
    embed.setDescription([
      done ? T("**Everything required is set up.** 🎉") : T("**Almost there** — fix the ❌ items (each says how)."),
      "",
      formatChecks(checks),
      "",
      T("**Next steps**"),
      T("1. Everyone: `/character pair` to link their companion (or `/character add` to link a character by hand)."),
      T("2. Officers: install the WoW addon — {url}", { url: ADDON_URL }),
      T("3. Raid leaders: `/core setup` builds a raid core (name, players, rules) with menus; then `/raid create core:<name>`."),
      T("4. Try everything safely: `/setup testraid start` (fake raid, removed with `/setup testraid cleanup`)."),
      T("5. `/help` lists every command by role.")
    ].join("\n").slice(0, 4000));
    // A missing channel/role after an update used to mean walking back through
    // every wizard step just to reach the one that creates it. These fix
    // everything at once, right from the checklist, in the standard categories
    // (bot-created names) — to link an existing channel instead, use /config.
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button("create-all-channels", missingChannels ? T("Create missing channels ({count})", { count: missingChannels }) : T("All channels exist"), ButtonStyle.Success, missingChannels === 0),
      button("create-roles", missingRoles ? T("Create missing roles ({count})", { count: missingRoles }) : T("All roles exist"), ButtonStyle.Success, missingRoles === 0)
    ));
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button("update-messages", T("Update bot messages"), ButtonStyle.Success),
      button("lfg-roles", T("Create LFG ping roles")),
      button("post-guide", T("Post a getting-started message for members"), ButtonStyle.Secondary, !settings.notifyChannelId),
      button("organize", T("Tidy my channels into categories"))
    ));
    // Link an existing channel instead of creating one: pick which, then the channel.
    const pending = pendingField.get(guildId);
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
      .setCustomId("setup:pick-field").setPlaceholder(T("Use an existing channel for..."))
      .addOptions([...ALL_CHANNELS].map((field) => ({
        label: `#${channelSpec(field, lang).name}`.slice(0, 100), value: field,
        description: settings[field] ? T("Set") : T("Not set"), default: pending === field
      })))));
    if (pending) {
      components.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder()
        .setCustomId("setup:ch-pick").setPlaceholder(T("Pick the channel for #{name}", { name: channelSpec(pending, lang).name }))
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ...(pending === "craftChannelId" ? [ChannelType.GuildForum] : []))
        .setMinValues(1).setMaxValues(1)));
    }
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      button("restart", T("Go through setup again")),
      button("close", T("Close"), ButtonStyle.Primary)
    ));
  }

  if (note) embed.addFields({ name: T("Last action"), value: note.slice(0, 1000) });
  return { embeds: [embed], components };
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

// Loot Leader and Class Leader: not needed to run the bot, created on request.
async function createOptionalRoles(guild: DiscordGuild, lang: Lang): Promise<string> {
  await guild.roles.fetch();
  const created: string[] = [];
  for (const permission of OPTIONAL_ROLES) {
    if (guild.roles.cache.some((role) => permissionRoleNames(permission).includes(role.name))) continue;
    const name = roleNamesFor(lang)[permission];
    await guild.roles.create({ name, reason: `${BRAND.name} /setup` });
    created.push(name);
  }
  return created.length ? tx(lang, "Created roles: {roles}. Now give them to your officers.", { roles: created.join(", ") }) : tx(lang, "All roles already existed.");
}

// "Class Leader (Warrior)" and so on for the picked classes (either language's name counts as there).
async function createClassLeaderRoles(guild: DiscordGuild, lang: Lang, classes: string[]): Promise<string> {
  await guild.roles.fetch();
  const created: string[] = [];
  for (const className of classes.filter((name) => (CLASSES as readonly string[]).includes(name))) {
    const names = [classLeaderRoleName(className, "en"), classLeaderRoleName(className, "fr")];
    if (guild.roles.cache.some((role) => names.includes(role.name))) continue;
    const name = classLeaderRoleName(className, lang);
    await guild.roles.create({ name, reason: `${BRAND.name} /setup` });
    created.push(name);
  }
  return created.length ? tx(lang, "Created roles: {roles}. Now give them to your officers.", { roles: created.join(", ") }) : tx(lang, "All roles already existed.");
}

async function createMissingRoles(guild: DiscordGuild, lang: Lang): Promise<string> {
  await guild.roles.fetch();
  const created: string[] = [];
  for (const permission of REQUIRED_ROLES) {
    // Either language's name counts as already there.
    if (guild.roles.cache.some((role) => isPermissionRoleName(permission, role.name))) continue;
    const name = roleNamesFor(lang)[permission];
    await guild.roles.create({ name, reason: `${BRAND.name} /setup` });
    created.push(name);
  }
  return created.length ? tx(lang, "Created roles: {roles}. Now give them to your officers.", { roles: created.join(", ") }) : tx(lang, "All roles already existed.");
}

const CORE_CHANNELS: ChannelField[] = ["notifyChannelId", "raidSignupChannelId", "raidLogChannelId", "logChannelId", "guideChannelId", "answerChannelId"];
const RAIDTEAM_CHANNELS: ChannelField[] = ["coreChannelId", "readinessChannelId", "lootChannelId", "craftChannelId", "applicationChannelId"];
const DUNGEON_CHANNELS: ChannelField[] = ["dungeonLeaderboardChannelId", "dungeonSignupChannelId", "dungeonChannelId"];
// Every channel field /setup can create. Also used by /setup uninstall to find what to remove.
export const ALL_CHANNELS: ChannelField[] = [...CORE_CHANNELS, ...RAIDTEAM_CHANNELS, ...DUNGEON_CHANNELS];

// The category for a group of channels; created once and reused (found by its English or French name).
async function ensureCategory(guild: DiscordGuild, key: CategoryKey, lang: Lang) {
  await guild.channels.fetch();
  const names = categoryNames(key);
  const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && names.includes(channel.name));
  return existing ?? guild.channels.create({ name: CATEGORY_NAMES[lang][key], type: ChannelType.GuildCategory, reason: `${BRAND.name} /setup` });
}

// The permission overwrites for a kind of channel. Leadership can always
// post in read-only channels; the bot can always post everywhere it makes.
function overwritesFor(guild: DiscordGuild, access: Access): OverwriteResolvable[] | undefined {
  const named = (permissions: Permission[]) => guild.roles.cache.filter((role) => permissions.some((permission) => isPermissionRoleName(permission, role.name)));
  const officers = named(["guildMaster", "officer"]);
  const leaders = named(["guildMaster", "officer", "raidLeader", "lootLeader", "classLeader"]);
  const me = guild.members.me;
  const bot: OverwriteResolvable[] = me
    ? [{
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
        ...(access === "pinned" ? [PermissionFlagsBits.PinMessages] : [])
      ]
    }]
    : [];
  if (access === "officers" || access === "leaders") {
    const who = access === "officers" ? officers : leaders;
    return [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...who.map((role) => ({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] })),
      ...bot
    ];
  }
  if (access === "board") {
    // The craft board: everyone reads and talks inside a request's post and can press its
    // buttons, but cannot start posts of their own (requests go through the bot, so they
    // keep their tags and buttons). Leadership can post and tidy threads.
    return [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.AddReactions, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads]
      },
      ...leaders.map((role) => ({ id: role.id, allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageThreads] })),
      ...(me ? [{ id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }] : [])
    ];
  }
  if (access === "readonly" || access === "pinned") {
    return [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads] },
      ...officers.map((role) => ({ id: role.id, allow: [PermissionFlagsBits.SendMessages] })),
      ...bot
    ];
  }
  return undefined;
}

// Puts the craft board's permissions right again (for a board made by an older version,
// or one someone changed). Only the entries the board needs are touched.
export async function repairCraftBoardPermissions(guild: DiscordGuild, channelId: string): Promise<boolean> {
  await guild.roles.fetch();
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildForum) return false;
  for (const entry of overwritesFor(guild, "board") ?? []) {
    const flags = (list: unknown, value: boolean) => Object.fromEntries((Array.isArray(list) ? list : []).map((flag) => [new PermissionsBitField(flag as bigint).toArray()[0], value]));
    await channel.permissionOverwrites.edit(entry.id as string, { ...flags(entry.allow, true), ...flags(entry.deny, false) } as never);
  }
  return true;
}

// Creates only the channels in `fields` that aren't set yet, each in its own
// category with the right permissions; never touches ones that are set.
export async function createSectionChannels(guild: DiscordGuild, guildId: string, fields: ChannelField[], lang: Lang): Promise<string> {
  const settings = await guildService.getSettings(guildId);
  const missing = fields.filter((field) => !settings?.[field]);
  if (missing.length === 0) return tx(lang, "Those channels were already set. Pick different ones from the menus if you want.");
  await guild.roles.fetch();
  await guild.channels.fetch();
  const made: string[] = [];
  // A guide message failing to post (missing permission, API hiccup) should
  // never hide that the channel itself was created and saved — collect it as
  // a warning on the final message instead of losing the confirmation, and
  // log it so the underlying cause (e.g. missing Pin Messages) is visible.
  const warnings: string[] = [];
  const guidedFor = (channel: string, error: unknown) => {
    console.warn(`Guide message not posted in ${channel}`, error);
    warnings.push(tx(lang, "Couldn't post the guide message in {channel} ({error}). Run setup again or use \"organize channels\" to retry.", {
      channel, error: error instanceof Error ? error.message : String(error)
    }));
  };
  const update: Partial<Record<ChannelField, string>> = {};
  for (const field of missing) {
    const spec = channelSpec(field, lang);
    const overwrites = overwritesFor(guild, spec.access);
    const existing = guild.channels.cache.find(candidate => candidate.type === ChannelType.GuildText
      && isSetupLeftover(field, candidate.name, candidate.parentId ? guild.channels.cache.get(candidate.parentId)?.name : undefined));
    const category = existing ? null : await ensureCategory(guild, spec.category, lang);
    const channel = existing ?? (spec.forum
      ? await guild.channels.create({
        name: spec.name, type: ChannelType.GuildForum, topic: spec.topic, parent: category!.id,
        availableTags: boardTagNames(lang).map((name) => ({ name })),
        ...(overwrites ? { permissionOverwrites: overwrites } : {})
      })
      : await guild.channels.create({
        name: spec.name, type: ChannelType.GuildText, topic: spec.topic, parent: category!.id,
        ...(overwrites ? { permissionOverwrites: overwrites } : {})
      }));
    // Save each channel before posting guides so a partial setup remains recoverable.
    await guildService.updateSettings(guildId, { [field]: channel.id });
    if (field === "answerChannelId") forgetAnswerSettings(guild.id);
    if (spec.forum && channel.type === ChannelType.GuildForum) await postBoardGuide(channel, lang).catch((error: unknown) => guidedFor(`<#${channel.id}>`, error));
    if (field === "guideChannelId" && channel.isTextBased()) await ensureBotGuide(channel, lang).catch((error: unknown) => guidedFor(`<#${channel.id}>`, error));
    update[field] = channel.id;
    made.push(`<#${channel.id}>${spec.access === "officers" ? tx(lang, " (officers only)") : spec.access === "leaders" ? tx(lang, " (officers and raid leaders only)") : ""}`);
  }
  if (update.dungeonSignupChannelId) {
    const channel = await guild.channels.fetch(update.dungeonSignupChannelId);
    if (channel?.isTextBased() && "send" in channel) {
      await ensureDungeonSignupGuide(channel, lang).catch((error: unknown) => guidedFor(`<#${channel.id}>`, error));
    }
  }
  if (update.dungeonLeaderboardChannelId) await updateDungeonLeaderboard(guild).catch((error: unknown) => guidedFor(`<#${update.dungeonLeaderboardChannelId}>`, error));
  if (update.coreChannelId) await syncAllCoreRosters(guild, prisma, guildId).catch((error: unknown) => guidedFor(`<#${update.coreChannelId}>`, error));
  const summary = tx(lang, "Configured {channels}. Existing Guilded channels were reused; missing ones were created.", { channels: made.join(", ") });
  return warnings.length ? `${summary}\n⚠️ ${warnings.join(" ")}` : summary;
}

// Tidies channels the bot made earlier (same name as the standard one):
// moves each into its category and resets its permissions to the standard
// set. Channels you picked yourself (any other name) are left alone.
async function organizeChannels(guild: DiscordGuild, guildId: string, lang: Lang): Promise<string> {
  const settings = await guildService.getSettings(guildId);
  if (!settings) return tx(lang, "No settings found.");
  await guild.roles.fetch();
  const tidied: string[] = [];
  const skipped: string[] = [];
  for (const field of ALL_CHANNELS) {
    const channelId = settings[field];
    if (!channelId) continue;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildForum)) continue;
    const spec = channelSpec(field, lang);
    if (!channelNames(field).includes(channel.name)) { skipped.push(`<#${channel.id}>`); continue; }
    const category = await ensureCategory(guild, spec.category, lang);
    const overwrites = overwritesFor(guild, spec.access);
    await channel.edit({ parent: category.id, permissionOverwrites: overwrites ?? [], reason: `${BRAND.name} /setup organize` });
    tidied.push(`<#${channel.id}>`);
  }
  return `${tidied.length ? tx(lang, "Tidied {channels}.", { channels: tidied.join(", ") }) : tx(lang, "Nothing of mine to tidy yet: run \"Create the missing ones for me\" in step 2, 3 or 4 first.")}`
    + `${skipped.length ? ` ${tx(lang, "Left alone (renamed or your own): {channels}.", { channels: skipped.join(", ") })}` : ""}`;
}

// The getting-started guide and ensureBotGuide live in services/bot-messages.ts (the checklist
// checks and updates them there); re-exported for the callers that import them from here.
export { ensureBotGuide };


// ---------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------

export async function executeSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context || !interaction.guild) return;
  const startLang = asLang((await guildService.getSettings(context.guildId))?.language);
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: tx(startLang, "Only server admins or Officers / Guild Masters can run setup. (The server owner always can.)"), ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  const guildId = context.guildId;

  // `status:true` used to reply once with no collector, so its buttons (Create
  // missing channels/roles, Tidy, etc.) were dead — a click did nothing. It
  // now gets the same interactive collector as the full wizard, just starting
  // on the checklist instead of step 1, so fixing what's missing never means
  // walking back through every step.
  let step = interaction.options.getBoolean("status") ? SUMMARY_STEP : 0;
  let note = "";
  await interaction.reply({ ...(await renderStep(step, guild, guildId, note)), ephemeral: true });
  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    time: 15 * 60_000,
    filter: (i) => i.user.id === interaction.user.id
  });
  // The language can change during setup (the first screen, or step 7), so read it fresh.
  const currentLang = async () => asLang((await guildService.getSettings(guildId))?.language);

  // Clicks run one at a time, in the order they arrive. Without this, a
  // double-click (or two clicks close together) would start two overlapping
  // database reads before either had written back, so both could see the
  // same channel as "missing" and create it twice — and whichever finished
  // last would silently overwrite the other's saved channel ids, leaving
  // some channels created in Discord but never recorded as set. Queuing
  // means the second click always reads the first click's finished result.
  let queue: Promise<void> = Promise.resolve();

  async function handleClick(i: MessageComponentInteraction, action: string): Promise<void> {
    if (action === "close") {
      await interaction.editReply({ content: tx(await currentLang(), "Setup closed. Run `/setup start` any time to come back, or `/setup start status:true` for the checklist."), embeds: [], components: [] }).catch(() => undefined);
      collector.stop("closed");
      return;
    }
    try {
      note = "";
      const lang = await currentLang();
      const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
      if (action === "next") step = Math.min(SUMMARY_STEP, step + 1);
      else if (action === "back") step = Math.max(1, step - 1);
      else if (action === "jump-summary") step = SUMMARY_STEP;
      else if (action === "restart") step = 1;
      else {
        if (action === "lang-en" || action === "lang-fr") {
          const chosen = action === "lang-fr" ? "fr" : "en";
          await guildService.updateSettings(guildId, { language: chosen });
          note = tx(chosen, "Language: English for roles, channels and member messages.");
        } else if (action === "create-roles") note = await createMissingRoles(guild, lang);
        else if (action === "create-optional-roles") note = await createOptionalRoles(guild, lang);
        else if (i.isStringSelectMenu() && action === "class-leaders") note = await createClassLeaderRoles(guild, lang, i.values);
        else if (action === "give-gm") {
          const role = guild.roles.cache.find((r) => isPermissionRoleName("guildMaster", r.name));
          const member = await guild.members.fetch(i.user.id);
          if (role) {
            await member.roles.add(role, `${BRAND.name} /setup`);
            note = T("Gave you {role}.", { role: role.name });
          }
        } else if (action === "create-channels") note = await createSectionChannels(guild, guildId, CORE_CHANNELS, lang);
        else if (action === "create-raidteam-channels") note = await createSectionChannels(guild, guildId, RAIDTEAM_CHANNELS, lang);
        else if (action === "create-dungeon-channels") note = await createSectionChannels(guild, guildId, DUNGEON_CHANNELS, lang);
        else if (action === "create-all-channels") note = await createSectionChannels(guild, guildId, ALL_CHANNELS, lang);
        else if (action === "dungeon-guide") {
          const settings = await guildService.getSettings(guildId);
          const channel = settings?.dungeonSignupChannelId
            ? await guild.channels.fetch(settings.dungeonSignupChannelId).catch(() => null)
            : null;
          if (channel?.isTextBased() && "send" in channel) {
            await ensureDungeonSignupGuide(channel, lang);
            note = T("Pinned dungeon signup guide is ready in <#{id}>.", { id: channel.id });
          } else {
            note = T("Set a dungeon signups channel with /setup config channel, then run /dungeon guide again.");
          }
        }
        else if (action === "organize") note = await organizeChannels(guild, guildId, lang);
        else if (i.isStringSelectMenu() && action === "pick-field") {
          const field = i.values[0] as ChannelField | undefined;
          if (field && (ALL_CHANNELS as string[]).includes(field)) pendingField.set(guildId, field);
        } else if (action === "update-messages") {
          const settings = await guildService.getSettings(guildId);
          if (settings) {
            note = await updateBotMessages(guild, settings, lang, {
              craftGuide: async () => {
                if (!settings.craftChannelId) return;
                const forum = await guild.channels.fetch(settings.craftChannelId).catch(() => null);
                if (forum?.type !== ChannelType.GuildForum) return;
                const pinned = (await forum.threads.fetchActive().catch(() => null))?.threads.find((thread) => thread.flags.has("Pinned"));
                const starter = pinned ? await pinned.fetchStarterMessage().catch(() => null) : null;
                if (starter?.editable) { if (starter.content !== craftGuideText(lang)) await starter.edit({ content: craftGuideText(lang) }); }
                else if (!pinned) await postBoardGuide(forum, lang);
              },
              leaderboard: () => updateDungeonLeaderboard(guild),
              rosters: () => ensureAllCoresDiscord(guild, prisma, guildId)
            });
          }
        } else if (action === "lfg-roles") {
          await guild.roles.fetch();
          const created: string[] = [];
          for (const name of Object.values(LFG_ROLE_NAMES)) {
            if (guild.roles.cache.some((role) => role.name.toLowerCase() === name.toLowerCase())) continue;
            await guild.roles.create({ name, mentionable: false, reason: `${BRAND.name} /setup: group finder pings` });
            created.push(name);
          }
          note = created.length
            ? T("Created {roles}. Offer them in the welcome role buttons (step 5) so members can opt in to group finder pings.", { roles: created.join(", ") })
            : T("All LFG ping roles already exist.");
        } else if (i.isChannelSelectMenu() && action === "ch-pick") {
          const field = pendingField.get(guildId);
          const channelId = i.values[0];
          if (field && channelId) {
            await guildService.updateSettings(guildId, { [field]: channelId });
            if (field === "answerChannelId") forgetAnswerSettings(guild.id);
            pendingField.delete(guildId);
            note = T("Saved <#{id}>.", { id: channelId });
            if (field === "coreChannelId") await syncAllCoreRosters(guild, prisma, guildId);
            if (field === "guideChannelId") {
              const channel = await guild.channels.fetch(channelId).catch(() => null);
              if (channel?.isTextBased() && "messages" in channel) await ensureBotGuide(channel, lang);
            }
            if (field === "dungeonSignupChannelId") {
              const channel = await guild.channels.fetch(channelId).catch(() => null);
              if (channel?.isTextBased() && "send" in channel) await ensureDungeonSignupGuide(channel, lang);
            }
          }
        } else if (i.isChannelSelectMenu()) {
          const channelId = i.values[0];
          const field = { "ch-notify": "notifyChannelId", "ch-raid": "raidSignupChannelId", "ch-raidlog": "raidLogChannelId", "ch-log": "logChannelId", "ch-welcome": "welcomeChannelId", "ch-dungeon": "dungeonChannelId", "ch-dungeon-lb": "dungeonLeaderboardChannelId", "ch-dungeon-signup": "dungeonSignupChannelId", "ch-core": "coreChannelId", "ch-readiness": "readinessChannelId", "ch-loot": "lootChannelId", "ch-craft": "craftChannelId" }[action];
          if (channelId && field) {
            await guildService.updateSettings(guildId, { [field]: channelId });
            note = T("Saved <#{id}>.", { id: channelId });
            if (field === "coreChannelId") await syncAllCoreRosters(guild, prisma, guildId);
            if (field === "dungeonLeaderboardChannelId") {
              await guildService.updateSettings(guildId, { dungeonLeaderboardMessageId: null });
              await updateDungeonLeaderboard(guild);
            }
            if (field === "dungeonSignupChannelId") {
              const channel = await guild.channels.fetch(channelId);
              if (channel?.isTextBased() && "send" in channel) await ensureDungeonSignupGuide(channel, lang);
            }
          }
        } else if (i.isRoleSelectMenu() && action === "welcome-roles") {
          await guildService.updateSettings(guildId, { welcomeRoleIds: i.values.slice(0, 5) });
          const blocked = i.values.map((id) => botCanAssign(guild, id)).filter((role) => role && !role.botCanAssign).map((role) => role?.name);
          note = i.values.length
            ? `${T("Welcome buttons: {roles}.", { roles: i.values.map((id) => `<@&${id}>`).join(", ") })}${blocked.length ? ` ${T("**My role is below {roles}**, so I can't hand those out yet: Server Settings → Roles, drag my role above them.", { roles: blocked.join(", ") })}` : ""}`
            : T("Removed the role buttons from the welcome message.");
        } else if (i.isStringSelectMenu() && action === "tz") {
          const timezone = i.values[0];
          if (timezone && isValidTimeZone(timezone)) {
            await guildService.updateSettings(guildId, { timezone });
            note = T("Timezone saved: raid times like \"friday 8pm\" now mean 8pm {zone}.", { zone: timezone.replace("_", " ") });
          }
        } else if (i.isStringSelectMenu() && action === "lang") {
          const language = i.values[0] === "fr" ? "fr" : "en";
          await guildService.updateSettings(guildId, { language });
          note = tx(language, "Language: English for roles, channels and member messages.");
        } else if (action.startsWith("delivery-")) {
          const value = action.slice("delivery-".length);
          await guildService.updateSettings(guildId, { welcomeDelivery: value });
          note = value === "DM" ? T("New members get the welcome by private message (the channel is used only if their DMs are closed).")
            : value === "BOTH" ? T("New members get the welcome by private message and in the welcome channel.")
              : T("The welcome is posted in the welcome channel.");
        } else if (action === "welcome-preview") {
          const current = await guildService.getSettings(guildId);
          const member = await guild.members.fetch(i.user.id);
          const sent = current ? await sendWelcome(guild, member, current) : { dm: false, channel: false };
          note = sent.dm || sent.channel
            ? T("Preview sent{where}. Try the buttons!", { where: `${sent.dm ? T(" to your DMs") : ""}${sent.dm && sent.channel ? T(" and") : ""}${sent.channel ? T(" in the welcome channel") : ""}` })
            : T("Nothing was sent: pick a welcome channel, or choose Private message. (If you chose DM, your DMs from server members may be off.)");
        } else if (action === "autoroles-off") {
          await guildService.updateSettings(guildId, { applicantRoleId: null, memberRoleId: null });
          note = T("Automatic Applicant / Member roles are off.");
        } else if (i.isRoleSelectMenu()) {
          const roleId = i.values[0];
          const field = action === "role-applicant" ? "applicantRoleId" : "memberRoleId";
          if (roleId) {
            await guildService.updateSettings(guildId, { [field]: roleId });
            const check = botCanAssign(guild, roleId);
            note = check?.botCanAssign ? T("Saved <@&{id}>.", { id: roleId }) : T("Saved <@&{id}>, but **my role is below it** so I can't hand it out yet: Server Settings → Roles, drag my role above it.", { id: roleId });
          }
        } else if (action === "welcome-off") {
          await guildService.updateSettings(guildId, { welcomeChannelId: null, welcomeDelivery: "CHANNEL", welcomeRoleIds: [] });
          note = T("Welcome message is off.");
        } else if (action === "epgp-recommended") {
          await guildService.updateSettings(guildId, RECOMMENDED_EPGP);
          note = T("Recommended EPGP values saved.");
        } else if (action === "reminders") {
          const settings = await guildService.getSettings(guildId);
          const on = (settings?.raidReminderMinutes ?? 0) > 0;
          await guildService.updateSettings(guildId, { raidReminderMinutes: on ? 0 : 60 });
          note = on ? T("Raid reminders off.") : T("Raid reminders on: signed-up players get pinged 60 minutes before start.");
        } else if (action === "auto-import") {
          const current = await guildService.getSettings(guildId);
          await guildService.updateSettings(guildId, { autoApplyImports: !current?.autoApplyImports });
          note = current?.autoApplyImports
            ? T("Auto-apply is off: officers apply uploads with /import apply.")
            : T("Auto-apply is on: what the companion uploads is applied and announced right away.");
        } else if (action === "weekly") {
          const settings = await guildService.getSettings(guildId);
          await guildService.updateSettings(guildId, { weeklyReportEnabled: !settings?.weeklyReportEnabled });
          note = settings?.weeklyReportEnabled ? T("Weekly report off.") : T("Weekly report on (posts in the announcements channel).");
        } else if (action === "post-guide") {
          const settings = await guildService.getSettings(guildId);
          const channel = settings?.notifyChannelId ? await guild.channels.fetch(settings.notifyChannelId).catch(() => null) : null;
          if (channel?.isTextBased()) {
            await channel.send({ embeds: [gettingStartedPost(asLang(settings?.language))] });
            note = T("Posted the getting-started guide in <#{id}>. Pin it there so new members see it.", { id: channel.id });
          } else note = T("Set an announcements channel first (step 2).");
        }
      }
      await interaction.editReply(await renderStep(step, guild, guildId, note));
    } catch (error) {
      const lang = await currentLang().catch(() => "en" as Lang);
      const text = error instanceof Error ? error.message : String(error);
      note = `⚠️ ${tx(lang, "That didn't work: {error}", { error: text })}${/Missing Permissions/i.test(text) ? ` — ${tx(lang, "I need the Manage Roles / Manage Channels permissions (or Administrator).")}` : ""}`;
      await interaction.editReply(await renderStep(step, guild, guildId, note)).catch(() => undefined);
    }
  }

  collector.on("collect", (i: MessageComponentInteraction) => {
    const action = i.customId.replace("setup:", "");
    // Ack the click immediately (Discord allows 3 seconds) regardless of how
    // long this click's turn in the queue takes to come up; the visible
    // message update always goes through `interaction.editReply` below, once
    // it's this click's turn.
    void i.deferUpdate().catch(() => undefined);
    queue = queue.then(() => handleClick(i, action)).catch((error: unknown) => console.error("Setup click failed", error));
  });

  collector.on("end", async (_collected, reason) => {
    if (reason === "closed") return;
    await interaction.editReply({ content: tx(await currentLang().catch(() => "en" as Lang), "Setup timed out after 15 minutes — your choices are saved. Run `/setup start` to continue."), embeds: [], components: [] }).catch(() => undefined);
  });
}

// Posted in the server's system channel when the bot is added, so whoever
// invited it knows the one command to run.
export async function greetNewGuild(guild: DiscordGuild): Promise<void> {
  const channel = guild.systemChannel;
  if (!channel) return;
  await channel.send({
    embeds: [new EmbedBuilder().setTitle(`${BRAND.emoji} Thanks for adding ${BRAND.name}!`).setColor(BRAND.color)
      // The server's language is not chosen yet at this point, so both languages.
      .setDescription("A server admin should run **`/setup start`** now — it's a 2-minute, click-through guide (no typing). You pick English or Français on its first screen.\n\n"
        + "Un administrateur devrait lancer **`/setup start`** maintenant — un guide de 2 minutes, avec des boutons (rien à écrire). Vous choisirez English ou Français sur le premier écran.\n\n`/help`")]
  }).catch(() => undefined);
}

// Printed in the bot's console window at startup, so whoever runs the bot
// sees right away if setup isn't finished.
export async function logSetupStatus(guilds: Iterable<DiscordGuild>): Promise<void> {
  for (const guild of guilds) {
    try {
      const record = await guildService.ensureGuild(guild.id, guild.name);
      const settings = await guildService.getSettings(record.id);
      if (!settings) continue;
      const checks = setupChecks(await gatherFacts(guild, record.id, settings));
      const missing = checks.filter((check) => !check.ok && !check.optional);
      if (missing.length === 0) console.info(`Setup complete for "${guild.name}".`);
      else console.warn(`Setup not finished for "${guild.name}" (${missing.map((check) => check.label).join("; ")}). Run /setup start in Discord.`);
    } catch (error) {
      console.warn(`Could not check setup for "${guild.name}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
