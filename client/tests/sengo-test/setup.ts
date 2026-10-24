// Drop this folder into sengo/client/tests/client/ so the relative imports resolve.
import { SengoClient } from '../../src/client/client';
import { SengoCollection } from '../../src/client/collection';
import { S3BucketSimulator } from '../repository/s3/S3BucketSimulator';
import type { WithId } from '../../src/types';

export interface Signup extends WithId<{}> {
  calendarId: string;
  memberId: string;
  isAvailable: boolean;
  assignedPositionId?: string | null;
  positionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TestContext {
  client: SengoClient;
  signups: SengoCollection<Signup>;
  s3sim: S3BucketSimulator;
}

export function createContext(collectionName = 'event_signups'): TestContext {
  const s3sim = new S3BucketSimulator();
  const client = new SengoClient();
  const signups = client.db('s3').collection<Signup>(collectionName);
  (signups.store as any).s3 = { send: s3sim.handleCommand.bind(s3sim) };
  return { client, signups, s3sim };
}

// Mongo-style: a unique compound index on one signup per member per event.
export async function createSignupUniqueIndex(signups: SengoCollection<Signup>): Promise<string> {
  return signups.createIndex({ calendarId: 1, memberId: 1 }, { unique: true } as any);
}

export const NOW = '2026-10-24T12:00:00.000Z';
