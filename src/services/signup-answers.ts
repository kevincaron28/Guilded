import type { PrismaClient, RaidRole } from "../generated/prisma/client.js";
import type { AddonSignupAnswer } from "../integrations/addon.js";
import { findCharacter } from "./character-match.js";
import { createRaidService } from "./raid.js";

// In-game raid sign-up (9.0). A member answers Sign up / Tentative / Can't on the addon's Signups
// page; the companion uploads the answer and the bot applies it to the Discord raid signup.
//
// One source of truth: the Discord RaidSignup row, one per member and raid. Conflict rule: the
// LATEST change wins, per member. An answer is applied only when it was given after the signup's
// last change (signed up, changed, or cancelled on Discord); an older answer is skipped, so a
// later Discord change is never undone by an old upload, and sending the same answer again
// changes nothing. The addon applies the same rule the other way round when it shows the list.

export interface SignupAnswerJob {
  raidId: string;
  memberId: string;
  status: AddonSignupAnswer["status"];
  role?: RaidRole;
  /** ISO time the member clicked in game. */
  at: string;
}

export interface SignupAnswerSummary {
  applied: number;
  /** Older than the signup's last change, or already exactly that answer. */
  unchanged: number;
  /** Raid closed, full of its kind, past its deadline... */
  failed: number;
  changedRaidIds: string[];
}

interface LinkedCharacter { id: string; name: string; realm: string; memberId: string }

/** Answers from the upload -> jobs for the members they belong to. Unlinked characters are left out. */
export function planSignupAnswers(answers: readonly AddonSignupAnswer[], characters: readonly LinkedCharacter[]): SignupAnswerJob[] {
  const jobs = new Map<string, SignupAnswerJob>();
  for (const answer of answers) {
    const character = findCharacter(characters, answer.character, answer.realm);
    if (!character) continue;
    const key = `${answer.raidId}:${character.memberId}`;
    const earlier = jobs.get(key);
    // Two characters of one member answering the same raid: the later click is the member's answer.
    if (earlier && Date.parse(earlier.at) >= answer.at.getTime()) continue;
    jobs.set(key, { raidId: answer.raidId, memberId: character.memberId, status: answer.status, ...(answer.role ? { role: answer.role } : {}), at: answer.at.toISOString() });
  }
  return [...jobs.values()];
}

/** When the member's Discord signup last changed (signing up, switching, cancelling). */
export function lastSignupChange(signup: { status: string; signedUpAt: Date; cancelledAt: Date | null }): number {
  return signup.status === "CANCELLED" ? (signup.cancelledAt ?? signup.signedUpAt).getTime() : signup.signedUpAt.getTime();
}

const ACTIVE = new Set(["SIGNED_UP", "WAITLISTED"]);

export async function applySignupAnswers(database: PrismaClient, guildId: string, jobs: readonly SignupAnswerJob[]): Promise<SignupAnswerSummary> {
  const summary: SignupAnswerSummary = { applied: 0, unchanged: 0, failed: 0, changedRaidIds: [] };
  const raids = createRaidService(database);
  for (const job of jobs) {
    const at = Date.parse(job.at);
    const raid = Number.isFinite(at)
      ? await database.raid.findFirst({ where: { id: job.raidId, guildId, status: "PLANNED", isTest: false }, select: { id: true } })
      : null;
    if (!raid) { summary.failed++; continue; }
    const existing = await database.raidSignup.findUnique({ where: { raidId_memberId: { raidId: job.raidId, memberId: job.memberId } } });
    if (existing && at <= lastSignupChange(existing)) { summary.unchanged++; continue; }
    try {
      if (job.status === "DECLINED") {
        // "Can't" frees the member's place; with no signup there is nothing to cancel.
        if (!existing || existing.status === "CANCELLED") { summary.unchanged++; continue; }
        await raids.cancelSignup(job.raidId, guildId, job.memberId);
      } else {
        const role = (job.role ?? existing?.role ?? "DPS") as RaidRole;
        const wantMaybe = job.status === "TENTATIVE";
        const same = existing && existing.role === role && (wantMaybe ? existing.status === "MAYBE" : ACTIVE.has(existing.status));
        if (same) { summary.unchanged++; continue; }
        await raids.signup(job.raidId, guildId, job.memberId, role, wantMaybe ? "MAYBE" : "AVAILABLE", undefined, true);
      }
      summary.applied++;
      summary.changedRaidIds.push(job.raidId);
    } catch {
      summary.failed++;
    }
  }
  summary.changedRaidIds = [...new Set(summary.changedRaidIds)];
  return summary;
}

/** One raid's answers as the addon shows them: compact rows, nearest raids only. */
export interface AddonRaidSignup { name: string; role: "T" | "H" | "D"; class: string; status: "S" | "M" | "W"; at: number }

const ROLE_LETTER = { TANK: "T", HEALER: "H", DPS: "D" } as const;
const STATUS_LETTER = { SIGNED_UP: "S", MAYBE: "M", WAITLISTED: "W" } as const;

export function addonSignupRows(signups: readonly {
  role: string; status: string; signedUpAt: Date; characterName?: string | null;
  character?: { name: string; className: string } | null;
  member?: { characters?: readonly { name: string; className: string }[] } | null;
}[], limit = 40): AddonRaidSignup[] {
  const rows: AddonRaidSignup[] = [];
  for (const signup of signups) {
    const letter = STATUS_LETTER[signup.status as keyof typeof STATUS_LETTER];
    const role = ROLE_LETTER[signup.role as keyof typeof ROLE_LETTER];
    const character = signup.character ?? signup.member?.characters?.[0] ?? null;
    const name = (signup.character?.name ?? signup.characterName ?? character?.name ?? "").trim();
    if (!letter || !role || !name) continue;
    rows.push({ name: name.slice(0, 40), role, class: (character?.className ?? "").toUpperCase().replace(/[^A-Z]/g, ""), status: letter, at: Math.floor(signup.signedUpAt.getTime() / 1000) });
    if (rows.length >= limit) break;
  }
  return rows;
}
