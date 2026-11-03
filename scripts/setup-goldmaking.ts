// Goldmaking section for the Québec Gold server. REST only: never starts a second bot session.
//   npx tsx scripts/setup-goldmaking.ts                         dry run: reads Discord, prints every change it would make
//   npx tsx scripts/setup-goldmaking.ts --apply                 creates what is missing, then verifies it with fresh API reads
//   npx tsx scripts/setup-goldmaking.ts --verify                read-only verification of an existing section
//   --moderator-id <userId>                                      confirm the exact account for @crashinbananas (required if the search is ambiguous)
//   --allow-guild-name-mismatch                                  proceed when DISCORD_GUILD_ID is not named "Québec Gold"
// Idempotent: categories, channels, the role, tags and bot posts are matched by name/marker and never duplicated.
// Existing channels, roles and permission overwrites are preserved: for something that already exists, only the
// Goldmaking Moderator overwrite (and the bot's own) is added when missing. Nothing is deleted.
import {
  REST, Routes, ChannelType, PermissionFlagsBits as P, OverwriteType, ChannelFlags, DiscordAPIError,
  type APIChannel, type APIRole, type APIGuild, type APIGuildMember, type APIMessage, type APIOverwrite
} from "discord.js";
import { config } from "../src/config.js";
import {
  START_CATEGORY, LIBRARY_CATEGORY, MODERATOR_ROLE, MODERATOR_USERNAME, MARKER, TEXT_CHANNELS, FORUMS,
  TEMPLATE_THREAD_TITLE, templatePosts, type TextChannelDef, type ForumDef
} from "./goldmaking-content.js";

const argv = process.argv.slice(2);
const argValue = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const apply = argv.includes("--apply");
const verifyOnly = argv.includes("--verify");
const write = apply && !verifyOnly;
const REASON = "Guilded: Goldmaking section";
const COLOR = 0xd4a017;

