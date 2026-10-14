// Diablo category for the owner's server. REST only, never starts a second bot session.
//   npx tsx scripts/setup-diablo-area.ts            dry run: prints what exists and what would change
//   npx tsx scripts/setup-diablo-area.ts --apply    creates missing roles/channels, visible to the owner and the bot only
//   npx tsx scripts/setup-diablo-area.ts --publish  after owner approval: opens the area to the Diablo roles
// Idempotent: existing channels are matched by name inside the category and left in place.
// Members with Administrator (and the server owner) always see every channel; Discord has no way around that.
import { REST, Routes, ChannelType, PermissionFlagsBits as P, OverwriteType, type APIChannel, type APIRole, type APIGuild, type RESTAPIGuildChannelResolvable } from "discord.js";
import { config } from "../src/config.js";

const CATEGORY = "━━ 😈 DIABLO 😈 ━━";
const ROLES = ["Diablo II", "Diablo IV"] as const;
const MODERATOR_ROLE = "Chef de Guerre";
const BOT_ROLE = "Guilded bot permissions";
const REASON = "Guilded: Diablo area";

type Room = { name: string; type: ChannelType.GuildText | ChannelType.GuildVoice; topic?: string; readOnly?: boolean; slowmode?: number };
const ROOMS: Room[] = [
  { name: "📢diablo-annonces", type: ChannelType.GuildText, readOnly: true, topic: "Annonces Diablo : nouvelles saisons, ladder D2R, événements et résultats de la communauté." },
  { name: "🩸d2-projet", type: ChannelType.GuildText, topic: "Projet Diablo II: Resurrected : objectifs, inscriptions, progrès du groupe et défis de saison." },
  { name: "🔥d4-saison", type: ChannelType.GuildText, topic: "Diablo IV : saison en cours, objectifs, conseils et progression." },
  { name: "🗨diablo-chat", type: ChannelType.GuildText, topic: "Discussion Diablo, tous les épisodes. Les annonces officielles vont dans 📢diablo-annonces." },
  { name: "🤝diablo-groupes", type: ChannelType.GuildText, slowmode: 30, topic: "Trouve un groupe : précise le jeu (D2R/D4), le mode (ladder, hardcore, saison), l'activité et l'heure. Ex. : D2R ladder · Baal runs · 21 h." },
  { name: "💎diablo-drops-builds", type: ChannelType.GuildText, topic: "Tes meilleurs drops et builds, avec capture. Discussions de build bienvenues." },
  { name: "💰diablo-échange", type: ChannelType.GuildText, slowmode: 60, topic: "Échanges entre membres, en jeu seulement. Aucune vente contre de l'argent réel." },
  { name: "🔊 Diablo · Groupe 1", type: ChannelType.GuildVoice },
  { name: "🔊 Diablo · Groupe 2", type: ChannelType.GuildVoice }
];

const mode = process.argv.includes("--publish") ? "publish" : process.argv.includes("--apply") ? "apply" : "dry-run";
const rest = new REST({ version: "10", timeout: 15000 }).setToken(config.DISCORD_TOKEN);
const gid = config.DISCORD_GUILD_ID;
const write = mode !== "dry-run";
const log = (line: string) => console.log(`${write ? "" : "[dry run] "}${line}`);

const guild = await rest.get(Routes.guild(gid)) as APIGuild;
let roles = await rest.get(Routes.guildRoles(gid)) as APIRole[];
let channels = await rest.get(Routes.guildChannels(gid)) as APIChannel[];
const roleNamed = (name: string) => roles.find(r => r.name === name);
const bits = (...flags: bigint[]) => flags.reduce((a, b) => a | b, 0n).toString();
const BOT_ALLOW = bits(P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.AddReactions, P.ManageMessages, P.PinMessages, P.Connect);

