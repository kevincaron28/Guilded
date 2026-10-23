import type { AuditAction, Prisma, PrismaClient } from "@prisma/client";

export interface AuditEntry {
  guildId: string;
  actorId: string;
  action: AuditAction;
  entityId?: string;
  metadata: Prisma.InputJsonObject;
}

export function createAuditService(database: PrismaClient) {
  return {
    record(entry: AuditEntry) {
      return database.auditLog.create({
        data: {
          guildId: entry.guildId,
          actorId: entry.actorId,
          action: entry.action,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata
        }
      });
    }
  };
}
