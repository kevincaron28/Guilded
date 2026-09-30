import {
  ChannelType, PermissionFlagsBits,
  type Guild as DiscordGuild, type OverwriteResolvable
} from "discord.js";
import type { PrismaClient, RaidCore } from "@prisma/client";
import { isPermissionRoleName, type Permission } from "../permissions.js";
import { BRAND } from "../brand.js";

// A raid core's own Discord role and channels.
//
// Role: named after the core, given by the bot to everyone in the core (main roster, bench and
// trial) and taken off when they leave it. Kept in step by syncCoreRole, which runs with every
// roster refresh (so adding, removing, trial, approve, /core add|remove and /core edit all
// follow without their own code).
//
// Channels (made automatically when a core is created, since 5.0; "Create channels" in /core
// edit and "Update bot messages" in /setup fill in what is missing): a category named after
// the core with
//   #<core>-roster   the core's roster message    visible to the guild, only the bot posts
//   #<core>-signups  the core's raid signup posts visible to the guild, only the bot posts
//   #<core>-chat     the core's own chat          core role + leadership only
//   🔊 <core>        voice                        core role + leadership only
// When the core is deleted they are archived (archiveCoreDiscord): the text channels move to a
// read-only "Archived cores" category so the history stays, the voice channel and the empty
// category go, and the role is renamed "<core> (archived)" so former members can still read.
// If the bot lacks Manage Roles / Manage Channels the core still works with the shared channels.
//
// "Visible to the guild": every role the bot knows as a guild role (member role, applicant role,
// welcome roles, leadership and class leaders, every core's role) can read them, so anyone can
// see a core's roster and sign up to fill a raid night. On a server that hides channels from
// @everyone that is who sees them; on an open server @everyone reads them too.

type Db = Pick<PrismaClient, "raidCore" | "raidCoreMember"> & Partial<Pick<PrismaClient, "guildSettings">>;
type CoreLike = Pick<RaidCore, "id" | "name" | "roleId" | "categoryId" | "rosterChannelId" | "signupChannelId" | "lootChannelId" | "raidLogChannelId" | "chatChannelId" | "voiceChannelId">;

const LEADERSHIP: Permission[] = ["guildMaster", "officer", "raidLeader"];

// "Tuesday MC" -> "tuesday-mc" (Discord text channel names are lower case, no spaces).
export function coreSlug(name: string): string {
  const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "core";
}

export function coreChannelNames(name: string) {
  const slug = coreSlug(name);
  return { category: `⚔️ ${name}`.slice(0, 100), roster: `${slug}-roster`, signups: `${slug}-signups`, loot: `${slug}-butin`, reports: `${slug}-rapports`, chat: `${slug}-chat`, voice: `🔊 ${name}`.slice(0, 100) };
}

// Creates the core's role when it has none (or it was deleted). Returns its id, or null when
// Discord refused (the bot needs Manage Roles).
export async function ensureCoreRole(guild: DiscordGuild, database: Db, core: CoreLike): Promise<string | null> {
  await guild.roles.fetch();
  if (core.roleId && guild.roles.cache.has(core.roleId)) return core.roleId;
  const role = await guild.roles.create({ name: core.name.slice(0, 100), mentionable: true, reason: `${BRAND.name}: raid core role` }).catch(() => null);
  if (!role) return null;
  await database.raidCore.update({ where: { id: core.id }, data: { roleId: role.id } });
  return role.id;
}

// Gives the core role to everyone in the core and takes it off everyone else. Returns what
// changed. Never throws (a missing permission must not undo the roster change behind it).
export async function syncCoreRole(guild: DiscordGuild, database: Db, coreId: string): Promise<{ added: number; removed: number }> {
  const result = { added: 0, removed: 0 };
  try {
    const core = await database.raidCore.findUnique({ where: { id: coreId }, include: { members: { include: { member: true } } } });
    if (!core) return result;
    const roleId = await ensureCoreRole(guild, database, core);
    if (!roleId) return result;
    const wanted = new Set(core.members.map((entry) => entry.member.discordUserId));
    // The member cache is kept current by the GuildMembers intent; fetch everyone only when it
    // is incomplete (a fetch per refresh would run into Discord's rate limit).
    const members = guild.members.cache.size >= guild.memberCount ? guild.members.cache : await guild.members.fetch().catch(() => null);
    if (!members) return result;
    for (const member of members.values()) {
      const has = member.roles.cache.has(roleId);
      if (wanted.has(member.id) && !has) {
        if (await member.roles.add(roleId, `${BRAND.name}: joined raid core ${core.name}`).then(() => true, () => false)) result.added++;
      } else if (!wanted.has(member.id) && has) {
        if (await member.roles.remove(roleId, `${BRAND.name}: left raid core ${core.name}`).then(() => true, () => false)) result.removed++;
      }
    }
  } catch (error) {
    console.error("Failed to sync the core role", error);
  }
  return result;
}

