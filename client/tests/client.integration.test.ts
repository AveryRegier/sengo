import { SengoClient } from '../src/client/client';
import Chance from 'chance';

describe('SengoClient Integration (Memory)', () => {
  const chance = new Chance();
  let client: SengoClient;
  let collectionName: string;
  let doc: any;

  beforeAll(() => {
    client = new SengoClient('memory');
    collectionName = 'col_' + chance.hash({ length: 8 });
    doc = {
      name: chance.name(),
      age: chance.age(),
      email: chance.email(),
      random: chance.string({ length: 10 })
    };
  });

  afterAll(async () => {
    await client.close();
  });

  it('should insert and find a document in a random collection', async () => {
    const collection = client.db().collection(collectionName);
    const insertResult = await collection.insertOne(doc);
    expect(insertResult.acknowledged).toBe(true);
    expect(insertResult.insertedId).toBeDefined();
    const found = await collection.find({ _id: insertResult.insertedId });
    expect(found.length).toBe(1);
    expect(found[0]).toMatchObject(doc);
    expect(found[0]._id).toBeDefined();
  });
});
