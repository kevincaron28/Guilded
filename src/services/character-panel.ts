import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction
} from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, t, type Lang } from "../i18n.js";
import { siteUrl } from "../site-url.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";
import { characterTrustMap, trustSuffix } from "./character-trust.js";
import { claimCharacter } from "./character-autolink.js";
import { tellAutoLinked, unlinkNotMine } from "./companion-link-dm.js";

// The /character panel (linking simplification, 13 November 2026; owner: "Approve, build it").
// One private message with the member's characters and buttons: link one, set the main, unlink, picture, refresh.
// Everything is a button, a select menu or a modal, so it needs no privileged intent, and it works the same in
// a DM: every custom id carries the Discord server id, nothing else is guessed from where it was pressed.
//
// Proof and conflicts: linking goes through claimCharacter, which only takes characters nobody has linked (the
// proof is the weakest, "named", like /character claim); unlinking goes through unlinkCharacter (detach, history
// kept, the member's own unlink sticks); setting the main only changes the member's own rows. A custom id never
// decides who owns what: every click re-reads the character and checks it belongs to the member who pressed.

export const PANEL_PREFIX = "linked:p:";
const MAX_OPTIONS = 25;

type Db = Pick<PrismaClient, "member" | "character" | "guildSettings" | "unclaimedCharacter" | "characterVerifyClaim" | "guildRosterEntry" | "memberLinkNotice">;
type PanelInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;
export interface PanelView { content: string; components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[]; allowedMentions: { parse: never[] } }

const id = (action: string, discordGuildId: string, extra?: string) => `${PANEL_PREFIX}${action}:${discordGuildId}${extra ? `:${extra}` : ""}`;
const label = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const row = <T extends ButtonBuilder | StringSelectMenuBuilder>(...components: T[]) => new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(components);
const view = (content: string, components: PanelView["components"] = []): PanelView => ({ content: content.slice(0, 1990), components, allowedMentions: { parse: [] } });

interface Context { member: { id: string; guildId: string; guild: { name: string; discordId: string } }; lang: Lang }

async function contextOf(database: Db, discordUserId: string, discordGuildId: string): Promise<Context | null> {
  const member = await database.member.findFirst({
    where: { discordUserId, guild: { discordId: discordGuildId }, status: { not: "LEFT" } },
    select: { id: true, guildId: true, guild: { select: { name: true, discordId: true } } }
  });
  if (!member) return null;
  const settings = await database.guildSettings.findUnique({ where: { guildId: member.guildId }, select: { language: true } });
  return { member, lang: asLang(settings?.language) };
}

/** The panel itself: the member's characters (main first) and the controls. */
export async function characterPanel(database: Db, discordUserId: string, discordGuildId: string, notice = ""): Promise<PanelView> {
  const context = await contextOf(database, discordUserId, discordGuildId);
  if (!context) return view(`${t("en", "panel.noServer")}\n${t("fr", "panel.noServer")}`);
  const { member, lang } = context;
  const characters = await database.character.findMany({ where: { memberId: member.id, detachedAt: null }, orderBy: [{ isMain: "desc" }, { name: "asc" }], take: MAX_OPTIONS });
  const book = await loadFullNameBook(database, member.guildId);
  const trust = await characterTrustMap(database, member.guildId, characters);
  const lines = characters.map((character) =>
    `${character.isMain ? "⭐" : "•"} ${escapeMarkdown(displayCharacterName(character, book))} — ${character.className}${character.level ? ` ${character.level}` : ""}${trustSuffix(trust.get(character.id), lang)}`);
  const content = [notice, t(lang, "panel.title", { server: escapeMarkdown(member.guild.name) }), lines.length ? lines.join("\n") : t(lang, "panel.empty")].filter(Boolean).join("\n\n");
  const options = (rows: typeof characters) => rows.map((character) => ({ label: label(displayCharacterName(character, book), 100), value: character.id, description: label(character.className, 100) }));
  const components = [row(
    new ButtonBuilder().setCustomId(id("link", discordGuildId)).setLabel(t(lang, "panel.link")).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel(t(lang, "panel.picture")).setStyle(ButtonStyle.Link).setURL(siteUrl("/me/pictures/")),
    new ButtonBuilder().setCustomId(id("refresh", discordGuildId)).setLabel(t(lang, "panel.refresh")).setStyle(ButtonStyle.Secondary))];
  const others = characters.filter((character) => !character.isMain);
  if (others.length) components.push(row(new StringSelectMenuBuilder().setCustomId(id("main", discordGuildId)).setPlaceholder(t(lang, "panel.mainMenu")).addOptions(options(others))));
  if (characters.length) components.push(row(new StringSelectMenuBuilder().setCustomId(id("unlink", discordGuildId)).setPlaceholder(t(lang, "panel.unlinkMenu")).addOptions(options(characters))));
  return view(content, components);
}

