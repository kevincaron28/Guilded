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
  companionTokenSet: boolean;
  linkedCharacters: number;
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
    channelCheck(lang, T("Announcements channel"), facts.notifyChannel, false, T("Run /setup start, step 2 (Channels).")),
    channelCheck(lang, T("Raid signups channel"), facts.raidChannel, false, T("Run /setup start, step 2 (Channels).")),
    channelCheck(lang, T("Officer log channel"), facts.logChannel, false, T("Run /setup start, step 2 (Channels).")),
    channelCheck(lang, T("Raid logs channel"), facts.raidLogChannel ?? null, true, T("Optional: run /setup start, step 2 (Channels). Raid summaries use announcements until then.")),
    channelCheck(lang, T("Dungeon signups channel"), facts.dungeonSignupChannel ?? null, true, T("Optional: run /setup start, step 4 (Dungeon channels).")),
    {
      label: T("Pinned dungeon signup guide"),
      ok: facts.dungeonSignupGuide === true,
      optional: !facts.dungeonSignupChannel,
      fix: T("Run /dungeon guide to post or repair the pinned signup guide. Set a channel first with /setup config channel.")
    },
    {
      label: T("Dungeon signup guide pin permission"),
      ok: facts.dungeonSignupCanPin === true,
      optional: !facts.dungeonSignupChannel,
      fix: T("Give the bot role the \"Pin Messages\" permission in the dungeon signup channel.")
    },
    channelCheck(lang, T("Dungeon leaderboard channel"), facts.dungeonLeaderboardChannel ?? null, true, T("Optional: run /setup start, step 3 (Dungeon channels).")),
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
      ok: facts.companionTokenSet,
      optional: true,
      fix: T("Needed only to sync the addon: put COMPANION_UPLOAD_TOKEN in .env.local (and the same value in companion.config.json), then restart the bot.")
    },
    {
      label: T("Characters linked"),
      ok: facts.linkedCharacters > 0,
      optional: true,
      fix: T("Everyone runs /character add once so addon data and EPGP match them.")
    }
  ];
  return checks;
}

// One line per check for an embed: ✅ done, ❌ needed, ➖ optional and off.
export function formatChecks(checks: SetupCheck[]): string {
  return checks.map((check) => {
    if (check.ok) return `✅ ${check.label}`;
    return `${check.optional ? "➖" : "❌"} ${check.label}\n   ↳ ${check.fix}`;
  }).join("\n");
}

export function setupComplete(checks: SetupCheck[]): boolean {
  return checks.every((check) => check.ok || check.optional);
}
