import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from "discord.js";

export type BattlegroundCardRecord = {
  id: string; reportId: string; gameEdition: string; mode: string; mapId: number;
  bracket: string; endedAt: Date; outcome: string; presence: string; status: string;
  correctionReason: string | null; conflictSummary?: string | null;
};

const safe = (value: string, limit = 240) => escapeMarkdown(value).replace(/@/g, "＠").slice(0, limit);
export function battlegroundRecordPanel(fr: boolean, guildId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[["history", fr ? "Mes résultats" : "My results"], ["stats", fr ? "Statistiques de guilde" : "Guild statistics"],
      ["privacy-help", fr ? "Confidentialité" : "Privacy"], ["setup", fr ? "Configuration officiers" : "Officer setup"]].map(([action, label]) =>
      new ButtonBuilder().setCustomId(`bgui:${guildId}:${action}`).setLabel(label!).setStyle(ButtonStyle.Secondary)));
}

export function battlegroundResultCard(row: BattlegroundCardRecord, fr: boolean) {
  const t = (en: string, french: string) => fr ? french : en;
  return new EmbedBuilder().setTitle(t("My battleground report", "Mon rapport de champ de bataille"))
    .setDescription(`${safe(row.gameEdition)} · ${safe(row.mode)} · ${t("API bracket", "Bracket API")}: ${safe(row.bracket)}\n${t("Map", "Carte")} ${row.mapId} · <t:${Math.floor(row.endedAt.getTime() / 1000)}:F>`)
    .addFields(
      { name: t("Reported outcome", "Résultat rapporté"), value: safe(row.outcome), inline: true },
      { name: t("Presence", "Présence"), value: safe(row.presence), inline: true },
      { name: t("Evidence status", "État des preuves"), value: safe(row.status), inline: true },
      { name: t("Report", "Rapport"), value: safe(row.id) },
      ...(row.conflictSummary ? [{ name: t("Conflict to review", "Conflit à examiner"), value: safe(row.conflictSummary, 600) }] : []),
      { name: t("Correction", "Correction"), value: row.correctionReason ? safe(row.correctionReason)
        : t("To withdraw an incorrect report: /bg correct report:<ID> reason:<reason>. A correction never manufactures a win.",
          "Pour retirer un rapport erroné : /bg correct report:<ID> reason:<motif>. Une correction ne crée jamais une victoire.") })
    .setFooter({ text: t("Private report. Provisional, incomplete, withdrawn or conflicting evidence does not earn competitive points. Not verified by Blizzard; no honor or ranking implied.",
      "Rapport privé. Les preuves provisoires, incomplètes, retirées ou contradictoires ne donnent aucun point compétitif. Non vérifié par Blizzard; aucun honneur ni classement.") });
}

export function battlegroundPrivacyHelp(fr: boolean) {
  return fr
    ? "Tout est partagé : vos rapports de match, lus après chaque match par votre Compagnon lié, alimentent votre historique et les statistiques de guilde. Il n'y a aucun réglage de confidentialité. Seuls vos propres résultats lisibles sont acceptés; aucun adversaire, message automatique ou récompense. Les adaptateurs non validés restent provisoires. Retirez un rapport erroné avec /bg correct."
    : "Everything is shared: your postmatch reports, read by your paired Companion after each match, feed your history and the guild statistics. There is no privacy setting. Only your own readable results are accepted; no opponents, automatic messages or awards. Unverified adapters remain provisional. Withdraw an incorrect report with /bg correct.";
}

export function battlegroundSetupHelp(fr: boolean) {
  return fr
    ? "1. Officiers : /setup start status:true → JcJ (facultatif) → Installer / réparer les panneaux, ou choisissez les salons existants. Réutilisez les accès de la bonne guilde; le bot doit voir, lire, envoyer et intégrer des liens.\n2. Les membres ouvrent /bg panel : groupes, résultats personnels et statistiques. /bg create utilise le salon choisi pour contrôler l'accès.\n3. Les rapports de chaque membre, lus par son Compagnon lié, sont partagés sans réglage.\n4. /bg stats sépare édition, saison, format et identifiant de bracket API (visible dans /bg result, pas une tranche de niveaux vérifiée). Il compte les participations provisoires, pas les matchs uniques vérifiés.\nAucun salon, rôle ou permission n'est modifié par cette commande. Aucune publication récurrente n'est activée."
    : "1. Officers: /setup start status:true → Battlegrounds (optional) → Install / repair panels, or select existing channels. Reuse access for the intended guild; the bot needs view, history, send and embed permissions.\n2. Members open /bg panel for groups, personal results and statistics. /bg create uses the chosen channel to control access.\n3. Each member's postmatch reports, read by their paired Companion, are shared with no setting.\n4. /bg stats separates edition, season, mode and API bracket identifier (shown in /bg result, not a verified level range). It counts provisional player participations, not verified unique matches.\nThis command changes no channels, roles or permissions and enables no recurring posts.";
}