/** The "Link a character" step: the characters nobody has linked yet, plus a way to type the name. */
async function linkView(database: Db, context: Context): Promise<PanelView> {
  const { member, lang } = context;
  const rows = await database.unclaimedCharacter.findMany({ where: { guildId: member.guildId }, orderBy: { name: "asc" }, take: MAX_OPTIONS });
  const book = await loadFullNameBook(database, member.guildId);
  const guildId = member.guild.discordId;
  const components: PanelView["components"] = [];
  if (rows.length) components.push(row(new StringSelectMenuBuilder().setCustomId(id("claim", guildId)).setPlaceholder(t(lang, "panel.pickMenu"))
    .addOptions(rows.map((character) => ({ label: label(displayCharacterName(character, book), 100), value: character.id, description: label(`${character.className}${character.level ? ` ${character.level}` : ""}`, 100) })))));
  components.push(row(
    new ButtonBuilder().setCustomId(id("name", guildId)).setLabel(t(lang, "panel.typeName")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(id("refresh", guildId)).setLabel(t(lang, "panel.cancel")).setStyle(ButtonStyle.Secondary)));
  return view(t(lang, rows.length ? "panel.pick" : "panel.pickNone"), components);
}

/** Links one unclaimed character (by id or typed name) to the member; the usual DM with "Not mine" follows. */
async function claim(database: Db, interaction: PanelInteraction, context: Context, wanted: string): Promise<string> {
  const { member, lang } = context;
  const result = await claimCharacter(database as unknown as PrismaClient, member.guildId, member.id, wanted);
  void tellAutoLinked(interaction.client, database as unknown as Parameters<typeof tellAutoLinked>[1], member.guild.discordId, member.guildId, [{ memberId: member.id, count: 1 }]);
  const book = await loadFullNameBook(database, member.guildId);
  return t(lang, "panel.linkedOne", { name: escapeMarkdown(displayCharacterName(result.row, book)), kind: t(lang, result.isMain ? "panel.kindMain" : "panel.kindAlt") });
}

/** The member's own character, re-read on every click (a custom id never decides ownership). */
async function ownCharacter(database: Db, context: Context, characterId: string) {
  const character = await database.character.findUnique({ where: { id: characterId } });
  return character && character.memberId === context.member.id && !character.detachedAt ? character : null;
}

export async function handlePanelInteraction(interaction: PanelInteraction, database: Db): Promise<void> {
  const [action, discordGuildId, extra] = interaction.customId.slice(PANEL_PREFIX.length).split(":");
  if (!action || !discordGuildId) return;
  const context = await contextOf(database, interaction.user.id, discordGuildId);
  const reply = (content: string) => interaction.reply({ content: content.slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!context) { await reply(`${t("en", "panel.noServer")}\n${t("fr", "panel.noServer")}`); return; }
  const { lang } = context;
  // A component on the panel replaces the panel; a modal answer is a new private message.
  const show = async (next: PanelView) => { if (interaction.isModalSubmit()) await interaction.reply({ ...next, flags: MessageFlags.Ephemeral }); else await interaction.update(next); };
  const panel = (notice = "") => characterPanel(database, interaction.user.id, discordGuildId, notice);

  if (action === "refresh") { await show(await panel()); return; }
  if (action === "link") { await show(await linkView(database, context)); return; }
  if (action === "name" && interaction.isButton()) {
    await interaction.showModal(new ModalBuilder().setCustomId(id("namemodal", discordGuildId)).setTitle(t(lang, "panel.modalTitle")).addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("name").setLabel(t(lang, "panel.modalLabel")).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40))));
    return;
  }
  if ((action === "claim" && interaction.isStringSelectMenu()) || (action === "namemodal" && interaction.isModalSubmit())) {
    const wanted = interaction.isStringSelectMenu() ? interaction.values[0] : interaction.fields.getTextInputValue("name");
    if (!wanted) return;
    let notice: string;
    try { notice = await claim(database, interaction, context, wanted); } catch (error) { notice = `⚠️ ${error instanceof Error ? error.message : String(error)}`; }
    await show(await panel(notice));
    return;
  }
  if (action === "main" && interaction.isStringSelectMenu()) {
    const character = await ownCharacter(database, context, interaction.values[0] ?? "");
    if (!character) { await show(await panel(t(lang, "linked.notYours"))); return; }
    await (database as unknown as PrismaClient).$transaction([
      (database as unknown as PrismaClient).character.updateMany({ where: { memberId: context.member.id, isMain: true }, data: { isMain: false } }),
      (database as unknown as PrismaClient).character.update({ where: { id: character.id }, data: { isMain: true } })
    ]);
    const book = await loadFullNameBook(database, context.member.guildId);
    await show(await panel(t(lang, "panel.mainDone", { name: escapeMarkdown(displayCharacterName(character, book)) })));
    return;
  }
  if (action === "unlink" && interaction.isStringSelectMenu()) {
    const character = await ownCharacter(database, context, interaction.values[0] ?? "");
    if (!character) { await show(await panel(t(lang, "linked.notYours"))); return; }
    const book = await loadFullNameBook(database, context.member.guildId);
    await show(view(t(lang, "panel.unlinkAsk", { name: escapeMarkdown(displayCharacterName(character, book)) }), [row(
      new ButtonBuilder().setCustomId(id("ok", discordGuildId, character.id)).setLabel(t(lang, "panel.unlinkYes")).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(id("refresh", discordGuildId)).setLabel(t(lang, "panel.cancel")).setStyle(ButtonStyle.Secondary))]));
    return;
  }
  if (action === "ok" && interaction.isButton() && extra) {
    // The same unlink as the DM's "Not mine" button: detached with its history, BLOCKED so nothing links it back, officer log line.
    const notice = await unlinkNotMine(database as unknown as Parameters<typeof unlinkNotMine>[0], interaction.client, interaction.user.id, extra);
    await show(await panel(notice));
  }
}
