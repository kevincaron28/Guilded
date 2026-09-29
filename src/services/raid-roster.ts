import type { PrismaClient } from "@prisma/client";

// The next raid's signed-up players, for the addon's mass invite (/guilded invite
// raid). Signups are per Discord member, so each is shown as one character: for a
// core raid the backup character of the role they signed up as, else the character
// they bring to that core; otherwise (or when none is set) their main, or their first one.

export interface NextRaid {
  id: string;
  title: string;
  scheduledAt: string;
  core: string | null;
  // The core's id: the addon keeps the core it follows by id, so a renamed core still matches.
  coreId: string | null;
  players: { name: string; role: string }[];
  maybe: string[];
}

type Db = Pick<PrismaClient, "raid">;

const WINDOW_BEFORE_MS = 3 * 3_600_000;   // still "tonight's raid" a few hours after it was due
const WINDOW_AFTER_MS = 36 * 3_600_000;   // and it appears the day before

export async function nextRaidRoster(database: Db, guildId: string, now = new Date()): Promise<NextRaid | null> {
  const raid = await database.raid.findFirst({
    where: {
      guildId, isTest: false, status: { in: ["PLANNED", "ACTIVE"] },
      scheduledAt: { gte: new Date(now.getTime() - WINDOW_BEFORE_MS), lte: new Date(now.getTime() + WINDOW_AFTER_MS) }
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      core: { select: { name: true, members: { select: { memberId: true, character: { select: { name: true } }, backups: { select: { role: true, character: { select: { name: true } } } } } } } },
      signups: { where: { status: { in: ["SIGNED_UP", "MAYBE"] } }, include: { member: { include: { characters: { orderBy: { isMain: "desc" } } } } }, orderBy: { signedUpAt: "asc" } }
    }
  });
  if (!raid) return null;
  const spots = new Map(raid.core?.members.map((spot) => [spot.memberId, spot]) ?? []);
  const nameOf = (signup: (typeof raid.signups)[number]) => {
    const spot = spots.get(signup.memberId);
    const backup = spot?.backups.find((entry) => entry.role === signup.role);
    return backup?.character.name ?? spot?.character?.name ?? signup.member.characters[0]?.name ?? null;
  };
  return {
    id: raid.id,
    title: raid.title,
    scheduledAt: raid.scheduledAt.toISOString(),
    core: raid.core?.name ?? null,
    coreId: raid.coreId ?? null,
    players: raid.signups.filter((s) => s.status === "SIGNED_UP").flatMap((s) => { const name = nameOf(s); return name ? [{ name, role: s.role }] : []; }),
    maybe: raid.signups.filter((s) => s.status === "MAYBE").flatMap((s) => { const name = nameOf(s); return name ? [name] : []; })
  };
}