// 1. Game roles: reuse Diablo IV, add Diablo II beside it. Same look as the other game roles.
for (const name of ROLES) {
  if (roleNamed(name)) { log(`role @${name} exists`); continue; }
  log(`create role @${name} (no colour, not hoisted, not mentionable, no permissions)`);
  if (!write) continue;
  const created = await rest.post(Routes.guildRoles(gid), { body: { name, permissions: "0", hoist: false, mentionable: false }, reason: REASON }) as APIRole;
  const anchor = roleNamed("Diablo IV") ?? roleNamed("World of Warcraft");
  if (anchor) await rest.patch(Routes.guildRoles(gid), { body: [{ id: created.id, position: anchor.position }], reason: REASON });
  roles = await rest.get(Routes.guildRoles(gid)) as APIRole[];
}

// 2. Permissions. Private: @everyone hidden, owner + bot allowed. Published: adds the Diablo roles and moderators.
const overwrites = (readOnly: boolean) => {
  const list = [
    { id: gid, type: OverwriteType.Role, deny: bits(P.ViewChannel, ...(readOnly ? [P.SendMessages, P.CreatePublicThreads] : [])), allow: "0" },
    { id: guild.owner_id, type: OverwriteType.Member, allow: bits(P.ViewChannel, P.SendMessages, P.Connect), deny: "0" },
    { id: config.DISCORD_CLIENT_ID, type: OverwriteType.Member, allow: BOT_ALLOW, deny: "0" }
  ];
  const botRole = roleNamed(BOT_ROLE);
  if (botRole) list.push({ id: botRole.id, type: OverwriteType.Role, allow: BOT_ALLOW, deny: "0" });
  if (mode === "publish") {
    for (const name of [...ROLES, MODERATOR_ROLE]) {
      const role = roleNamed(name);
      if (role) list.push({ id: role.id, type: OverwriteType.Role, allow: bits(P.ViewChannel), deny: "0" });
      else console.warn(`role @${name} is missing; run --apply first`);
    }
  }
  return list;
};

// 3. Category and rooms.
let category = channels.find(c => c.type === ChannelType.GuildCategory && "name" in c && c.name === CATEGORY);
if (!category) {
  log(`create category ${CATEGORY} (private)`);
  if (write) category = await rest.post(Routes.guildChannels(gid), { body: { name: CATEGORY, type: ChannelType.GuildCategory, permission_overwrites: overwrites(false) }, reason: REASON }) as APIChannel;
} else {
  log(`category ${CATEGORY} exists; ${write ? "updating" : "would update"} its permissions (${mode === "publish" ? "public to Diablo roles" : "private"})`);
  if (write) await rest.patch(Routes.channel(category.id), { body: { permission_overwrites: overwrites(false) }, reason: REASON });
}
for (const room of ROOMS) {
  const existing = category && channels.find(c => "parent_id" in c && c.parent_id === category!.id && "name" in c && c.name === room.name);
  const body = {
    permission_overwrites: overwrites(!!room.readOnly),
    ...(room.type === ChannelType.GuildText ? { topic: room.topic ?? "", rate_limit_per_user: room.slowmode ?? 0 } : {})
  };
  log(`${existing ? "update" : "create"} ${room.type === ChannelType.GuildVoice ? "voice" : "text"} ${room.name}${room.readOnly ? " (read-only)" : ""}`);
  if (!write || !category) continue;
  if (existing) await rest.patch(Routes.channel(existing.id), { body, reason: REASON });
  else await rest.post(Routes.guildChannels(gid), { body: { name: room.name, type: room.type, parent_id: category.id, ...body }, reason: REASON });
}

// 4. On publish, move the category up next to the other games (just above World of Warcraft).
if (mode === "publish" && category) {
  channels = await rest.get(Routes.guildChannels(gid)) as APIChannel[];
  const wow = channels.find(c => c.type === ChannelType.GuildCategory && "name" in c && /WORLD OF WARCRAFT/.test(c.name ?? ""));
  if (wow && "position" in wow) {
    await rest.patch(Routes.guildChannels(gid), { body: [{ id: category.id, position: wow.position }] satisfies RESTAPIGuildChannelResolvable[], reason: REASON });
    log("moved the Diablo category above World of Warcraft");
  }
  console.log("\nLast step for the owner: add @Diablo II and @Diablo IV to the welcome game picker (/setup start, step 5), so members can pick them.");
}
console.log(`\nDone (${mode}).`);
