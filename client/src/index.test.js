var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { SengoClient } from './client/client';
import Chance from 'chance';
const chance = new Chance();
describe('SengoClient basic API', () => {
    it('should allow db().collection() and insertOne()', () => __awaiter(void 0, void 0, void 0, function* () {
        const client = new SengoClient();
        const collection = client.db().collection('animals');
        const animal = { name: chance.first(), kind: chance.animal() };
        const result = yield collection.insertOne(animal);
        expect(result).toHaveProperty('acknowledged', true);
        expect(result).toHaveProperty('insertedId');
    }));
    it('should find a document by _id after insertOne', () => __awaiter(void 0, void 0, void 0, function* () {
        const client = new SengoClient();
        const collection = client.db().collection('animals');
        const animal = { name: chance.first(), kind: chance.animal() };
        const insertResult = yield collection.insertOne(animal);
        const found = yield collection.find({ _id: insertResult.insertedId });
        expect(Array.isArray(found)).toBe(true);
        expect(found.length).toBe(1);
        expect(found[0]).toMatchObject(Object.assign({ _id: insertResult.insertedId }, animal));
    }));
    it('should clear all collections and prevent further use after close', () => __awaiter(void 0, void 0, void 0, function* () {
        const client = new SengoClient();
        const collection = client.db().collection('animals');
        yield collection.insertOne({ name: 'test', kind: 'cat' });
        yield client.close();
        expect(() => client.db().collection('animals')).toThrow('Store is closed');
    }));
});
describe('SengoClient close behavior', () => {
    it('should throw if db() is called after close()', () => __awaiter(void 0, void 0, void 0, function* () {
        const client = new SengoClient();
        yield client.close();
        expect(() => client.db()).not.toThrow(); // db() should not throw, only collection() should
        expect(() => client.db().collection('animals')).toThrow('Store is closed');
    }));
    it('should throw if insertOne is called after collection is closed', () => __awaiter(void 0, void 0, void 0, function* () {
        const client = new SengoClient();
        const collection = client.db().collection('animals');
        yield client.close();
        yield expect(collection.insertOne({ name: 'fuzzy', kind: 'cat' })).rejects.toThrow('Store is closed');
    }));
});
