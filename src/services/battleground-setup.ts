import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, type Guild as DiscordGuild, type TextChannel } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { BG_SETUP_NAMES } from "../setup-names.js";
import { loadGuildScope, runInGuildScope } from "./guild-scope.js";

export const BG_SETUP_PARTS = ["groups", "results", "stats"] as const;
export type BgSetupPart = typeof BG_SETUP_PARTS[number];
export const BG_SETUP_FIELDS = {
  groups: { channel: "bgGroupsChannelId", message: "bgGroupsMessageId" },
  results: { channel: "bgResultsChannelId", message: "bgResultsMessageId" },
  stats: { channel: "bgStatsChannelId", message: "bgStatsMessageId" }
} as const;
// Reviewed legacy installation: adopt only the default scope of this exact server.
export const QG_BG_ADOPTION = {
  discordId: "1323321076478119967", category: "1565740141643964497",
  groups: { channel: "1552246570714402827", message: "1565730945766527019" },
  stats: { channel: "1565740142977880104", message: "1565740363321442386" },
  results: { channel: "1565740144299081798", message: "1565740366987005953" }
} as const;
const queues = new Map<string, Promise<unknown>>();
const say = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;
const posting = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

export function bgSetupPanel(part: BgSetupPart, guildId: string, lang: Lang) {
  const fr = lang === "fr";
  const marker = `Guilded BG setup • ${guildId} • ${part}`;
  const texts = {
    groups: fr ? "Créez ou rejoignez un groupe JcJ. Chaque joueur choisit sa participation. Aucun résultat, point ou récompense automatique." : "Create or join a PvP group. Each player chooses their participation. No automatic results, points or rewards.",
    results: fr ? "Mes résultats ouvre votre historique privé. /bg result affiche une fiche; /bg correct retire un rapport des statistiques. Capture et contribution aux statistiques exigent votre consentement dans /bg privacy. Rapports provisoires, sans classement officiel." : "My results opens your private history. /bg result shows a card; /bg correct withdraws a report from statistics. Capture and statistics contribution require your consent in /bg privacy. Provisional reports, no official ranking.",
    stats: fr ? "Statistiques de participations provisoires, pas de matchs uniques certifiés ni de MMR. Choisissez édition/saison, mode et identifiant API du bracket provenant de /bg result (pas une tranche de niveaux vérifiée). Seuls les membres consentants contribuent; conflits et retraits sont exclus." : "Provisional participation statistics, not certified unique matches or MMR. Choose edition/season, mode and the API bracket identifier from /bg result (not a verified level range). Only consenting members contribute; conflicts and withdrawals are excluded."
  };
  const actions = part === "groups" ? [["create", fr ? "Créer" : "Create"], ["join", fr ? "Rejoindre" : "Join"], ["mine", fr ? "Mes groupes" : "My groups"], ["upcoming", fr ? "À venir" : "Upcoming"]]
    : part === "results" ? [["history", fr ? "Mes résultats" : "My results"], ["privacy-help", fr ? "Confidentialité" : "Privacy"]]
    : [["stats", fr ? "Statistiques" : "Statistics"], ["privacy-help", fr ? "Confidentialité" : "Privacy"]];
  return { content: texts[part], embeds: [{ footer: { text: marker }, description: fr ? "Panneau statique • réponses personnelles privées" : "Static panel • private personal responses" }],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(actions.map(([action, label]) => new ButtonBuilder().setCustomId(`bgui:${guildId}:${action}`).setLabel(label!).setStyle(ButtonStyle.Secondary)))], allowedMentions: { parse: [] } };
}

/** Explicit install/repair only. Never called by normal setup or a background job. */
export async function ensureBattlegroundSetup(guild: DiscordGuild, db: PrismaClient, guildId: string, lang: Lang, actorId: string,
  selection?: { part: BgSetupPart; channelId: string }): Promise<string> {
  const previous = queues.get(guild.id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => install(guild, db, guildId, lang, actorId, selection));
  queues.set(guild.id, next);
  try { return await next; } finally { if (queues.get(guild.id) === next) queues.delete(guild.id); }
}

