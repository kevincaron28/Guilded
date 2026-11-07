import { cleanCharacterName } from "../services/character-display.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createCraftService } from "../services/craft.js";
import { postToLogChannel } from "../services/housekeeping.js";
import { findProfessionHolders } from "../services/profession-search.js";
import { describeCrafters, findCrafters } from "../services/recipes.js";
import { requireGuildContext } from "./context.js";
import { PROFESSIONS } from "../wow-data.js";
import { postCraftRequest, syncCraftPost } from "./craft-board.js";
import { repairCraftBoardPermissions } from "./setup.js";
import { postCraftOffer, offerService, syncCraftOffer } from "./craft-offers.js";
import { boardLang } from "./craft-board.js";
import { updateProfessionDirectory } from "../services/profession-directory.js";
import { OFFER_LIMITS } from "../services/craft-offers.js";
import { tx } from "../i18n.js";

const craftService = createCraftService(prisma);

const idOption = (name: string) => (o: import("discord.js").SlashCommandStringOption) =>
  o.setName("id").setDescription(`Request, start typing the item (${name})`).setAutocomplete(true).setRequired(true);

export const craftCommand = new SlashCommandBuilder()
  .setName("craft")
  .setDescription("Ask guild crafters to make something, or pick up requests.")
  .addSubcommand((sub) => sub.setName("request").setDescription("Ask a guild crafter to make an item.")
    .addStringOption((o) => o.setName("item").setDescription("Item to craft").setMaxLength(100).setRequired(true))
    .addStringOption((o) => o.setName("profession").setDescription("Profession (shows who can make it)")
      .addChoices(...PROFESSIONS.map((name) => ({ name, value: name }))))
    .addIntegerOption((o) => o.setName("quantity").setDescription("How many (default 1)").setMinValue(1).setMaxValue(200))
    .addBooleanOption((o) => o.setName("materials").setDescription("You will provide the materials"))
    .addStringOption((o) => o.setName("note").setDescription("Details, tip, deadline").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("list").setDescription("Open requests crafters can pick up.")
    .addStringOption((o) => o.setName("profession").setDescription("Only this profession")
      .addChoices(...PROFESSIONS.map((name) => ({ name, value: name })))))
  .addSubcommand((sub) => sub.setName("who").setDescription("Who in the guild can craft an item (from the addon's profession scan).")
    .addStringOption((o) => o.setName("item").setDescription("Item or enchant (pick from the list, or type part of the name)").setAutocomplete(true).setMaxLength(100).setRequired(true)))
  .addSubcommand((sub) => sub.setName("mine").setDescription("Your open requests and the ones you're crafting."))
  .addSubcommand((sub) => sub.setName("claim").setDescription("Take a request (you'll craft it).").addStringOption(idOption("from /craft list")))
  .addSubcommand((sub) => sub.setName("done").setDescription("Mark a request you claimed as crafted.").addStringOption(idOption("from /craft mine")))
  .addSubcommand((sub) => sub.setName("release").setDescription("Give a claimed request back to the list.").addStringOption(idOption("from /craft mine")))
  .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel your request.").addStringOption(idOption("from /craft mine")))
  .addSubcommand((sub) => sub.setName("offer").setDescription("Offer a craft you can make (needs offers turned on).")
    .addStringOption((o) => o.setName("item").setDescription("Item or enchant from your recorded recipes").setAutocomplete(true).setMaxLength(100).setRequired(true))
    .addStringOption((o) => o.setName("price").setDescription("Price or tips welcome (you trade in game)").setMaxLength(100))
    .addBooleanOption((o) => o.setName("materials").setDescription("The buyer brings the materials"))
    .addStringOption((o) => o.setName("note").setDescription("Availability, details").setMaxLength(300))
    .addIntegerOption((o) => o.setName("days").setDescription(`Days the offer lasts (default ${OFFER_LIMITS.defaultDays})`).setMinValue(1).setMaxValue(OFFER_LIMITS.maxDays))
    .addBooleanOption((o) => o.setName("unverified").setDescription("Post an item with no recorded recipe, labelled unverified"))
    .addStringOption((o) => o.setName("profession").setDescription("Profession (unverified offers only)").addChoices(...PROFESSIONS.map((name) => ({ name, value: name })))))
  .addSubcommand((sub) => sub.setName("offers").setDescription("Active crafter offers."))
  .addSubcommand((sub) => sub.setName("withdraw").setDescription("Withdraw your craft offer.")
    .addStringOption((o) => o.setName("id").setDescription("Your offer").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("offer-setting").setDescription("Officers: turn crafter offers on or off for this server.")
    .addBooleanOption((o) => o.setName("enabled").setDescription("On or off").setRequired(true)))
  .addSubcommand((sub) => sub.setName("posts-setting").setDescription("Officers: turn the per-profession posts in the craft forum on or off.")
    .addBooleanOption((o) => o.setName("enabled").setDescription("On or off").setRequired(true)))
  .addSubcommand((sub) => sub.setName("permissions").setDescription("Officers: put the craft board's permissions right (members talk in posts, only the bot starts them)."));

function describe(request: { item: string; quantity: number; profession: string | null; materialsProvided: boolean; note: string | null }): string {
  return `${request.quantity} × **${request.item}**${request.profession ? ` (${request.profession})` : ""}`
    + `${request.materialsProvided ? ", mats provided" : ""}${request.note ? ` — ${request.note}` : ""}`;
}

export async function executeCraft(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();
  const isOfficer = !!interaction.member && hasPermission(interaction.member as GuildMember, "officer");
  const dm = (userId: string, text: string) => interaction.client.users.send(userId, text).catch(() => undefined);

  if (subcommand === "who") {
    const query = interaction.options.getString("item", true);
    await interaction.reply({ content: describeCrafters(query, await findCrafters(prisma, context.guildId, query), await boardLang(context.guildId)), flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "offer-setting") {
    if (!isOfficer) throw new Error("Only Officers or Guild Masters can turn crafter offers on or off.");
    const enabled = interaction.options.getBoolean("enabled", true);
    await offerService.setEnabled(context.guildId, enabled);
    await interaction.reply({ content: enabled ? "Crafter offers are on. Crafters use /craft offer; members answer with the button in the post. Trades happen in game: Guilded never handles gold." : "Crafter offers are off. Existing offers stay readable until they end; nobody can post or answer new ones.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === "posts-setting") {
    if (!isOfficer) throw new Error("Only Officers or Guild Masters can turn the profession posts on or off.");
    const enabled = interaction.options.getBoolean("enabled", true);
    await prisma.guildSettings.updateMany({ where: { guildId: context.guildId }, data: { professionPostsEnabled: enabled } });
    await interaction.reply({ content: enabled ? "The per-profession posts are on: each profession gets one post in the craft forum, edited in place as recipes are scanned." : "The per-profession posts are off. Existing posts stay but are no longer updated.", flags: MessageFlags.Ephemeral });
    if (enabled) await updateProfessionDirectory(interaction.guild).catch(() => undefined);
    return;
  }
  if (subcommand === "offer") {
    const lang = await boardLang(context.guildId);
    const offer = await offerService.create({
      guildId: context.guildId, crafterId: context.memberId, item: interaction.options.getString("item", true),
      profession: interaction.options.getString("profession") ?? undefined, price: interaction.options.getString("price") ?? undefined,
      materialsProvided: interaction.options.getBoolean("materials") ?? false, note: interaction.options.getString("note") ?? undefined,
      days: interaction.options.getInteger("days") ?? undefined, allowUnverified: interaction.options.getBoolean("unverified") ?? false
    });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const board = await postCraftOffer(interaction.guild, offer.id);
    await updateProfessionDirectory(interaction.guild).catch(() => undefined);
    await interaction.editReply({ content: (board.posted ? tx(lang, "Offer posted on the craft board: <#{id}>.", { id: board.threadId ?? "" }) : tx(lang, "Offer saved (ID `{id}`), but I couldn't post it to the board: is the craft channel a forum?", { id: offer.id }))
      + (offer.verified ? "" : " " + tx(lang, "It is labelled unverified.")) });
    return;
  }
  if (subcommand === "offers") {
    const lang = await boardLang(context.guildId);
    if (!(await offerService.isEnabled(context.guildId))) throw new Error(tx(lang, "Crafter offers are off on this server."));
    const offers = await offerService.active(context.guildId);
    const text = offers.map((o) => `• **${o.item}**${o.profession ? ` (${o.profession})` : ""} — ${o.crafter.displayName}${o.price ? `, ${o.price}` : ""}${o.verified ? "" : " ⚠️"}${o.threadId ? ` <#${o.threadId}>` : ""}`).join("\n");
    await interaction.reply({ content: text.slice(0, 1900) || tx(lang, "No active crafter offers."), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  if (subcommand === "withdraw") {
    const offer = await offerService.withdraw(context.guildId, interaction.options.getString("id", true).replace(/`/g, "").trim(), context.memberId, isOfficer);
    await syncCraftOffer(interaction.guild, offer.id);
    await updateProfessionDirectory(interaction.guild).catch(() => undefined);
    await interaction.reply({ content: `Withdrew your offer of ${offer.item}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "permissions") {
    if (!isOfficer) throw new Error("Only Officers or Guild Masters can change the craft board's permissions.");
    const settings = await prisma.guildSettings.findUnique({ where: { guildId: context.guildId } });
    if (!settings?.craftChannelId || !interaction.guild) throw new Error("No craft board is set. Run /setup start first.");
    const fixed = await repairCraftBoardPermissions(interaction.guild, settings.craftChannelId);
    await interaction.reply({
      content: fixed
        ? `Craft board permissions are set: everyone can read, talk inside a request's post and press its buttons. Only the bot (through /craft request and the pinned button) and leadership start posts.`
        : "The craft channel is not a forum, so nothing was changed. Create it with /setup.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (subcommand === "request") {
    const profession = interaction.options.getString("profession") ?? undefined;
    const request = await craftService.request({
      guildId: context.guildId,
      requesterId: context.memberId,
      item: interaction.options.getString("item", true),
      profession,
      quantity: interaction.options.getInteger("quantity") ?? 1,
      note: interaction.options.getString("note") ?? undefined,
      materialsProvided: interaction.options.getBoolean("materials") ?? false
    });
    const crafters = profession ? (await findProfessionHolders(prisma, context.guildId, profession)).slice(0, 5) : [];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const board = await postCraftRequest(interaction.guild, request.id);
    await interaction.editReply({
      content: (board.posted ? `Request posted on the craft board: <#${board.threadId}>.` : `Request posted: ${describe(request)}. ID \`${request.id}\`.`)
        + " You'll get a DM when someone claims it."
        + (crafters.length ? `\nGuild ${profession} crafters: ${crafters.map((c) => `${cleanCharacterName(c.character)} (${c.skillLevel})`).join(", ")}` : "")
    });
    if (interaction.guild && !board.posted) {
      await postToLogChannel(interaction.guild, `🔨 Craft request from ${interaction.user.username}: ${describe(request)} — /craft claim id:${request.id}`, "craft");
    }
    return;
  }
  if (subcommand === "list") {
    const requests = await craftService.list(context.guildId, interaction.options.getString("profession") ?? undefined);
    const text = requests.map((r) => `• ${describe(r)} for ${r.requester.displayName} <t:${Math.floor(r.createdAt.getTime() / 1000)}:R> \`${r.id}\``).join("\n");
    await interaction.reply({ content: text.slice(0, 1900) || "No open craft requests.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === "mine") {
    const requests = await craftService.mine(context.guildId, context.memberId);
    const text = requests.map((r) => r.requesterId === context.memberId
      ? `📝 ${describe(r)} — ${r.status === "CLAIMED" ? `being crafted by ${r.crafter?.displayName}` : "waiting for a crafter"} \`${r.id}\``
      : `🔨 ${describe(r)} for ${r.requester.displayName} (you claimed it) \`${r.id}\``).join("\n");
    await interaction.reply({ content: text.slice(0, 1900) || "Nothing open.", flags: MessageFlags.Ephemeral });
    return;
  }

  const id = interaction.options.getString("id", true).replace(/`/g, "").trim();
  if (subcommand === "claim") {
    const request = await craftService.claim(context.guildId, id, context.memberId);
    await syncCraftPost(interaction.guild, request.id);
    await interaction.reply({ content: `You claimed ${describe(request)} for ${request.requester.displayName}. \`/craft done id:${request.id}\` when it's made.`, flags: MessageFlags.Ephemeral });
    await dm(request.requester.discordUserId, `🔨 ${request.crafter?.displayName ?? "A guild crafter"} is crafting your ${describe(request)}.`);
    return;
  }
  if (subcommand === "done") {
    const request = await craftService.complete(context.guildId, id, context.memberId, isOfficer);
    await syncCraftPost(interaction.guild, request.id);
    await interaction.reply({ content: `Marked done: ${describe(request)}.`, flags: MessageFlags.Ephemeral });
    await dm(request.requester.discordUserId, `✅ Your ${describe(request)} is crafted by ${request.crafter?.displayName ?? "a guild crafter"}. Check your mail or arrange a trade.`);
    return;
  }
  if (subcommand === "release") {
    const request = await craftService.release(context.guildId, id, context.memberId, isOfficer);
    await syncCraftPost(interaction.guild, request.id);
    await interaction.reply({ content: `Released ${describe(request)} back to the list.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const request = await craftService.cancel(context.guildId, id, context.memberId, isOfficer);
  await syncCraftPost(interaction.guild, request.id);
  await interaction.reply({ content: `Cancelled ${describe(request)}.`, flags: MessageFlags.Ephemeral });
  if (request.crafter) await dm(request.crafter.discordUserId, `The craft request for ${describe(request)} was cancelled.`);
}
