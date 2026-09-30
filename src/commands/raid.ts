import { serializeRaidPosts, syncRaidPosts } from "../services/raid-signup-posts.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "../services/discord-jobs.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type Guild as DiscordGuild, type GuildMember
} from "discord.js";
import { RaidAttendanceStatus, RaidBossStatus, RaidRole } from "@prisma/client";
import { prisma } from "../database.js";
import { notifications, notify } from "../services/notify.js";
import { showEpProposal } from "./ep-award.js";
import { postRaidReport, raidReportEmbed } from "./raid-report.js";
import { buildRaidReport } from "../services/raid-report.js";
import { bossProgress } from "../services/progress.js";
import { parseRaidTime } from "../services/raid-time.js";
import { asLang, t, type Lang } from "../i18n.js";
import { createRaidService, type SignupAvailability } from "../services/raid.js";
import { coreSpotLabel, createRaidCoreService } from "../services/raid-core.js";
import { buildSignupEmbed, openSpots } from "../services/signup-embed.js";
import { hasPermission } from "../permissions.js";
import { guildService, requireGuildContext } from "./context.js";
import { BRAND } from "../brand.js";

const raidService = createRaidService(prisma);

const roleLabel: Record<RaidRole, string> = { TANK: "Tank", HEALER: "Healer", DPS: "DPS" };