const GUILD_ROLES: Permission[] = ["guildMaster", "officer", "raidLeader", "dkpOfficer", "lootLeader", "classLeader"];

// The roles that read every core's roster and signups channels (see the top of this file).
export async function guildViewerRoleIds(guild: DiscordGuild, database: Db, guildId: string): Promise<string[]> {
  const settings = database.guildSettings ? await database.guildSettings.findUnique({ where: { guildId } }).catch(() => null) : null;
  const cores = await database.raidCore.findMany({ where: { guildId }, select: { roleId: true } });
  const ids = new Set<string>([
    ...(settings?.memberRoleId ? [settings.memberRoleId] : []),
    ...(settings?.applicantRoleId ? [settings.applicantRoleId] : []),
    ...(settings?.welcomeRoleIds ?? []),
    ...cores.flatMap((core) => (core.roleId ? [core.roleId] : [])),
    ...guild.roles.cache.filter((role) => GUILD_ROLES.some((permission) => isPermissionRoleName(permission, role.name))).map((role) => role.id)
  ]);
  ids.delete(guild.roles.everyone.id);
  return [...ids].filter((id) => guild.roles.cache.has(id));
}

// True when the server shows channels to @everyone by default (no role needed to read).
const openServer = (guild: DiscordGuild) => guild.roles.everyone.permissions.has(PermissionFlagsBits.ViewChannel);

function overwrites(guild: DiscordGuild, roleId: string, access: "public" | "private", viewers: string[] = []): OverwriteResolvable[] {
  const leaders = guild.roles.cache.filter((role) => LEADERSHIP.some((permission) => isPermissionRoleName(permission, role.name)));
  const me = guild.members.me;
  const list: OverwriteResolvable[] = [];
  if (access === "public") {
    // The guild reads; only the bot (and leadership) posts. Buttons on the bot's posts still work.
    // A server that hides channels from @everyone keeps doing so: its guild roles read them.
    list.push(openServer(guild) || viewers.length === 0
      ? { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] }
      : { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] });
    for (const id of viewers) list.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
  } else {
    list.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
    list.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] });
  }
  for (const role of leaders.values()) {
    list.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] });
  }
  if (me) list.push({ id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.Connect] });
  return list;
}

// Creates what is missing of the core's role, category and four channels (safe to press again:
// existing ones are kept). Returns the names created.
export async function createCoreChannels(guild: DiscordGuild, database: Db, coreId: string): Promise<string[]> {
  const core = await database.raidCore.findUniqueOrThrow({ where: { id: coreId } });
  const roleId = await ensureCoreRole(guild, database, core);
  if (!roleId) throw new Error("I could not create the core's role: give my role \"Manage Roles\" (and \"Manage Channels\").");
  await guild.channels.fetch();
  const names = coreChannelNames(core.name);
  const created: string[] = [];
  const exists = (id: string | null) => !!id && guild.channels.cache.has(id);

  let categoryId = core.categoryId;
  if (!exists(categoryId)) {
    const category = await guild.channels.create({ name: names.category, type: ChannelType.GuildCategory, reason: `${BRAND.name}: raid core channels` });
    categoryId = category.id;
    created.push(names.category);
  }
  // Who reads the public channels; a failed lookup only means @everyone reads them, as before.
  const viewers = await guildViewerRoleIds(guild, database, core.guildId).catch(() => []);
  const make = async (current: string | null, name: string, type: ChannelType.GuildText | ChannelType.GuildVoice, access: "public" | "private") => {
    if (exists(current)) return current as string;
    const channel = await guild.channels.create({
      name, type, parent: categoryId as string, permissionOverwrites: overwrites(guild, roleId, access, viewers), reason: `${BRAND.name}: raid core channels`
    });
    created.push(type === ChannelType.GuildVoice ? name : `#${name}`);
    return channel.id;
  };
  const rosterChannelId = await make(core.rosterChannelId, names.roster, ChannelType.GuildText, "public");
  const signupChannelId = await make(core.signupChannelId, names.signups, ChannelType.GuildText, "public");
  const lootChannelId = await make(core.lootChannelId, names.loot, ChannelType.GuildText, "public");
  await database.raidCore.update({ where: { id: core.id }, data: { lootChannelId } });
  const raidLogChannelId = await make(core.raidLogChannelId, names.reports, ChannelType.GuildText, "public");
  await database.raidCore.update({ where: { id: core.id }, data: { raidLogChannelId } });
  const chatChannelId = await make(core.chatChannelId, names.chat, ChannelType.GuildText, "private");
  const voiceChannelId = await make(core.voiceChannelId, names.voice, ChannelType.GuildVoice, "private");
  // The roster message moves to the core's own channel: the old one (shared channel) is removed.
  const movingRoster = core.rosterChannelId !== rosterChannelId;
  await database.raidCore.update({
    where: { id: core.id },
    data: { categoryId, rosterChannelId, signupChannelId, lootChannelId, raidLogChannelId, chatChannelId, voiceChannelId, ...(movingRoster ? { rosterMessageId: null } : {}) }
  });
  await openCoreChannels(guild, database, core.guildId, [rosterChannelId, signupChannelId, lootChannelId, raidLogChannelId]);
  return created;
}

