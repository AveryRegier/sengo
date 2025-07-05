import { describe, it, expect } from 'vitest';
import { ConsumingArrayCursor, Cursor } from '../../src/client/findCursor';

describe('Cursor', () => {
  const docs = [
    { _id: 1, name: 'A' },
    { _id: 2, name: 'B' },
    { _id: 3, name: 'C' },
  ];

  it('returns documents in order with next()', async () => {
    const cursor = new ConsumingArrayCursor([...docs]);
    expect(await cursor.next()).toEqual(docs[0]);
    expect(await cursor.next()).toEqual(docs[1]);
    expect(await cursor.next()).toEqual(docs[2]);
    expect(await cursor.next()).toBeNull();
  });

  it('toArray() returns all remaining documents', async () => {
    const cursor = new ConsumingArrayCursor([...docs]);
    await cursor.next(); // consume one
    expect(await cursor.toArray()).toEqual([docs[1], docs[2]]);
    expect(await cursor.next()).toBeNull();
  });

  it('hasNext() is true when there are more docs', async () => {
    const cursor = new ConsumingArrayCursor([...docs]);
    expect(await cursor.hasNext()).toBe(true);
    await cursor.next();
    await cursor.next();
    expect(await cursor.hasNext()).toBe(true);
    await cursor.next();
    expect(await cursor.hasNext()).toBe(false);
  });

  it('close() prevents further access', async () => {
    const cursor = new ConsumingArrayCursor([...docs]);
    await cursor.close();
    await expect(cursor.next()).rejects.toThrow('Cursor is closed');
    await expect(cursor.toArray()).rejects.toThrow('Cursor is closed');
  });

  it('supports async iteration', async () => {
    const cursor = new ConsumingArrayCursor([...docs]);
    const seen: any[] = [];
    for await (const doc of cursor) {
      seen.push(doc);
    }
    expect(seen).toEqual(docs);
  });
});