export const raidCommand = new SlashCommandBuilder()
  .setName("raid")
  .setDescription("Manage guild raids and attendance.")
  .addSubcommand((sub) => sub.setName("create").setDescription("Create a raid.")
    .addStringOption((o) => o.setName("title").setDescription("Raid title (pick a past one, or type)").setMinLength(3).setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("time").setDescription("When (pick a suggestion, or type e.g. friday 8pm, 2026-10-03 20:00)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("description").setDescription("Optional description"))
    .addStringOption((o) => o.setName("bosses").setDescription("Comma-separated boss names"))
    .addStringOption((o) => o.setName("core").setDescription("Raid core: its members get signup priority").setAutocomplete(true))
    .addBooleanOption((o) => o.setName("weekly").setDescription("Repeat every week: ending this raid creates the next one"))
    .addIntegerOption((o) => o.setName("tanks").setDescription("Tank slot cap").setMinValue(0))
    .addIntegerOption((o) => o.setName("healers").setDescription("Healer slot cap").setMinValue(0))
    .addIntegerOption((o) => o.setName("dps").setDescription("DPS slot cap").setMinValue(0)))
  .addSubcommand((sub) => sub.setName("progress").setDescription("Guild boss progression: first kills, kill counts, latest kill."))
  .addSubcommand((sub) => sub.setName("report").setDescription("Raid summary: duration, raiders, bosses, EP, loot. Posts it for everyone.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("award-ep").setDescription("Propose EP for a raid from attendance and boss kills; approve with a button.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("note").setDescription("Add an officer note to a raid (general, a boss, or what to improve).")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("text").setDescription("The note").setMaxLength(1000).setRequired(true))
    .addStringOption((o) => o.setName("boss").setDescription("Boss this note is about (optional)")))
  .addSubcommand((sub) => sub.setName("edit").setDescription("Edit a planned raid.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("title").setDescription("New title"))
    .addStringOption((o) => o.setName("time").setDescription("New time, e.g. friday 8pm"))
    .addStringOption((o) => o.setName("description").setDescription("New description"))
    .addIntegerOption((o) => o.setName("tanks").setDescription("New tank slot cap").setMinValue(0))
    .addIntegerOption((o) => o.setName("healers").setDescription("New healer slot cap").setMinValue(0))
    .addIntegerOption((o) => o.setName("dps").setDescription("New DPS slot cap").setMinValue(0)))
  .addSubcommand((sub) => sub.setName("fill").setDescription("Short on players? Post the open spots for the whole guild and ping the core's bench.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("message").setDescription("Optional extra text").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel a raid.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("signup").setDescription("Sign up for a raid.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("role").setDescription("Your role for this raid").setRequired(true)
      .addChoices(
        { name: "Tank", value: "TANK" },
        { name: "Healer", value: "HEALER" },
        { name: "DPS", value: "DPS" }
      ))
    .addStringOption((o) => o.setName("availability").setDescription("Available (default) or Maybe")
      .addChoices(
        { name: "Available", value: "AVAILABLE" },
        { name: "Maybe", value: "MAYBE" }
      )))
  .addSubcommand((sub) => sub.setName("cancel-signup").setDescription("Cancel your raid signup.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("status").setDescription("View raid status.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("roster").setDescription("View the raid roster.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("start").setDescription("Start a raid.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("end").setDescription("End a raid.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("boss").setDescription("Mark a raid boss's kill status.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("name").setDescription("Boss name").setRequired(true))
    .addStringOption((o) => o.setName("status").setDescription("Boss status").setRequired(true)
      .addChoices(
        { name: "Killed", value: "KILLED" },
        { name: "Pending", value: "PENDING" }
      )))
  .addSubcommand((sub) => sub.setName("attendance").setDescription("Record a member's raid attendance.")
    .addStringOption((o) => o.setName("raid").setDescription("Raid (start typing its name)").setAutocomplete(true).setRequired(true))
    .addUserOption((o) => o.setName("player").setDescription("Member to record").setRequired(true))
    .addStringOption((o) => o.setName("status").setDescription("Attendance status").setRequired(true)
      .addChoices(
        { name: "Present", value: "PRESENT" },
        { name: "Late", value: "LATE" },
        { name: "Benched (full credit, attendance EP only)", value: "BENCHED" },
        { name: "Absent", value: "ABSENT" }
      ))
    .addStringOption((o) => o.setName("notes").setDescription("Optional notes")));

function requireRaidLeader(interaction: ChatInputCommandInteraction): void {
  if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "raidLeader")) {
    throw new Error("Only Raid Leaders, Officers, Guild Masters, or Administrators can manage raids.");
  }
}

// "friday 8pm" etc. in the guild's timezone (see services/raid-time.ts).
async function readRaidTime(guildId: string, value: string): Promise<Date> {
  const settings = await guildService.getSettings(guildId);
  return parseRaidTime(value, settings?.timezone ?? "America/Toronto");
}

// Buttons on the live signup post, so signing up needs no command. Only
// shown while the raid is still planned.
export const RAID_SIGNUP_PREFIX = "raidsignup:";
function signupButtons(raidId: string, status: string, lang: Lang) {
  if (status !== "PLANNED") return [];
  const b = (action: string, label: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(`${RAID_SIGNUP_PREFIX}${raidId}:${action}`).setLabel(label).setStyle(style);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    b("TANK", t(lang, "button.tank"), ButtonStyle.Primary),
    b("HEALER", t(lang, "button.healer"), ButtonStyle.Success),
    b("DPS", t(lang, "button.dps"), ButtonStyle.Danger),
    b("MAYBE", t(lang, "button.maybe"), ButtonStyle.Secondary),
    b("CANCEL", t(lang, "button.cancel"), ButtonStyle.Secondary)
  )];
}

const failedSignupSyncs = new Map<string, Set<string>>();
export const pendingSignupRaidIds = (guildId: string): string[] => [...(failedSignupSyncs.get(guildId) ?? [])];

export async function syncSignupEmbed(discordGuild: DiscordGuild, guildId: string, raidId: string, delivery = false): Promise<void> {
  if (!delivery) {
    const job = await enqueueDiscordJob(prisma, guildId, `raid:${raidId}`, "RAID_POST", { raidId });
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return;
  }
  await serializeRaidPosts(`${guildId}:${raidId}`, async () => {
  try {
    const raid = await raidService.getStatus(raidId, guildId);
    const lang = asLang((await guildService.getSettings(guildId))?.language);
    const everyone = await raidService.signups(raidId, guildId);
    const core = raid.coreId
      ? await prisma.raidCore.findUnique({ where: { id: raid.coreId }, select: { name: true, members: { select: { memberId: true, role: true, bench: true, member: { select: { displayName: true } }, character: { select: { name: true } } } } } })
      : null;
    // A core raid shows the character each core member brings to this core ("Kevin · Thrall").
    const coreLabel = new Map(core?.members.map((m) => [m.memberId, coreSpotLabel(m)]) ?? []);
    const embed = buildSignupEmbed({
      lang, raid,
      signups: everyone.map((signup) => ({ memberId: signup.memberId, displayName: coreLabel.get(signup.memberId) ?? signup.member.displayName, role: signup.role, status: signup.status })),
      core: core ? { name: core.name, members: core.members.map((m) => ({ memberId: m.memberId, displayName: coreSpotLabel(m), role: m.role, bench: m.bench })) } : undefined
    });

    const settings = await guildService.getSettings(guildId);
    const coreChannel = raid.coreId ? (await prisma.raidCore.findFirst({ where: { id: raid.coreId, guildId }, select: { signupChannelId: true } }))?.signupChannelId ?? null : null;
    await syncRaidPosts(discordGuild, prisma, raid, settings?.raidSignupChannelId ?? null, coreChannel,
      { embeds: [embed], components: signupButtons(raid.id, raid.status, lang), allowedMentions: { parse: [] } });
    failedSignupSyncs.get(guildId)?.delete(raidId);
  } catch (error) {
    if (!failedSignupSyncs.has(guildId)) failedSignupSyncs.set(guildId, new Set());
    failedSignupSyncs.get(guildId)!.add(raidId);
    console.error("Failed to sync raid signup embed", error);
    throw error;
  }
  });
}

// DMs players moved off the waitlist. Best effort: closed DMs are ignored,
// and the updated signup embed shows the change anyway.
async function tellPromoted(
  interaction: { client: ChatInputCommandInteraction["client"] },
  promoted: Array<{ raidId: string; role: RaidRole; member: { discordUserId: string } }>
): Promise<void> {
  for (const signup of promoted) {
    const raid = await prisma.raid.findUnique({
      where: { id: signup.raidId },
      select: { title: true, scheduledAt: true, guild: { select: { settings: { select: { language: true } } } } }
    });
    const lang = asLang(raid?.guild.settings?.language);
    await interaction.client.users.send(signup.member.discordUserId, t(lang, "dm.promoted", {
      role: t(lang, `role.${signup.role}` as const),
      raid: raid?.title ?? "raid",
      when: raid ? `<t:${Math.floor(raid.scheduledAt.getTime() / 1000)}:F>` : ""
    })).catch(() => undefined);
  }
}

// Tells a player a core member took their slot (they're first on the waitlist).
async function tellBumped(
  client: ChatInputCommandInteraction["client"],
  bumped: { raidId: string; role: RaidRole; member: { discordUserId: string } } | null
): Promise<void> {
  if (!bumped) return;
  const raid = await prisma.raid.findUnique({
    where: { id: bumped.raidId },
    select: { title: true, guild: { select: { settings: { select: { language: true } } } } }
  });
  const lang = asLang(raid?.guild.settings?.language);
  await client.users.send(bumped.member.discordUserId, t(lang, "dm.bumped", {
    role: t(lang, `role.${bumped.role}` as const), raid: raid?.title ?? "raid"
  })).catch(() => undefined);
}

// When an officer doesn't pass core:, guess it instead of leaving the raid core-less (which
// means no one gets signup priority and /guilded drop can't tell which loot system to use).
// Weekly repeats already carry their core forward (raid.ts service); this covers the first
// time a title is used. Two signals, in order, both unambiguous enough to trust without asking:
// the same title was linked to a core before, or there is only one core to begin with.
async function inferCoreId(guildId: string, title: string): Promise<string | null> {
  const previous = await prisma.raid.findFirst({
    where: { guildId, title: { equals: title.trim(), mode: "insensitive" }, coreId: { not: null }, isTest: false },
    orderBy: { scheduledAt: "desc" },
    select: { coreId: true }
  });
  if (previous?.coreId) return previous.coreId;
  const cores = await prisma.raidCore.findMany({ where: { guildId }, select: { id: true }, take: 2 });
  return cores.length === 1 ? (cores[0]?.id ?? null) : null;
}

export async function executeRaid(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();
  const management = ["create", "edit", "cancel", "start", "end", "attendance", "boss", "note", "award-ep", "fill"].includes(subcommand);
  if (management) requireRaidLeader(interaction);

  if (subcommand === "create") {
    const description = interaction.options.getString("description");
    const bosses = interaction.options.getString("bosses");
    const tanks = interaction.options.getInteger("tanks");
    const healers = interaction.options.getInteger("healers");
    const dps = interaction.options.getInteger("dps");
    const title = interaction.options.getString("title", true);
    const coreName = interaction.options.getString("core");
    let core = coreName ? await createRaidCoreService(prisma).byIdOrName(context.guildId, coreName) : null;
    let coreGuessed = false;
    if (!core) {
      const inferredId = await inferCoreId(context.guildId, title);
      if (inferredId) {
        core = await createRaidCoreService(prisma).byIdOrName(context.guildId, inferredId);
        coreGuessed = true;
      }
    }
    const raid = await raidService.create({
      ...(core ? { coreId: core.id } : {}),
      guildId: context.guildId,
      title,
      scheduledAt: await readRaidTime(context.guildId, interaction.options.getString("time", true)),
      createdBy: interaction.user.id,
      ...(interaction.options.getBoolean("weekly") ? { repeatWeekly: true } : {}),
      ...(description === null ? {} : { description }),
      ...(bosses === null ? {} : { bosses: bosses.split(",") }),
      ...(tanks === null ? {} : { tankLimit: tanks }),
      ...(healers === null ? {} : { healerLimit: healers }),
      ...(dps === null ? {} : { dpsLimit: dps })
    });
    if (interaction.guild) await syncSignupEmbed(interaction.guild, context.guildId, raid.id);
    // Discord shows <t:...> in each reader's own timezone, so this doubles as a check.
    const when = Math.floor(raid.scheduledAt.getTime() / 1000);
    const coreNote = core
      ? ` for the **${core.name}** core (its ${core.members.length} members get signup priority)${coreGuessed ? " — guessed from your other raids/cores, pass core: to change it" : ""}`
      : "";
    await interaction.reply({ content: `Created raid **${raid.title}** for <t:${when}:F> (<t:${when}:R>)${coreNote}. If that time looks wrong, fix it with \`/raid edit\`.`, ephemeral: true });
    return;
  }

  if (subcommand === "progress") {
    const progress = await bossProgress(prisma, context.guildId);
    const day = (date: Date) => `<t:${Math.floor(date.getTime() / 1000)}:d>`;
    const lines = progress.map((boss) =>
      `**${boss.boss}** - first kill ${day(boss.firstKill)} (${boss.firstKillRaid}), ${boss.kills} kill${boss.kills === 1 ? "" : "s"}, latest ${day(boss.lastKill)}`);
    let text = "";
    for (const line of lines) {
      if (text.length + line.length > 3900) break;
      text += `${line}\n`;
    }
    await interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${BRAND.emoji} ${BRAND.name} progression`)
      .setDescription(text || "No boss kills recorded yet. Mark kills with /raid boss.")
      .setFooter({ text: `${progress.length} boss(es) killed` })] });
    return;
  }

  const raidId = interaction.options.getString("raid", true);
  if (subcommand === "signup") {
    const role = interaction.options.getString("role", true) as RaidRole;
    const availability = (interaction.options.getString("availability") ?? "AVAILABLE") as SignupAvailability;
    const signup = await raidService.signup(raidId, context.guildId, context.memberId, role, availability);
    await tellBumped(interaction.client, signup.bumped);
    if (interaction.guild) await syncSignupEmbed(interaction.guild, context.guildId, raidId);
    const replies: Record<string, string> = {
      SIGNED_UP: `You are signed up as ${roleLabel[role]}.`,
      MAYBE: `You are marked as **maybe** (${roleLabel[role]}). Sign up again as Available to take a slot.`,
      WAITLISTED: `${roleLabel[role]} slots are full, so you're on the **waitlist**. You'll get a DM if a slot opens.`
    };
    const lang = asLang((await guildService.getSettings(context.guildId))?.language);
    await interaction.reply({ content: (replies[signup.status] ?? "Signup recorded.") + await clashNote(raidId, context.guildId, context.memberId, lang), ephemeral: true });
    return;
  }
  if (subcommand === "fill") {
    await postFillCall(interaction, context.guildId, raidId);
    return;
  }
  if (subcommand === "cancel-signup") {
    const { promoted } = await raidService.cancelSignup(raidId, context.guildId, context.memberId);
    if (interaction.guild) await syncSignupEmbed(interaction.guild, context.guildId, raidId);
    await tellPromoted(interaction, promoted);
    await interaction.reply({ content: "Your raid signup was cancelled.", ephemeral: true });
    return;
  }
  if (subcommand === "report") {
    const report = await buildRaidReport(prisma, context.guildId, raidId);
    const lang = asLang((await guildService.getSettings(context.guildId))?.language);
    const raid = await prisma.raid.findFirst({ where: { id: raidId, guildId: context.guildId }, select: { coreId: true } });
    if (raid?.coreId) {
      await interaction.deferReply({ ephemeral: true });
      const posted = await postRaidReport(interaction.guild, context.guildId, raidId);
      await interaction.editReply({ content: posted ? "Posted in this core's raid reports channel." : "No report channel is configured for this core." });
    } else await interaction.reply({ embeds: [raidReportEmbed(report, lang)], allowedMentions: { parse: [] } });
    return;
  }
  if (subcommand === "award-ep") {
    await showEpProposal(interaction, context.guildId, raidId, "Proposed EP (nothing is recorded until you approve):");
    return;
  }
  if (subcommand === "note") {
    const note = await raidService.addNote(raidId, context.guildId, interaction.options.getString("text", true), interaction.user.id,
      interaction.options.getString("boss") ?? undefined);
    await interaction.reply({ content: `Note added${note.bossName ? ` for **${note.bossName}**` : ""}. It shows in \`/raid status\`.`, ephemeral: true });
    return;
  }
  if (subcommand === "status") {
    const raid = await raidService.getStatus(raidId, context.guildId);
    const bosses = raid.bosses.length ? raid.bosses.map((boss) => `${boss.status === "KILLED" ? "✅" : "⬜"} ${boss.name}`).join("\n") : "No bosses recorded.";
    // Notes are officer-written; only raid leaders see them.
    const canSeeNotes = !!interaction.member && hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "raidLeader");
    const notes = canSeeNotes && raid.notes.length
      ? `\n\n**Notes**\n${raid.notes.map((note) => `• ${note.bossName ? `[${note.bossName}] ` : ""}${note.body}`).join("\n")}`
      : "";
    const text = `**${raid.title}** — ${raid.status}\nStart: <t:${Math.floor(raid.scheduledAt.getTime() / 1000)}:F>\nSignups: ${raid._count.signups}\nAttendance records: ${raid._count.attendance}\n${bosses}${notes}`;
    await interaction.reply({ content: text.length > 1950 ? `${text.slice(0, 1940)}…` : text, ephemeral: true });
    return;
  }
  if (subcommand === "roster") {
    const roster = await raidService.roster(raidId, context.guildId);
    await interaction.reply({ content: roster.length ? roster.map((signup) => `• ${signup.member.displayName} (<@${signup.member.discordUserId}>) — ${roleLabel[signup.role]}`).join("\n") : "No members are signed up.", ephemeral: true });
    return;
  }
  if (subcommand === "edit") {
    const title = interaction.options.getString("title");
    const time = interaction.options.getString("time");
    const description = interaction.options.getString("description");
    const tanks = interaction.options.getInteger("tanks");
    const healers = interaction.options.getInteger("healers");
    const dps = interaction.options.getInteger("dps");
    const raid = await raidService.edit(raidId, context.guildId, {
      ...(title === null ? {} : { title }),
      ...(time === null ? {} : { scheduledAt: await readRaidTime(context.guildId, time) }),
      ...(description === null ? {} : { description }),
      ...(tanks === null ? {} : { tankLimit: tanks }),
      ...(healers === null ? {} : { healerLimit: healers }),
      ...(dps === null ? {} : { dpsLimit: dps })
    });
    if (interaction.guild) await syncSignupEmbed(interaction.guild, context.guildId, raidId);
    await tellPromoted(interaction, raid.promoted);
    await interaction.reply({
      content: `Updated raid **${raid.title}**.${raid.promoted.length ? ` Moved ${raid.promoted.length} player(s) off the waitlist.` : ""}`,
      ephemeral: true
    });
    return;
  }
  if (subcommand === "cancel") {
    const raid = await raidService.cancel(raidId, context.guildId);
    if (interaction.guild) await syncSignupEmbed(interaction.guild, context.guildId, raidId);
    await interaction.reply({ content: `Cancelled raid **${raid.title}**.`, ephemeral: true });
    return;
  }
  if (subcommand === "start" || subcommand === "end") {
    const raid = subcommand === "start"
      ? await raidService.start(raidId, context.guildId)
      : await raidService.end(raidId, context.guildId);
    if (interaction.guild) await syncSignupEmbed(interaction.guild, context.guildId, raidId);
    if (subcommand === "end") {
      // Ending a raid shows the proposed EP with Approve / Cancel buttons.
      await showEpProposal(interaction, context.guildId, raidId, `Ended raid **${raid.title}**.`);
    } else {
      await interaction.reply({ content: `Started raid **${raid.title}**.`, ephemeral: true });
    }
    await notify(interaction.guild, subcommand === "start" ? notifications.raidStarted(raid.title) : notifications.raidEnded(raid.title));
    if (subcommand === "end") {
      const next = await raidService.createNextRepeat(raidId, context.guildId);
      if (next) {
        if (interaction.guild) await syncSignupEmbed(interaction.guild, context.guildId, next.id);
        await interaction.followUp({ content: `Weekly raid: the next **${next.title}** is set for <t:${Math.floor(next.scheduledAt.getTime() / 1000)}:F>. Cancel it with /raid cancel if you skip a week.`, ephemeral: true }).catch(() => undefined);
      }
    }
    return;
  }
  if (subcommand === "boss") {
    const bossName = interaction.options.getString("name", true);
    const status = interaction.options.getString("status", true) as RaidBossStatus;
    const boss = await prisma.raidBoss.findFirst({ where: { raidId, name: { equals: bossName, mode: "insensitive" } } });
    if (!boss) throw new Error(`Boss "${bossName}" was not found for this raid.`);
    const updated = await raidService.setBossStatus(raidId, context.guildId, boss.id, status);
    await interaction.reply({ content: `Marked **${updated.name}** as ${updated.status}.`, ephemeral: true });
    if (updated.status === "KILLED") {
      const raid = await prisma.raid.findUnique({ where: { id: raidId }, select: { title: true } });
      await notify(interaction.guild, notifications.bossKilled(updated.name, raid?.title ?? "raid"));
    }
    return;
  }
  const player = interaction.options.getUser("player", true);
  const target = await guildService.ensureMember(context.guildId, player.id, player.username);
  const attendance = await raidService.recordAttendance({
    raidId,
    guildId: context.guildId,
    memberId: target.id,
    status: interaction.options.getString("status", true) as RaidAttendanceStatus,
    recordedBy: interaction.user.id,
    ...(interaction.options.getString("notes") === null ? {} : { notes: interaction.options.getString("notes", true) })
  });
  await interaction.reply({ content: `Recorded **${attendance.status}** attendance for ${player.username}.`, ephemeral: true });
}

