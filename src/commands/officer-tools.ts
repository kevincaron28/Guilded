import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type GuildMember, type ModalSubmitInteraction
} from "discord.js";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createAuditService } from "../services/audit.js";
import { createRaidService } from "../services/raid.js";
import { RAID_PRESETS } from "../services/raid-presets.js";
import { formatRaidTime, parseRaidTime } from "../services/raid-time.js";
import { createCoreApplicationChannel } from "../services/core-channels.js";
import { syncCoreRoster } from "../services/raid-core.js";
import { officerId, officerModalId, parseOfficerId, parseOfficerModalId, type OfficerAction } from "../services/officer-buttons.js";
import { guildService } from "./context.js";
import { syncSignupEmbed } from "./raid.js";

// Officer buttons on the raid signup post and on a core's roster post (see services/officer-buttons.ts).
// Every click and every modal submission re-checks the clicker's current Officer role and that the
// raid or core belongs to this server, answers privately, and writes an audit entry for each change.
// Nothing here messages anyone unless an officer picks the "cancel and ping" confirmation.

type Db = typeof prisma;
export interface OfficerDeps {
  db: Db;
  // The internal guild id for this interaction's Discord server.
  guildIdFor(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<string>;
  languageFor(guildId: string): Promise<"en" | "fr">;
  refreshRaid(interaction: ButtonInteraction | ModalSubmitInteraction, guildId: string, raidId: string): Promise<void>;
  refreshCore(interaction: ButtonInteraction | ModalSubmitInteraction, guildId: string, coreId: string): Promise<void>;
}

export const defaultOfficerDeps: OfficerDeps = {
  db: prisma,
  async guildIdFor(interaction) {
    if (!interaction.guild) throw new Error("Server only.");
    return (await guildService.ensureGuild(interaction.guild.id, interaction.guild.name)).id;
  },
  async languageFor(guildId) {
    return (await guildService.getSettings(guildId))?.language === "fr" ? "fr" : "en";
  },
  async refreshRaid(interaction, guildId, raidId) {
    if (interaction.guild) await syncSignupEmbed(interaction.guild, guildId, raidId);
  },
  async refreshCore(interaction, guildId, coreId) {
    await syncCoreRoster(interaction.guild, prisma, guildId, coreId);
  }
};

const pick = (lang: "en" | "fr", en: string, fr: string) => (lang === "fr" ? fr : en);
const reply = (interaction: ButtonInteraction | ModalSubmitInteraction, content: string) =>
  interaction.replied || interaction.deferred
    ? interaction.editReply({ content, components: [] })
    : interaction.reply({ content, flags: MessageFlags.Ephemeral });

// The clicker's current roles, read from this interaction (never from the post's author or an
// earlier check). Officers, Guild Masters and Administrators only; Raid Leaders are not enough.
export function officerAccess(interaction: ButtonInteraction | ModalSubmitInteraction): boolean {
  const member = interaction.member;
  if (!member || !interaction.guild) return false;
  if (Array.isArray(member.roles)) {
    const ids = new Set(member.roles);
    return Boolean(interaction.memberPermissions && hasPermission({
      permissions: interaction.memberPermissions,
      roles: { cache: interaction.guild.roles.cache.filter(role => ids.has(role.id)) }
    } as unknown as GuildMember, "officer"));
  }
  return hasPermission(member as GuildMember, "officer");
}

const DENIED = { en: "Only Officers and Guild Masters can use these tools.", fr: "Seuls les officiers et le maître de guilde peuvent utiliser ces outils." };

const button = (customId: string, label: string, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(customId).setLabel(label.slice(0, 80)).setStyle(style);
const row = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
const field = (id: string, label: string, value: string, required: boolean, style = TextInputStyle.Short, max = 100) =>
  new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label.slice(0, 45)).setStyle(style).setRequired(required).setMaxLength(max).setValue(value.slice(0, max)));

async function audit(deps: OfficerDeps, guildId: string, actorId: string, action: "RAID_OFFICER" | "CORE_OFFICER", entityId: string, metadata: Prisma.InputJsonObject) {
  await createAuditService(deps.db).record({ guildId, actorId, action, entityId, metadata });
}