const rest = new REST({ version: "10", timeout: 20000 }).setToken(config.DISCORD_TOKEN);
const gid = config.DISCORD_GUILD_ID;
const botId = config.DISCORD_CLIENT_ID;
let failures = 0;
let warnings = 0;
const log = (line: string) => console.log(`${write ? "" : verifyOnly ? "[verify] " : "[dry run] "}${line}`);
const warn = (line: string) => { warnings++; console.warn(`WARN  ${line}`); };
const fail = (line: string) => { failures++; console.error(`FAIL  ${line}`); };
const describeError = (e: unknown) => e instanceof DiscordAPIError ? `HTTP ${e.status}, code ${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch (e) { fail(`${label}: ${describeError(e)}`); return undefined; }
}

const bits = (...flags: bigint[]) => flags.reduce((a, b) => a | b, 0n);
const str = (n: bigint) => n.toString();
const MOD_ALLOW = bits(P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.EmbedLinks, P.AttachFiles, P.AddReactions, P.ManageMessages, P.ManageThreads, P.PinMessages);
const BOT_ALLOW = MOD_ALLOW;
const READ_ONLY_DENY = bits(P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads);
const NEEDED_GUILD_PERMS: [string, bigint][] = [
  ["View Channels", P.ViewChannel], ["Manage Channels", P.ManageChannels], ["Manage Roles", P.ManageRoles],
  ["Send Messages", P.SendMessages], ["Send Messages in Threads", P.SendMessagesInThreads], ["Create Public Threads", P.CreatePublicThreads],
  ["Embed Links", P.EmbedLinks], ["Read Message History", P.ReadMessageHistory], ["Manage Messages", P.ManageMessages],
  ["Manage Threads", P.ManageThreads], ["Pin Messages", P.PinMessages]
];
// Permissions the moderator role must never hold at role level (it is created with none).
const FORBIDDEN_ROLE_PERMS: [string, bigint][] = [
  ["Administrator", P.Administrator], ["Manage Channels", P.ManageChannels], ["Manage Roles", P.ManageRoles], ["Manage Guild", P.ManageGuild],
  ["Manage Messages (server-wide)", P.ManageMessages], ["Manage Threads (server-wide)", P.ManageThreads], ["Kick Members", P.KickMembers], ["Ban Members", P.BanMembers],
  ["Moderate Members", P.ModerateMembers], ["Manage Webhooks", P.ManageWebhooks], ["Mention Everyone", P.MentionEveryone]
];

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- Preflight: guild, bot permissions, hierarchy, moderator identity ------------------------------------------------
const guild = await rest.get(Routes.guild(gid)) as APIGuild;
let roles = await rest.get(Routes.guildRoles(gid)) as APIRole[];
let channels = await rest.get(Routes.guildChannels(gid)) as APIChannel[];
console.log(`Guild: ${guild.name} (${gid}) — mode: ${verifyOnly ? "verify" : write ? "APPLY" : "dry run"}`);

const preflightErrors: string[] = [];
if (!/quebec\s*gold/.test(normalize(guild.name)) && !argv.includes("--allow-guild-name-mismatch")) {
  preflightErrors.push(`DISCORD_GUILD_ID points at "${guild.name}", not Québec Gold. Fix the configuration, or pass --allow-guild-name-mismatch if this is intended.`);
}

const botMember = await rest.get(Routes.guildMember(gid, botId)) as APIGuildMember;
const everyoneRole = roles.find(r => r.id === gid);
const botRoles = roles.filter(r => botMember.roles.includes(r.id));
const botPerms = [everyoneRole, ...botRoles].reduce((acc, r) => acc | BigInt(r?.permissions ?? "0"), 0n);
const botIsAdmin = (botPerms & P.Administrator) !== 0n;
const missingPerms = botIsAdmin ? [] : NEEDED_GUILD_PERMS.filter(([, flag]) => (botPerms & flag) === 0n).map(([name]) => name);
if (missingPerms.length) preflightErrors.push(`The bot role lacks: ${missingPerms.join(", ")}.`);
const botTop = Math.max(0, ...botRoles.map(r => r.position));
const existingModRole = roles.find(r => r.name === MODERATOR_ROLE);
if (existingModRole) {
  if (botTop <= existingModRole.position && !botIsAdmin) preflightErrors.push(`The bot's highest role (position ${botTop}) is not above @${MODERATOR_ROLE} (position ${existingModRole.position}).`);
  const risky = FORBIDDEN_ROLE_PERMS.filter(([, f]) => (BigInt(existingModRole.permissions) & f) !== 0n).map(([n]) => n);
  if (risky.length) warn(`Existing role @${MODERATOR_ROLE} already holds ${risky.join(", ")}. It is preserved as-is; remove those permissions manually.`);
} else if (botTop < 2 && !botIsAdmin) {
  preflightErrors.push(`The bot's highest role is at position ${botTop}; it must sit above a newly created role (position 1) to assign it.`);
}
log(`bot permissions: ${botIsAdmin ? "Administrator" : missingPerms.length ? `missing ${missingPerms.join(", ")}` : "all required present"}; highest bot role position ${botTop}`);

// Exact account for the moderator. Anything but one exact username match stops the run before any change.
type Candidate = { id: string; username: string; nick: string | null; global: string | null };
const toCandidate = (m: APIGuildMember): Candidate | undefined => m.user ? { id: m.user.id, username: m.user.username, nick: m.nick ?? null, global: m.user.global_name ?? null } : undefined;
let moderator: Candidate | undefined;
const forcedId = argValue("--moderator-id");
if (forcedId) {
  const member = await rest.get(Routes.guildMember(gid, forcedId)).catch(() => undefined) as APIGuildMember | undefined;
  const c = member && toCandidate(member);
  if (!c) preflightErrors.push(`--moderator-id ${forcedId} is not a member of this server.`);
  else if (c.username.toLowerCase() !== MODERATOR_USERNAME) preflightErrors.push(`--moderator-id ${forcedId} is "${c.username}", not "${MODERATOR_USERNAME}". Not assigning.`);
  else moderator = c;
} else {
  const found = await rest.get(Routes.guildMembersSearch(gid), { query: new URLSearchParams({ query: MODERATOR_USERNAME, limit: "20" }) }) as APIGuildMember[];
  const candidates = found.map(toCandidate).filter((c): c is Candidate => !!c);
  const exact = candidates.filter(c => c.username.toLowerCase() === MODERATOR_USERNAME);
  if (exact.length === 1) moderator = exact[0];
  else {
    const list = candidates.map(c => `    ${c.id}  username=${c.username}  display=${c.global ?? "-"}  nick=${c.nick ?? "-"}`).join("\n") || "    (no member found)";
    preflightErrors.push(`Cannot identify "${MODERATOR_USERNAME}" unambiguously (${exact.length} exact matches). Candidates:\n${list}\n  Confirm the right ID and re-run with --moderator-id <id>.`);
  }
}
if (moderator) log(`moderator account: ${moderator.username} — user ID ${moderator.id}${moderator.nick ? ` (server nickname "${moderator.nick}")` : ""}`);

