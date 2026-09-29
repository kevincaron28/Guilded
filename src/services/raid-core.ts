import { EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import type { PrismaClient, RaidRole } from "@prisma/client";
import { createGuildService } from "./guild.js";
import { applyToCoreButtonRow } from "./application.js";
import { asLootMode, LOOT_MODE_LABEL } from "./core-rules.js";
import { asLang, tx, type Lang } from "../i18n.js";
import { setupCoreDiscord, syncCoreRole } from "./core-channels.js";

// A raid core is a named roster (e.g. "Tuesday MC core"). A guild can have
// several. Core members get priority at signups for raids created for that
// core (see raid.ts), and every core's roster is kept as one live message in
// the roster channel. One member can be in several cores (a different role in each), and each
// core spot can name the character they bring there: the same one everywhere, or an alt per core.

const ROLE_ORDER: RaidRole[] = ["TANK", "HEALER", "DPS"];
const ROLE_LABELS: Record<Lang, Record<RaidRole, string>> = {
  en: { TANK: "🛡️ Tanks", HEALER: "💚 Healers", DPS: "⚔️ DPS" },
  fr: { TANK: "🛡️ Tanks", HEALER: "💚 Soigneurs", DPS: "⚔️ DPS" }
};
const ROLE_WORD: Record<Lang, Record<RaidRole, string>> = {
  en: { TANK: "Tank", HEALER: "Healer", DPS: "DPS" },
  fr: { TANK: "Tank", HEALER: "Soigneur", DPS: "DPS" }
};

type Db = PrismaClient;

export function createRaidCoreService(database: Db) {
  async function byIdOrName(guildId: string, value: string) {
    const core = await database.raidCore.findFirst({
      where: { guildId, OR: [{ id: value }, { name: { equals: value.trim(), mode: "insensitive" } }] },
      include: { members: { include: { member: true, character: true }, orderBy: { addedAt: "asc" } } }
    });
    if (!core) throw new Error(`No raid core "${value}". See /core list.`);
    return core;
  }

  // One of the member's own linked characters, by name (case does not matter).
  async function ownCharacter(memberId: string, name: string) {
    const character = await database.character.findFirst({ where: { memberId, name: { equals: name.trim(), mode: "insensitive" } } });
    if (!character) throw new Error(`"${name.trim()}" is not one of that player's linked characters. Link it first with /character.`);
    return character;
  }

  return {
    byIdOrName,

    async create(guildId: string, name: string, description?: string | null, schedule?: string | null) {
      const clean = name.trim();
      if (clean.length < 2 || clean.length > 50) throw new Error("A core name must be 2 to 50 characters.");
      const exists = await database.raidCore.findFirst({ where: { guildId, name: { equals: clean, mode: "insensitive" } } });
      if (exists) throw new Error(`A core called "${exists.name}" already exists.`);
      return database.raidCore.create({
        data: {
          guildId, name: clean,
          description: description?.trim().slice(0, 300) || null,
          schedule: schedule?.trim().slice(0, 100) || null
        }
      });
    },

    async remove(guildId: string, value: string) {
      const core = await byIdOrName(guildId, value);
      await database.raidCore.delete({ where: { id: core.id } });
      // Prices are kept apart from the core (no foreign key: "" is the guild-wide list).
      await database.coreItemValue.deleteMany({ where: { guildId, coreId: core.id } });
      return core;
    },

    // Adds a player, or changes the role / bench spot of one already in the core. Being in
    // another core changes nothing here. `characterName` (one of their linked characters) says
    // which character they bring to this core; left out, the one already set is kept.
    async addMember(guildId: string, value: string, memberId: string, role: RaidRole, bench = false, characterName?: string | null) {
      const core = await byIdOrName(guildId, value);
      const characterId = characterName ? (await ownCharacter(memberId, characterName)).id : undefined;
      await database.raidCoreMember.upsert({
        where: { coreId_memberId: { coreId: core.id, memberId } },
        // Added or moved by an officer: a full member from now on (not on trial).
        create: { coreId: core.id, memberId, role, bench, ...(characterId ? { characterId } : {}) },
        update: { role, bench, trial: false, ...(characterId ? { characterId } : {}) }
      });
      return core;
    },

    // The character a core member brings to this core; null clears it. Returns the core and the
    // character (null when cleared).
    async setCharacter(guildId: string, value: string, memberId: string, characterName: string | null) {
      const core = await byIdOrName(guildId, value);
      if (!core.members.some((entry) => entry.memberId === memberId)) throw new Error(`That player is not in ${core.name}.`);
      const character = characterName ? await ownCharacter(memberId, characterName) : null;
      await database.raidCoreMember.update({
        where: { coreId_memberId: { coreId: core.id, memberId } },
        data: { characterId: character?.id ?? null }
      });
      return { core, character };
    },

    // Every core a member is in, with their role, spot and character there.
    spotsOf(guildId: string, memberId: string) {
      return database.raidCoreMember.findMany({
        where: { memberId, core: { guildId } },
        include: { core: { select: { id: true, name: true } }, character: true },
        orderBy: { core: { name: "asc" } }
      });
    },

    // Renames a core (names are unique per guild, ignoring case). Raids, signups, prices and
    // the addon follow by id, so nothing else has to change; the roster message is refreshed
    // by the caller.
    async rename(guildId: string, value: string, name: string, description?: string | null) {
      const core = await byIdOrName(guildId, value);
      const trimmed = name.trim();
      if (trimmed.length < 2 || trimmed.length > 50) throw new Error("A core name is 2 to 50 characters.");
      const clash = await database.raidCore.findFirst({ where: { guildId, id: { not: core.id }, name: { equals: trimmed, mode: "insensitive" } } });
      if (clash) throw new Error(`A core called "${clash.name}" already exists.`);
      return database.raidCore.update({
        where: { id: core.id },
        data: { name: trimmed, ...(description !== undefined ? { description: description?.trim().slice(0, 300) || null } : {}) }
      });
    },

    // An applicant's place in the core after a decision: on Trial they join as a trial member
    // (with the role they applied for), on Approve the trial mark is cleared (or they join as a
    // full member), on Reject a trial member is taken off again. A role or bench spot an officer
    // already set is kept. The character named on the application becomes their character in
    // this core when it is one of their linked characters and none is set yet (their spots in
    // other cores are left alone). Returns false when nothing changed.
    async settleApplicant(coreId: string, memberId: string, outcome: "TRIAL" | "APPROVED" | "REJECTED", role: RaidRole | null, characterName?: string | null): Promise<boolean> {
      if (outcome === "REJECTED") {
        const removed = await database.raidCoreMember.deleteMany({ where: { coreId, memberId, trial: true } });
        return removed.count > 0;
      }
      const trial = outcome === "TRIAL";
      const character = characterName?.trim()
        ? await database.character.findFirst({ where: { memberId, name: { equals: characterName.trim(), mode: "insensitive" } }, select: { id: true } })
        : null;
      const spot = await database.raidCoreMember.upsert({
        where: { coreId_memberId: { coreId, memberId } },
        create: { coreId, memberId, role: role ?? "DPS", trial, ...(character ? { characterId: character.id } : {}) },
        update: { trial }
      });
      if (character && !spot.characterId) {
        await database.raidCoreMember.update({ where: { id: spot.id }, data: { characterId: character.id } });
      }
      return true;
    },

    async removeMember(guildId: string, value: string, memberId: string) {
      const core = await byIdOrName(guildId, value);
      const removed = await database.raidCoreMember.deleteMany({ where: { coreId: core.id, memberId } });
      if (removed.count === 0) throw new Error("That player is not in this core.");
      return core;
    },

    list(guildId: string) {
      return database.raidCore.findMany({
        where: { guildId },
        include: { members: { include: { member: true, character: true }, orderBy: { addedAt: "asc" } }, _count: { select: { raids: true } } },
        orderBy: { name: "asc" }
      });
    },

    // The main players (they get signup priority). The bench does not.
    async memberIds(coreId: string): Promise<Set<string>> {
      const rows = await database.raidCoreMember.findMany({ where: { coreId, bench: false }, select: { memberId: true } });
      return new Set(rows.map((row) => row.memberId));
    },

    // Bench members (replacements), shown with a chair on the signup post.
    async benchIds(coreId: string): Promise<Set<string>> {
      const rows = await database.raidCoreMember.findMany({ where: { coreId, bench: true }, select: { memberId: true } });
      return new Set(rows.map((row) => row.memberId));
    }
  };
}

type CoreForEmbed = {
  name: string;
  description: string | null;
  schedule?: string | null;
  lootMode?: string | null;
  reservesPerPlayer?: number | null;
  members: CoreSpot[];
};

type CoreSpot = { role: RaidRole; bench: boolean; trial?: boolean; member: { displayName: string }; character?: { name: string } | null };

// "Kevin · Thrall" when the spot names the character brought to this core, else just the name.
export function coreSpotLabel(entry: CoreSpot): string {
  return entry.character ? `${entry.member.displayName} · ${entry.character.name}` : entry.member.displayName;
}

// `guildLootMode` is the guild's raw default (GuildSettings.lootMode); the core's own
// lootMode overrides it when set, so the message always shows the *effective* mode.
export function coreRosterEmbed(core: CoreForEmbed, guildLootMode?: string | null, lang: Lang = "en"): EmbedBuilder {
  const ROLE_LABEL = ROLE_LABELS[lang];
  const embed = new EmbedBuilder().setColor(0xd4af37).setTitle(`⚜️ ${core.name}`);
  if (core.description) embed.setDescription(core.description);
  if (core.schedule) embed.addFields({ name: `📅 ${tx(lang, "Schedule")}`, value: core.schedule, inline: true });
  const mode = asLootMode(core.lootMode ?? guildLootMode);
  const reserves = mode === "RESERVE" && core.reservesPerPlayer
    ? ` (${core.reservesPerPlayer === 1 ? tx(lang, "{n} reserve/player", { n: core.reservesPerPlayer }) : tx(lang, "{n} reserves/player", { n: core.reservesPerPlayer })})`
    : "";
  embed.addFields({ name: `🎲 ${tx(lang, "Loot")}`, value: `${LOOT_MODE_LABEL[mode]}${reserves}`, inline: true });
  for (const role of ROLE_ORDER) {
    const names = core.members.filter((entry) => entry.role === role && !entry.bench && !entry.trial).map(coreSpotLabel).sort((a, b) => a.localeCompare(b));
    embed.addFields({ name: `${ROLE_LABEL[role]} (${names.length})`, value: names.length ? names.join("\n").slice(0, 1000) : "—", inline: true });
  }
  // Trial members (an application moved to Trial) are listed apart until they are approved.
  const trial = core.members.filter((entry) => entry.trial && !entry.bench)
    .map((entry) => `${coreSpotLabel(entry)} (${ROLE_WORD[lang][entry.role]})`)
    .sort((a, b) => a.localeCompare(b));
  if (trial.length) embed.addFields({ name: `🧪 ${tx(lang, "Trial")} (${trial.length})`, value: trial.join("\n").slice(0, 1000), inline: false });
  const bench = core.members.filter((entry) => entry.bench)
    .map((entry) => `${coreSpotLabel(entry)} (${ROLE_WORD[lang][entry.role]})`)
    .sort((a, b) => a.localeCompare(b));
  if (bench.length) embed.addFields({ name: `🪑 ${tx(lang, "Bench")} (${bench.length})`, value: bench.join("\n").slice(0, 1000), inline: false });
  const mains = core.members.length - bench.length - trial.length;
  const people = mains === 1 ? tx(lang, "{count} core member", { count: mains }) : tx(lang, "{count} core members", { count: mains });
  const extra = `${trial.length ? tx(lang, " + {n} on trial", { n: trial.length }) : ""}${bench.length ? tx(lang, " + {n} on the bench", { n: bench.length }) : ""}`;
  embed.setFooter({ text: `${people}${extra} · ${tx(lang, "core members get priority at this core's raid signups")}` });
  return embed;
}

// Keeps the core's roster message in the roster channel current (edit in
// place; re-post if it was deleted). False when no roster channel is set.
// Never throws: a failed refresh must not undo the change that caused it.
export async function syncCoreRoster(discordGuild: DiscordGuild | null, database: Db, guildId: string, coreId: string): Promise<boolean> {
  if (!discordGuild) return false;
  // The core's role follows its members with every roster refresh (see core-channels.ts).
  await syncCoreRole(discordGuild, database, coreId);
  try {
    const settings = await createGuildService(database).getSettings(guildId);
    const core = await database.raidCore.findFirst({ where: { id: coreId, guildId }, include: { members: { include: { member: true, character: true } } } });
    if (!core) return false;
    // The core's own roster channel when it has one, else the guild's shared roster channel.
    const channelId = core.rosterChannelId ?? settings?.coreChannelId;
    if (!settings || !channelId) return false;
    const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return false;
    const payload = {
      embeds: [coreRosterEmbed(core, settings.lootMode, asLang(settings.language))],
      components: [applyToCoreButtonRow(core)],
      allowedMentions: { parse: [] as never[] }
    };
    const existing = core.rosterMessageId ? await channel.messages.fetch(core.rosterMessageId).catch(() => null) : null;
    if (existing?.editable) {
      await existing.edit(payload);
    } else {
      const sent = await channel.send(payload);
      await database.raidCore.update({ where: { id: core.id }, data: { rosterMessageId: sent.id } });
    }
    return true;
  } catch (error) {
    console.error("Failed to sync core roster", error);
    return false;
  }
}

// Removes a deleted core's roster message from the channel.
export async function removeCoreRosterMessage(discordGuild: DiscordGuild | null, database: Db, guildId: string, messageId: string | null, channelId?: string | null): Promise<void> {
  if (!discordGuild || !messageId) return;
  try {
    const settings = await createGuildService(database).getSettings(guildId);
    const where = channelId ?? settings?.coreChannelId;
    if (!where) return;
    const channel = await discordGuild.channels.fetch(where).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    await message?.delete().catch(() => undefined);
  } catch (error) {
    console.error("Failed to remove core roster message", error);
  }
}

// A core's own category, channels and role (made when the core is created, since 5.0), then its
// roster in its own channel. Never throws; the error says what permission is missing.
export async function ensureCoreDiscord(discordGuild: DiscordGuild | null, database: Db, guildId: string, coreId: string): Promise<{ created: string[]; error?: string }> {
  if (!discordGuild) return { created: [] };
  const result = await setupCoreDiscord(discordGuild, database, coreId,
    (messageId, channelId) => removeCoreRosterMessage(discordGuild, database, guildId, messageId, channelId));
  await syncCoreRoster(discordGuild, database, guildId, coreId);
  return result;
}

// Every core's channels and roster ("Update bot messages" in /setup: cores made before 5.0 get
// their channels too).
export async function ensureAllCoresDiscord(discordGuild: DiscordGuild | null, database: Db, guildId: string): Promise<void> {
  const cores = await database.raidCore.findMany({ where: { guildId }, select: { id: true } });
  for (const core of cores) await ensureCoreDiscord(discordGuild, database, guildId, core.id);
}

// Reposts every core's roster (used when the roster channel is first set).
export async function syncAllCoreRosters(discordGuild: DiscordGuild | null, database: Db, guildId: string): Promise<void> {
  const cores = await database.raidCore.findMany({ where: { guildId }, select: { id: true } });
  for (const core of cores) await syncCoreRoster(discordGuild, database, guildId, core.id);
}