const raidLine = (raid: { title: string; status: string; scheduledAt: Date; signupsCloseAt: Date | null }, lang: "en" | "fr") =>
  `**${raid.title}** · <t:${Math.floor(raid.scheduledAt.getTime() / 1000)}:f> · ${raid.status}${raid.status === "PLANNED" && raid.signupsCloseAt && raid.signupsCloseAt.getTime() <= Date.now() ? ` · 🔒 ${pick(lang, "signups locked", "inscriptions verrouillées")}` : ""}`;

function raidMenu(raid: { id: string; status: string; scheduledAt: Date; signupsCloseAt: Date | null }, lang: "en" | "fr") {
  if (raid.status === "CANCELLED") return [row(button(officerId("raid", raid.id, "reopen"), pick(lang, "Reopen raid", "Rouvrir le raid"), ButtonStyle.Success))];
  if (raid.status !== "PLANNED") return [];
  const locked = Boolean(raid.signupsCloseAt && raid.signupsCloseAt.getTime() <= Date.now());
  return [row(
    button(officerId("raid", raid.id, "edit"), pick(lang, "Edit details", "Modifier"), ButtonStyle.Primary),
    locked
      ? button(officerId("raid", raid.id, "unlock"), pick(lang, "Unlock signups", "Déverrouiller"))
      : button(officerId("raid", raid.id, "lock"), pick(lang, "Lock signups", "Verrouiller")),
    button(officerId("raid", raid.id, "cancel"), pick(lang, "Cancel raid", "Annuler le raid"), ButtonStyle.Danger)
  )];
}

function coreMenu(core: { id: string; archivedAt: Date | null; applicationChannelId: string | null }, lang: "en" | "fr") {
  const buttons = [button(officerId("core", core.id, "edit"), pick(lang, "Edit details", "Modifier"), ButtonStyle.Primary)];
  if (!core.applicationChannelId) buttons.push(button(officerId("core", core.id, "appchan"), pick(lang, "Create application channel", "Créer le salon de candidatures")));
  buttons.push(core.archivedAt
    ? button(officerId("core", core.id, "unarchive"), pick(lang, "Unarchive", "Désarchiver"), ButtonStyle.Success)
    : button(officerId("core", core.id, "archive"), pick(lang, "Archive core", "Archiver"), ButtonStyle.Danger));
  return [row(...buttons)];
}

const coreLine = (core: { name: string; archivedAt: Date | null; applicationChannelId: string | null }, lang: "en" | "fr") =>
  `**${core.name}**${core.archivedAt ? ` · 🗄️ ${pick(lang, "archived", "archivé")}` : ""} · ${core.applicationChannelId
    ? `${pick(lang, "applications", "candidatures")}: <#${core.applicationChannelId}>` : pick(lang, "applications: common channel", "candidatures : salon commun")}`;

const SIZES = new Map<number, (typeof RAID_PRESETS)[number]>(RAID_PRESETS.map(preset => [preset.raidSize, preset]));