if (preflightErrors.length) {
  for (const e of preflightErrors) console.error(`BLOCKED  ${e}`);
  if (write) { console.error("\nNothing was changed. Resolve the points above and re-run."); process.exit(2); }
  console.error("\n(dry run continues read-only so you can review the plan; --apply would refuse)");
}

// ---- Snapshot of everything outside the section, to prove it is untouched -----------------------------------------
const sectionNames = new Set<string>([START_CATEGORY, LIBRARY_CATEGORY, ...TEXT_CHANNELS.map(c => c.name), ...FORUMS.map(f => f.name)]);
const snapshotOutside = (list: APIChannel[]) => list
  .filter(c => !("name" in c && c.name && sectionNames.has(c.name)))
  .map(c => ({ id: c.id, name: "name" in c ? c.name : null, parent: "parent_id" in c ? c.parent_id : null, topic: "topic" in c ? c.topic : null, ow: "permission_overwrites" in c ? c.permission_overwrites : null }))
  .sort((a, b) => a.id.localeCompare(b.id));
const before = snapshotOutside(channels);
const rolesBefore = roles.filter(r => r.name !== MODERATOR_ROLE).map(r => ({ id: r.id, name: r.name, permissions: r.permissions, position: r.position })).sort((a, b) => a.id.localeCompare(b.id));

// ---- 1. Role --------------------------------------------------------------------------------------------------------
let modRole = existingModRole;
if (verifyOnly) { /* read-only */ }
else if (modRole) log(`role @${MODERATOR_ROLE} exists (${modRole.id}); permissions left untouched`);
else {
  log(`create role @${MODERATOR_ROLE} (no server-wide permissions, not hoisted, not mentionable)`);
  if (write && !preflightErrors.length) modRole = await step("create role", async () =>
    await rest.post(Routes.guildRoles(gid), { body: { name: MODERATOR_ROLE, permissions: "0", hoist: false, mentionable: false }, reason: REASON }) as APIRole);
}
if (modRole && moderator && !verifyOnly) {
  const member = await rest.get(Routes.guildMember(gid, moderator.id)) as APIGuildMember;
  if (member.roles.includes(modRole.id)) log(`${moderator.username} already has @${MODERATOR_ROLE}`);
  else {
    log(`assign @${MODERATOR_ROLE} to ${moderator.username} (${moderator.id})`);
    if (write) await step("assign role", () => rest.put(Routes.guildMemberRole(gid, moderator!.id, modRole!.id), { reason: REASON }));
  }
} else if (!modRole && !verifyOnly) {
  log(`assign @${MODERATOR_ROLE} to ${moderator?.username ?? MODERATOR_USERNAME} (after the role is created)`);
}

// ---- 2. Categories and channels ---------------------------------------------------------------------------------------
const overwrite = (id: string, type: OverwriteType, allow: bigint, deny: bigint = 0n) => ({ id, type, allow: str(allow), deny: str(deny) });
const sectionOverwrites = (extra: ReturnType<typeof overwrite>[] = []) => [
  ...(modRole ? [overwrite(modRole.id, OverwriteType.Role, MOD_ALLOW)] : []),
  overwrite(botId, OverwriteType.Member, BOT_ALLOW),
  ...extra
];
const readOnlyEveryone = overwrite(gid, OverwriteType.Role, 0n, READ_ONLY_DENY);

const idByName = new Map<string, string>();
const outsideConflict = (name: string, type: ChannelType, parentId: string | null) =>
  channels.find(c => "name" in c && c.name === name && c.type === type && ("parent_id" in c ? c.parent_id : null) !== parentId);

