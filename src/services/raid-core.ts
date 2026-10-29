import { ContainerBuilder, EmbedBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder, escapeMarkdown, type Guild as DiscordGuild } from "discord.js";
import type { PrismaClient, RaidRole } from "../generated/prisma/client.js";
import { currentEdition } from "./edition-context.js";
import { createGuildService } from "./guild.js";
import { applyToCoreButtonRow } from "./application.js";
import { asLootMode, LOOT_MODE_LABEL, LOOT_MODE_LABEL_FR } from "./core-rules.js";
import { asLang, t, tx, type Lang } from "../i18n.js";
import { allocate, clip, fit, SIGNUP_TEXT_LIMIT } from "./signup-layout.js";
import { dpsSplitLine } from "./dps-range.js";
import { openAllCoreChannels, setupCoreDiscord, syncCoreRole } from "./core-channels.js";
import { assertRealm, requiredRealm } from "./realm-check.js";
import { weeklyScheduleData } from "./core-weekly-time.js";
import { CHARACTER_REQUIRED, ownedSignupCharacter } from "./signup-character.js";
import { CHARACTER_DISPLAY_SELECT, characterDisplayLine, hasStaleGear, loadClassEmojis, staleGearNote, type ClassEmojis, type DisplayCharacter } from "./character-display.js";
import { boundRosterEmbed, clipRosterLines } from "./roster-embed-limits.js";

// A trial lasts this long unless the officer picks another length (/application trial days:).
export const DEFAULT_TRIAL_DAYS = 14;

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

// What a roster needs of each core spot: the player, the character they bring, their backups.
const SPOT_INCLUDE = { member: true, character: true, backups: { include: { character: true }, orderBy: { addedAt: "asc" as const } } };

