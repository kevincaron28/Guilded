// Words for the invite expiry (invite-expiry.ts), kept apart so the pure invite-queue code does not load Discord or the config.
export type CloseReason = "left_discord" | "member_cancelled" | "no_answer" | "expired" | "officer_removed" | "superseded";
/** What an officer reads for a closed request (English: the officer reply is English like the rest of /mod invites). */
export const CLOSE_TEXT: Record<CloseReason, string> = {
  left_discord: "the member left the Discord server",
  member_cancelled: "the member answered No",
  no_answer: "no answer to the confirmation question",
  expired: "too old, with no confirmation question (DM switched off)",
  officer_removed: "removed by an officer in game",
  superseded: "the member posted a newer request (corrected name)"
};
export const GAME_STATE_TEXT: Record<string, string> = { declined: "declined in game", inguild: "in another guild", notfound: "character not found" };
