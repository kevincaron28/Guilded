import { tx, type Lang } from "../i18n.js";
import { officerSyncRecent } from "./officer-sync.js";

// The /setup checklist: what's configured, what's missing, and exactly how
// to fix each missing thing. Pure (takes plain data) so it's easy to test.

export function publicSharingNotice(settings: { publicDungeonRuns?: boolean; publicDungeonRunsSince?: Date | null }, lang: Lang = "en"): string {
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  // Sharing is always on (owner decision, 7 November 2026); an old "off" flag is ignored. Only "Delete my data" removes a member.
  const window = settings.publicDungeonRunsSince
    ? T("Only runs started since {since}; older imports stay private.", { since: `<t:${Math.ceil(settings.publicDungeonRunsSince.getTime() / 1000)}:f>` })
    : T("Eligible saved runs from the last 30 days are included.");
  return [
    T("**Public dungeon sharing: ON.** Anyone can see eligible runs at https://guilded.kcaron.top/leaderboards/: all recorded party members' character names/realms, class, role, level, times, deaths and scores, including non-guild players."),
    window,
    T("Members can erase their own data any time with “Delete my data” on the Guilded website.")
  ].join("\n");
}

export interface SetupFacts {
  existingRoleNames: string[];
  // Each entry is one required role: a name, or the names (English and French) any of which counts.
  requiredRoleNames: (string | string[])[];
  notifyChannel: ChannelFact | null;
  raidChannel: ChannelFact | null;
  logChannel: ChannelFact | null;
  raidLogChannel?: ChannelFact | null;
  dungeonSignupChannel?: ChannelFact | null;
  dungeonSignupGuide?: boolean | null;
  dungeonSignupCanPin?: boolean | null;
  dungeonLeaderboardChannel?: ChannelFact | null;
  welcomeChannel: ChannelFact | null;
  // Auto-roles the bot must be able to hand out (null when not configured).
  autoRoles: { name: string; botCanAssign: boolean }[];
  epgpConfigured: boolean;
  remindersOn: boolean;
  weeklyReportOn: boolean;
  companionPaired: boolean;
  linkedCharacters: number;
  // Last upload from an officer's companion (Guild.officerSyncAt); omitted = not checked.
  officerSyncAt?: Date | null;
  // 9.1: the newest stored guild roster reading and whose upload brought it (guild-data.ts
  // rosterFreshness); null = never uploaded, omitted = not checked.
  rosterUpdate?: { at: Date; by: string | null; members: number } | null;
  // 8.5: only set when nickname sync is on; whether the bot has Manage Nicknames.
  nicknameSyncReady?: boolean;
  // How many members the bot cannot rename because their top role is at or above the bot's (cached members only).
  nicknameBlockedMembers?: number;
  // True when the last community honors role sync was refused by Discord (the bot role is below the honor roles).
  honorRolesBlocked?: boolean;
  // Board channels (standings, ladders, leaderboards, recaps) where members can still write or start threads.
  openBoardChannels?: string[];
  // The pinned group finder message is the pre-4.6 button, not the current menu.
  dungeonSignupGuideOutdated?: boolean;
  // Every other channel setup can create (field name -> state), shown as optional rows.
  extraChannels?: { field: string; fact: ChannelFact | null }[];
  // The bot's own messages in its channels (services/bot-messages.ts).
  messageContentIntent?: boolean;
  // The community section: a Discord season open to everyone, and whether it earns points.
  community?: { season: boolean; participation: boolean; honors?: boolean } | null;
  botMessages?: { kind: string; name?: string; state: "current" | "outdated" | "missing" }[];
  // Officer roles that can't see /lead, /officer or /organize ("Raid Leader → /lead");
  // null when Discord refused the check (services/command-visibility.ts).
  commandAccess?: { role: string; command: string }[] | null;
}

/** After this long without a new roster reading, /setup status warns (members log in daily in an active guild). */
export const ROSTER_STALE_MS = 3 * 86_400_000;

