import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang } from "../i18n.js";
import { withDeadline } from "./blizzard-items.js";
import type { ItemDataProvider } from "./item-preview-data.js";
import type { WebhookEmbed } from "./item-preview-embed.js";
import { addCardQualities, loadProfessionCard, professionCardEmbed } from "./profession-link-card.js";

/** The profession-link card for a Discord server: the first of its guilds (editions) where exactly one character matches. */
export async function professionCardFor(db: Pick<PrismaClient, "guild" | "character" | "recipeKnown">, items: ItemDataProvider,
  discordGuildId: string, profession: string, names: string[], discordUserId: string | undefined): Promise<WebhookEmbed | null> {
  const guilds = await db.guild.findMany({ where: { discordId: discordGuildId }, select: { id: true, gameEdition: true, settings: { select: { language: true } } } });
  for (const guild of guilds) {
    const card = await loadProfessionCard(db, guild, profession, names, discordUserId);
    if (!card) continue;
    await addCardQualities(card, withDeadline(items, 3_000)); // slow answers still fill the cache for next time
    return professionCardEmbed(card, asLang(guild.settings?.language), process.env["PUBLIC_SITE_URL"]?.trim() || undefined);
  }
  return null;
}