export async function handleOfficerButton(interaction: ButtonInteraction, deps: OfficerDeps = defaultOfficerDeps): Promise<void> {
  const id = parseOfficerId(interaction.customId);
  if (!id) return;
  // Permission first, before any database access: a member's click costs nothing and reveals nothing.
  if (!officerAccess(interaction)) { await interaction.reply({ content: DENIED.en, flags: MessageFlags.Ephemeral }); return; }
  const guildId = await deps.guildIdFor(interaction);
  const lang = await deps.languageFor(guildId);
  const missing = pick(lang, "That raid or core is not on this server any more.", "Ce raid ou ce core n'est plus sur ce serveur.");
  const actorId = interaction.user.id;

  if (id.kind === "raid") {
    const raid = await deps.db.raid.findFirst({ where: { id: id.entityId, guildId } });
    if (!raid) { await reply(interaction, missing); return; }
    const refreshed = async () => deps.refreshRaid(interaction, guildId, raid.id);
    switch (id.action) {
      case "menu":
        await interaction.reply({ content: raidLine(raid, lang), components: raidMenu(raid, lang), flags: MessageFlags.Ephemeral });
        return;
      case "edit": {
        if (raid.status !== "PLANNED") { await reply(interaction, pick(lang, "Only planned raids can be edited.", "Seuls les raids prévus peuvent être modifiés.")); return; }
        const timezone = (await guildService.getSettings(guildId))?.timezone ?? "America/Toronto";
        const size = [raid.tankLimit, raid.healerLimit, raid.dpsLimit].every(limit => limit !== null) ? String(raid.tankLimit! + raid.healerLimit! + raid.dpsLimit!) : "";
        await interaction.showModal(new ModalBuilder().setCustomId(officerModalId("raid", raid.id)).setTitle(pick(lang, "Edit raid details", "Modifier le raid")).addComponents(
          field("title", pick(lang, "Title", "Titre"), raid.title, true),
          field("time", pick(lang, "Date and time (e.g. friday 8pm)", "Date et heure (ex. vendredi 20h)"), formatRaidTime(raid.scheduledAt, timezone, lang), true),
          field("size", pick(lang, "Raid size (10/20/25/30/40, blank = keep)", "Taille (10/20/25/30/40, vide = garder)"), size, false, TextInputStyle.Short, 3),
          field("notes", pick(lang, "Notes", "Notes"), raid.description ?? "", false, TextInputStyle.Paragraph, 1000)));
        return;
      }
      case "cancel":
        if (raid.status === "COMPLETED" || raid.status === "CANCELLED") { await reply(interaction, pick(lang, "This raid cannot be cancelled.", "Ce raid ne peut pas être annulé.")); return; }
        await interaction.update({
          content: `⚠️ ${pick(lang, "Cancel", "Annuler")} ${raidLine(raid, lang)}\n${pick(lang, "The signup post will show Cancelled. Nobody is messaged unless you choose the ping option.", "Le message d'inscription indiquera Annulé. Personne n'est contacté sauf si vous choisissez l'option avec mention.")}`,
          components: [row(
            button(officerId("raid", raid.id, "cancel-ok"), pick(lang, "Confirm cancel", "Confirmer"), ButtonStyle.Danger),
            button(officerId("raid", raid.id, "cancel-ping"), pick(lang, "Cancel + ping signed-up", "Annuler + mentionner"), ButtonStyle.Danger),
            button(officerId("raid", raid.id, "menu"), pick(lang, "Keep raid", "Garder")))]
        });
        return;
      case "cancel-ok":
      case "cancel-ping": {
        await interaction.deferUpdate();
        const cancelled = await createRaidService(deps.db).cancel(raid.id, guildId);
        const ping = id.action === "cancel-ping";
        await audit(deps, guildId, actorId, "RAID_OFFICER", raid.id, { change: "cancel", title: cancelled.title, ping });
        await refreshed();
        let pinged = 0;
        if (ping) pinged = await pingSignedUp(interaction, deps, raid, lang);
        await interaction.editReply({ content: `🚫 ${pick(lang, "Cancelled", "Annulé")}: **${cancelled.title}**${ping ? ` · ${pick(lang, `${pinged} member(s) pinged`, `${pinged} membre(s) mentionné(s)`)}` : ""}`, components: [] });
        return;
      }
      case "reopen": {
        if (raid.status !== "CANCELLED") { await reply(interaction, pick(lang, "This raid is not cancelled.", "Ce raid n'est pas annulé.")); return; }
        if (raid.scheduledAt.getTime() <= Date.now()) { await reply(interaction, pick(lang, "The start time has passed: edit the time first with /raid edit, or create a new raid.", "L'heure est passée : créez un nouveau raid.")); return; }
        await interaction.deferUpdate();
        await deps.db.raid.update({ where: { id: raid.id }, data: { status: "PLANNED" } });
        await audit(deps, guildId, actorId, "RAID_OFFICER", raid.id, { change: "reopen", title: raid.title });
        await refreshed();
        await interaction.editReply({ content: `✅ ${pick(lang, "Reopened", "Rouvert")}: **${raid.title}**`, components: [] });
        return;
      }
      case "lock":
      case "unlock": {
        if (raid.status !== "PLANNED") { await reply(interaction, pick(lang, "Only planned raids can be locked.", "Seuls les raids prévus peuvent être verrouillés.")); return; }
        await interaction.deferUpdate();
        // Locking closes signups now (Can't come and Late still work); unlocking removes the deadline.
        const locking = id.action === "lock";
        await deps.db.raid.update({ where: { id: raid.id }, data: { signupsCloseAt: locking ? new Date() : null } });
        await audit(deps, guildId, actorId, "RAID_OFFICER", raid.id, { change: id.action, previousCloseAt: raid.signupsCloseAt?.toISOString() ?? null });
        await refreshed();
        await interaction.editReply({ content: `${locking ? "🔒" : "🔓"} **${raid.title}** · ${locking ? pick(lang, "signups locked", "inscriptions verrouillées") : pick(lang, "signups unlocked", "inscriptions déverrouillées")}`, components: [] });
        return;
      }
      default:
        await reply(interaction, missing);
        return;
    }
  }

  const core = await deps.db.raidCore.findFirst({ where: { id: id.entityId, guildId } });
  if (!core) { await reply(interaction, missing); return; }
  switch (id.action) {
    case "menu":
      await interaction.reply({ content: coreLine(core, lang), components: coreMenu(core, lang), flags: MessageFlags.Ephemeral });
      return;
    case "edit":
      await interaction.showModal(new ModalBuilder().setCustomId(officerModalId("core", core.id)).setTitle(pick(lang, "Edit core details", "Modifier le core")).addComponents(
        field("name", pick(lang, "Name", "Nom"), core.name, true, TextInputStyle.Short, 50),
        field("schedule", pick(lang, "Schedule (shown on the roster)", "Horaire (affiché sur le roster)"), core.schedule ?? "", false),
        field("loot", pick(lang, "Loot rules summary", "Résumé des règles de butin"), core.lootRulesNote ?? "", false, TextInputStyle.Paragraph, 300),
        field("officer", pick(lang, "Core officer role (name, id or none)", "Rôle officier du core (nom, id ou aucun)"), core.officerRoleId ? interaction.guild?.roles.cache.get(core.officerRoleId)?.name ?? core.officerRoleId : "", false, TextInputStyle.Short, 100)));
      return;
    case "archive":
      if (core.archivedAt) { await reply(interaction, pick(lang, "Already archived.", "Déjà archivé.")); return; }
      await interaction.update({
        content: `⚠️ ${pick(lang, "Archive", "Archiver")} ${coreLine(core, lang)}\n${pick(lang, "Its roster stops taking applications and automatic weekly raids stop. Members, raids, loot history and channels are kept; you can unarchive any time.", "Le roster n'accepte plus de candidatures et les raids hebdomadaires automatiques s'arrêtent. Membres, raids, historique de butin et salons sont conservés; vous pouvez désarchiver.")}`,
        components: [row(button(officerId("core", core.id, "archive-ok"), pick(lang, "Confirm archive", "Confirmer"), ButtonStyle.Danger), button(officerId("core", core.id, "menu"), pick(lang, "Keep active", "Garder actif")))]
      });
      return;
    case "archive-ok":
    case "unarchive": {
      const archiving = id.action === "archive-ok";
      if (archiving === Boolean(core.archivedAt)) { await reply(interaction, pick(lang, "Nothing to change.", "Rien à changer.")); return; }
      await interaction.deferUpdate();
      await deps.db.raidCore.update({ where: { id: core.id }, data: { archivedAt: archiving ? new Date() : null } });
      await audit(deps, guildId, actorId, "CORE_OFFICER", core.id, { change: archiving ? "archive" : "unarchive", name: core.name });
      await deps.refreshCore(interaction, guildId, core.id);
      await interaction.editReply({ content: `${archiving ? "🗄️" : "✅"} **${core.name}** · ${archiving ? pick(lang, "archived", "archivé") : pick(lang, "active again", "de nouveau actif")}`, components: [] });
      return;
    }
    case "appchan": {
      if (core.applicationChannelId) { await reply(interaction, coreLine(core, lang)); return; }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!interaction.guild) throw new Error("Server only.");
      try {
        const result = await createCoreApplicationChannel(interaction.guild, deps.db, core.id);
        await audit(deps, guildId, actorId, "CORE_OFFICER", core.id, { change: "application-channel", channelId: result.channelId, created: result.created });
        await interaction.editReply({ content: `📋 ${pick(lang, "Applications for", "Les candidatures pour")} **${core.name}** → <#${result.channelId}> (${pick(lang, "officers only", "officiers seulement")})` });
      } catch {
        await interaction.editReply({ content: pick(lang, "I could not create the channel: give my role \"Manage Channels\" and try again.", "Je n'ai pas pu créer le salon : donnez « Gérer les salons » à mon rôle puis réessayez.") });
      }
      return;
    }
    default:
      await reply(interaction, missing);
  }
}