// Makes sure every guild role can read these (roster and signups) channels: adds what is
// missing, and on a server that hides channels from @everyone, takes back an @everyone read
// given by an older version. Only the entries it needs are touched (an officer's own overwrites
// stay). Never throws. Returns how many channels changed.
export async function openCoreChannels(guild: DiscordGuild, database: Db, guildId: string, channelIds: (string | null)[]): Promise<number> {
  let changed = 0;
  try {
    const viewers = await guildViewerRoleIds(guild, database, guildId);
    for (const id of channelIds) {
      if (!id) continue;
      const channel = await guild.channels.fetch(id).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) continue;
      let touched = false;
      for (const roleId of viewers) {
        const current = channel.permissionOverwrites.cache.get(roleId);
        if (current?.allow.has(PermissionFlagsBits.ViewChannel) && current.allow.has(PermissionFlagsBits.ReadMessageHistory)) continue;
        if (await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, ReadMessageHistory: true }).then(() => true, () => false)) touched = true;
      }
      const everyone = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
      if (!openServer(guild) && viewers.length > 0 && everyone?.allow.has(PermissionFlagsBits.ViewChannel)) {
        if (await channel.permissionOverwrites.edit(guild.roles.everyone.id, { ViewChannel: null, ReadMessageHistory: null, SendMessages: false }).then(() => true, () => false)) touched = true;
      }
      if (touched) changed++;
    }
  } catch (error) {
    console.error("Failed to open the core channels to the guild", error);
  }
  return changed;
}

// Every core's roster and signups channels, readable by the guild (a new core's role included).
export async function openAllCoreChannels(guild: DiscordGuild, database: Db, guildId: string): Promise<number> {
  const cores = await database.raidCore.findMany({ where: { guildId }, select: { rosterChannelId: true, signupChannelId: true, lootChannelId: true, raidLogChannelId: true } });
  return openCoreChannels(guild, database, guildId, cores.flatMap((core) => [core.rosterChannelId, core.signupChannelId, core.lootChannelId, core.raidLogChannelId]));
}

// After a rename: the role, the category and the channels follow the new name.
export async function renameCoreDiscord(guild: DiscordGuild, core: CoreLike): Promise<void> {
  const names = coreChannelNames(core.name);
  const rename = async (id: string | null, name: string) => {
    if (!id) return;
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (channel && "setName" in channel) await channel.setName(name, `${BRAND.name}: raid core renamed`).catch(() => undefined);
  };
  if (core.roleId) {
    const role = await guild.roles.fetch(core.roleId).catch(() => null);
    await role?.setName(core.name.slice(0, 100), `${BRAND.name}: raid core renamed`).catch(() => undefined);
  }
  await rename(core.categoryId, names.category);
  await rename(core.rosterChannelId, names.roster);
  await rename(core.signupChannelId, names.signups);
  await rename(core.lootChannelId, names.loot);
  await rename(core.raidLogChannelId, names.reports);
  await rename(core.chatChannelId, names.chat);
  await rename(core.voiceChannelId, names.voice);
}

