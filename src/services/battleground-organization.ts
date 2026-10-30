import type { PrismaClient } from "../generated/prisma/client.js";
import { battlegroundPlanSchema, validateBattlegroundSlots } from "./battleground-policy.js";
import { composition, scheduleData } from "./activity-core.js";

export async function createBattleground(db: PrismaClient, guildId: string, input: {
  name: string; channelId: string; plan: unknown; startsAt: Date;
  tanks: number; healers: number; dps: number; durationMinutes: number;
}, now = new Date()) {
  const plan = battlegroundPlanSchema.parse(input.plan);
  const slots = composition("PVP", input.tanks, input.healers, input.dps);
  validateBattlegroundSlots(plan, slots);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 50) throw new Error("Name must be 2–50 characters / Nom de 2 à 50 caractères.");
  if (!Number.isFinite(input.startsAt.getTime()) || input.startsAt <= now || input.startsAt.getTime() > now.getTime() + 90 * 86400000) {
    throw new Error("Choose a start within 90 days / Début dans les 90 prochains jours.");
  }
  return db.$transaction(async tx => {
    const guild = await tx.guild.findUniqueOrThrow({ where: { id: guildId }, select: { gameEdition: true } });
    if (guild.gameEdition !== plan.edition) throw new Error("Use this guild's edition / Utilisez l'édition de cette guilde.");
    const core = await tx.activityCore.create({ data: {
      guildId, name, nameKey: name.toLowerCase(), kind: "PVP", channelId: input.channelId,
      battlegroundPlan: plan, ...slots, ...scheduleData("off", "UTC", input.durationMinutes),
    } });
    return tx.activitySession.create({ data: {
      coreId: core.id, occurrence: `bg:${input.startsAt.toISOString()}`, scheduledAt: input.startsAt,
      endsAt: new Date(input.startsAt.getTime() + input.durationMinutes * 60000), openRecruitment: true,
    } });
  });
}
