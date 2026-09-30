import type { PrismaClient } from "@prisma/client";
import { findProfessionHolders, professionCoverage } from "./profession-search.js";
import type { Lang } from "../i18n.js";

export async function professionDirectoryText(database: Pick<PrismaClient, "professionSkill">, guildId: string, lang: Lang = "en"): Promise<string> {
  const header = lang === "fr"
    ? "**Artisans de la guilde**\n`/craft who item:` : recettes connues. `/character profession who` : compétences. `/craft request` : demander une fabrication. Ouvrez vos métiers avec Guilded et synchronisez via le compagnon pour partager vos recettes."
    : "**Guild profession directory**\n`/craft who item:` finds known recipes. `/character profession who` lists skills. `/craft request` arranges a craft. Open profession windows with Guilded and sync through the companion to share recipes.";
  let text = header;
  const coverage = await professionCoverage(database, guildId);
  for (const row of coverage) {
    const holders = await findProfessionHolders(database, guildId, row.profession);
    const line = `\n**${row.profession}**: ${holders.slice(0, 3).map((holder) => `${holder.character} (${holder.skillLevel}, ${holder.member})`).join(" · ")}`;
    if (text.length + line.length > 1850) return `${text}\n…`;
    text += line;
  }
  return text + (coverage.length ? "" : lang === "fr" ? "\nAucun métier enregistré." : "\nNo professions recorded yet.");
}