/** A member's display name inside a checklist line: no markdown, no line breaks, short. */
const plainName = (name: string) => name.replace(/[\p{Cc}*_~`|>\\[\]<@#]/gu, "").replace(/\s+/g, " ").trim().slice(0, 32) || "?";

export interface ChannelFact {
  name: string;
  exists: boolean;
  botCanPost: boolean;
}

export interface SetupCheck {
  label: string;
  ok: boolean;
  optional: boolean;
  fix: string;
  // Shown with ⚠️: there but out of date (does not block "set up").
  warn?: boolean;
}

function channelCheck(lang: Lang, label: string, fact: ChannelFact | null, optional: boolean, fix: string): SetupCheck {
  if (!fact) return { label, ok: false, optional, fix };
  if (!fact.exists) return { label, ok: false, optional, fix: `${tx(lang, "The saved channel was deleted.")} ${fix}` };
  if (!fact.botCanPost) {
    return { label: `${label} (#${fact.name})`, ok: false, optional, fix: tx(lang, "I can't post in #{name} or check its pinned messages. Give my role \"View Channel\", \"Read Message History\", \"Send Messages\" and \"Embed Links\" there, or pick another channel.", { name: fact.name }) };
  }
  return { label: `${label} (#${fact.name})`, ok: true, optional, fix: "" };
}

export function setupChecks(facts: SetupFacts, lang: Lang = "en", now = new Date()): SetupCheck[] {
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const missingRoles = facts.requiredRoleNames
    .map((entry) => (Array.isArray(entry) ? entry : [entry]))
    .filter((names) => !names.some((name) => facts.existingRoleNames.includes(name)))
    // Named in the guild's language when a French name exists.
    .map((names) => (lang === "fr" && names[1] ? names[1] : names[0]));
  const checks: SetupCheck[] = [
    {
      label: T("Permission roles (Guild Master, Officer, Raid Leader, DKP Officer)"),
      ok: missingRoles.length === 0,
      optional: false,
      fix: T("Missing: {roles}. Run /setup start and press \"Create missing roles\", then give them to your officers.", { roles: missingRoles.join(", ") })
    },
    channelCheck(lang, T("Announcements channel"), facts.notifyChannel, false, T("Press \"Create missing channels\" on this checklist, or /config to pick an existing one.")),
    channelCheck(lang, T("Raid signups channel"), facts.raidChannel, false, T("Press \"Create missing channels\" on this checklist, or /config to pick an existing one.")),
    channelCheck(lang, T("Officer log channel"), facts.logChannel, false, T("Press \"Create missing channels\" on this checklist, or /config to pick an existing one.")),
    channelCheck(lang, T("Dungeon signups channel"), facts.dungeonSignupChannel ?? null, true, T("Optional: press \"Create missing channels\" on this checklist.")),
    {
      label: T("Pinned dungeon signup guide"),
      ok: facts.dungeonSignupGuide === true && !facts.dungeonSignupGuideOutdated,
      optional: !facts.dungeonSignupChannel || (facts.dungeonSignupGuide === true && facts.dungeonSignupGuideOutdated === true),
      ...(facts.dungeonSignupGuide === true && facts.dungeonSignupGuideOutdated ? { warn: true } : {}),
      fix: facts.dungeonSignupGuide === true && facts.dungeonSignupGuideOutdated
        ? T("It is the old dungeon-only button: press \"Update bot messages\" for the group finder menu (or run /dungeon guide).")
        : T("Run /dungeon guide to post or repair the pinned signup guide. Set a channel first with /config channel.")
    },
    {
      label: T("Dungeon signup guide pin permission"),
      ok: facts.dungeonSignupCanPin === true,
      optional: !facts.dungeonSignupChannel,
      fix: T("Give the bot role the \"Pin Messages\" permission in the dungeon signup channel.")
    },
    channelCheck(lang, T("Dungeon leaderboard channel"), facts.dungeonLeaderboardChannel ?? null, true, T("Optional: press \"Create missing channels\" on this checklist.")),
    channelCheck(lang, T("Welcome channel"), facts.welcomeChannel, true, T("Optional: run /setup start, step 5 (Welcome).")),
    ...facts.autoRoles.map((role) => ({
      label: T("Auto-role \"{name}\"", { name: role.name }),
      ok: role.botCanAssign,
      optional: true,
      fix: T("My role must be above \"{name}\": Server Settings > Roles, drag my role higher.", { name: role.name })
    })),
    ...(facts.nicknameSyncReady === undefined ? [] : [{
      label: T("Nickname sync permission"),
      ok: facts.nicknameSyncReady && !facts.nicknameBlockedMembers,
      optional: true,
      fix: facts.nicknameSyncReady
        ? T("My role is below {count} member(s)' top role, so I can't rename them. Server Settings > Roles: drag my role above the member ranks.", { count: facts.nicknameBlockedMembers ?? 0 })
        : T("Give the bot role the \"Manage Nicknames\" permission, above the members it should rename.")
    }]),
    ...(facts.openBoardChannels === undefined ? [] : [{
      label: T("Board channels read-only"),
      ok: facts.openBoardChannels.length === 0,
      optional: true,
      fix: T("Members can still write in {channels}. Press \"Lock board channels\" on this checklist: they can still react, only the bot posts.", { channels: facts.openBoardChannels.map((id) => `<#${id}>`).join(", ") })
    }]),
    ...(facts.honorRolesBlocked ? [{
      label: T("Community honor roles"),
      ok: false,
      optional: true,
      fix: T("I can't give the honor roles because my role is below them. Server Settings > Roles: drag the Guilded role above the honor roles. I retry every 15 minutes.")
    }] : []),
    {
      label: T("EPGP point values (base GP set)"),
      ok: facts.epgpConfigured,
      optional: true,
      fix: T("Defaults work, but base GP is 0: run /setup start step 7 and press \"Use recommended values\".")
    },
    { label: T("Raid reminders"), ok: facts.remindersOn, optional: true, fix: T("Optional: turn them on in /setup step 7.") },
    { label: T("Weekly guild report"), ok: facts.weeklyReportOn, optional: true, fix: T("Optional: turn it on in /setup step 7.") },
    {
      label: T("At least one companion account connected"),
      ok: facts.companionPaired,
      optional: true,
      fix: T("Optional for WoW sync: in the companion choose Sign in with Discord, then this server (/character pair has the link). Members without a companion link with the /guilded verify line from /character pair.")
    },
    {
      label: T("At least one WoW character linked"),
      ok: facts.linkedCharacters > 0,
      optional: true,
      fix: T("WoW players only: /character pair shows existing characters and how to link them. Already connected? Sync alts with the same companion.")
    }
  ];
  // Addon-only members (and their /guilded verify links) depend on an officer's companion. Only for
  // guilds that use WoW sync at all, so a guild without WoW players never sees it.
  if (facts.officerSyncAt !== undefined && (facts.companionPaired || facts.linkedCharacters > 0)) {
    const recent = officerSyncRecent(facts.officerSyncAt, now);
    const last = facts.officerSyncAt
      ? T("Last officer sync: {when}.", { when: `<t:${Math.floor(facts.officerSyncAt.getTime() / 1000)}:R>` })
      : T("No officer's companion has synced yet.");
    checks.push({
      label: T("An officer's companion synced in the last 2 weeks"), ok: recent, optional: true,
      ...(recent ? {} : { warn: true }),
      fix: `${last} ${T("Members who only use the addon (their /guilded verify links, gear, dungeon runs) reach Discord through an officer's companion. An officer: run /character pair, connect the companion with Sign in with Discord, then /reload in WoW and press Sync now.")}`
    });
  }
  // 9.1 (docs/JEEVES_COMPARISON.md idea 3): how fresh the guild roster is and whose upload last
  // refreshed it, so "the only member who uploads stopped playing" shows here instead of going unnoticed.
  if (facts.rosterUpdate !== undefined && (facts.companionPaired || facts.linkedCharacters > 0)) {
    const roster = facts.rosterUpdate;
    const fresh = !!roster && now.getTime() - roster.at.getTime() <= ROSTER_STALE_MS;
    const when = roster ? `<t:${Math.floor(roster.at.getTime() / 1000)}:R>` : "";
    const by = roster?.by ? plainName(roster.by) : null;
    const howTo = T("The roster refreshes whenever a member with the Guilded app logs in or types /reload in WoW. Ask an active member to /reload, or connect one more member's app so it never depends on one person.");
    checks.push(fresh
      ? { label: by
        ? T("Guild roster updated {when} by {name}'s upload ({count} members)", { when, name: by, count: roster!.members })
        : T("Guild roster updated {when} ({count} members)", { when, count: roster!.members }), ok: true, optional: true, fix: "" }
      : { label: T("Guild roster updated in the last 3 days"), ok: false, optional: true, warn: true,
        fix: `${roster
          ? by ? T("Last roster update: {when}, from {name}'s upload.", { when, name: by }) : T("Last roster update: {when}.", { when })
          : T("No member's upload has brought the guild roster yet.")} ${howTo}` });
  }
  // Every other channel setup can create: optional, each with how to get it.
  const CHANNEL_LABELS: Record<string, string> = {
    coreChannelId: T("Raid roster channel"), readinessChannelId: T("Raid readiness channel"),
    craftChannelId: T("Craft board channel"), applicationChannelId: T("Applications channel"), attendanceChannelId: T("Raid attendance channel"), guideChannelId: T("Bot guide channel"),
    dungeonChannelId: T("Dungeon runs channel"), weeklyReportChannelId: T("WoW weekly report channel"), inviteChannelId: T("Guild invites channel")
  };
  for (const entry of facts.extraChannels ?? []) {
    const label = CHANNEL_LABELS[entry.field];
    if (!label) continue;
    checks.push(channelCheck(lang, label, entry.fact, true, T("Optional: press \"Create missing channels\", or pick an existing channel with the menu below.")));
  }
  // 9.1: the crafting extras (orders, archive, top crafters) share one row, so the checklist stays within Discord's limit.
  const CRAFT_EXTRAS: Record<string, string> = { craftOrdersChannelId: T("Craft orders channel"), craftArchiveChannelId: T("Craft archive channel"), craftLadderChannelId: T("Top crafters channel") };
  const extras = (facts.extraChannels ?? []).filter((entry) => CRAFT_EXTRAS[entry.field]);
  if (extras.length) {
    const missing = extras.filter((entry) => !entry.fact?.exists || !entry.fact.botCanPost).map((entry) => CRAFT_EXTRAS[entry.field]!);
    checks.push({ label: T("Crafting orders, archive and top crafters channels"), ok: !missing.length, optional: true,
      fix: missing.length ? `${missing.join(", ")}: ${T("Optional: press \"Create missing channels\", or pick an existing channel with the menu below.")}` : "" });
  }
  if (facts.community) {
    checks.push({
      label: T("Community season and participation rewards"), ok: facts.community.season && facts.community.participation, optional: true,
      fix: facts.community.season
        ? T("The season is active but participation rewards are off: press \"Set up community\", or run /participation settings.")
        : T("Optional: press \"Set up community\" on this checklist.")
    });
    if (facts.community.honors !== undefined) checks.push({
      label: T("Hall of fame: weekly MVP and monthly podium roles"), ok: facts.community.honors, optional: true,
      fix: T("Optional: press \"Set up community\" on this checklist to add the hall-of-fame channel and its roles.")
    });
  }
  if (facts.commandAccess !== undefined) {
    const blocked = facts.commandAccess;
    const howTo = T("Give the Raid Leader role \"Manage Events\" (Server Settings > Roles), or in Server Settings > Integrations > Guilded allow the Officer, Guild Master and Raid Leader roles on /lead, /officer and /organize.");
    checks.push({
      label: T("Leader commands visible to your officer roles"), ok: blocked !== null && blocked.length === 0, optional: true,
      ...(blocked?.length ? { warn: true } : {}),
      fix: blocked === null
        ? `${T("I couldn't read the command settings. Check it once:")} ${howTo}`
        : `${T("Hidden from: {list}.", { list: blocked.map((entry) => `${entry.role} → /${entry.command}`).join(", ") })} ${howTo}`
    });
  }
  // The #bot-faq answer channel was retired in 9.0: it is neither listed nor counted any more.
  // The bot's messages: missing (❌-style, optional) or out of date (⚠️), fixed by one button.
  const MESSAGE_LABELS: Record<string, string> = {
    botGuide: T("Pinned bot guide"), installPost: T("Pinned install post"), craftGuide: T("Pinned craft board guide"), welcomePanel: T("Pinned welcome panel"), leaderboard: T("Dungeon leaderboard message")
  };
  for (const message of facts.botMessages ?? []) {
    const label = message.kind === "roster" ? T("Roster message: {name}", { name: message.name ?? "?" }) : MESSAGE_LABELS[message.kind];
    if (!label) continue;
    checks.push({
      label, ok: message.state === "current", optional: true,
      ...(message.state === "outdated" ? { warn: true } : {}),
      fix: message.state === "outdated" ? T("Out of date: press \"Update bot messages\".") : T("Missing: press \"Update bot messages\".")
    });
  }
  return checks;
}

// One line per check for an embed: ✅ done, ❌ needed, ➖ optional and off.
export function formatChecks(checks: SetupCheck[]): string {
  return checks.map((check) => {
    if (check.ok) return `✅ ${check.label}`;
    return `${check.warn ? "⚠️" : check.optional ? "➖" : "❌"} ${check.label}\n   ↳ ${check.fix}`;
  }).join("\n");
}

export function setupComplete(checks: SetupCheck[]): boolean {
  return checks.every((check) => check.ok || check.optional);
}
