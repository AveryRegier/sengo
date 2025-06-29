var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { SengoClient } from './client';
import Chance from 'chance';
describe('SengoClient Integration (Memory)', () => {
    const chance = new Chance();
    let client;
    let collectionName;
    let doc;
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
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        yield client.close();
    }));
    it('should insert and find a document in a random collection', () => __awaiter(void 0, void 0, void 0, function* () {
        const collection = client.db().collection(collectionName);
        const insertResult = yield collection.insertOne(doc);
        expect(insertResult.acknowledged).toBe(true);
        expect(insertResult.insertedId).toBeDefined();
        const found = yield collection.find({ _id: insertResult.insertedId });
        expect(found.length).toBe(1);
        expect(found[0]).toMatchObject(doc);
        expect(found[0]._id).toBeDefined();
    }));
});
