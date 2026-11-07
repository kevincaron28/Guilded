import {
  ActionRowBuilder, ChannelType, MessageFlags, ModalBuilder, OverwriteType, PermissionFlagsBits, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ChatInputCommandInteraction, type Client, type Guild as DiscordGuild, type Interaction, type ModalSubmitInteraction,
  type StringSelectMenuInteraction, type TextChannel
} from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  actionInfo, boardComponents, boardEmbed, buildDigest, clampPage, confirmComponents, confirmFresh, detailComponents, detailEmbed, digestText,
  helpText, pageSlice, parseConsoleId, setupProgress, CONSOLE_PREFIX, type ActionId, type FleetRow, type Tier
} from "./owner-console-model.js";

// The bot owner's private fleet console (docs/OWNER_CONSOLE.md). One channel in the home server,
// visible to the application owner only; one board message edited in place; every action is
// owner-checked on every interaction, confirmed, and audited.

export const CONSOLE_CHANNEL_NAME = "guilded-owner-console";
const REFRESH_FLOOR_MS = 20_000;

/** The Discord-heavy parts, injected so tests need no live guild (defaults in owner-console-tools.ts). */
export interface ConsoleTools {
  updateMessages(guild: DiscordGuild, dbGuildId: string): Promise<string>;
  createChannels(guild: DiscordGuild, dbGuildId: string): Promise<string>;
  setupCheck(guild: DiscordGuild, dbGuildId: string): Promise<string>;
}

export interface ConsoleDeps {
  db: PrismaClient;
  client: Client;
  homeGuildId: string;
  ownerId: () => Promise<string | null>;
  tier: (discordId: string) => Tier;
  setTier: (discordId: string, tier: "approved" | "lite") => Promise<string>;
  version: string;
  tools: ConsoleTools;
  now?: () => number;
  warn?: (message: string) => void;
}

