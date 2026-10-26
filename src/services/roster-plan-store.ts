import type { PrismaClient } from "../generated/prisma/client.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import { loadRosterSnapshot } from "./roster-dashboard-store.js";
import { mainPlanRevision, reviewMainPlan } from "./roster-review.js";

export class MainPlanConflict extends Error {}
export interface RosterPlanWriter {
  apply(userId: string, guildId: string, csv: string, revision: string): Promise<{ auditId: string; changes: number }>;
}

export function prismaRosterPlanWriter(database: PrismaClient, access: GuildDashboardAccess): RosterPlanWriter {
  return {
    async apply(userId, guildId, csv, revision) {
      // Fresh Discord role check before opening the database transaction.
      const guild = await access.authorize(userId, guildId);
      if (!guild) throw new MainPlanConflict("Access changed");
      return database.$transaction(async tx => {
        const actor = await tx.member.findFirst({ where: { guildId, discordUserId: userId, status: "ACTIVE", isTest: false }, select: { id: true } });
        if (!actor) throw new MainPlanConflict("Membership changed");
        const snapshot = await loadRosterSnapshot(tx, guild);
        if (snapshot.truncated || mainPlanRevision(snapshot) !== revision) throw new MainPlanConflict("Roster changed");
        const plan = reviewMainPlan(snapshot, csv);
        if (plan.some(row => !["change", "unchanged"].includes(row.status))) throw new MainPlanConflict("Plan has conflicts");
        const changes = plan.filter(row => row.status === "change");
        if (!changes.length) throw new MainPlanConflict("No changes");
        for (const change of changes) {
          const before = snapshot.characters.find(row => row.characterId === change.characterId);
          if (!before?.characterId || !before.memberId || !before.updatedAt || change.main === null) throw new MainPlanConflict("Identity changed");
          const result = await tx.character.updateMany({
            where: { id: before.characterId, guildId, gameEdition: guild.edition, memberId: before.memberId,
              isMain: before.isMain!, updatedAt: before.updatedAt, member: { guildId, status: "ACTIVE", isTest: false } },
            data: { isMain: change.main }
          });
          if (result.count !== 1) throw new MainPlanConflict("Concurrent change");
        }
        const audit = await tx.auditLog.create({ data: { guildId, actorId: userId, action: "MEMBER_UPDATED",
          metadata: { via: "roster-main-plan", edition: guild.edition, revision,
            changes: changes.map(row => ({ characterId: row.characterId!, character: row.character, realm: row.realm, before: row.current, after: row.main })) }
        }, select: { id: true } });
        return { auditId: audit.id, changes: changes.length };
      }, { isolationLevel: "Serializable", maxWait: 15_000, timeout: 15_000 });
    }
  };
}