// /raid fill: a call for players in the guild's shared raid signup channel (everyone reads it),
// with the free slots, the core members still missing and a link to the signup post. The core's
// bench (its replacements) is pinged; nobody else is.
async function postFillCall(interaction: ChatInputCommandInteraction, guildId: string, raidId: string): Promise<void> {
  const raid = await raidService.getStatus(raidId, guildId);
  if (raid.status !== "PLANNED") throw new Error("Signups are closed for this raid.");
  const settings = await guildService.getSettings(guildId);
  const lang = asLang(settings?.language);
  const everyone = await raidService.signups(raidId, guildId);
  const core = raid.coreId
    ? await prisma.raidCore.findUnique({ where: { id: raid.coreId }, select: { name: true, members: { select: { memberId: true, bench: true, member: { select: { discordUserId: true } } } } } })
    : null;
  const answered = new Set(everyone.map((signup) => signup.memberId));
  const free = openSpots({ TANK: raid.tankLimit, HEALER: raid.healerLimit, DPS: raid.dpsLimit }, everyone);
  const missing = core?.members.filter((m) => !m.bench && !answered.has(m.memberId)).length ?? 0;
  const bench = core?.members.filter((m) => m.bench && !answered.has(m.memberId)).map((m) => m.member.discordUserId) ?? [];
  if (!free.length && !missing && raid.tankLimit !== null && raid.healerLimit !== null && raid.dpsLimit !== null) {
    throw new Error("Every slot of this raid is taken: no call needed.");
  }
  const when = Math.floor(raid.scheduledAt.getTime() / 1000);
  const spots = free.length
    ? free.map((spot) => `${spot.open} ${t(lang, `role.${spot.role}` as const)}`).join(" · ")
    : t(lang, "fill.any");
  const link = raid.signupChannelId && raid.signupMessageId
    ? `https://discord.com/channels/${interaction.guildId}/${raid.signupChannelId}/${raid.signupMessageId}`
    : null;
  const extra = interaction.options.getString("message");
  const lines = [
    t(lang, "fill.title", { raid: raid.title, core: core ? ` (${core.name})` : "", time: `<t:${when}:F>`, relative: `<t:${when}:R>` }),
    t(lang, "fill.spots", { spots }),
    ...(missing ? [t(lang, "fill.missing", { count: missing })] : []),
    ...(extra ? [extra] : []),
    link ? t(lang, "fill.link", { link }) : t(lang, "fill.command"),
    ...(bench.length ? [`${t(lang, "fill.bench")} ${bench.map((id) => `<@${id}>`).join(" ")}`] : [])
  ];
  // The guild's shared signup channel (read by everyone); else where the command was used.
  const target = settings?.raidSignupChannelId ? await interaction.guild?.channels.fetch(settings.raidSignupChannelId).catch(() => null) : null;
  const channel = target?.isTextBased() ? target : interaction.channel;
  if (!channel?.isSendable()) throw new Error("I can't post in the raid signup channel. Check my permissions there.");
  await channel.send({ content: lines.join("\n").slice(0, 1900), allowedMentions: { users: bench.slice(0, 40), parse: [] } });
  await interaction.reply({ content: `Posted the call for players in <#${channel.id}>${bench.length ? ` and pinged ${bench.length} bench player(s)` : ""}.`, ephemeral: true });
}