// Adds the moderator/bot overwrite on something that already exists, leaving every other overwrite alone.
async function ensureOverwrites(ch: APIChannel, wanted: ReturnType<typeof overwrite>[]) {
  const have = ("permission_overwrites" in ch ? ch.permission_overwrites ?? [] : []) as APIOverwrite[];
  for (const w of wanted) {
    const cur = have.find(o => o.id === w.id);
    if (cur && cur.allow === w.allow && cur.deny === w.deny) continue;
    log(`${cur ? "update" : "add"} permission overwrite ${w.id === botId ? "(bot)" : "@" + MODERATOR_ROLE} on ${("name" in ch && ch.name) || ch.id}`);
    if (write) await step(`overwrite on ${ch.id}`, () => rest.put(Routes.channelPermission(ch.id, w.id), { body: { type: w.type, allow: w.allow, deny: w.deny }, reason: REASON }));
  }
}

async function ensureCategory(name: string): Promise<APIChannel | undefined> {
  const found = channels.find(c => c.type === ChannelType.GuildCategory && "name" in c && c.name.toLowerCase() === name.toLowerCase());
  if (found) { log(`category ${name} exists (${found.id})`); if (!verifyOnly) await ensureOverwrites(found, sectionOverwrites()); return found; }
  if (verifyOnly) { fail(`category ${name} is missing`); return undefined; }
  log(`create category ${name}`);
  if (!write) return undefined;
  return step(`create category ${name}`, async () => await rest.post(Routes.guildChannels(gid), { body: { name, type: ChannelType.GuildCategory, permission_overwrites: sectionOverwrites() }, reason: REASON }) as APIChannel);
}

const forumTagBody = (forum: ForumDef) => forum.tags.map(name => ({ name, moderated: false }));
type Tag = { id?: string; name: string; moderated?: boolean; emoji_id?: string | null; emoji_name?: string | null };

async function ensureTextChannel(def: TextChannelDef, category: APIChannel | undefined) {
  const found = category && channels.find(c => c.type === ChannelType.GuildText && "name" in c && c.name === def.name && "parent_id" in c && c.parent_id === category.id);
  if (found) { idByName.set(def.name, found.id); log(`text #${def.name} exists (${found.id})`); if (!verifyOnly) await ensureOverwrites(found, sectionOverwrites()); return; }
  const elsewhere = outsideConflict(def.name, ChannelType.GuildText, category?.id ?? null);
  if (elsewhere) { fail(`a text channel named #${def.name} already exists elsewhere (${elsewhere.id}); not creating a duplicate or moving it. Move/rename it and re-run.`); return; }
  if (verifyOnly) { fail(`text #${def.name} is missing`); return; }
  log(`create text #${def.name} (read-only for members)`);
  if (!write || !category) return;
  const created = await step(`create #${def.name}`, async () => await rest.post(Routes.guildChannels(gid), {
    body: { name: def.name, type: ChannelType.GuildText, parent_id: category.id, topic: def.topic, permission_overwrites: sectionOverwrites([readOnlyEveryone]) }, reason: REASON
  }) as APIChannel);
  if (created) { idByName.set(def.name, created.id); channels.push(created); }
}

async function ensureForum(def: ForumDef, category: APIChannel | undefined) {
  const found = category && channels.find(c => c.type === ChannelType.GuildForum && "name" in c && c.name === def.name && "parent_id" in c && c.parent_id === category.id);
  if (found && found.type === ChannelType.GuildForum) {
    idByName.set(def.name, found.id);
    const have = (found.available_tags ?? []) as Tag[];
    const missing = forumTagBody(def).filter(t => !have.some(h => h.name === t.name));
    log(`forum #${def.name} exists (${found.id}); ${missing.length ? `adding ${missing.length} tag(s): ${missing.map(t => t.name).join(", ")}` : "tags complete"}`);
    if (verifyOnly) { if (missing.length) fail(`forum #${def.name} lacks tags: ${missing.map(t => t.name).join(", ")}`); return; }
    await ensureOverwrites(found, sectionOverwrites());
    if (missing.length) {
      if (have.length + missing.length > 20) { fail(`forum #${def.name} would exceed 20 tags`); return; }
      if (write) await step(`tags on #${def.name}`, () => rest.patch(Routes.channel(found.id), {
        body: { available_tags: [...have.map(t => ({ id: t.id, name: t.name, moderated: t.moderated ?? false, emoji_id: t.emoji_id ?? null, emoji_name: t.emoji_name ?? null })), ...missing] }, reason: REASON
      }));
    }
    return;
  }
  const elsewhere = outsideConflict(def.name, ChannelType.GuildForum, category?.id ?? null);
  if (elsewhere) { fail(`a forum named #${def.name} already exists elsewhere (${elsewhere.id}); not creating a duplicate.`); return; }
  if (verifyOnly) { fail(`forum #${def.name} is missing`); return; }
  log(`create forum #${def.name} with ${def.tags.length} tags`);
  if (!write || !category) return;
  const created = await step(`create forum #${def.name}`, async () => await rest.post(Routes.guildChannels(gid), {
    body: {
      name: def.name, type: ChannelType.GuildForum, parent_id: category.id, topic: def.topic, available_tags: forumTagBody(def),
      default_auto_archive_duration: 10080, default_sort_order: 1, default_forum_layout: 1, default_reaction_emoji: { emoji_name: "💰" },
      permission_overwrites: sectionOverwrites()
    }, reason: REASON
  }) as APIChannel);
  if (created) { idByName.set(def.name, created.id); channels.push(created); }
}

