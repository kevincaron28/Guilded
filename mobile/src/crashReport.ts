import { ApiError, fetchBounded, readTextBounded } from "./api";

// "Send error report" on the friendly error screen (0.4.0). Nothing is sent unless the person presses the button. The report
// is the error text, a short stack, the app version, the platform and the screen: no account, name, token or guild data.
// The server files it like /report bug and answers a reference (POST /api/v1/mobile/report, src/services/mobile-app-report.ts).

export interface ErrorReport { message: string; stack: string; version: string; platform: "android" | "ios" | "web"; screen: string }

let screen = "";
/** The tab the person is on, so a report says where it happened. */
export function setReportScreen(name: string): void { screen = name; }
export const currentReportScreen = (): string => screen;

const clip = (value: string, max: number): string => value.slice(0, max);
// Paths and links inside a message or stack can carry a username or a token; keep only what helps find the bug.
const scrub = (value: string): string => value.replace(/\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s)'"]+/gi, "[link]").replace(/\b[A-Za-z]:\\[^\s)'"]+/g, "[path]");

export function buildReport(error: unknown, context: { version?: string | undefined; platform: string; screen?: string }): ErrorReport {
  const value = error instanceof Error ? error : null;
  const message = scrub(value ? `${value.name}: ${value.message}` : typeof error === "string" ? error : "Unknown error");
  const stack = scrub(value?.stack ?? "").split("\n").slice(0, 8).join("\n");
  return {
    message: clip(message.trim() || "Unknown error", 400), stack: clip(stack, 1200), version: clip(context.version ?? "unknown", 20),
    platform: context.platform === "ios" || context.platform === "web" ? context.platform : "android", screen: clip(context.screen ?? "", 40)
  };
}

/** Files the report and returns its short reference. Throws when the server refuses or cannot be reached. */
export async function sendErrorReport(origin: string, report: ErrorReport): Promise<string> {
  const response = await fetchBounded(`${origin}/api/v1/mobile/report`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(report) });
  let body: unknown = null;
  try { body = JSON.parse(await readTextBounded(response)); } catch { /* handled below */ }
  const ref = body && typeof body === "object" && "ref" in body ? (body as { ref: unknown }).ref : null;
  if (!response.ok || typeof ref !== "string" || !ref) throw new ApiError("The report could not be sent.", response.status);
  return ref;
}
