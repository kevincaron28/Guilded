import { ChannelType, SlashCommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import type { BankRequestStatus } from "../generated/prisma/client.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createBankService } from "../services/bank.js";
import { bankItems, dmRequester, guildLang, itemMarkdown, lowStock, lowStockLines, postRequestCard, refreshRequestCard, resolveBankItem,
  searchReplyText, statusIcon, statusWord, BANK_REQUEST_PREFIX } from "../services/guild-bank-member.js";
import { requireGuildContext } from "./context.js";

const bankService = createBankService(prisma);

export const bankCommand = new SlashCommandBuilder()
  .setName("bank")
  .setDescription("Search and request items from the guild bank.")
  .addSubcommand((sub) => sub.setName("search").setDescription("What the guild bank holds.")
    .addStringOption((o) => o.setName("item").setDescription("Item name").setMaxLength(100).setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("request").setDescription("Ask the guild bank for an item.")
    .addStringOption((o) => o.setName("item").setDescription("Item name").setMaxLength(100).setAutocomplete(true).setRequired(true))
    .addIntegerOption((o) => o.setName("quantity").setDescription("How many (default 1)").setMinValue(1).setMaxValue(1000))
    .addStringOption((o) => o.setName("note").setDescription("What it's for").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("mine").setDescription("Your recent bank requests."))
  .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel one of your open requests.")
    .addStringOption((o) => o.setName("id").setDescription("Request (start typing the item)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("list").setDescription("Open requests (officers).")
    .addStringOption((o) => o.setName("status").setDescription("Which requests (default open)")
      .addChoices(
        { name: "Open (pending + approved)", value: "OPEN" },
        { name: "Pending", value: "PENDING" },
        { name: "Approved", value: "APPROVED" },
        { name: "Fulfilled", value: "FULFILLED" },
        { name: "Denied", value: "DENIED" }
      )))
  .addSubcommand((sub) => sub.setName("handle").setDescription("Approve, fulfil, or deny a request (officers).")
    .addStringOption((o) => o.setName("id").setDescription("Request (start typing the item)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("action").setDescription("What to do").setRequired(true)
      .addChoices(
        { name: "Approve", value: "APPROVED" },
        { name: "Fulfilled (sent by mail/trade)", value: "FULFILLED" },
        { name: "Deny", value: "DENIED" }
      ))
    .addStringOption((o) => o.setName("reply").setDescription("Message to the requester").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("stock").setDescription("Low items; officers set a minimum per item.")
    .addStringOption((o) => o.setName("item").setDescription("Item in the bank").setMaxLength(100).setAutocomplete(true))
    .addIntegerOption((o) => o.setName("min").setDescription("Keep at least this many (0 removes)").setMinValue(0).setMaxValue(100000)))
  .addSubcommand((sub) => sub.setName("settings").setDescription("Bank switches (officers).")
    .addBooleanOption((o) => o.setName("member_search").setDescription("Members can search the contents"))
    .addBooleanOption((o) => o.setName("request_posts").setDescription("Post request cards for officers"))
    .addChannelOption((o) => o.setName("request_channel").setDescription("Where request cards go (default: log channel)").addChannelTypes(ChannelType.GuildText))
    .addBooleanOption((o) => o.setName("stock_alerts").setDescription("Alert when an item goes below its minimum")));

const isOfficer = (interaction: ChatInputCommandInteraction | ButtonInteraction) => !!interaction.member && hasPermission(interaction.member as GuildMember, "officer");

async function loadItems(guildId: string) {
  const contents = await prisma.guildBankContents.findUnique({ where: { guildId }, select: { observedAt: true, tabs: true } });
  return { observedAt: contents?.observedAt ?? null, items: contents ? bankItems(contents.tabs) : [] };
}

/** Autocomplete for item options: names in the last bank contents (members may type anything for a request). */
export async function bankItemChoices(guildId: string, query: string, officer: boolean) {
  const settings = await prisma.guildSettings.findUnique({ where: { guildId }, select: { guildBankMemberSearch: true } });
  if (!officer && settings?.guildBankMemberSearch === false) return [];
  const { items } = await loadItems(guildId);
  const q = query.trim().toLowerCase();
  return items.filter((item) => !q || item.name.toLowerCase().includes(q)).slice(0, 25)
    .map((item) => ({ name: `${item.name} ×${item.count}`.slice(0, 100), value: item.name.slice(0, 100) }));
}

export async function executeBank(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();
  const lang = await guildLang(prisma, context.guildId);
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const reply = (content: string) => interaction.reply({ content: content.slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const settings = await prisma.guildSettings.findUnique({ where: { guildId: context.guildId } });
  const memberSearch = isOfficer(interaction) || settings?.guildBankMemberSearch !== false;

  if (subcommand === "search") {
    if (!memberSearch) { await reply(t("Officers turned off member bank search here. Ask an officer.", "Les officiers ont désactivé la recherche dans la banque ici. Demandez à un officier.")); return; }
    const { observedAt, items } = await loadItems(context.guildId);
    await reply(searchReplyText(items, interaction.options.getString("item", true), observedAt, lang));
    return;
  }

  if (subcommand === "request") {
    const item = interaction.options.getString("item", true);
    const quantity = interaction.options.getInteger("quantity") ?? 1;
    const note = interaction.options.getString("note") ?? undefined;
    const match = memberSearch ? resolveBankItem((await loadItems(context.guildId)).items, item) : null;
    const request = await bankService.request(context.guildId, context.memberId, match?.name ?? item, quantity, note, { itemId: match?.id ?? null, source: "discord" });
    await reply(t(`Request sent: ${quantity} × ${match ? itemMarkdown(match.id, match.name) : `**${request.item}**`}. You'll get a DM when an officer handles it (\`/bank mine\` shows it too).`,
      `Demande envoyée : ${quantity} × ${match ? itemMarkdown(match.id, match.name) : `**${request.item}**`}. Vous recevrez un MP quand un officier la traitera (\`/bank mine\` l'affiche aussi).`));
    await postRequestCard(interaction.client, prisma, request).catch((error: unknown) => console.warn("Bank request card failed", error));
    return;
  }
  if (subcommand === "mine") {
    const requests = await bankService.mine(context.guildId, context.memberId);
    await reply(requests.length
      ? requests.map((r) => `${statusIcon(r.status)} ${r.quantity} × ${r.itemId ? itemMarkdown(r.itemId, r.item) : `**${r.item}**`} — ${statusWord(r.status, lang)}${r.reply ? ` ("${r.reply}")` : ""} \`${r.id}\``).join("\n")
      : t("You have no bank requests.", "Vous n'avez aucune demande à la banque."));
    return;
  }
  if (subcommand === "cancel") {
    const cancelled = await bankService.cancel(context.guildId, context.memberId, interaction.options.getString("id", true).replace(/`/g, "").trim());
    await reply(t("Request cancelled.", "Demande annulée."));
    const full = await prisma.bankRequest.findUnique({ where: { id: cancelled.id }, include: { member: true } });
    if (full) await refreshRequestCard(interaction.client, prisma, full).catch(() => undefined);
    return;
  }

  if (subcommand === "stock") {
    const itemText = interaction.options.getString("item");
    const min = interaction.options.getInteger("min");
    if (itemText && min !== null) {
      if (!isOfficer(interaction)) { await reply(t("Only officers can set bank minimums.", "Seuls les officiers fixent les minimums de la banque.")); return; }
      const { items } = await loadItems(context.guildId);
      const match = resolveBankItem(items, itemText);
      const known = match ?? await prisma.guildBankTarget.findFirst({ where: { guildId: context.guildId, itemName: { equals: itemText.trim(), mode: "insensitive" } } })
        .then((row) => row ? { id: row.itemId, name: row.itemName } : null);
      if (!known) { await reply(t("Pick an item from the list: minimums use the item as the bank last showed it.", "Choisissez un objet de la liste : les minimums utilisent l'objet tel que la banque l'a montré.")); return; }
      if (min === 0) {
        await prisma.guildBankTarget.deleteMany({ where: { guildId: context.guildId, itemId: known.id } });
        await reply(t(`No minimum for ${itemMarkdown(known.id, known.name)} any more.`, `Plus de minimum pour ${itemMarkdown(known.id, known.name)}.`));
        return;
      }
      await prisma.guildBankTarget.upsert({ where: { guildId_itemId: { guildId: context.guildId, itemId: known.id } },
        create: { guildId: context.guildId, itemId: known.id, itemName: known.name, minCount: min }, update: { minCount: min, itemName: known.name, lowSince: null } });
      await reply(t(`Keeping at least ${min} × ${itemMarkdown(known.id, known.name)}. The log channel gets one alert when an upload shows less.`,
        `Au moins ${min} × ${itemMarkdown(known.id, known.name)}. Le salon de journal reçoit une alerte quand un envoi en montre moins.`));
      return;
    }
    if (!memberSearch) { await reply(t("Officers turned off member bank search here.", "Les officiers ont désactivé la recherche dans la banque ici.")); return; }
    const targets = await prisma.guildBankTarget.findMany({ where: { guildId: context.guildId }, orderBy: { itemName: "asc" } });
    if (!targets.length) { await reply(t("No bank minimums yet. Officers: `/bank stock item:<item> min:<count>`.", "Aucun minimum. Officiers : `/bank stock item:<objet> min:<nombre>`.")); return; }
    const low = lowStock((await loadItems(context.guildId)).items, targets);
    await reply([low.length ? t("**Below target** (have / target):", "**Sous la cible** (disponible / cible) :") : t("Everything is at or above its target.", "Tout est à la cible ou au-dessus."),
      ...lowStockLines(low, lang), "", t(`${targets.length} item(s) have a minimum.`, `${targets.length} objet(s) ont un minimum.`)].join("\n"));
    return;
  }

  if (!isOfficer(interaction)) {
    await reply(t("Only officers can view and handle bank requests.", "Seuls les officiers voient et traitent les demandes à la banque."));
    return;
  }
  if (subcommand === "settings") {
    const data: { guildBankMemberSearch?: boolean; guildBankRequestPosts?: boolean; guildBankStockAlerts?: boolean; bankRequestChannelId?: string } = {};
    const memberSearchOn = interaction.options.getBoolean("member_search");
    const posts = interaction.options.getBoolean("request_posts");
    const alerts = interaction.options.getBoolean("stock_alerts");
    const channel = interaction.options.getChannel("request_channel");
    if (memberSearchOn !== null) data.guildBankMemberSearch = memberSearchOn;
    if (posts !== null) data.guildBankRequestPosts = posts;
    if (alerts !== null) data.guildBankStockAlerts = alerts;
    if (channel) data.bankRequestChannelId = channel.id;
    const saved = Object.keys(data).length && settings ? await prisma.guildSettings.update({ where: { guildId: context.guildId }, data }) : settings;
    if (!saved) { await reply(t("Run /setup first.", "Lancez d'abord /setup.")); return; }
    const on = (value: boolean) => value ? t("on", "activé") : t("off", "désactivé");
    await reply([
      `${t("Member search (contents only, never the ledger)", "Recherche des membres (contenu seulement, jamais le registre)")}: **${on(saved.guildBankMemberSearch)}**`,
      `${t("Request cards for officers", "Cartes de demande pour les officiers")}: **${on(saved.guildBankRequestPosts)}** · ${saved.bankRequestChannelId ? `<#${saved.bankRequestChannelId}>` : t("log channel", "salon de journal")}`,
      `${t("Low-stock alerts", "Alertes de stock bas")}: **${on(saved.guildBankStockAlerts)}**`,
      `${t("Weekly summary", "Résumé hebdomadaire")}: **${on(saved.guildBankWeeklyEnabled)}** (\`/officer stats bank\`)`
    ].join("\n"));
    return;
  }
  if (subcommand === "list") {
    const choice = interaction.options.getString("status") ?? "OPEN";
    const statuses: BankRequestStatus[] = choice === "OPEN" ? ["PENDING", "APPROVED"] : [choice as BankRequestStatus];
    const requests = await bankService.list(context.guildId, statuses);
    const text = requests.map((r) =>
      `${statusIcon(r.status)} ${r.quantity} × ${r.itemId ? itemMarkdown(r.itemId, r.item) : `**${r.item}**`} ${t("for", "pour")} ${r.member.displayName}${r.note ? ` (${r.note})` : ""}${r.source === "addon" ? " 🎮" : ""} <t:${Math.floor(r.createdAt.getTime() / 1000)}:R> \`${r.id}\``).join("\n");
    await reply(text || t("No requests.", "Aucune demande."));
    return;
  }

  const status = interaction.options.getString("action", true) as BankRequestStatus;
  const replyText = interaction.options.getString("reply") ?? undefined;
  const updated = await bankService.setStatus(context.guildId, interaction.options.getString("id", true).replace(/`/g, "").trim(), status, interaction.user.id, replyText);
  await reply(t(`Marked ${updated.quantity} × **${updated.item}** for ${updated.member.displayName} as ${statusWord(status, lang)}.`,
    `${updated.quantity} × **${updated.item}** pour ${updated.member.displayName} : ${statusWord(status, lang)}.`));
  await refreshRequestCard(interaction.client, prisma, updated).catch(() => undefined);
  await dmRequester(interaction.client, updated, lang);
}

/** The card's Approve / Fulfilled / Deny buttons (officers only). */
export async function handleBankRequestButton(interaction: ButtonInteraction): Promise<void> {
  const [id, status] = interaction.customId.slice(BANK_REQUEST_PREFIX.length).split(":");
  const context = await requireGuildContext(interaction);
  if (!context || !id || !status) return;
  const lang = await guildLang(prisma, context.guildId);
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  if (!isOfficer(interaction)) { await interaction.reply({ content: t("Only officers can handle bank requests.", "Seuls les officiers traitent les demandes à la banque."), flags: MessageFlags.Ephemeral }); return; }
  if (!["APPROVED", "FULFILLED", "DENIED"].includes(status)) return;
  await interaction.deferUpdate();
  const updated = await bankService.setStatus(context.guildId, id, status as BankRequestStatus, interaction.user.id).catch(async (error: unknown) => {
    await interaction.followUp({ content: error instanceof Error ? error.message : t("Could not update the request.", "Impossible de modifier la demande."), flags: MessageFlags.Ephemeral });
    return null;
  });
  if (!updated) return;
  await refreshRequestCard(interaction.client, prisma, updated).catch(() => undefined);
  await dmRequester(interaction.client, updated, lang);
}
