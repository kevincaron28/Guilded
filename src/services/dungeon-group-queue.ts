// Discord side effects for one group must complete before another click or
// cleanup edits its roster, starts it, or closes its voice channel.
const pending = new Map<string, Promise<unknown>>();
export async function serializeDungeonGroup<T>(groupId: string, work: () => Promise<T>): Promise<T> {
  const task = (pending.get(groupId) ?? Promise.resolve()).catch(() => undefined).then(work);
  pending.set(groupId, task);
  try { return await task; } finally { if (pending.get(groupId) === task) pending.delete(groupId); }
}
