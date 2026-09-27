import { ApplicationStatus, type PrismaClient } from "@prisma/client";

export interface CreateApplicationInput {
  guildId: string;
  memberId: string;
  character: string;
  className: string;
  spec: string;
  experience: string;
  availability: string;
  notes?: string;
  coreId?: string;
}

export function createApplicationService(database: PrismaClient) {
  return {
    async create(input: CreateApplicationInput) {
      for (const [label, value] of Object.entries(input).slice(2, 7)) {
        if (typeof value !== "string" || value.trim().length < 2) throw new Error(`${label} is required`);
      }
      return database.application.create({
        data: {
          guildId: input.guildId,
          memberId: input.memberId,
          character: input.character.trim(),
          className: input.className.trim(),
          spec: input.spec.trim(),
          experience: input.experience.trim(),
          availability: input.availability.trim(),
          ...(input.notes ? { notes: input.notes.trim() } : {}),
          ...(input.coreId ? { coreId: input.coreId } : {})
        },
        include: { core: true }
      });
    },

    list(guildId: string, status?: ApplicationStatus) {
      return database.application.findMany({
        where: { guildId, ...(status ? { status } : {}) },
        include: { member: true, core: true },
        orderBy: { createdAt: "desc" }
      });
    },

    get(guildId: string, id: string) {
      return database.application.findFirst({ where: { guildId, id }, include: { member: true, core: true } });
    },

    async transition(guildId: string, id: string, status: ApplicationStatus, reviewedBy: string) {
      const application = await database.application.findFirst({ where: { guildId, id } });
      if (!application) throw new Error("Application not found");
      if (application.status !== ApplicationStatus.PENDING && application.status !== ApplicationStatus.TRIAL) {
        throw new Error("This application cannot be changed");
      }
      return database.application.update({
        where: { id },
        data: { status, reviewedBy, reviewedAt: new Date() }
      });
    }
  };
}