// Mentions (only) the members still signed up, tentative or waitlisted, in the raid's own signup channel.
async function pingSignedUp(interaction: ButtonInteraction, deps: OfficerDeps, raid: { id: string; title: string; scheduledAt: Date; signupChannelId: string | null }, lang: "en" | "fr"): Promise<number> {
  const rows = await deps.db.raidSignup.findMany({ where: { raidId: raid.id, status: { in: ["SIGNED_UP", "MAYBE", "WAITLISTED"] } }, select: { member: { select: { discordUserId: true } } } });
  const users = [...new Set(rows.map(entry => entry.member.discordUserId))];
  const channel = raid.signupChannelId ? await interaction.client.channels.fetch(raid.signupChannelId).catch(() => null) : null;
  if (!users.length || !channel?.isTextBased() || !("send" in channel)) return 0;
  const head = pick(lang, `🚫 **${raid.title}** (<t:${Math.floor(raid.scheduledAt.getTime() / 1000)}:f>) is cancelled.`, `🚫 **${raid.title}** (<t:${Math.floor(raid.scheduledAt.getTime() / 1000)}:f>) est annulé.`);
  for (let index = 0; index < users.length; index += 40) {
    const chunk = users.slice(index, index + 40);
    await channel.send({ content: `${index === 0 ? `${head}\n` : ""}${chunk.map(user => `<@${user}>`).join(" ")}`, allowedMentions: { users: chunk } });
  }
  return users.length;
}

