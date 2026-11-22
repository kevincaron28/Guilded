// My own answer on each upcoming raid (0.5.1): GET /api/v1/me/raid-signups and POST /api/v1/me/raid-signup.
export type Answer = "SIGNED_UP" | "MAYBE" | "WAITLISTED" | "CANCELLED";
export type RaidRoleName = "TANK" | "HEALER" | "DPS";
export interface MySignup { raidId: string; status: Answer | null; role: RaidRoleName | null; late: boolean; closesAt: string | null }
export type Choice = "YES" | "MAYBE" | "NO";

const ANSWERS: Answer[] = ["SIGNED_UP", "MAYBE", "WAITLISTED", "CANCELLED"];
const ROLES: RaidRoleName[] = ["TANK", "HEALER", "DPS"];
const record = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function parseSignup(value: unknown): MySignup | null {
  const row = record(value);
  if (!row || typeof row.raidId !== "string" || !row.raidId) return null;
  return {
    raidId: row.raidId,
    status: ANSWERS.includes(row.status as Answer) ? row.status as Answer : null,
    role: ROLES.includes(row.role as RaidRoleName) ? row.role as RaidRoleName : null,
    late: row.late === true,
    closesAt: typeof row.closesAt === "string" && Number.isFinite(Date.parse(row.closesAt)) ? row.closesAt : null
  };
}

/** The list answer as a map by raid id; anything malformed is skipped. */
export function parseSignups(body: unknown): Record<string, MySignup> {
  const raids = record(body)?.raids;
  const out: Record<string, MySignup> = {};
  if (Array.isArray(raids)) for (const item of raids) { const signup = parseSignup(item); if (signup) out[signup.raidId] = signup; }
  return out;
}

/** The sign-up answer of one POST. */
export const parseSignupAnswer = (body: unknown): MySignup | null => parseSignup(record(body)?.signup);

/**
 * Only raids made by the bot can be answered here. A Discord scheduled event (id "discord:<id>") has no sign-up list,
 * and the server answers any other id the same "no longer open".
 */
export const signable = (raidId: string): boolean => /^[a-z0-9]{20,40}$/.test(raidId);

/** A raid whose reminders are not worth sending: the member said they cannot come. */
export const declined = (answers: Record<string, MySignup> | null | undefined, raidId: string): boolean => answers?.[raidId]?.status === "CANCELLED";

export const closed = (signup: MySignup | undefined, now = Date.now()): boolean => Boolean(signup?.closesAt && Date.parse(signup.closesAt) <= now);
