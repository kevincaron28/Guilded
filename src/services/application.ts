import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { ApplicationStatus, type PrismaClient, type RaidRole } from "@prisma/client";

// Shared with commands/application.ts (the click-to-apply flow) and
// raid-core.ts (the "Apply" button on a core's live roster message).
export const APPLY_PREFIX = "apply-form:";

// Opens the application form straight to one core (skips the "which core?"
// picker), for that core's own roster message.
export function applyToCoreButtonRow(core: { id: string; name: string }) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${APPLY_PREFIX}roster:${core.id}`).setLabel(`Apply to ${core.name}`.slice(0, 80)).setEmoji("📋").setStyle(ButtonStyle.Primary)
  );
}

// The card's buttons: all three while pending; after Trial, Approve and Reject stay so the
// trial can be settled later with one click; after Approve or Reject, none.
export function applicationDecisionRows(id: string, status: ApplicationStatus = ApplicationStatus.PENDING) {
  if (status === ApplicationStatus.APPROVED || status === ApplicationStatus.REJECTED) return [];
  const buttons = [new ButtonBuilder().setCustomId(`${APPLY_PREFIX}decide:approve:${id}`).setLabel(status === ApplicationStatus.TRIAL ? "Approve (end trial)" : "Approve").setStyle(ButtonStyle.Success)];
  if (status === ApplicationStatus.PENDING) buttons.push(new ButtonBuilder().setCustomId(`${APPLY_PREFIX}decide:trial:${id}`).setLabel("Trial").setStyle(ButtonStyle.Secondary));
  buttons.push(new ButtonBuilder().setCustomId(`${APPLY_PREFIX}decide:reject:${id}`).setLabel("Reject").setStyle(ButtonStyle.Danger));
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)];
}

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
  role?: RaidRole;
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
          ...(input.coreId ? { coreId: input.coreId } : {}),
          ...(input.role ? { role: input.role } : {})
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

    // Remembers the applications-channel card's message id, so a decision
    // made later with /application approve|reject|trial can update that
    // same card (never throws: losing this is cosmetic, not a data loss).
    async setCardMessage(id: string, messageId: string): Promise<void> {
      await database.application.update({ where: { id }, data: { cardMessageId: messageId } }).catch((error: unknown) => {
        console.error(`Failed to save application card message for ${id}`, error);
      });
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
