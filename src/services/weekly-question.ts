import { z } from "zod";
import { cleanOptions } from "./poll.js";
import { timezone } from "./group-subscription.js";

const text = (max: number) => z.string().trim().min(3).max(max).refine(value => !/@everyone|@here|<@|<#/.test(value), "Do not include mentions.");
export const weeklyQuestionDraftSchema = z.object({
  question: text(250),
  options: z.array(z.string().trim().min(1).max(80).refine(value => !/@everyone|@here|<@|<#/.test(value), "Do not include mentions.")).max(5).default([]),
  timezone,
  weekday: z.number().int().min(0).max(6),
  minute: z.number().int().min(0).max(1439),
  channelId: z.string().regex(/^\d{17,20}$/),
  mode: z.enum(["question", "button-poll"]).default("question")
}).strict().superRefine((value, context) => {
  if (value.mode === "question" && value.options.length) context.addIssue({ code: "custom", message: "A question does not need vote options." });
  if (value.mode === "button-poll") {
    try { cleanOptions(value.options); } catch { context.addIssue({ code: "custom", message: "Use two to five different poll options." }); }
  }
});

/** Configuration scaffold only. Uses existing officer poll authorization and
 * button-poll constraints. Native Discord polls need a separate capability check.
 * No scheduling, rewards, persistence or Discord send occurs here. */
export function weeklyQuestionDraft(input: unknown, actor: { canManagePolls: boolean; canViewChannel: boolean; canSendToChannel: boolean }) {
  if (!actor.canManagePolls || !actor.canViewChannel || !actor.canSendToChannel) throw new Error("Officer permission and access to the selected channel are required.");
  const settings = weeklyQuestionDraftSchema.parse(input);
  return { ...settings, enabled: false as const, cadence: "weekly" as const, automaticPoints: 0 as const, allowedMentions: { parse: [] as string[] } };
}
