// When a device last synced (link-status.ts "Last synced"). At most one write per 5 minutes per
// device, never awaited and never failing the request.
const USE_NOTE_MS = 5 * 60_000;
type UseNote = { updateMany(args: { where: { tokenHash: string; OR: ({ lastUsedAt: null } | { lastUsedAt: { lt: Date } })[] }; data: { lastUsedAt: Date } }): Promise<unknown> };
export function noteCredentialUse(model: UseNote | undefined, tokenHash: string, now = new Date()): void {
  try {
    void Promise.resolve(model?.updateMany({ where: { tokenHash, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - USE_NOTE_MS) } }] }, data: { lastUsedAt: now } })).catch(() => {});
  } catch { /* a missing column or a test double: the status line simply stays as it was */ }
}
