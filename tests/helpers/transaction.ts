// Model unit tests share the same serialization boundary as the real database
// service. Real advisory-lock behavior is separately exercised against PostgreSQL.
export function withTransactionMock<T extends object>(database: T): T {
  let queue = Promise.resolve();
  return Object.assign(database, { $transaction: (work: (tx: unknown) => Promise<unknown>) => {
    const task = queue.then(() => work({ ...database, $executeRaw: async () => 0 }));
    queue = task.then(() => undefined, () => undefined);
    return task;
  } });
}