const startCat = await ensureCategory(START_CATEGORY);
if (startCat && !channels.some(c => c.id === startCat.id)) channels.push(startCat);
for (const def of TEXT_CHANNELS) await step(`text #${def.name}`, () => ensureTextChannel(def, startCat));
const libCat = await ensureCategory(LIBRARY_CATEGORY);
if (libCat && !channels.some(c => c.id === libCat.id)) channels.push(libCat);
for (const def of FORUMS) await step(`forum #${def.name}`, () => ensureForum(def, libCat));

// ---- 3. Content ---------------------------------------------------------------------------------------------------------
const resolve = (text: string) => text.replace(/\{\{ch:([a-z-]+)\}\}/g, (_m, name: string) => idByName.has(name) ? `<#${idByName.get(name)}>` : `#${name}`);
const footer = (key: string) => `Goldmaking · ${key}`;
type Embed = { title: string; description: string; color: number; footer: { text: string } };
const embedFor = (key: string, title: string, body: string): Embed => {
  const description = resolve(body);
  if (description.length > 4000) throw new Error(`post ${key} is too long (${description.length})`);
  return { title, description, color: COLOR, footer: { text: footer(key) } };
};

async function botMessages(channelId: string): Promise<APIMessage[]> {
  const out: APIMessage[] = [];
  let beforeId: string | undefined;
  for (let page = 0; page < 3; page++) {
    const query = new URLSearchParams({ limit: "100" });
    if (beforeId) query.set("before", beforeId);
    const batch = await rest.get(Routes.channelMessages(channelId), { query }) as APIMessage[];
    out.push(...batch.filter(m => m.author.id === botId));
    if (batch.length < 100) break;
    beforeId = batch[batch.length - 1]?.id;
  }
  return out;
}

async function publishPosts(channelName: string, posts: { key: string; embed: Embed }[], pinKey?: string) {
  const channelId = idByName.get(channelName);
  if (!channelId) { if (write) fail(`cannot post to #${channelName}: channel unavailable`); else log(`would post ${posts.length} message(s) in #${channelName}`); return; }
  const existing = await botMessages(channelId);
  for (const post of posts) {
    const old = existing.find(m => m.embeds.some(e => e.footer?.text === footer(post.key)));
    if (verifyOnly) { if (!old) fail(`#${channelName}: post "${post.key}" is missing`); continue; }
    if (!old) {
      log(`post "${post.embed.title}" in #${channelName}`);
      if (write) {
        const sent = await step(`post ${post.key}`, async () => await rest.post(Routes.channelMessages(channelId), { body: { embeds: [post.embed], allowed_mentions: { parse: [] } } }) as APIMessage);
        if (sent && post.key === pinKey) await step(`pin ${post.key}`, () => rest.put(Routes.channelMessagesPin(channelId, sent.id), { reason: REASON }));
      }
      continue;
    }
    const cur = old.embeds[0];
    if (cur?.title === post.embed.title && cur?.description === post.embed.description) { log(`post "${post.embed.title}" in #${channelName} is current`); continue; }
    log(`update post "${post.embed.title}" in #${channelName}`);
    if (write) await step(`edit ${post.key}`, () => rest.patch(Routes.channelMessage(channelId, old.id), { body: { embeds: [post.embed], allowed_mentions: { parse: [] } } }));
  }
  if (pinKey && write) {
    const pinned = existing.find(m => m.embeds.some(e => e.footer?.text === footer(pinKey)));
    if (pinned && !pinned.pinned) await step(`pin ${pinKey}`, () => rest.put(Routes.channelMessagesPin(channelId, pinned.id), { reason: REASON }));
  }
}

