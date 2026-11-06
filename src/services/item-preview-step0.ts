import { buildItemEmbed, buildPayload } from "./item-preview-embed.js";
import { postWebhook, type FetchLike } from "./item-preview-webhook.js";
import { sealSecret } from "./secret-box.js";

// "Step 0" of docs/ITEM_PREVIEWS.md in one command: a test embed through a TEMPORARY webhook the bot creates in a
// chosen channel, then the webhook is deleted again. If the owner sees the test post in Discord and NOT in WoW guild
// chat, one button turns previews on with a permanent webhook the bot creates itself (no URL is ever typed or shown).
// Everything outside (Discord, network, database) is injected so this is testable offline.

export const ITEM_PREVIEW_PREFIX = "ipv:";

export interface BotWebhook { id: string; url: string; remove(): Promise<void> }
export interface StepZeroDeps {
  createWebhook(channelId: string, name: string): Promise<BotWebhook>;
  fetch: FetchLike;
}
export type StepZeroStage = "create" | "post" | "done";
export interface StepZeroResult {
  ok: boolean;
  stage: StepZeroStage;
  /** The test post, kept so the owner can look for it in WoW chat; removed by the owner's button. */
  messageId?: string;
  /** True when the temporary webhook no longer exists. */
  cleaned: boolean;
  detail: string;
}

export async function runStepZero(deps: StepZeroDeps, channelId: string): Promise<StepZeroResult> {
  let hook: BotWebhook;
  try { hook = await deps.createWebhook(channelId, "Guilded item preview test"); }
  catch { return { ok: false, stage: "create", cleaned: true, detail: "The bot could not create a webhook in that channel. Give it Manage Webhooks there (or the channel blocks webhooks); nothing was created." }; }
  let post: Awaited<ReturnType<typeof postWebhook>> | null;
  try {
    const embed = buildItemEmbed({ itemId: 2092, name: "Guilded step 0 test item", verified: true, quality: 3 }, null);
    embed.footer = { text: "Guilded item preview test: you can ignore this" };
    post = await postWebhook(deps.fetch, hook.url, buildPayload([embed]));
  } catch { post = null; }
  // Clean up whatever happened: the temporary webhook must not outlive the test.
  const cleaned = await hook.remove().then(() => true, () => false);
  const tail = cleaned ? "" : " The temporary webhook could not be deleted: delete \"Guilded item preview test\" in Channel settings > Integrations.";
  if (!post || !post.ok) {
    const status = post && !post.ok ? post.status : 0;
    return { ok: false, stage: "post", cleaned, detail: `The channel did not accept the test post${status ? ` (HTTP ${status})` : ""}. Previews cannot run there; stop here and do not work around it.${tail}` };
  }
  return { ok: true, stage: "done", ...(post.messageId ? { messageId: post.messageId } : {}), cleaned, detail: `The test embed was posted and the temporary webhook was ${cleaned ? "deleted" : "NOT deleted"}.${tail}` };
}

export interface EnableDeps {
  createWebhook(channelId: string, name: string): Promise<BotWebhook>;
  save(row: { channelId: string; webhookId: string; webhookSealed: string }): Promise<void>;
  secret: string;
}
/** After step 0 passed: the bot makes its own permanent webhook and stores only the encrypted URL. */
export async function enableAfterStepZero(deps: EnableDeps, channelId: string): Promise<{ ok: boolean; detail: string }> {
  let hook: BotWebhook;
  try { hook = await deps.createWebhook(channelId, "Guilded item previews"); }
  catch { return { ok: false, detail: "The bot could not create the permanent webhook. Previews stay off." }; }
  try { await deps.save({ channelId, webhookId: hook.id, webhookSealed: sealSecret(deps.secret, hook.url) }); }
  catch {
    await hook.remove().catch(() => undefined);
    return { ok: false, detail: "Saving failed, so the new webhook was deleted. Previews stay off." };
  }
  return { ok: true, detail: `Item previews are ON for <#${channelId}>. The webhook is stored encrypted; disable or delete it with /guilded-previews.` };
}

export const stepZeroButtons = (channelId: string, messageId: string) => ({
  pass: `${ITEM_PREVIEW_PREFIX}ok:${channelId}:${messageId}`,
  fail: `${ITEM_PREVIEW_PREFIX}bad:${channelId}:${messageId}`
});
export function parseStepZeroButton(customId: string): { verdict: "ok" | "bad"; channelId: string; messageId: string } | null {
  const m = /^ipv:(ok|bad):(\d{15,25}):(\d{15,25})$/.exec(customId);
  return m ? { verdict: m[1] as "ok" | "bad", channelId: m[2]!, messageId: m[3]! } : null;
}