type Pending = { guildId: string; text: string; userId: string; at: number };
const DAY = 24 * 60 * 60 * 1000;
const isGone = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && [10003, 10008, 50001].includes((error as { code: number }).code);
const short = (text: string, max = 1900): string => text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function createOwnerConsole(deps: ConsoleDeps) {
  const { db, client } = deps;
  const clock = deps.now ?? Date.now;
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const pendingMessages = new Map<string, Pending>();
  let page = 0, lastRefresh = 0, queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const task = queue.then(fn, fn); queue = task.catch(() => undefined); return task; };

  const state = () => db.ownerConsole.findUnique({ where: { id: "main" } });
  const saveState = (data: { channelId?: string | null; boardMessageId?: string | null; digestEnabled?: boolean; digestLastAt?: Date | null; knownGuilds?: Record<string, string> }) =>
    db.ownerConsole.upsert({ where: { id: "main" }, create: { id: "main", ...data }, update: data });
  const audit = async (actorId: string, action: string, targetGuildId: string | null, detail: string | null) => {
    await db.ownerConsoleAudit.create({ data: { actorId, action, targetGuildId, detail: detail?.slice(0, 300) ?? null } });
    // A one-line trail in the console itself; never the typed message text.
    const row = await state();
    const channel = row?.channelId ? await client.channels.fetch(row.channelId).catch(() => null) : null;
    if (channel?.isTextBased() && "send" in channel) await channel.send({ content: short(`📝 <@${actorId}> ${action}${targetGuildId ? ` · \`${targetGuildId}\`` : ""}${detail ? ` · ${detail.slice(0, 200)}` : ""}`), allowedMentions: { parse: [] } }).catch(() => undefined);
  };

  /** True only for the application owner, in the home server, in the console channel. */
  async function authorized(interaction: Interaction): Promise<boolean> {
    if (interaction.user.id !== await deps.ownerId()) return false;
    if (interaction.guildId !== deps.homeGuildId) return false;
    const row = await state();
    return Boolean(row?.channelId) && interaction.channelId === row?.channelId;
  }
  const deny = (interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction) =>
    interaction.reply({ content: "Only the Guilded bot's owner can use the owner console.", flags: MessageFlags.Ephemeral });

  // ------------------------------------------------------------------ data
  // Live servers first, then the owner's test servers; the home server leads its group.
  let testIds = new Set<string>();
  const loadTestIds = async () => { testIds = new Set((await db.guild.findMany({ where: { isTestServer: true }, select: { discordId: true } })).map(record => record.discordId)); };
  const sortedGuilds = (): DiscordGuild[] => [...client.guilds.cache.values()].sort((a, b) =>
    Number(testIds.has(a.id)) - Number(testIds.has(b.id)) || (a.id === deps.homeGuildId ? -1 : b.id === deps.homeGuildId ? 1 : 0) || a.name.localeCompare(b.name));

  async function rowFor(guild: DiscordGuild): Promise<FleetRow> {
    const now = new Date(clock());
    const records = await db.guild.findMany({ where: { discordId: guild.id }, select: { id: true, scopeKey: true, gameEdition: true, officerSyncAt: true, isTestServer: true, settings: true } });
    const ids = records.map(record => record.id);
    const main = records.find(record => record.scopeKey === "default") ?? records[0];
    const settings = main?.settings ?? null;
    const [errors24h, characters, cores, upcomingRaids, audited, imported, honors] = ids.length ? await Promise.all([
      db.errorReport.count({ where: { guildId: guild.id, createdAt: { gte: new Date(now.getTime() - DAY) } } }),
      db.character.count({ where: { guildId: { in: ids }, member: { isTest: false } } }),
      db.raidCore.count({ where: { guildId: { in: ids } } }),
      db.raid.count({ where: { guildId: { in: ids }, isTest: false, status: "PLANNED", scheduledAt: { gte: now } } }),
      db.auditLog.findFirst({ where: { guildId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.addonImport.findFirst({ where: { guildId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.communityHonors.findFirst({ where: { guildId: { in: ids } }, select: { weeklyEnabled: true } })
    ]) : [await db.errorReport.count({ where: { guildId: guild.id, createdAt: { gte: new Date(now.getTime() - DAY) } } }), 0, 0, 0, null, null, null];
    const latest = (...dates: (Date | null | undefined)[]): Date | null => dates.filter((date): date is Date => Boolean(date)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const progress = setupProgress(settings);
    return {
      discordId: guild.id, name: guild.name, memberCount: guild.memberCount, tier: guild.id === deps.homeGuildId ? "approved" : deps.tier(guild.id),
      editions: [...new Set(records.map(record => record.gameEdition))], language: settings?.language ?? "en",
      lastActivity: latest(settings?.updatedAt, audited?.createdAt), setupDone: progress.done, setupTotal: progress.total,
      achievements: settings?.achievementsEnabled ?? true, announcements: settings?.achievementAnnounceEnabled ?? false, publicSharing: settings?.publicDungeonRuns ?? false,
      weeklyReport: settings?.weeklyReportEnabled ?? false, honors: honors ? honors.weeklyEnabled : null, errors24h,
      lastSync: latest(main?.officerSyncAt, imported?.createdAt), version: settings?.lastAnnouncedVersion ?? null, characters, cores, upcomingRaids,
      hasAdminChannel: Boolean(settings?.adminChannelId), untracked: !main, isTest: records.some(record => record.isTestServer)
    };
  }

  // ----------------------------------------------------------------- board
  async function renderBoard(pageNumber: number) {
    await loadTestIds();
    const guilds = sortedGuilds(), index = clampPage(pageNumber, guilds.length);
    const rows = await Promise.all(pageSlice(guilds, index).map(rowFor));
    const row = await state();
    return { index, content: "", embeds: [boardEmbed(rows, guilds.length, index, deps.version, new Date(clock()), { servers: guilds.length, members: guilds.reduce((sum, guild) => sum + guild.memberCount, 0) })], components: boardComponents(rows, guilds.length, index, row?.digestEnabled ?? false), allowedMentions: { parse: [] as never[] } };
  }

  /** Edits the board message in place (posting it once if it is missing). Quiet when the channel is gone. */
  function refresh(force = false): Promise<void> {
    return serial(async () => {
      const row = await state();
      if (!row?.channelId) return;
      if (!force && clock() - lastRefresh < REFRESH_FLOOR_MS) return;
      lastRefresh = clock();
      const channel = await client.channels.fetch(row.channelId).catch((error: unknown) => { if (isGone(error)) return null; throw error; });
      if (!channel || !channel.isTextBased() || !("send" in channel)) {
        // The channel was deleted: forget it once, quietly. /guilded-console setup makes a new one.
        await saveState({ channelId: null, boardMessageId: null });
        warn("Owner console channel is gone; run /guilded-console setup to recreate it.");
        return;
      }
      page = clampPage(page, client.guilds.cache.size);
      const view = await renderBoard(page);
      const existing = row.boardMessageId ? await channel.messages.fetch(row.boardMessageId).catch(() => null) : null;
      if (existing?.editable) await existing.edit(view);
      else await saveState({ boardMessageId: (await channel.send(view)).id });
    });
  }

  async function ensureChannel(home: DiscordGuild, ownerId: string): Promise<{ channel: TextChannel; created: boolean }> {
    const me = client.user!.id;
    const overwrites = [
      { id: home.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
      { id: ownerId, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands] },
      { id: me, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] }
    ];
    const row = await state();
    const known = row?.channelId ? await home.channels.fetch(row.channelId).catch(() => null) : null;
    const found = known ?? home.channels.cache.find(channel => channel.type === ChannelType.GuildText && channel.name === CONSOLE_CHANNEL_NAME) ?? null;
    if (found && found.type === ChannelType.GuildText) {
      await found.permissionOverwrites.set(overwrites, "Guilded owner console: owner-only");
      return { channel: found, created: false };
    }
    const channel = await home.channels.create({ name: CONSOLE_CHANNEL_NAME, type: ChannelType.GuildText, topic: "Guilded fleet board. Owner only.", permissionOverwrites: overwrites, reason: "Guilded owner console" });
    return { channel, created: true };
  }

  async function setupChannel(interaction: ChatInputCommandInteraction): Promise<void> {
    const owner = await deps.ownerId();
    if (!owner || interaction.user.id !== owner) { await interaction.reply({ content: "Only the Guilded bot's owner can set up the owner console.", flags: MessageFlags.Ephemeral }); return; }
    if (!interaction.guild || interaction.guildId !== deps.homeGuildId) { await interaction.reply({ content: "The owner console can only be set up in the home server (K Caron Projects).", flags: MessageFlags.Ephemeral }); return; }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { channel, created } = await ensureChannel(interaction.guild, owner);
    const before = await state();
    await saveState({ channelId: channel.id, ...(before?.channelId === channel.id ? {} : { boardMessageId: null }) });
    await refresh(true);
    await audit(owner, created ? "console setup (channel created)" : "console setup (re-run)", null, null);
    await interaction.editReply(`${created ? "Created" : "Checked"} <#${channel.id}>: hidden from everyone but you and the bot. Server administrators can still see any channel; keep that role to people you trust.`);
  }

  // ----------------------------------------------------------- interactions
  async function showDetail(interaction: StringSelectMenuInteraction | ButtonInteraction, discordId: string) {
    const guild = client.guilds.cache.get(discordId);
    if (!guild) { await interaction.reply({ content: "The bot is no longer in that server.", flags: MessageFlags.Ephemeral }); return; }
    const row = await rowFor(guild);
    await interaction.reply({ embeds: [detailEmbed(row, new Date(clock()))], components: detailComponents(row, discordId === deps.homeGuildId), flags: MessageFlags.Ephemeral });
  }

  const dbIdOf = async (discordId: string): Promise<string | null> =>
    (await db.guild.findFirst({ where: { discordId, scopeKey: "default" }, select: { id: true } }))?.id ?? null;

  const TOGGLES: Partial<Record<ActionId, { field: "achievementsEnabled" | "achievementAnnounceEnabled" | "publicDungeonRuns" | "weeklyReportEnabled"; name: string }>> = {
    achievements: { field: "achievementsEnabled", name: "achievements" }, announcements: { field: "achievementAnnounceEnabled", name: "achievement announcements" },
    sharing: { field: "publicDungeonRuns", name: "public dungeon sharing" }, weekly: { field: "weeklyReportEnabled", name: "the weekly report" }
  };

  /** Marks (on) or unmarks (off) a server as a test server; with `on` omitted it flips the mark. Owner-checked by the callers. */
  async function setTestServer(discordId: string, on: boolean | undefined, actorId: string): Promise<string> {
    const records = await db.guild.findMany({ where: { discordId }, select: { id: true, isTestServer: true } });
    if (!records.length) return "That server has no Guilded record yet (nobody has run a command there). Mark it after the first command.";
    const next = on ?? !records.some(record => record.isTestServer);
    await db.guild.updateMany({ where: { discordId }, data: { isTestServer: next } });
    const name = client.guilds.cache.get(discordId)?.name.replace(/[*_`~|>]/g, "") ?? discordId;
    await audit(actorId, next ? "mark test server" : "mark live server", discordId, name.slice(0, 80));
    void refresh(true).catch(() => undefined);
    return next ? `**${name}** is now a 🧪 test server: kept out of public leaderboards, the guild directory and shared boards.` : `**${name}** is now a live server and appears in public surfaces again.`;
  }

  /** Runs one confirmed action; returns the line to show the owner. Throws nothing the owner should not see. */
  async function perform(action: ActionId, discordId: string, actorId: string, text?: string): Promise<string> {
    const guild = client.guilds.cache.get(discordId);
    if (!guild) return "The bot is no longer in that server.";
    const home = discordId === deps.homeGuildId;
    const dbId = await dbIdOf(discordId);
    let result: string;
    if (action === "testmark") {
      return setTestServer(discordId, undefined, actorId);
    }
    if (action === "tier") {
      if (home) return "The home server is always approved.";
      result = await deps.setTier(discordId, deps.tier(discordId) === "approved" ? "lite" : "approved");
    } else if (action === "leave") {
      if (home) return "The bot never leaves the home server from the console.";
      await audit(actorId, "leave server", discordId, guild.name.slice(0, 80));
      await guild.leave();
      void refresh(true).catch(() => undefined);
      return `Left **${guild.name.replace(/[*_`~|>]/g, "")}**.`;
    } else if (action === "send") {
      const settings = dbId ? await db.guildSettings.findUnique({ where: { guildId: dbId }, select: { adminChannelId: true } }) : null;
      const channel = settings?.adminChannelId ? await guild.channels.fetch(settings.adminChannelId).catch(() => null) : null;
      if (!channel?.isTextBased() || !("send" in channel) || !text) return "That server has no usable admin channel; nothing was sent.";
      await channel.send({ content: short(`**Message from the Guilded bot owner**\n${text}`, 2000), allowedMentions: { parse: [] } });
      result = "Sent to the admin channel.";
    } else if (TOGGLES[action]) {
      const toggle = TOGGLES[action]!;
      if (!dbId) return "That server has not run /setup yet, so it has no settings to change.";
      const current = await db.guildSettings.findUnique({ where: { guildId: dbId }, select: { [toggle.field]: true } as never }) as Record<string, boolean | null> | null;
      if (!current) return "That server has no settings yet.";
      const next = !current[toggle.field];
      const data: Record<string, unknown> = { [toggle.field]: next };
      if (toggle.field === "publicDungeonRuns") data["publicDungeonRunsSince"] = next ? new Date(clock()) : null;
      await db.guildSettings.update({ where: { guildId: dbId }, data: data as never });
      result = `Turned ${toggle.name} ${next ? "on" : "off"}.`;
    } else {
      if (!dbId) return "That server has not run /setup yet; there is nothing to act on.";
      result = action === "messages" ? await deps.tools.updateMessages(guild, dbId) : action === "channels" ? await deps.tools.createChannels(guild, dbId) : await deps.tools.setupCheck(guild, dbId);
    }
    if (action !== "check") await audit(actorId, actionInfo(action)?.label ?? action, discordId, result.slice(0, 200));
    void refresh(true).catch(() => undefined);
    return result;
  }

  async function handleButton(interaction: ButtonInteraction, kind: string, args: string[]): Promise<void> {
    if (kind === "page" || kind === "refresh") {
      page = clampPage(Number(args[0]), client.guilds.cache.size);
      await interaction.deferUpdate();
      await refresh(true);
    } else if (kind === "digest") {
      const row = await state();
      await saveState({ digestEnabled: !row?.digestEnabled, ...(row?.digestEnabled ? {} : { digestLastAt: new Date(clock()), knownGuilds: Object.fromEntries(sortedGuilds().map(guild => [guild.id, guild.name])) }) });
      await audit(interaction.user.id, `daily digest ${row?.digestEnabled ? "off" : "on"}`, null, null);
      await interaction.deferUpdate();
      await refresh(true);
    } else if (kind === "help") {
      await interaction.reply({ content: short(helpText(), 2000), flags: MessageFlags.Ephemeral });
    } else if (kind === "act") {
      const action = actionInfo(args[0] ?? ""), discordId = args[1] ?? "";
      const guild = client.guilds.cache.get(discordId);
      if (!action || !guild) { await interaction.reply({ content: "That server or action is not available any more.", flags: MessageFlags.Ephemeral }); return; }
      const home = discordId === deps.homeGuildId;
      if (home && (action.id === "leave" || action.id === "tier")) { await interaction.reply({ content: "Not available for the home server.", flags: MessageFlags.Ephemeral }); return; }
      if (action.id === "send" || action.id === "leave") {
        const modal = new ModalBuilder().setCustomId(`${CONSOLE_PREFIX}${action.id === "send" ? "sendm" : "leavem"}:${discordId}`).setTitle(action.id === "send" ? "Message the admin channel" : "Leave this server?");
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(action.id === "send"
          ? new TextInputBuilder().setCustomId("text").setLabel("Message (posted as from the bot owner)").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)
          : new TextInputBuilder().setCustomId("text").setLabel(`Type LEAVE to remove the bot from this server`).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)));
        await interaction.showModal(modal);
        return;
      }
      await interaction.reply({ content: `**${action.label}** · ${guild.name.replace(/[*_`~|>]/g, "")}\n${action.confirm}`, components: [confirmComponents(action.id, discordId, clock())], flags: MessageFlags.Ephemeral });
    } else if (kind === "ok") {
      const [actionId, discordId, token, pendingKey] = args;
      const action = actionInfo(actionId ?? "");
      if (!action || !discordId || !confirmFresh(token, clock())) { await interaction.update({ content: "That confirmation expired. Open the server again.", components: [], embeds: [] }); return; }
      await interaction.update({ content: `Working on **${action.label}**…`, components: [] });
      let text: string | undefined;
      if (action.id === "send") {
        const pending = pendingKey ? pendingMessages.get(pendingKey) : undefined;
        pendingMessages.delete(pendingKey ?? "");
        if (!pending || pending.guildId !== discordId || pending.userId !== interaction.user.id || clock() - pending.at > 5 * 60_000) { await interaction.editReply({ content: "That message expired. Start again." }); return; }
        text = pending.text;
      }
      const result = await perform(action.id, discordId, interaction.user.id, text).catch((error: unknown) => `Failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`);
      await interaction.editReply({ content: short(result) });
    } else if (kind === "no") {
      await interaction.update({ content: "Cancelled.", components: [], embeds: [] });
    }
  }

  async function handleModal(interaction: ModalSubmitInteraction, kind: string, args: string[]): Promise<void> {
    const discordId = args[0] ?? "";
    const guild = client.guilds.cache.get(discordId);
    if (!guild) { await interaction.reply({ content: "The bot is no longer in that server.", flags: MessageFlags.Ephemeral }); return; }
    const text = interaction.fields.getTextInputValue("text").trim();
    if (kind === "leavem") {
      if (text !== "LEAVE") { await interaction.reply({ content: "Not confirmed: you must type LEAVE exactly. Nothing happened.", flags: MessageFlags.Ephemeral }); return; }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({ content: short(await perform("leave", discordId, interaction.user.id).catch((error: unknown) => `Failed: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`)) });
    } else if (kind === "sendm") {
      if (!text) { await interaction.reply({ content: "The message was empty. Nothing was sent.", flags: MessageFlags.Ephemeral }); return; }
      const key = Math.random().toString(36).slice(2, 10);
      pendingMessages.set(key, { guildId: discordId, text, userId: interaction.user.id, at: clock() });
      for (const [k, value] of pendingMessages) if (clock() - value.at > 5 * 60_000) pendingMessages.delete(k);
      await interaction.reply({ content: short(`**Send to ${guild.name.replace(/[*_`~|>]/g, "")}'s admin channel?**\n>>> ${text.replaceAll("@", "@​")}`, 1900), components: [confirmComponents("send", discordId, clock(), key)], flags: MessageFlags.Ephemeral });
    }
  }

  /** Routes any `oc:` component or modal. Returns false when the id is not the console's. */
  async function handle(interaction: Interaction): Promise<boolean> {
    if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return false;
    const parsed = parseConsoleId(interaction.customId);
    if (!parsed) return false;
    if (!await authorized(interaction)) { await deny(interaction); return true; }
    if (interaction.isStringSelectMenu()) { if (parsed.kind === "pick" && interaction.values[0]) await showDetail(interaction, interaction.values[0]); }
    else if (interaction.isModalSubmit()) await handleModal(interaction, parsed.kind, parsed.args);
    else await handleButton(interaction, parsed.kind, parsed.args);
    return true;
  }

  /** Hourly: posts the opt-in daily digest once a day. Off unless the owner turned it on. */
  async function digestTick(): Promise<void> {
    const row = await state();
    if (!row?.digestEnabled || !row.channelId || (row.digestLastAt && clock() - row.digestLastAt.getTime() < DAY)) return;
    const channel = await client.channels.fetch(row.channelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return;
    await loadTestIds();
    const guilds = sortedGuilds();
    const current = await Promise.all(guilds.map(async guild => ({ id: guild.id, name: guild.name, errors24h: await db.errorReport.count({ where: { guildId: guild.id, createdAt: { gte: new Date(clock() - DAY) } } }) })));
    const digest = buildDigest({ known: (row.knownGuilds as Record<string, string> | null) ?? null, current });
    await channel.send({ content: digestText(digest), allowedMentions: { parse: [] } });
    await saveState({ digestLastAt: new Date(clock()), knownGuilds: Object.fromEntries(current.map(guild => [guild.id, guild.name])) });
  }

  return { setupChannel, refresh, handle, digestTick, authorized, rowFor, perform, state, setTestServer };
}

export type OwnerConsole = ReturnType<typeof createOwnerConsole>;