// Threads in the forums (active + archived), used by the index and by template lookup.
type Thread = { id: string; name: string; parent_id?: string | null; flags?: number; thread_metadata?: { locked?: boolean } };
async function forumThreads(forumId: string, activeAll: Thread[]): Promise<Thread[]> {
  const active = activeAll.filter(t => t.parent_id === forumId);
  const archived = await rest.get(Routes.channelThreads(forumId, "public"), { query: new URLSearchParams({ limit: "100" }) }).catch(() => ({ threads: [] })) as { threads: Thread[] };
  const seen = new Set(active.map(t => t.id));
  return [...active, ...archived.threads.filter(t => !seen.has(t.id))];
}

// 3a. Text channel lessons (guide-index is built last, from live forum content).
for (const def of TEXT_CHANNELS.filter(c => c.posts.length)) {
  await step(`content #${def.name}`, () => publishPosts(def.name, def.posts.map(p => ({ key: p.key, embed: embedFor(p.key, p.title, p.body) })), def.name === "welcome-to-goldmaking" ? "welcome" : undefined));
}

// 3b. Forum starter templates (pinned, locked).
const activeThreads = (write || verifyOnly) ? ((await rest.get(Routes.guildActiveThreads(gid)).catch(() => ({ threads: [] }))) as { threads: Thread[] }).threads : [];
const threadsByForum = new Map<string, Thread[]>();
for (const def of FORUMS) {
  await step(`template ${def.name}`, async () => {
    const forumId = idByName.get(def.name);
    if (!forumId) { log(`would create pinned template thread in #${def.name}`); return; }
    const threads = await forumThreads(forumId, activeThreads);
    threadsByForum.set(def.name, threads);
    const { intro, template } = templatePosts(def);
    const embed = { title: "Modèle de guide", description: intro, color: COLOR, footer: { text: footer(`template:${def.name}`) } };
    const existing = threads.find(t => t.name === TEMPLATE_THREAD_TITLE);
    if (verifyOnly) { if (!existing) fail(`#${def.name}: starter template is missing`); else if (!((existing.flags ?? 0) & ChannelFlags.Pinned)) fail(`#${def.name}: starter template is not pinned`); return; }
    if (!existing) {
      log(`create pinned template thread in #${def.name}`);
      if (!write) return;
      const thread = await rest.post(Routes.threads(forumId), { body: { name: TEMPLATE_THREAD_TITLE, auto_archive_duration: 10080, message: { embeds: [embed], allowed_mentions: { parse: [] } } }, reason: REASON }) as Thread;
      await rest.post(Routes.channelMessages(thread.id), { body: { content: template, allowed_mentions: { parse: [] } } });
      await rest.patch(Routes.channel(thread.id), { body: { flags: ChannelFlags.Pinned, locked: true }, reason: REASON });
      threadsByForum.set(def.name, [...threads, thread]);
      return;
    }
    // Existing: refresh bot-owned text when it changed; make sure it is pinned and locked.
    const starter = await rest.get(Routes.channelMessage(existing.id, existing.id)).catch(() => undefined) as APIMessage | undefined;
    if (starter && starter.author.id === botId && starter.embeds[0]?.description !== embed.description) {
      log(`update template text in #${def.name}`);
      if (write) await rest.patch(Routes.channelMessage(existing.id, existing.id), { body: { embeds: [embed] } });
    } else log(`template thread in #${def.name} is current`);
    if (!((existing.flags ?? 0) & ChannelFlags.Pinned) || !existing.thread_metadata?.locked) {
      log(`pin and lock template thread in #${def.name}`);
      if (write) await rest.patch(Routes.channel(existing.id), { body: { flags: (existing.flags ?? 0) | ChannelFlags.Pinned, locked: true } });
    }
    const posts = (await rest.get(Routes.channelMessages(existing.id), { query: new URLSearchParams({ limit: "10" }) }) as APIMessage[]).filter(m => m.author.id === botId && m.id !== existing.id);
    const tpl = posts.find(m => m.content.startsWith("```"));
    if (tpl && tpl.content !== template) { log(`update template block in #${def.name}`); if (write) await rest.patch(Routes.channelMessage(existing.id, tpl.id), { body: { content: template } }); }
  });
}

