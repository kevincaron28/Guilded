import type { WebhookPayload } from "./item-preview-embed.js";

export type WebhookResult =
  | { ok: true }
  | { ok: false; status: number; disable: boolean; retryAfterMs?: number };

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

const WEBHOOK = /^https:\/\/(?:discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api(?:\/v\d+)?\/webhooks\/(\d{15,25})\/([A-Za-z0-9._-]{20,120})$/;

/** Accepts only a Discord webhook URL; returns its parts or null. The caller must never log the input. */
export function parseWebhookUrl(url: string): { id: string; token: string } | null {
  const m = WEBHOOK.exec(url.trim());
  return m ? { id: m[1]!, token: m[2]! } : null;
}

/**
 * Posts through a stored webhook with wait=true. Results carry only a status, never the URL or token.
 * 401/404 = the webhook is gone or revoked: the caller disables the feature. 429 = honour retry-after.
 */
export async function postWebhook(fetchImpl: FetchLike, webhookUrl: string, payload: WebhookPayload, timeoutMs = 8000): Promise<WebhookResult> {
  const parts = parseWebhookUrl(webhookUrl);
  if (!parts) return { ok: false, status: 0, disable: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://discord.com/api/v10/webhooks/${parts.id}/${parts.token}?wait=true`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    if (res.status === 401 || res.status === 404) return { ok: false, status: res.status, disable: true };
    if (res.status === 429) {
      const header = res.headers.get("retry-after");
      let seconds = header ? Number(header) : Number.NaN;
      if (!Number.isFinite(seconds)) {
        const body = await res.json().catch(() => null) as { retry_after?: number } | null;
        seconds = Number(body?.retry_after);
      }
      return { ok: false, status: 429, disable: false, retryAfterMs: Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0) * 1000, 300_000) : 5000 };
    }
    return { ok: false, status: res.status, disable: false };
  } catch {
    return { ok: false, status: 0, disable: false };
  } finally { clearTimeout(timer); }
}
