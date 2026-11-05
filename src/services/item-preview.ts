import { parseItemLinks } from "./item-links.js";
import { itemKey, type ItemDataProvider, type PreviewGate } from "./item-preview-data.js";
import { buildItemEmbed, buildPayload } from "./item-preview-embed.js";
import { postWebhook, type FetchLike } from "./item-preview-webhook.js";
import { openSecret } from "./secret-box.js";

// Orchestrates one chat message -> zero or one Discord-only webhook post (docs/ITEM_PREVIEWS.md).
// Everything outside (database, clock, network) is injected, so it is testable offline.

export interface PreviewConfigRow { discordGuildId: string; channelId: string; webhookId: string; webhookSealed: string; enabled: boolean }
export interface PreviewMessage {
  guildId: string; channelId: string; content: string;
  authorId: string; webhookId: string | null;
}
export interface PreviewDeps {
  loadConfig(discordGuildId: string): Promise<PreviewConfigRow | null>;
  disable(discordGuildId: string, reason: string): Promise<void>;
  secret: string | undefined;
  botUserId: string | undefined;
  fetch: FetchLike;
  provider: ItemDataProvider;
  gate: PreviewGate;
  now?: () => number;
  /** Per-guild back-off after a 429 (kept by the caller so it survives between messages). */
  backoff: Map<string, number>;
}

export type PreviewOutcome = "off" | "wrong-channel" | "self" | "no-items" | "throttled" | "no-secret" | "bad-secret" | "backoff" | "posted" | "disabled" | "failed";

export async function handlePreviewMessage(deps: PreviewDeps, message: PreviewMessage): Promise<PreviewOutcome> {
  const now = deps.now ?? Date.now;
  const config = await deps.loadConfig(message.guildId);
  if (!config || !config.enabled) return "off";
  if (message.channelId !== config.channelId) return "wrong-channel";
  // Loop prevention: never react to our own bot or to the preview webhook itself. Other bots and
  // webhooks are expected: the Blizzard relay is one of them.
  if ((deps.botUserId && message.authorId === deps.botUserId) || message.webhookId === config.webhookId) return "self";
  if (!message.content) return "no-items";
  const items = parseItemLinks(message.content);
  if (items.length === 0) return "no-items";
  if (!deps.secret) return "no-secret";
  const until = deps.backoff.get(message.guildId);
  if (until !== undefined && now() < until) return "backoff";

  const allowed = items.filter(item => deps.gate.allow(message.channelId, itemKey(item)));
  if (allowed.length === 0) return "throttled";

  const embeds = [];
  for (const item of allowed) embeds.push(buildItemEmbed(item, await deps.provider.lookup(item).catch(() => null)));

  const url = openSecret(deps.secret, config.webhookSealed);
  if (!url) { await deps.disable(message.guildId, "stored webhook could not be decrypted"); return "bad-secret"; }
  const result = await postWebhook(deps.fetch, url, buildPayload(embeds));
  if (result.ok) return "posted";
  if (result.disable) { await deps.disable(message.guildId, `webhook rejected (${result.status || "invalid"})`); return "disabled"; }
  if (result.retryAfterMs) deps.backoff.set(message.guildId, now() + result.retryAfterMs);
  return "failed";
}