// 3c. Guide index: static navigation plus a live list of the guides currently in each forum.
await step("guide index", async () => {
  const forumLines = FORUMS.map(f => `• {{ch:${f.name}}} — ${f.hint}`).join("\n");
  const how = [
    "**Comment utiliser la bibliothèque**",
    "1. Choisis le forum qui correspond à ton besoin (liste ci-dessous).",
    "2. Filtre avec les **étiquettes** : niveau, difficulté, compétition, classe.",
    "3. Ouvre le fil épinglé « Modèle de guide » avant de publier le tien.",
    "",
    "**Forums**",
    forumLines,
    "",
    "**Titre d'un guide** : `[Niv.+] Zone — Ressource principale`",
    "**Fiabilité** : ✅ vérifié dans Forever · ⚠️ base Classic · 🧪 non testé",
    "",
    "Les guides de membres sont listés dans le message suivant (mis à jour à chaque exécution du script de configuration)."
  ].join("\n");

  const lines: string[] = [];
  let total = 0;
  for (const f of FORUMS) {
    const guides = (threadsByForum.get(f.name) ?? []).filter(t => t.name !== TEMPLATE_THREAD_TITLE).slice(0, 10);
    total += guides.length;
    lines.push(`**{{ch:${f.name}}}**`);
    lines.push(...(guides.length ? guides.map(t => `• [${t.name.slice(0, 90)}](https://discord.com/channels/${gid}/${t.id})`) : ["_Aucun guide publié pour le moment._"]));
    lines.push("");
  }
  const live = total
    ? lines.join("\n")
    : ["_Aucun guide de membre n'est encore publié._ Les premiers guides vérifiés apparaîtront ici.", "", ...FORUMS.map(f => `• {{ch:${f.name}}}`)].join("\n");
  const liveBody = resolve(live).length > 3900 ? live.slice(0, 3800) + "\n…" : live;

  await publishPosts("guide-index", [
    { key: "index-how", embed: embedFor("index-how", "Index des guides de farm", how) },
    { key: "index-live", embed: embedFor("index-live", "Guides publiés par la communauté", liveBody) }
  ], "index-how");
});