// The role named, mentioned or identified by an officer in the core form; "none" clears it.
export function resolveRole(value: string, roles: { cache: { values(): Iterable<{ id: string; name: string }> } }): { id: string | null } | null {
  const text = value.trim();
  if (!text || /^(none|aucun|aucune)$/i.test(text)) return { id: null };
  const id = /^<@&(\d+)>$/.exec(text)?.[1] ?? (/^\d{15,22}$/.test(text) ? text : null);
  const all = [...roles.cache.values()];
  const match = id ? all.find(role => role.id === id) : all.find(role => role.name.toLowerCase() === text.replace(/^@/, "").toLowerCase());
  return match ? { id: match.id } : null;
}

export async function handleOfficerModal(interaction: ModalSubmitInteraction, deps: OfficerDeps = defaultOfficerDeps): Promise<void> {
  const id = parseOfficerModalId(interaction.customId);
  if (!id) return;
  if (!officerAccess(interaction)) { await interaction.reply({ content: DENIED.en, flags: MessageFlags.Ephemeral }); return; }
  const guildId = await deps.guildIdFor(interaction);
  const lang = await deps.languageFor(guildId);
  const missing = pick(lang, "That raid or core is not on this server any more.", "Ce raid ou ce core n'est plus sur ce serveur.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actorId = interaction.user.id;
  try {
    if (id.kind === "raid") {
      const raid = await deps.db.raid.findFirst({ where: { id: id.entityId, guildId } });
      if (!raid) { await interaction.editReply({ content: missing }); return; }
      const timezone = (await guildService.getSettings(guildId))?.timezone ?? "America/Toronto";
      const title = interaction.fields.getTextInputValue("title").trim();
      const timeText = interaction.fields.getTextInputValue("time").trim();
      const sizeText = interaction.fields.getTextInputValue("size").trim();
      const notes = interaction.fields.getTextInputValue("notes").trim();
      const preset = sizeText ? SIZES.get(Number(sizeText)) : undefined;
      if (sizeText && !preset) throw new Error(pick(lang, "Raid size must be 10, 20, 25, 30 or 40.", "La taille doit être 10, 20, 25, 30 ou 40."));
      const scheduledAt = timeText && timeText !== formatRaidTime(raid.scheduledAt, timezone, lang) ? parseRaidTime(timeText, timezone) : undefined;
      const updated = await createRaidService(deps.db).edit(raid.id, guildId, {
        ...(title && title !== raid.title ? { title } : {}),
        ...(scheduledAt ? { scheduledAt } : {}),
        ...(notes !== (raid.description ?? "") ? { description: notes || null } : {}),
        ...(preset ? { tankLimit: preset.tankLimit, healerLimit: preset.healerLimit, dpsLimit: preset.dpsLimit } : {})
      });
      await audit(deps, guildId, actorId, "RAID_OFFICER", raid.id, {
        change: "edit", before: { title: raid.title, scheduledAt: raid.scheduledAt.toISOString() },
        after: { title: updated.title, scheduledAt: updated.scheduledAt.toISOString(), ...(preset ? { size: preset.raidSize } : {}) }
      });
      await deps.refreshRaid(interaction, guildId, raid.id);
      await interaction.editReply({ content: `✅ ${pick(lang, "Updated", "Mis à jour")}: **${updated.title}**` });
      return;
    }
    const core = await deps.db.raidCore.findFirst({ where: { id: id.entityId, guildId } });
    if (!core) { await interaction.editReply({ content: missing }); return; }
    const name = interaction.fields.getTextInputValue("name").trim();
    if (name.length < 2 || name.length > 50) throw new Error(pick(lang, "A core name is 2 to 50 characters.", "Le nom d'un core fait 2 à 50 caractères."));
    if (name !== core.name && await deps.db.raidCore.findFirst({ where: { guildId, id: { not: core.id }, name: { equals: name, mode: "insensitive" } } })) {
      throw new Error(pick(lang, `A core called "${name}" already exists.`, `Un core nommé « ${name} » existe déjà.`));
    }
    const officerText = interaction.fields.getTextInputValue("officer");
    const role = interaction.guild ? resolveRole(officerText, interaction.guild.roles) : { id: null };
    if (!role) throw new Error(pick(lang, "I could not find that role. Use its exact name, a mention or its id, or \"none\".", "Rôle introuvable. Utilisez son nom exact, une mention, son id, ou « aucun »."));
    const data = {
      name, schedule: interaction.fields.getTextInputValue("schedule").trim().slice(0, 100) || null,
      lootRulesNote: interaction.fields.getTextInputValue("loot").trim().slice(0, 300) || null, officerRoleId: role.id
    };
    await deps.db.raidCore.update({ where: { id: core.id }, data });
    await audit(deps, guildId, actorId, "CORE_OFFICER", core.id, {
      change: "edit", before: { name: core.name, schedule: core.schedule, lootRulesNote: core.lootRulesNote, officerRoleId: core.officerRoleId }, after: data
    });
    if (name !== core.name && interaction.guild) {
      const { renameCoreDiscord, coreChannelLanguage } = await import("../services/core-channels.js");
      await renameCoreDiscord(interaction.guild, { ...core, name }, await coreChannelLanguage(deps.db, guildId));
    }
    await deps.refreshCore(interaction, guildId, core.id);
    await interaction.editReply({ content: `✅ ${pick(lang, "Updated", "Mis à jour")}: **${name}**` });
  } catch (error) {
    await interaction.editReply({ content: `⚠️ ${error instanceof Error ? error.message : pick(lang, "Could not save.", "Enregistrement impossible.")}` });
  }
}

export type { OfficerAction };