async function install(guild: DiscordGuild, db: PrismaClient, guildId: string, lang: Lang, actorId: string, selection?: { part: BgSetupPart; channelId: string }): Promise<string> {
  const scope = await loadGuildScope(db, guildId, guild.id);
  const actor = await guild.members.fetch({ user: actorId, force: true });
  if (!runInGuildScope(scope, () => hasPermission(actor, "officer"))) throw new Error(say(lang, "Officer permission is required.", "Permission officier requise."));
  const me = await guild.members.fetchMe();
  await guild.channels.fetch();
  await guild.roles.fetch();
  let settings = await db.guildSettings.findUniqueOrThrow({ where: { guildId } });
  const save = async (data: Parameters<typeof db.guildSettings.update>[0]["data"]) => { settings = await db.guildSettings.update({ where: { guildId }, data }); };
  const fail = (en: string, fr: string): never => { throw new Error(say(lang, en, fr)); };
  const checkOwner = async (id: string) => {
    // Match every ownership source used by interactionGuildScope, for channels AND parents.
    const [other, core, activity, binding] = await Promise.all([
      db.guildSettings.findFirst({ where: { guildId: { not: guildId }, guild: { discordId: guild.id }, OR: [
        "raidSignupChannelId", "logChannelId", "notifyChannelId", "weeklyReportChannelId", "answerChannelId", "dungeonChannelId", "dungeonLeaderboardChannelId", "dungeonSignupChannelId", "bgCategoryId", "bgGroupsChannelId", "bgResultsChannelId", "bgStatsChannelId", "raidLogChannelId", "lootChannelId", "craftChannelId", "readinessChannelId", "coreChannelId", "applicationChannelId", "attendanceChannelId", "guideChannelId", "pugChannelId"
      ].map(f => ({ [f]: id })) } }),
      db.raidCore.findFirst({ where: { guildId: { not: guildId }, guild: { discordId: guild.id }, OR: ["categoryId", "rosterChannelId", "signupChannelId", "lootChannelId", "raidLogChannelId", "chatChannelId", "voiceChannelId", "attendanceChannelId"].map(f => ({ [f]: id })) } }),
      db.activityCore.findFirst({ where: { guildId: { not: guildId }, guild: { discordId: guild.id }, channelId: id } }),
      db.wowGuildChannel.findUnique({ where: { discordId_channelId: { discordId: guild.id, channelId: id } } })
    ]);
    if (other || core || activity || (binding && binding.scopeGuildId !== guildId)) fail("This channel belongs to another guild scope. Select a separate channel.", "Ce salon appartient à une autre guilde. Choisissez un salon distinct.");
  };
  const fetchChannel = async (id: string) => {
    await checkOwner(id);
    const channel = await guild.channels.fetch(id);
    if (!channel || channel.guild.id !== guild.id) fail("Channel unavailable in this server.", "Salon indisponible sur ce serveur.");
    if (channel!.parentId) await checkOwner(channel!.parentId);
    if (!channel!.permissionsFor(actor)?.has(PermissionFlagsBits.ViewChannel)) fail("You cannot view this channel.", "Vous ne pouvez pas voir ce salon.");
    return channel!;
  };
  // Repair confirmed deletions only; permission/network failures must never create replacements.
  if (!selection) {
    for (const field of ["bgCategoryId", ...BG_SETUP_PARTS.map(p => BG_SETUP_FIELDS[p].channel)] as const) {
      const id = settings[field];
      if (!id) continue;
      await checkOwner(id);
      const found = await guild.channels.fetch(id).catch((error: unknown) => {
        if ((error as { code?: number }).code === 10003) return null;
        throw error;
      });
      if (!found) {
        const part = BG_SETUP_PARTS.find(p => BG_SETUP_FIELDS[p].channel === field);
        await save({ [field]: null, ...(part ? { [BG_SETUP_FIELDS[part].message]: null } : {}) });
      }
    }
  }
  if (selection) {
    const chosen = await fetchChannel(selection.channelId);
    if (chosen.type !== ChannelType.GuildText || !chosen.permissionsFor(me)?.has(posting)) fail("Choose a text channel where I can view, read history, send and embed links.", "Choisissez un salon texte où je peux voir, lire l’historique, envoyer et intégrer des liens.");
    const fields = BG_SETUP_FIELDS[selection.part];
    if (BG_SETUP_PARTS.some(p => p !== selection.part && settings[BG_SETUP_FIELDS[p].channel] === chosen.id)) fail("Use a separate channel for each panel.", "Utilisez un salon distinct pour chaque panneau.");
    if (settings[fields.channel] !== chosen.id) await save({ [fields.channel]: chosen.id, [fields.message]: null });
    // Selection installs only this panel; no unrelated channel is created.
  }
  const legacy = guild.id === QG_BG_ADOPTION.discordId && scope.guild.scopeKey === "default" ? QG_BG_ADOPTION : null;
  let categoryId = settings.bgCategoryId;
  if (!selection && !categoryId && legacy) {
    const category = await fetchChannel(legacy.category);
    if (category.type !== ChannelType.GuildCategory) fail("Legacy category is unavailable; select channels manually.", "Catégorie précédente indisponible; choisissez les salons manuellement.");
    categoryId = category.id;
    await save({ bgCategoryId: categoryId });
  }
  if (!selection && !categoryId && BG_SETUP_PARTS.some(p => !settings[BG_SETUP_FIELDS[p].channel])) {
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) fail("Manage Channels is missing. Use the existing-channel menus instead.", "Gérer les salons manque. Utilisez les menus de salons existants.");
    const memberRoleId = scope.memberRoleId ?? settings.memberRoleId;
    if (!memberRoleId || memberRoleId === guild.id || !guild.roles.cache.has(memberRoleId)) fail("Configure a member role or select existing channels manually; no public category was created.", "Configurez un rôle membre ou choisissez les salons existants; aucune catégorie publique créée.");
    const name = `${BG_SETUP_NAMES[lang].category} · ${scope.guild.name} · ${scope.guild.gameEdition}`.slice(0, 100);
    const matches = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory && c.name === name);
    if (matches.size) fail("An unsaved category has this name. Select its existing channels manually to avoid duplicates.", "Une catégorie non enregistrée porte ce nom. Choisissez ses salons manuellement pour éviter les doublons.");
    {
      const category = await guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: memberRoleId!, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands] },
        { id: me.id, allow: posting }
      ], reason: "Guilded optional battleground setup" });
      categoryId = category.id;
    }
    await save({ bgCategoryId: categoryId });
  }
  const notes: string[] = [];
  for (const part of selection ? [selection.part] : BG_SETUP_PARTS) {
    const fields = BG_SETUP_FIELDS[part];
    let id = settings[fields.channel];
    if (!id && legacy && !selection) {
      const old = await fetchChannel(legacy[part].channel);
      if (old.type !== ChannelType.GuildText || old.parentId !== categoryId) fail("Legacy layout changed. Select channels manually.", "La disposition précédente a changé. Choisissez les salons manuellement.");
      id = old.id;
      await save({ [fields.channel]: id, [fields.message]: legacy[part].message });
    }
    if (!id) {
      if (!categoryId) fail("Select an existing channel.", "Choisissez un salon existant.");
      const category = await fetchChannel(categoryId!);
      if (category.type !== ChannelType.GuildCategory) throw new Error(say(lang, "Saved category is not a category.", "La catégorie enregistrée est invalide."));
      const matches = guild.channels.cache.filter(c => c.type === ChannelType.GuildText && c.parentId === categoryId && ([BG_SETUP_NAMES.en[part], BG_SETUP_NAMES.fr[part]] as string[]).includes(c.name));
      if (matches.size > 1) fail("Several matching channels exist; select one manually.", "Plusieurs salons correspondent; choisissez-en un manuellement.");
      const existing = matches.first();
      if (existing) { await checkOwner(existing.id); id = existing.id; }
      else {
        if (!category.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) fail("Manage Channels is missing. Select an existing channel.", "Gérer les salons manque. Choisissez un salon existant.");
        const overwrites = category.permissionOverwrites.cache.map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }));
        if (part !== "groups") {
          const noPosting = PermissionFlagsBits.SendMessages | PermissionFlagsBits.SendMessagesInThreads | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.CreatePrivateThreads;
          if (!overwrites.some(o => o.id === guild.id)) overwrites.push({ id: guild.id, type: 0, allow: 0n, deny: noPosting });
          for (const overwrite of overwrites) {
            if (overwrite.id === me.id) continue;
            overwrite.allow &= ~noPosting;
            overwrite.deny |= noPosting;
          }
        }
        // A category may grant bot access through a role; read-only role denies must not block this bot.
        const botAllow = posting.reduce((bits, bit) => bits | bit, 0n);
        const bot = overwrites.find(o => o.id === me.id);
        if (bot) { bot.allow |= botAllow; bot.deny &= ~botAllow; }
        else overwrites.push({ id: me.id, type: 1, allow: botAllow, deny: 0n });
        const created = await guild.channels.create({ name: BG_SETUP_NAMES[lang][part], type: ChannelType.GuildText, parent: category.id,
          permissionOverwrites: overwrites, reason: "Guilded optional battleground setup" });
        id = created.id;
      }
      await save({ [fields.channel]: id });
    }
    const channel = await fetchChannel(id!);
    if (channel.type !== ChannelType.GuildText || !channel.permissionsFor(me)?.has(posting)) fail("Cannot post this panel. Grant view/history/send/embed access or select another channel.", "Impossible de publier ce panneau. Accordez voir/historique/envoyer/liens ou choisissez un autre salon.");
    const text = channel as TextChannel;
    const payload = bgSetupPanel(part, guildId, lang);
    const marker = `Guilded BG setup • ${guildId} • ${part}`;
    const savedId = settings[fields.message];
    let message = savedId ? await text.messages.fetch(savedId).catch((error: unknown) => {
      if ((error as { code?: number }).code === 10008) return null;
      throw error;
    }) : null;
    if (message && message.author.id !== me.id) fail("Saved panel is not mine; it was left untouched.", "Le panneau enregistré ne m’appartient pas; il reste intact.");
    if (!message) {
      const recent = await text.messages.fetch({ limit: 100 });
      const pinned = await text.messages.fetchPins();
      const candidates = [...recent.values(), ...pinned.items.map(p => p.message)].filter(m => m.author.id === me.id && m.embeds.some(e => e.footer?.text === marker));
      const unique = [...new Map(candidates.map(m => [m.id, m])).values()];
      if (unique.length > 1) fail("Multiple panels found; repair the saved message ID before retrying.", "Plusieurs panneaux trouvés; corrigez l’ID du message avant de réessayer.");
      message = unique[0] ?? null;
    }
    if (message) await message.edit({ content: payload.content, embeds: payload.embeds, components: payload.components, allowedMentions: { parse: [] } });
    else message = await text.send(payload);
    await save({ [fields.message]: message.id });
    if (!message.pinned && text.permissionsFor(me)?.has(PermissionFlagsBits.PinMessages)) await message.pin("Guilded battleground guide");
    notes.push(`<#${text.id}>${message.pinned ? "" : say(lang, " (pin manually)", " (épingler manuellement)")}`);
  }
  return say(lang, `Battleground panels saved: ${notes.join(", ")}. No automation or consent settings changed.`, `Panneaux JcJ enregistrés : ${notes.join(", ")}. Aucun réglage d’automatisation ou de consentement modifié.`);
}

