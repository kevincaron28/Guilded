import { tx, type Lang } from "../i18n.js";

// The /setup checklist: what's configured, what's missing, and exactly how
// to fix each missing thing. Pure (takes plain data) so it's easy to test.

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
  // The pinned group finder message is the pre-4.6 button, not the current menu.
  dungeonSignupGuideOutdated?: boolean;
  // Every other channel setup can create (field name -> state), shown as optional rows.
  extraChannels?: { field: string; fact: ChannelFact | null }[];
  // The bot's own messages in its channels (services/bot-messages.ts).
  messageContentIntent?: boolean;
  // The community section: a Discord season open to everyone, and whether it earns points.
  community?: { season: boolean; participation: boolean } | null;
  botMessages?: { kind: string; name?: string; state: "current" | "outdated" | "missing" }[];
}

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

export function setupChecks(facts: SetupFacts, lang: Lang = "en"): SetupCheck[] {
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
    {
      label: T("EPGP point values (base GP set)"),
      ok: facts.epgpConfigured,
      optional: true,
      fix: T("Defaults work, but base GP is 0: run /setup start step 7 and press \"Use recommended values\".")
    },
    { label: T("Raid reminders"), ok: facts.remindersOn, optional: true, fix: T("Optional: turn them on in /setup step 7.") },
    { label: T("Weekly guild report"), ok: facts.weeklyReportOn, optional: true, fix: T("Optional: turn it on in /setup step 7.") },
    {
      label: T("Companion link to the WoW addon"),
      ok: facts.companionPaired,
      optional: true,
      fix: T("Needed only to sync the addon: run /character pair and link the code in Companion Settings.")
    },
    {
      label: T("Characters linked"),
      ok: facts.linkedCharacters > 0,
      optional: true,
      fix: T("Everyone runs /character pair once (or /character add) so addon data and EPGP match them.")
    }
  ];
  // Every other channel setup can create: optional, each with how to get it.
  const CHANNEL_LABELS: Record<string, string> = {
    coreChannelId: T("Raid roster channel"), readinessChannelId: T("Raid readiness channel"),
    craftChannelId: T("Craft board channel"), applicationChannelId: T("Applications channel"), attendanceChannelId: T("Raid attendance channel"), guideChannelId: T("Bot guide channel"), answerChannelId: T("Bot FAQ channel"),
    dungeonChannelId: T("Dungeon runs channel"), weeklyReportChannelId: T("WoW weekly report channel")
  };
  for (const entry of facts.extraChannels ?? []) {
    const label = CHANNEL_LABELS[entry.field];
    if (!label) continue;
    checks.push(channelCheck(lang, label, entry.fact, true, T("Optional: press \"Create missing channels\", or pick an existing channel with the menu below.")));
  }
  if (facts.community) {
    checks.push({
      label: T("Community season and participation rewards"), ok: facts.community.season && facts.community.participation, optional: true,
      fix: facts.community.season
        ? T("The season is active but participation rewards are off: press \"Set up community\", or run /participation settings.")
        : T("Optional: press \"Set up community\" on this checklist.")
    });
  }
  const answerFact = (facts.extraChannels ?? []).find((entry) => entry.field === "answerChannelId")?.fact;
  if (answerFact && facts.messageContentIntent === false) {
    checks.push({
      label: T("Bot FAQ can read messages"), ok: false, optional: true, warn: true,
      fix: T("Turn on MESSAGE_CONTENT_INTENT=true in the bot's .env and the Message Content switch in the Discord Developer Portal.")
    });
  }
  // The bot's messages: missing (❌-style, optional) or out of date (⚠️), fixed by one button.
  const MESSAGE_LABELS: Record<string, string> = {
    botGuide: T("Pinned bot guide"), craftGuide: T("Pinned craft board guide"), welcomePanel: T("Pinned welcome panel"), leaderboard: T("Dungeon leaderboard message")
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
