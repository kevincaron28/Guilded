import { parse } from "dotenv";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { createPilotPolicy } from "./pilot-policy.js";

export function pilotFilePolicy(source: string) {
  const env = parse(source);
  if (!["true", "false", "1", "0"].includes(env["HOSTED_PILOT"] ?? "false")) throw new Error("HOSTED_PILOT must be true or false.");
  return createPilotPolicy({ enabled: ["true", "1"].includes(env["HOSTED_PILOT"] ?? "false"),
    primaryGuildId: env["DISCORD_GUILD_ID"] ?? "", guildIds: env["HOSTED_GUILD_IDS"] ?? "",
    limit: Number(env["HOSTED_GUILD_LIMIT"] ?? 5) });
}

// Change only pilot settings. Preserve secrets, quoting and unrelated comments verbatim.
export function editPilotApprovals(source: string, action: "enable" | "approve" | "revoke", guildId?: string): string {
  const env = parse(source), primary = env["DISCORD_GUILD_ID"] ?? "";
  if (action !== "enable" && (!guildId || !/^\d{17,20}$/.test(guildId))) throw new Error("Supply a Discord server ID (17–20 digits).");
  if (action === "revoke" && guildId === primary) throw new Error("The owner's primary server cannot be revoked.");
  let ids = (env["HOSTED_GUILD_IDS"] ?? "").split(/[\s,]+/).filter(Boolean);
  if (action === "approve") ids.push(guildId!);
  if (action === "revoke") ids = ids.filter(id => id !== guildId);
  const policy = createPilotPolicy({ enabled: true, primaryGuildId: primary, guildIds: ids.join(","), limit: Number(env["HOSTED_GUILD_LIMIT"] ?? 5) });
  const changes: Record<string, string> = { HOSTED_PILOT: "true", HOSTED_GUILD_IDS: policy.guildIds.filter(id => id !== primary).join(",") };
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  for (const [key, value] of Object.entries(changes)) {
    const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "gm");
    source = pattern.test(source) ? source.replace(pattern, `${key}=${value}`) : `${source.replace(/\r?\n?$/, eol)}${key}=${value}${eol}`;
  }
  return source;
}

export function pilotInvite(source: string, guildId: string): string {
  const policy = pilotFilePolicy(source), appId = parse(source)["DISCORD_CLIENT_ID"] ?? "";
  if (!policy.enabled || !policy.allows(guildId)) throw new Error("Approve this server before generating its invitation.");
  if (!/^\d{17,20}$/.test(appId)) throw new Error("DISCORD_CLIENT_ID must be a Discord application ID.");
  const permissions = new PermissionsBitField([
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.PinMessages,
    PermissionFlagsBits.AddReactions, PermissionFlagsBits.CreateEvents, PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers
  ]);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({ client_id: appId, scope: "bot applications.commands", integration_type: "0",
    permissions: permissions.bitfield.toString(), guild_id: guildId, disable_guild_select: "true" }).toString();
  return url.toString();
}
