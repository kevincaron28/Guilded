// /guilded verify codes and addon-only members' data reach the bot only with an upload from an
// officer's companion (Guild.officerSyncAt). After this long without one, members (/character pair)
// and officers (/setup status) are told.
export const OFFICER_SYNC_DAYS = 14;

export const officerSyncRecent = (at: Date | null | undefined, now = new Date()) =>
  Boolean(at && now.getTime() - at.getTime() < OFFICER_SYNC_DAYS * 86_400_000);