// Creates the channels of a new (or pre-5.0) core and moves its roster message there. Never
// throws: returns what was created, or the reason it could not (a missing permission).
export async function setupCoreDiscord(
  guild: DiscordGuild, database: Db, coreId: string,
  removeOldRoster: (messageId: string | null, channelId: string | null) => Promise<void>
): Promise<{ created: string[]; error?: string }> {
  try {
    const before = await database.raidCore.findUniqueOrThrow({ where: { id: coreId } });
    const created = await createCoreChannels(guild, database, coreId);
    const after = await database.raidCore.findUnique({ where: { id: coreId } });
    // The roster message moved: the one left in the shared roster channel is removed.
    if (after && before.rosterChannelId !== after.rosterChannelId) await removeOldRoster(before.rosterMessageId, before.rosterChannelId);
    return { created };
  } catch (error) {
    return { created: [], error: error instanceof Error ? error.message : "Could not create the core's channels." };
  }
}

export const ARCHIVE_CATEGORY = "🗄️ Archived cores";
// Discord allows 50 channels in a category.
const CATEGORY_LIMIT = 50;

// When a core is deleted: its text channels are kept, read-only, in an "Archived cores"
// category (a new one when the last is full); the voice channel and the core's category go;
// the role stays, renamed, so the people who were in the core can still read their chat.
// Returns how many channels were archived.
export async function archiveCoreDiscord(guild: DiscordGuild, core: CoreLike): Promise<number> {
  await guild.channels.fetch();
  const textIds = [core.rosterChannelId, core.signupChannelId, core.lootChannelId, core.raidLogChannelId, core.chatChannelId].filter((id): id is string => !!id && guild.channels.cache.has(id));
  let archived = 0;
  if (textIds.length > 0) {
    const categories = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildCategory && channel.name.startsWith(ARCHIVE_CATEGORY));
    const childCount = (id: string) => guild.channels.cache.filter((channel) => "parentId" in channel && channel.parentId === id).size;
    let archive = categories.find((category) => childCount(category.id) + textIds.length <= CATEGORY_LIMIT) ?? null;
    if (!archive) {
      const name = categories.size === 0 ? ARCHIVE_CATEGORY : `${ARCHIVE_CATEGORY} ${categories.size + 1}`;
      archive = await guild.channels.create({
        name, type: ChannelType.GuildCategory, reason: `${BRAND.name}: archived raid core channels`,
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.SendMessages] }]
      }).catch(() => null);
    }
    for (const id of textIds) {
      const channel = guild.channels.cache.get(id);
      if (!channel || channel.type !== ChannelType.GuildText) continue;
      const moved = await channel.edit({ parent: archive?.id ?? null, lockPermissions: false, reason: `${BRAND.name}: raid core deleted, channel archived` }).then(() => true, () => false);
      if (!moved) continue;
      archived++;
      // Read-only for everyone who could see it (the core role, leadership); the bot still can.
      for (const overwrite of channel.permissionOverwrites.cache.values()) {
        if (overwrite.id === guild.members.me?.id) continue;
        await channel.permissionOverwrites.edit(overwrite.id, { SendMessages: false }).catch(() => undefined);
      }
    }
  }
  for (const id of [core.voiceChannelId, core.categoryId]) {
    if (!id) continue;
    const channel = await guild.channels.fetch(id).catch(() => null);
    await channel?.delete(`${BRAND.name}: raid core deleted`).catch(() => undefined);
  }
  if (core.roleId) {
    const role = await guild.roles.fetch(core.roleId).catch(() => null);
    await role?.edit({ name: `${core.name} (archived)`.slice(0, 100), mentionable: false, reason: `${BRAND.name}: raid core deleted` }).catch(() => undefined);
  }
  return archived;
}

// When a core is deleted with its channels: the four channels, the category and the role go.
export async function deleteCoreDiscord(guild: DiscordGuild, core: CoreLike): Promise<number> {
  let removed = 0;
  for (const id of [core.rosterChannelId, core.signupChannelId, core.lootChannelId, core.raidLogChannelId, core.chatChannelId, core.voiceChannelId, core.categoryId]) {
    if (!id) continue;
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (channel && await channel.delete(`${BRAND.name}: raid core deleted`).then(() => true, () => false)) removed++;
  }
  if (core.roleId) {
    const role = await guild.roles.fetch(core.roleId).catch(() => null);
    if (role && await role.delete(`${BRAND.name}: raid core deleted`).then(() => true, () => false)) removed++;
  }
  return removed;
}