export function createRaidCoreService(database: Db) {
  async function byIdOrName(guildId: string, value: string) {
    const core = await database.raidCore.findFirst({
      where: { guildId, OR: [{ id: value }, { name: { equals: value.trim(), mode: "insensitive" } }] },
      include: { members: { include: SPOT_INCLUDE, orderBy: { addedAt: "asc" } } }
    });
    if (!core) throw new Error(`No raid core "${value}". See /core list.`);
    return core;
  }

  // One of the member's own linked characters, by name (case does not matter).
  async function ownCharacter(memberId: string, name: string) {
    if (currentEdition() !== "forever") {
      const candidates = await database.character.findMany({ where: { memberId }, select: { member: { select: { guildId: true } } }, take: 1 });
      if (!candidates[0]) throw new Error("Link your character first with /character.");
      return ownedSignupCharacter(database, candidates[0].member.guildId, memberId, name);
    }
    const character = await database.character.findFirst({ where: { memberId, name: { equals: name.trim(), mode: "insensitive" } } });
    if (!character) throw new Error(`"${name.trim()}" is not one of that player's linked characters. Link it first with /character.`);
    return character;
  }

  // A character joining a core must be on the core's realm: the one an officer set, else the
  // one the other members' characters share.
  function checkCoreRealm(core: Awaited<ReturnType<typeof byIdOrName>>, memberId: string, character: { name: string; realm: string }) {
    if (currentEdition() === "retail" && !core.realm) return;
    const others = core.members.filter(spot => spot.memberId !== memberId);
    assertRealm(character, requiredRealm(core.realm, others.flatMap(spot => [spot.character?.realm, ...spot.backups.map(backup => backup.character.realm)])), core.name);
  }

  return {
    byIdOrName,

    async create(guildId: string, name: string, description?: string | null, schedule?: string | null, automatic?: { timezone: string; createdBy: string }) {
      const clean = name.trim();
      if (clean.length < 2 || clean.length > 50) throw new Error("A core name must be 2 to 50 characters.");
      const weekly = automatic ? weeklyScheduleData(schedule, automatic.timezone, automatic.createdBy) : {};
      const settings = await database.guildSettings?.findUnique({ where: { guildId }, select: { coreLootOnly: true, lootMode: true } });
      const exists = await database.raidCore.findFirst({ where: { guildId, name: { equals: clean, mode: "insensitive" } } });
      if (exists) throw new Error(`A core called "${exists.name}" already exists.`);
      return database.raidCore.create({
        data: {
          guildId, name: clean,
          description: description?.trim().slice(0, 300) || null,
          schedule: schedule?.trim().slice(0, 100) || null,
          ...weekly,
          ...(settings?.coreLootOnly ? { separatePool: true, lootMode: asLootMode(settings.lootMode) } : {})
        }
      });
    },

    // The realm this core plays on; null goes back to the realm its characters share.
    async setRealm(guildId: string, value: string, realm: string | null) {
      const core = await byIdOrName(guildId, value);
      return database.raidCore.update({ where: { id: core.id }, data: { realm: realm?.trim().slice(0, 60) || null } });
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
      const settings = await database.guildSettings?.findUnique({ where: { guildId }, select: { characterSignups: true } });
      const existing = core.members.find(spot => spot.memberId === memberId);
      const character = settings?.characterSignups
        ? await ownedSignupCharacter(database, guildId, memberId, characterName ?? existing?.characterId)
        : characterName ? await ownedSignupCharacter(database, guildId, memberId, characterName) : undefined;
      const characterId = character?.id;
      if (character && character.id !== existing?.characterId) checkCoreRealm(core, memberId, character);
      const spot = await database.raidCoreMember.upsert({
        where: { coreId_memberId: { coreId: core.id, memberId } },
        // Added or moved by an officer: a full member from now on (not on trial).
        create: { coreId: core.id, memberId, role, bench, ...(characterId ? { characterId } : {}) },
        update: { role, bench, trial: false, ...(characterId ? { characterId } : {}) }
      });
      if (characterId) {
        await database.raidCoreBackup.deleteMany({ where: { spotId: spot.id, characterId } });
      }
      return core;
    },

    // The character a core member brings to this core; null clears it. Returns the core and the
    // character (null when cleared).
    async setCharacter(guildId: string, value: string, memberId: string, characterName: string | null) {
      const core = await byIdOrName(guildId, value);
      if (!core.members.some((entry) => entry.memberId === memberId)) throw new Error(`That player is not in ${core.name}.`);
      const settings = await database.guildSettings?.findUnique({ where: { guildId }, select: { characterSignups: true } });
      if (settings?.characterSignups && !characterName) throw new Error(CHARACTER_REQUIRED);
      const character = characterName ? await ownedSignupCharacter(database, guildId, memberId, characterName) : null;
      if (character) checkCoreRealm(core, memberId, character);
      await database.raidCoreMember.update({
        where: { coreId_memberId: { coreId: core.id, memberId } },
        data: { characterId: character?.id ?? null }
      });
      if (character) await database.raidCoreBackup.deleteMany({ where: { spotId: core.members.find(spot => spot.memberId === memberId)!.id, characterId: character.id } });
      return { core, character };
    },

    // A backup character the member can bring to this core instead (its own role). Adding one
    // already listed changes its role. The spot's own character cannot also be a backup.
    async addBackup(guildId: string, value: string, memberId: string, characterName: string, role: RaidRole) {
      const core = await byIdOrName(guildId, value);
      const spot = core.members.find((entry) => entry.memberId === memberId);
      if (!spot) throw new Error(`That player is not in ${core.name}. Add them first.`);
      const character = await ownedSignupCharacter(database, guildId, memberId, characterName);
      if (spot.characterId === character.id) throw new Error(`${character.name} is already their character in ${core.name}.`);
      checkCoreRealm(core, memberId, character);
      await database.raidCoreBackup.upsert({
        where: { spotId_characterId: { spotId: spot.id, characterId: character.id } },
        create: { spotId: spot.id, characterId: character.id, role },
        update: { role }
      });
      return { core, character };
    },

    async removeBackup(guildId: string, value: string, memberId: string, characterName: string) {
      const core = await byIdOrName(guildId, value);
      const spot = core.members.find((entry) => entry.memberId === memberId);
      const backup = spot?.backups.find(entry => [entry.character.id, entry.character.name, `${entry.character.name}-${entry.character.realm}`].some(value => value.toLowerCase() === characterName.trim().toLowerCase()));
      if (!spot || !backup) throw new Error(`"${characterName.trim()}" is not a backup character of that player in ${core.name}.`);
      await database.raidCoreBackup.delete({ where: { id: backup.id } });
      return { core, character: backup.character };
    },

    // Replace only the displayed page. Validate the entire selection before any
    // write and commit it together, so an invalid/newly unlinked choice cannot
    // leave a partially cleared backup list.
    async replaceBackupPage(guildId: string, coreId: string, memberId: string, visibleIds: string[], wantedIds: string[], role: RaidRole) {
      const visible = new Set(visibleIds), wanted = new Set(wantedIds);
      if (visible.size > 24 || wanted.size > 24 || [...wanted].some(id => !visible.has(id))) throw new Error("Reopen the character picker before changing this selection.");
      return database.$transaction(async tx => {
        const core = await createRaidCoreService(tx as Db).byIdOrName(guildId, coreId);
        const spot = core.members.find(entry => entry.memberId === memberId);
        if (!spot) throw new Error("That player is no longer in this core.");
        if (spot.characterId) wanted.delete(spot.characterId);
        const characters = await tx.character.findMany({ where: { memberId, member: { guildId }, id: { in: [...wanted] } } });
        if (characters.length !== wanted.size) throw new Error("A selected character is no longer linked. Reopen the character picker.");
        for (const character of characters) checkCoreRealm(core, memberId, character);
        await tx.raidCoreBackup.deleteMany({ where: { spotId: spot.id, characterId: { in: [...visible].filter(id => !wanted.has(id)) } } });
        if (characters.length) await tx.raidCoreBackup.createMany({ data: characters.map(character => ({ spotId: spot.id, characterId: character.id, role })), skipDuplicates: true });
        return wanted.size;
      }, { isolationLevel: "Serializable", timeout: 15_000, maxWait: 15_000 });
    },

    // Every core a member is in, with their role, spot and character there.
    spotsOf(guildId: string, memberId: string) {
      return database.raidCoreMember.findMany({
        where: { memberId, core: { guildId } },
        include: { core: { select: { id: true, name: true } }, character: true, backups: { include: { character: true } } },
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
    // trialTerms: how long the trial lasts and who vouched for them (the deciding officer by default).
    async settleApplicant(coreId: string, memberId: string, outcome: "TRIAL" | "APPROVED" | "REJECTED", role: RaidRole | null, characterName?: string | null, trialTerms?: { days: number; sponsorId: string } | null): Promise<boolean> {
      if (outcome === "REJECTED") {
        const removed = await database.raidCoreMember.deleteMany({ where: { coreId, memberId, trial: true } });
        return removed.count > 0;
      }
      const trial = outcome === "TRIAL";
      const core = await database.raidCore?.findUnique?.({ where: { id: coreId }, select: { guildId: true } });
      const settings = core ? await database.guildSettings?.findUnique({ where: { guildId: core.guildId }, select: { characterSignups: true } }) : null;
      const character = settings?.characterSignups && core ? await ownedSignupCharacter(database, core.guildId, memberId, characterName) : characterName?.trim()
        ? currentEdition() !== "forever" ? await ownCharacter(memberId, characterName)
          : await database.character.findFirst({ where: { memberId, name: { equals: characterName.trim(), mode: "insensitive" } }, select: { id: true } })
        : null;
      const now = new Date();
      const terms = trial
        ? { trialStartedAt: now, trialEndsAt: new Date(now.getTime() + (trialTerms?.days ?? DEFAULT_TRIAL_DAYS) * 86_400_000), trialSponsorId: trialTerms?.sponsorId ?? null, trialRemindedAt: null }
        : { trialStartedAt: null, trialEndsAt: null, trialSponsorId: null, trialRemindedAt: null };
      const spot = await database.raidCoreMember.upsert({
        where: { coreId_memberId: { coreId, memberId } },
        create: { coreId, memberId, role: role ?? "DPS", trial, ...terms, ...(character ? { characterId: character.id } : {}) },
        update: { trial, ...terms, ...(settings?.characterSignups && character ? { characterId: character.id } : {}) }
      });
      if (settings?.characterSignups && character) await database.raidCoreBackup.deleteMany({ where: { spotId: spot.id, characterId: character.id } });
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
        include: { members: { include: SPOT_INCLUDE, orderBy: { addedAt: "asc" } }, _count: { select: { raids: true } } },
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
  raidSize?: number | null;
  tankLimit?: number | null;
  healerLimit?: number | null;
  dpsLimit?: number | null;
  weeklyStartDate?: string | null;
  weeklyHorizonDays?: number;
  weeklyTimezone?: string | null;
  name: string;
  description: string | null;
  schedule?: string | null;
  lootMode?: string | null;
  reservesPerPlayer?: number | null;
  separatePool?: boolean;
  members: CoreSpot[];
};

type CoreSpot = {
  role: RaidRole; bench: boolean; trial?: boolean; member: { displayName: string }; character?: ({ name: string } & DisplayCharacter) | null;
  backups?: { role: RaidRole; character: { name: string } & DisplayCharacter }[];
};

// "Kevin · Thrall" when the spot names the character brought to this core, else just the name.
export function coreSpotLabel(entry: CoreSpot): string {
  return entry.character ? `${entry.member.displayName} · ${entry.character.name}` : entry.member.displayName;
}

// `guildLootMode` is the guild's raw default (GuildSettings.lootMode); the core's own
// lootMode overrides it when set, so the message always shows the *effective* mode.
export function coreRosterEmbed(core: CoreForEmbed, guildLootMode?: string | null, lang: Lang = "en", emojis: ClassEmojis = {}, now = new Date()): EmbedBuilder {
  const ROLE_LABEL = ROLE_LABELS[lang];
  const label = (entry: CoreSpot) => characterDisplayLine(coreSpotLabel(entry), entry.character, lang, emojis, now);
  const embed = new EmbedBuilder().setColor(0xd4af37).setTitle(`⚜️ ${core.name}`);
  if (core.description) embed.setDescription(core.description);
  if (core.schedule) embed.addFields({ name: `📅 ${tx(lang, "Schedule")}`, value: core.schedule, inline: true });
  if (core.weeklyStartDate) embed.addFields({ name: lang === "fr" ? "Début des raids" : "Raids start", value: `${core.weeklyStartDate} · ${core.weeklyTimezone ?? ""}`, inline: true });
  if (core.raidSize) embed.addFields({ name: lang === "fr" ? "Taille du raid" : "Raid size", value: String(core.raidSize), inline: true });
  const mode = asLootMode(core.lootMode ?? guildLootMode);
  const reserves = mode === "RESERVE" && core.reservesPerPlayer
    ? ` (${core.reservesPerPlayer === 1 ? tx(lang, "{n} reserve/player", { n: core.reservesPerPlayer }) : tx(lang, "{n} reserves/player", { n: core.reservesPerPlayer })})`
    : "";
  embed.addFields({ name: `🎲 ${tx(lang, "Loot")}`, value: `${lang === "fr" ? LOOT_MODE_LABEL_FR[mode] : LOOT_MODE_LABEL[mode]}${reserves}`, inline: true });
  // Shared pool: points earned in any core count here too. Own pool: this core's points only.
  if (core.separatePool !== undefined) {
    embed.addFields({ name: `💰 ${tx(lang, "Points")}`, value: core.separatePool ? tx(lang, "This core's own pool") : tx(lang, "Shared guild pool"), inline: true });
  }
  for (const role of ROLE_ORDER) {
    const names = core.members.filter((entry) => entry.role === role && !entry.bench && !entry.trial).map(label).sort((a, b) => a.localeCompare(b));
    const target = { TANK: core.tankLimit, HEALER: core.healerLimit, DPS: core.dpsLimit }[role];
    embed.addFields({ name: `${ROLE_LABEL[role]} (${names.length}${target == null ? "" : `/${target}`})`, value: clipRosterLines(names), inline: true });
  }
  // Trial members (an application moved to Trial) are listed apart until they are approved.
  const trial = core.members.filter((entry) => entry.trial && !entry.bench)
    .map((entry) => `${label(entry)} (${ROLE_WORD[lang][entry.role]})`)
    .sort((a, b) => a.localeCompare(b));
  if (trial.length) embed.addFields({ name: `🧪 ${tx(lang, "Trial")} (${trial.length})`, value: clipRosterLines(trial), inline: false });
  const bench = core.members.filter((entry) => entry.bench)
    .map((entry) => `${label(entry)} (${ROLE_WORD[lang][entry.role]})`)
    .sort((a, b) => a.localeCompare(b));
  if (bench.length) embed.addFields({ name: `🪑 ${tx(lang, "Bench")} (${bench.length})`, value: clipRosterLines(bench), inline: false });
  // Other characters players can bring to this core (a healer alt, a second tank...).
  const backups = core.members.flatMap((entry) => (entry.backups ?? []).map((backup) => `${characterDisplayLine(`${entry.member.displayName} · ${backup.character.name}`, backup.character, lang, emojis, now)} (${ROLE_WORD[lang][backup.role]})`))
    .sort((a, b) => a.localeCompare(b));
  if (backups.length) embed.addFields({ name: `🔁 ${tx(lang, "Backup characters")} (${backups.length})`, value: clipRosterLines(backups), inline: false });
  const mains = core.members.length - bench.length - trial.length;
  const people = mains === 1 ? tx(lang, "{count} core member", { count: mains }) : tx(lang, "{count} core members", { count: mains });
  const extra = `${trial.length ? tx(lang, " + {n} on trial", { n: trial.length }) : ""}${bench.length ? tx(lang, " + {n} on the bench", { n: bench.length }) : ""}`;
  const stale = core.members.some(entry => hasStaleGear(entry.character, now) || entry.backups?.some(backup => hasStaleGear(backup.character, now)));
  embed.setFooter({ text: `${people}${extra} · ${tx(lang, "core members get priority at this core's raid signups")}${stale ? `\n${staleGearNote(lang)}` : ""}` });
  return boundRosterEmbed(embed);
}

// The posted roster as Discord Components V2, in the raid signup card's style (signup-layout.ts):
// guild header, a two-per-line summary, one block per role with a count badge (DPS also split into
// melee and ranged), then trial, bench and backup characters, the footer and the Apply button.
// The editors' private previews keep coreRosterEmbed.
export function coreRosterLayout(core: CoreForEmbed & { id: string }, options: { guildLootMode?: string | null; lang?: Lang; emojis?: ClassEmojis;
  guild?: { name: string; iconUrl?: string | null }; edition?: string | null; now?: Date } = {}) {
  const lang = options.lang ?? "en";
  const emojis = options.emojis ?? {};
  const now = options.now ?? new Date();
  const fr = lang === "fr";
  const label = (entry: CoreSpot) => characterDisplayLine(coreSpotLabel(entry), entry.character, lang, emojis, now);
  const sorted = (lines: string[]) => lines.sort((a, b) => a.localeCompare(b));

  const header = [
    options.guild ? `**${escapeMarkdown(clip(options.guild.name, 100))}**` : "",
    `### ⚜️ ${escapeMarkdown(clip(core.name, 200))}`,
    core.description ? clip(core.description, 500) : ""
  ].filter(Boolean).join("\n");

  const mode = asLootMode(core.lootMode ?? options.guildLootMode);
  const reserves = mode === "RESERVE" && core.reservesPerPlayer
    ? ` (${core.reservesPerPlayer === 1 ? tx(lang, "{n} reserve/player", { n: core.reservesPerPlayer }) : tx(lang, "{n} reserves/player", { n: core.reservesPerPlayer })})`
    : "";
  const facts: [string, string][] = [];
  if (core.schedule) facts.push([`📅 ${tx(lang, "Schedule")}`, escapeMarkdown(clip(core.schedule, 120))]);
  if (core.weeklyStartDate) facts.push([fr ? "Début des raids" : "Raids start", `${core.weeklyStartDate} · ${core.weeklyTimezone ?? ""}`]);
  if (core.raidSize) facts.push([fr ? "Taille du raid" : "Raid size", String(core.raidSize)]);
  facts.push([`🎲 ${tx(lang, "Loot")}`, `${fr ? LOOT_MODE_LABEL_FR[mode] : LOOT_MODE_LABEL[mode]}${reserves}`]);
  if (core.separatePool !== undefined) facts.push([`💰 ${tx(lang, "Points")}`, core.separatePool ? tx(lang, "This core's own pool") : tx(lang, "Shared guild pool")]);
  const summary = facts.reduce<string[]>((lines, fact, index) => {
    const text = `**${fact[0]}** ${fact[1]}`;
    if (index % 2) lines[lines.length - 1] += ` · ${text}`; else lines.push(text);
    return lines;
  }, []).join("\n");

  // Role blocks: one player per line, with the class/spec details players check before a raid.
  const badge = (icon: string, name: string, count: string) => `${icon} **\`${name}\`** \`${count}\``;
  const ROLE_ICON: Record<RaidRole, string> = { TANK: "🛡️", HEALER: "💚", DPS: "⚔️" };
  const mains = core.members.filter((entry) => !entry.bench && !entry.trial);
  const roleBlocks = ROLE_ORDER.map((role) => {
    const players = mains.filter((entry) => entry.role === role);
    const target = { TANK: core.tankLimit, HEALER: core.healerLimit, DPS: core.dpsLimit }[role];
    const split = role === "DPS" ? dpsSplitLine(players.map((entry) => entry.character), lang, options.edition) : "";
    return { heading: badge(ROLE_ICON[role], ROLE_LABELS[lang][role].replace(/^\S+\s/, ""), `${players.length}${target == null ? "" : `/${target}`}`),
      note: split, items: sorted(players.map(label)), separator: "\n" };
  });
  const listBlocks: { heading: string; note: string; items: string[]; separator: string }[] = [];
  const list = (icon: string, name: string, items: string[]) => {
    if (items.length) listBlocks.push({ heading: badge(icon, name, String(items.length)), note: "", items: sorted(items), separator: "\n" });
  };
  list("🧪", tx(lang, "Trial"), core.members.filter((entry) => entry.trial && !entry.bench).map((entry) => `${label(entry)} (${ROLE_WORD[lang][entry.role]})`));
  list("🪑", tx(lang, "Bench"), core.members.filter((entry) => entry.bench).map((entry) => `${label(entry)} (${ROLE_WORD[lang][entry.role]})`));
  list("🔁", tx(lang, "Backup characters"), core.members.flatMap((entry) => (entry.backups ?? [])
    .map((backup) => `${characterDisplayLine(`${entry.member.displayName} · ${backup.character.name}`, backup.character, lang, emojis, now)} (${ROLE_WORD[lang][backup.role]})`)));

  const trials = core.members.filter((entry) => entry.trial && !entry.bench).length;
  const benched = core.members.filter((entry) => entry.bench).length;
  const people = mains.length === 1 ? tx(lang, "{count} core member", { count: mains.length }) : tx(lang, "{count} core members", { count: mains.length });
  const stale = core.members.some((entry) => hasStaleGear(entry.character, now) || entry.backups?.some((backup) => hasStaleGear(backup.character, now)));
  const footer = [
    `${people}${trials ? tx(lang, " + {n} on trial", { n: trials }) : ""}${benched ? tx(lang, " + {n} on the bench", { n: benched }) : ""}`,
    tx(lang, "core members get priority at this core's raid signups"),
    stale ? staleGearNote(lang) : ""
  ].filter(Boolean).map((line) => `-# ${line}`).join("\n");

  // The same 4000-character budget as the signup card: every heading stays, long lists end in "+N more".
  const blocks = [...roleBlocks, ...listBlocks];
  const lead = (block: typeof blocks[number]) => `${block.heading}${block.note ? `\n-# ${block.note}` : ""}\n>>> `;
  const reserve = (block: typeof blocks[number]) => block.items.length ? t(lang, "signup.more", { count: block.items.length }).length : 1;
  const wanted = (block: typeof blocks[number]) => Math.max(0, block.items.join(block.separator).length - reserve(block));
  const room = SIGNUP_TEXT_LIMIT - [header, summary, footer].reduce((sum, text) => sum + text.length, 0)
    - blocks.reduce((sum, block) => sum + lead(block).length + reserve(block), 0);
  const extra = allocate(blocks.map(wanted), room);
  const texts = blocks.map((block, index) => `${lead(block)}${fit(block.items, block.separator, reserve(block) + extra[index]!, lang)}`);

  const container = new ContainerBuilder().setAccentColor(0xd4af37);
  const headerText = new TextDisplayBuilder().setContent(header);
  if (options.guild?.iconUrl) {
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(headerText)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(options.guild.iconUrl).setDescription(clip(options.guild.name, 100))));
  } else container.addTextDisplayComponents(headerText);
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summary)).addSeparatorComponents(divider())
    .addTextDisplayComponents(...texts.slice(0, roleBlocks.length).map((text) => new TextDisplayBuilder().setContent(text)));
  if (listBlocks.length) {
    container.addSeparatorComponents(divider())
      .addTextDisplayComponents(...texts.slice(roleBlocks.length).map((text) => new TextDisplayBuilder().setContent(text)));
  }
  container.addSeparatorComponents(divider()).addTextDisplayComponents(new TextDisplayBuilder().setContent(footer))
    .addActionRowComponents(applyToCoreButtonRow(core));
  return { components: [container], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] as never[] } };
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
    const core = await database.raidCore.findFirst({ where: { id: coreId, guildId }, include: { members: { include: {
      ...SPOT_INCLUDE, character: { select: CHARACTER_DISPLAY_SELECT },
      backups: { include: { character: { select: CHARACTER_DISPLAY_SELECT } }, orderBy: { addedAt: "asc" } }
    } } } });
    if (!core) return false;
    // The core's own roster channel when it has one, else the guild's shared roster channel.
    const channelId = core.rosterChannelId ?? settings?.coreChannelId;
    if (!settings || !channelId) return false;
    const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return false;
    const edition = (await database.guild.findUnique({ where: { id: guildId }, select: { gameEdition: true } }))?.gameEdition ?? null;
    const payload = coreRosterLayout(core, { guildLootMode: settings.lootMode, lang: asLang(settings.language), emojis: await loadClassEmojis(discordGuild),
      guild: { name: discordGuild.name, iconUrl: discordGuild.iconURL({ size: 128 }) }, edition });
    let existing = core.rosterMessageId ? await channel.messages.fetch(core.rosterMessageId).catch(() => null) : null;
    // A roster posted before 29 October 2026 is an embed; Components V2 cannot be added to it,
    // so it is replaced by a new post (the roster is a board, not a link people keep).
    if (existing?.editable && !existing.flags.has(MessageFlags.IsComponentsV2)) {
      await existing.delete().catch(() => undefined);
      existing = null;
    }
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
  // Every core's roster and signups stay readable by the whole guild (this core's new role too).
  await openAllCoreChannels(discordGuild, database, guildId);
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
