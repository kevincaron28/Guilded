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
// Channels ("Create channels" in /core edit): a category named after the core with
//   #<core>-roster   the core's roster message    visible to everyone, only the bot posts
//   #<core>-signups  the core's raid signup posts visible to everyone, only the bot posts
//   #<core>-chat     the core's own chat          core role + leadership only
//   🔊 <core>        voice                        core role + leadership only
// Guilds that never press it keep the shared roster and signup channels.

type Db = Pick<PrismaClient, "raidCore" | "raidCoreMember">;
type CoreLike = Pick<RaidCore, "id" | "name" | "roleId" | "categoryId" | "rosterChannelId" | "signupChannelId" | "chatChannelId" | "voiceChannelId">;

const LEADERSHIP: Permission[] = ["guildMaster", "officer", "raidLeader"];

// "Tuesday MC" -> "tuesday-mc" (Discord text channel names are lower case, no spaces).
export function coreSlug(name: string): string {
  const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "core";
}

export function coreChannelNames(name: string) {
  const slug = coreSlug(name);
  return { category: `⚔️ ${name}`.slice(0, 100), roster: `${slug}-roster`, signups: `${slug}-signups`, chat: `${slug}-chat`, voice: `🔊 ${name}`.slice(0, 100) };
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

function overwrites(guild: DiscordGuild, roleId: string, access: "public" | "private"): OverwriteResolvable[] {
  const leaders = guild.roles.cache.filter((role) => LEADERSHIP.some((permission) => isPermissionRoleName(permission, role.name)));
  const me = guild.members.me;
  const list: OverwriteResolvable[] = [];
  if (access === "public") {
    // Everyone reads; only the bot (and leadership) posts. Buttons on the bot's posts still work.
    list.push({ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
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
  const make = async (current: string | null, name: string, type: ChannelType.GuildText | ChannelType.GuildVoice, access: "public" | "private") => {
    if (exists(current)) return current as string;
    const channel = await guild.channels.create({
      name, type, parent: categoryId as string, permissionOverwrites: overwrites(guild, roleId, access), reason: `${BRAND.name}: raid core channels`
    });
    created.push(type === ChannelType.GuildVoice ? name : `#${name}`);
    return channel.id;
  };
  const rosterChannelId = await make(core.rosterChannelId, names.roster, ChannelType.GuildText, "public");
  const signupChannelId = await make(core.signupChannelId, names.signups, ChannelType.GuildText, "public");
  const chatChannelId = await make(core.chatChannelId, names.chat, ChannelType.GuildText, "private");
  const voiceChannelId = await make(core.voiceChannelId, names.voice, ChannelType.GuildVoice, "private");
  // The roster message moves to the core's own channel: the old one (shared channel) is removed.
  const movingRoster = core.rosterChannelId !== rosterChannelId;
  await database.raidCore.update({
    where: { id: core.id },
    data: { categoryId, rosterChannelId, signupChannelId, chatChannelId, voiceChannelId, ...(movingRoster ? { rosterMessageId: null } : {}) }
  });
  return created;
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
  await rename(core.chatChannelId, names.chat);
  await rename(core.voiceChannelId, names.voice);
}

// When a core is deleted with its channels: the four channels, the category and the role go.
export async function deleteCoreDiscord(guild: DiscordGuild, core: CoreLike): Promise<number> {
  let removed = 0;
  for (const id of [core.rosterChannelId, core.signupChannelId, core.chatChannelId, core.voiceChannelId, core.categoryId]) {
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