// ---- 4. Verification with fresh reads -------------------------------------------------------------------------------------
if (write || verifyOnly) {
  const savedFailures = failures;
  console.log("\n--- Verification (fresh Discord API reads) ---");
  roles = await rest.get(Routes.guildRoles(gid)) as APIRole[];
  channels = await rest.get(Routes.guildChannels(gid)) as APIChannel[];
  const check = (ok: boolean, okMsg: string, badMsg: string) => { if (ok) console.log(`OK    ${okMsg}`); else fail(badMsg); };

  const role = roles.find(r => r.name === MODERATOR_ROLE);
  check(!!role, `role @${MODERATOR_ROLE} exists`, `role @${MODERATOR_ROLE} missing`);
  if (role) {
    const risky = FORBIDDEN_ROLE_PERMS.filter(([, f]) => (BigInt(role.permissions) & f) !== 0n).map(([n]) => n);
    check(risky.length === 0, `role has no server-wide elevated permissions (permissions=${role.permissions})`, `role holds elevated permissions: ${risky.join(", ")}`);
    if (moderator) {
      const m = await rest.get(Routes.guildMember(gid, moderator.id)) as APIGuildMember;
      check(m.roles.includes(role.id), `${moderator.username} (${moderator.id}) has @${MODERATOR_ROLE}`, `${moderator.username} does not have the role`);
    }
    const sectionIds = new Set(channels.filter(c => "name" in c && sectionNames.has(c.name ?? "")).map(c => c.id));
    const leaks = channels.filter(c => !sectionIds.has(c.id) && "permission_overwrites" in c && (c.permission_overwrites ?? []).some(o => o.id === role.id));
    check(leaks.length === 0, "the role has no overwrite on any channel outside the section", `role has overwrites outside the section: ${leaks.map(c => c.id).join(", ")}`);
  }
  const byName = (name: string, type: ChannelType) => channels.find(c => c.type === type && "name" in c && c.name === name);
  for (const catName of [START_CATEGORY, LIBRARY_CATEGORY]) {
    const cat = channels.find(c => c.type === ChannelType.GuildCategory && "name" in c && c.name === catName);
    check(!!cat, `category ${catName}`, `category ${catName} missing`);
    if (cat && role) {
      const ow = ("permission_overwrites" in cat ? cat.permission_overwrites ?? [] : []).find(o => o.id === role.id);
      check(!!ow && BigInt(ow.allow) === MOD_ALLOW && BigInt(ow.deny) === 0n, `category ${catName}: moderator overwrite correct`, `category ${catName}: moderator overwrite missing/incorrect`);
    }
  }
  const startCatId = channels.find(c => c.type === ChannelType.GuildCategory && "name" in c && c.name === START_CATEGORY)?.id;
  const libCatId = channels.find(c => c.type === ChannelType.GuildCategory && "name" in c && c.name === LIBRARY_CATEGORY)?.id;
  for (const def of TEXT_CHANNELS) {
    const ch = byName(def.name, ChannelType.GuildText);
    check(!!ch && "parent_id" in ch && ch.parent_id === startCatId, `text #${def.name} in ${START_CATEGORY}`, `text #${def.name} missing or in the wrong category`);
  }
  for (const def of FORUMS) {
    const ch = byName(def.name, ChannelType.GuildForum);
    check(!!ch && "parent_id" in ch && ch.parent_id === libCatId, `forum #${def.name} in ${LIBRARY_CATEGORY}`, `forum #${def.name} missing or in the wrong category`);
    if (ch && ch.type === ChannelType.GuildForum) {
      const names = (ch.available_tags ?? []).map(t => t.name);
      const missing = def.tags.filter(t => !names.includes(t));
      check(missing.length === 0 && names.length <= 20, `forum #${def.name}: ${names.length} tags`, `forum #${def.name}: missing tags ${missing.join(", ")} (total ${names.length})`);
    }
  }
  const total = TEXT_CHANNELS.length + FORUMS.length;
  const typed = TEXT_CHANNELS.filter(d => byName(d.name, ChannelType.GuildText)).length + FORUMS.filter(d => byName(d.name, ChannelType.GuildForum)).length;
  check(typed === total, `${typed}/${total} channels with correct types (${TEXT_CHANNELS.length} text, ${FORUMS.length} forums)`, `only ${typed}/${total} channels exist with the correct type`);

  if (write) {
    const after = snapshotOutside(channels);
    check(same(before, after), `all ${before.length} other channels (names, parents, topics, permission overwrites) unchanged`, "channels outside the section changed during the run");
    const rolesAfter = roles.filter(r => r.name !== MODERATOR_ROLE).map(r => ({ id: r.id, name: r.name, permissions: r.permissions, position: r.position })).sort((a, b) => a.id.localeCompare(b.id));
    check(same(rolesBefore, rolesAfter.filter(r => rolesBefore.some(b => b.id === r.id))), `all ${rolesBefore.length} other roles unchanged (permissions)`, "a pre-existing role changed during the run");
  }
  // Post presence is checked inside publishPosts when --verify is used; in apply mode re-read it here.
  if (write) {
    for (const def of TEXT_CHANNELS) {
      const id = byName(def.name, ChannelType.GuildText)?.id;
      if (!id) continue;
      const have = await botMessages(id);
      const keys = def.name === "guide-index" ? ["index-how", "index-live"] : def.posts.map(p => p.key);
      const missing = keys.filter(k => !have.some(m => m.embeds.some(e => e.footer?.text === footer(k))));
      check(missing.length === 0, `#${def.name}: ${keys.length} post(s) published`, `#${def.name}: missing posts ${missing.join(", ")}`);
    }
  }
  if (failures === savedFailures) console.log("\nVerification passed.");
}

console.log(`\nDone (${verifyOnly ? "verify" : write ? "apply" : "dry run"}): ${failures} failure(s), ${warnings} warning(s), marker "${MARKER}".`);
if (failures || preflightErrors.length) process.exitCode = 1;
