import { MessageFlags, PermissionFlagsBits, escapeMarkdown, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from "discord.js";
import { prisma } from "../database.js";
import { groupWatchEvents, saveGroupWatch, watchWindow } from "../services/group-watch.js";
import { groupSubscriptionSchema, subscriptionPreview } from "../services/group-subscription.js";
import { asLang } from "../i18n.js";
import { guildService } from "./context.js";

export const groupWatchSubcommand = (sub: SlashCommandSubcommandBuilder) => sub.setName("watch").setDescription("Private group/vacancy preferences and matches")
  .setDescriptionLocalizations({ fr: "Préférences privées et groupes/places correspondants" })
  .addStringOption(o => o.setName("action").setDescription("Choose an action").setRequired(true).addChoices({ name: "Save", value: "save" }, { name: "Status", value: "status" }, { name: "Off", value: "off" }, { name: "Matches", value: "matches" }))
  .addStringOption(o => o.setName("roles").setDescription("tank,healer,dps"))
  .addStringOption(o => o.setName("available").setDescription("HH:mm-HH:mm"))
  .addStringOption(o => o.setName("timezone").setDescription("IANA timezone; guild default"))
  .addStringOption(o => o.setName("quiet").setDescription("HH:mm-HH:mm; default 22:00-08:00"))
  .addStringOption(o => o.setName("weekdays").setDescription("0=Sun to 6=Sat, comma separated; default all"))
  .addIntegerOption(o => o.setName("hours").setDescription("Expires after 1–168 hours; default 24").setMinValue(1).setMaxValue(168))
  .addStringOption(o => o.setName("type").setDescription("Opportunity type").addChoices({ name: "Both", value: "both" }, { name: "Dungeon groups", value: "group" }, { name: "Raid vacancies", value: "vacancy" }));

export async function executeGroupWatch(interaction: ChatInputCommandInteraction, guildId: string, memberId: string) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = await guildService.getSettings(guildId), fr = asLang(settings?.language) === "fr";
  const action = interaction.options.getString("action", true), now = new Date();
  let alert = await prisma.groupAlert.findFirst({ where: { guildId, memberId } });
  if (action === "save") {
    const roles = interaction.options.getString("roles"), available = interaction.options.getString("available");
    if (!roles || !available) throw new Error(fr ? "Précisez roles et available pour enregistrer." : "Provide roles and available to save preferences.");
    const type = interaction.options.getString("type") ?? "both";
    const weekdays = (interaction.options.getString("weekdays") ?? "0,1,2,3,4,5,6").split(",").map(value => value.trim());
    if (weekdays.some(value => !/^[0-6]$/.test(value))) throw new Error(fr ? "Jours : nombres de 0 à 6 séparés par des virgules." : "Weekdays: comma-separated numbers from 0 to 6.");
    alert = await saveGroupWatch(prisma, guildId, memberId, {
      optedIn: true, timezone: interaction.options.getString("timezone") ?? settings?.timezone ?? "America/Toronto",
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + (interaction.options.getInteger("hours") ?? 24) * 3_600_000).toISOString(),
      available: watchWindow(available), quiet: watchWindow(interaction.options.getString("quiet") ?? "22:00-08:00"),
      weekdays: [...new Set(weekdays.map(Number))],
      types: type === "both" ? ["group", "vacancy"] : [type]
    }, [...new Set(roles.split(",").map(role => role.trim().toUpperCase()))]);
  } else if (action === "off") {
    const parsed = groupSubscriptionSchema.safeParse(alert?.subscription);
    if (parsed.success) alert = await saveGroupWatch(prisma, guildId, memberId, { ...parsed.data, optedIn: false }, alert!.roles);
  } else if (!["status", "matches"].includes(action)) throw new Error("Unknown watch action.");
  const parsed = groupSubscriptionSchema.safeParse(alert?.subscription);
  if (!parsed.success || !alert) {
    await interaction.editReply({ content: fr ? "Aucune préférence ciblée. Utilisez action:save avec roles et available." : "No targeted preferences yet. Use action:save with roles and available.", allowedMentions: { parse: [] } });
    return;
  }
  const pref = parsed.data, clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  let content = `${pref.optedIn && Date.parse(pref.expiresAt) > now.getTime() ? fr ? "Activé" : "Opted in" : fr ? "Désactivé/expiré" : "Off/expired"} · ${pref.timezone} · ${alert.roles.join(", ")}\n`
    + `${clock(pref.available.start)}–${clock(pref.available.end)} · ${fr ? "Jours (0=dimanche)" : "Days (0=Sunday)"}: ${pref.weekdays.join(",")}\n`
    + `${fr ? "Silence" : "Quiet"}: ${clock(pref.quiet.start)}–${clock(pref.quiet.end)} · ${fr ? "Expire" : "Expires"} <t:${Math.floor(Date.parse(pref.expiresAt) / 1000)}:f>\n`
    + (fr ? "Maximum 2 notifications/24 h, espacées de 6 h. Aucun MP. " : "Maximum 2 notices/24h, 6h apart. No DMs. ")
    + (settings?.targetedAlertsEnabled ? fr ? "Envoi soumis aux autorisations du canal." : "Delivery requires channel access." : fr ? "Envoi automatique en attente d’approbation." : "Automatic delivery held pending approval.");
  if (action === "matches") {
    const member = await interaction.guild!.members.fetch(interaction.user.id);
    const characters = await prisma.character.findMany({ where: { memberId, member: { guildId } }, select: { level: true } });
    const events = await groupWatchEvents(prisma, guildId, now), lines: string[] = [];
    const history = await prisma.targetedAlertAttempt.findMany({ where: { guildId, memberId, attemptedAt: { gt: new Date(now.getTime() - 8 * 86_400_000) } },
      select: { eventKey: true, attemptedAt: true }, orderBy: { attemptedAt: "desc" }, take: 50 });
    for (const event of events) {
      if (event.excludedMemberIds.includes(memberId)) continue;
      const channel = await interaction.guild!.channels.fetch(event.channelId).catch(() => null);
      const visible = !!channel && "permissionsFor" in channel && !!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);
      if (!subscriptionPreview({ subscription: pref, candidate: { discordUserId: interaction.user.id, kinds: alert.kinds, roles: alert.roles, levels: characters.map(character => character.level) },
        event, now, history, isMember: true, canViewChannel: visible }).eligible) continue;
      lines.push(`[${escapeMarkdown(event.title).slice(0, 90)}](https://discord.com/channels/${interaction.guildId}/${event.channelId}/${event.messageId})`);
      if (lines.length === 5) break;
    }
    content += `\n\n${lines.join("\n") || (fr ? "Aucun résultat admissible maintenant." : "No eligible matches right now.")}`;
  }
  await interaction.editReply({ content: content.slice(0, 1950), allowedMentions: { parse: [] } });
}