// A warning added to a signup reply when the member is also down for another raid at about the
// same time (two cores with overlapping raid nights). Empty when there is none.
async function clashNote(raidId: string, guildId: string, memberId: string, lang: Lang): Promise<string> {
  const clashes = await raidService.clashingSignups(raidId, guildId, memberId).catch(() => []);
  return clashes.map((entry) => `\n${t(lang, "reply.clash", { raid: entry.raid.title, time: `<t:${Math.floor(entry.raid.scheduledAt.getTime() / 1000)}:f>` })}`).join("");
}

// Clicks on the signup post's buttons. Maybe keeps your current role (DPS if
// you had none); Can't come cancels, which can move a waitlisted player up.
export async function handleRaidSignupButton(interaction: ButtonInteraction): Promise<void> {
  const [raidId, action] = interaction.customId.slice(RAID_SIGNUP_PREFIX.length).split(":");
  if (!interaction.guild || !raidId || !action) return;
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const member = await guildService.ensureMember(guild.id, interaction.user.id,
    (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
  const lang = asLang((await guildService.getSettings(guild.id))?.language);
  let content: string;
  if (action === "CANCEL") {
    const existing = await prisma.raidSignup.findUnique({ where: { raidId_memberId: { raidId, memberId: member.id } } });
    if (!existing || existing.status === "CANCELLED") {
      content = t(lang, "reply.notSignedUp");
    } else {
      const { promoted } = await raidService.cancelSignup(raidId, guild.id, member.id);
      await tellPromoted(interaction, promoted);
      content = t(lang, "reply.cancelled");
    }
  } else {
    const existing = await prisma.raidSignup.findUnique({ where: { raidId_memberId: { raidId, memberId: member.id } } });
    const role = (action === "MAYBE" ? existing?.role ?? "DPS" : action) as RaidRole;
    const signup = await raidService.signup(raidId, guild.id, member.id, role, action === "MAYBE" ? "MAYBE" : "AVAILABLE");
    await tellBumped(interaction.client, signup.bumped);
    const roleText = t(lang, `role.${role}` as const);
    const replies: Record<string, string> = {
      SIGNED_UP: t(lang, "reply.signedUp", { role: roleText }),
      MAYBE: t(lang, "reply.maybe", { role: roleText }),
      WAITLISTED: t(lang, "reply.waitlisted", { role: roleText })
    };
    content = (replies[signup.status] ?? "Signup saved.") + await clashNote(raidId, guild.id, member.id, lang);
  }
  await interaction.reply({ content, ephemeral: true });
  await syncSignupEmbed(interaction.guild, guild.id, raidId);
}
