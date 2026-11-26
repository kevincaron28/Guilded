import type { PrismaClient, RaidRole } from "../generated/prisma/client.js";
import { SignupsClosedError, type RaidService } from "./raid.js";

// The phone app's raid sign-up (mobile 0.5.1): the same three answers as the Discord post's buttons (I'm in, Maybe, Can't come), for the
// member who holds the companion credential. The caller (companion-api.ts) has already turned the credential into a Discord user id.
// The raid and the server are re-read: a raid id from another server, an unknown one or a test raid answers the same "gone".
// The effects are the post's own: raidService.signup / cancelSignup (roles, caps, waitlist, core priority, the deadline), then the
// caller refreshes the signup post and tells a promoted or bumped player (as the buttons do).

const RAID_ID = /^[a-z0-9]{20,40}$/;
const GUILD_ID = /^\d{5,30}$/;
const ROLES: RaidRole[] = ["TANK", "HEALER", "DPS"];
export type SignupChoice = "YES" | "MAYBE" | "NO";
export type SignupState = "SIGNED_UP" | "MAYBE" | "WAITLISTED" | "CANCELLED";

export interface MySignup { raidId: string; status: SignupState | null; role: RaidRole | null; late: boolean; closesAt: string | null }
export type SignupResult =
  | { status: "ok"; signup: MySignup }
  | { status: "invalid" }
  | { status: "gone" }
  | { status: "closed"; closesAt: string | null }
  | { status: "refused"; message: string };

type Db = Pick<PrismaClient, "member" | "raid" | "guildSettings" | "character">;
type Raids = Pick<RaidService, "signup" | "cancelSignup">;
type Promoted = Awaited<ReturnType<RaidService["cancelSignup"]>>["promoted"];
export interface SignupEffects { guildId: string; guildDiscordId: string; raidId: string; promoted: Promoted; bumped: Awaited<ReturnType<RaidService["signup"]>>["bumped"] }

async function memberIn(database: Db, discordUserId: string, guildDiscordId: unknown, allows: (id: string) => boolean) {
  if (typeof guildDiscordId !== "string" || !GUILD_ID.test(guildDiscordId) || !allows(guildDiscordId)) return null;
  return database.member.findFirst({ where: { discordUserId, status: "ACTIVE", isTest: false, guild: { discordId: guildDiscordId } }, select: { id: true, guildId: true } });
}

const view = (raidId: string, closesAt: Date | null, row: { status: SignupState; role: RaidRole; late: boolean } | null | undefined): MySignup =>
  ({ raidId, status: row?.status ?? null, role: row?.role ?? null, late: row?.late ?? false, closesAt: closesAt ? closesAt.toISOString() : null });

/**
 * The character a phone answer is for, on a server with character sign-ups on (the phone has no picker): the one already on this
 * raid's sign-up, else the main. Undefined elsewhere, and when there is neither: raidService then takes the only character or says so.
 */
async function signupCharacterFor(database: Db, member: { id: string; guildId: string }, signedUpAs: string | null | undefined): Promise<string | undefined> {
  const settings = await database.guildSettings.findUnique({ where: { guildId: member.guildId }, select: { characterSignups: true } });
  if (!settings?.characterSignups) return undefined;
  if (signedUpAs) return signedUpAs;
  return (await database.character.findFirst({ where: { memberId: member.id, isMain: true }, select: { id: true } }))?.id;
}

/** The member's own answer on each upcoming raid of one server (empty when they are not in it). */
export async function mySignupsFor(database: Db, discordUserId: string, guildDiscordId: unknown, allows: (id: string) => boolean = () => true, now = new Date()): Promise<{ raids: MySignup[] }> {
  const member = await memberIn(database, discordUserId, guildDiscordId, allows);
  if (!member) return { raids: [] };
  const raids = await database.raid.findMany({
    where: { guildId: member.guildId, status: "PLANNED", isTest: false, scheduledAt: { gt: now } },
    orderBy: { scheduledAt: "asc" }, take: 30,
    select: { id: true, signupsCloseAt: true, signups: { where: { memberId: member.id }, select: { status: true, role: true, late: true }, take: 1 } }
  });
  return { raids: raids.map((raid) => view(raid.id, raid.signupsCloseAt, raid.signups[0])) };
}

export async function signUpFor(
  database: Db, raids: Raids, discordUserId: string, input: { raidId?: unknown; guildDiscordId?: unknown; choice?: unknown; role?: unknown },
  allows: (id: string) => boolean = () => true, after: (effects: SignupEffects) => Promise<void> = async () => undefined
): Promise<SignupResult> {
  const { raidId, choice } = input;
  if (typeof raidId !== "string" || !RAID_ID.test(raidId) || (choice !== "YES" && choice !== "MAYBE" && choice !== "NO")) return { status: "invalid" };
  if (input.role !== undefined && !ROLES.includes(input.role as RaidRole)) return { status: "invalid" };
  const member = await memberIn(database, discordUserId, input.guildDiscordId, allows);
  if (!member) return { status: "gone" };
  const raid = await database.raid.findFirst({
    where: { id: raidId, guildId: member.guildId, isTest: false }, select: { id: true, status: true, signupsCloseAt: true,
      signups: { where: { memberId: member.id }, select: { status: true, role: true, late: true, characterId: true }, take: 1 } }
  });
  if (!raid || raid.status !== "PLANNED") return { status: "gone" };
  const existing = raid.signups[0];
  const guildDiscordId = input.guildDiscordId as string;
  try {
    if (choice === "NO") {
      // Can't come: nothing to cancel is already the answer the member wants.
      if (!existing || existing.status === "CANCELLED") return { status: "ok", signup: view(raid.id, raid.signupsCloseAt, existing) };
      const { cancelled, promoted } = await raids.cancelSignup(raid.id, member.guildId, member.id);
      await after({ guildId: member.guildId, guildDiscordId, raidId: raid.id, promoted, bumped: null });
      return { status: "ok", signup: view(raid.id, raid.signupsCloseAt, cancelled as { status: SignupState; role: RaidRole; late: boolean }) };
    }
    // Maybe keeps the current role (DPS when there is none), as the post's Maybe button does.
    const active = existing && existing.status !== "CANCELLED" ? existing : null;
    const role = (input.role as RaidRole | undefined) ?? active?.role ?? "DPS";
    const character = await signupCharacterFor(database, member, existing?.characterId);
    const saved = await raids.signup(raid.id, member.guildId, member.id, role, choice === "MAYBE" ? "MAYBE" : "AVAILABLE", character, true);
    await after({ guildId: member.guildId, guildDiscordId, raidId: raid.id, promoted: saved.promoted, bumped: saved.bumped });
    return { status: "ok", signup: view(raid.id, raid.signupsCloseAt, saved as { status: SignupState; role: RaidRole; late: boolean }) };
  } catch (error) {
    if (error instanceof SignupsClosedError) return { status: "closed", closesAt: error.closedAt.toISOString() };
    const message = error instanceof Error ? error.message.slice(0, 200) : "";
    console.warn("Phone app: raid sign-up refused:", message);
    return message ? { status: "refused", message } : { status: "refused", message: "Signing up did not work." };
  }
}
