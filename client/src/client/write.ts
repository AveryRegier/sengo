import type { CollectionIndex } from '../repository/index';
import type { WithId } from '../types';

const storeWriteQueues = new WeakMap<object, Promise<void>>();

export async function serializeStoreWrite<T>(store: object, operation: () => Promise<T>): Promise<T> {
  const previous = storeWriteQueues.get(store) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  storeWriteQueues.set(store, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (storeWriteQueues.get(store) === queued) {
      storeWriteQueues.delete(store);
    }
  }
}

export async function rollbackUniqueIndexes(
  claimed: CollectionIndex[],
  current: WithId<Record<string, any>> | null,
  updated: WithId<Record<string, any>>,
): Promise<unknown[]> {
  const cleanupErrors: unknown[] = [];
  for (const index of claimed.reverse()) {
    try {
      if (current) {
        await index.updateIndexOnDocumentUpdate(updated, current);
      } else {
        await index.removeDocument(updated);
      }
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  }
  return cleanupErrors;
}
