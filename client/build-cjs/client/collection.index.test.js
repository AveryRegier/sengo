"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("./client");
const chance_1 = __importDefault(require("chance"));
describe('SengoCollection createIndex and find (Memory)', () => {
    const chance = new chance_1.default();
    let client;
    let collection;
    let docs;
    const docCreator = () => ({
        name: chance.name(),
        age: chance.age(),
        email: chance.email(),
        city: chance.city(),
        random: chance.string({ length: 10 })
    });
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        client = new client_1.SengoClient('memory');
        const collectionName = 'col_' + chance.hash({ length: 8 });
        collection = client.db().collection(collectionName);
        // Create some docs with random structure
        docs = Array.from({ length: 3 }, docCreator);
        // Insert initial docs
        for (const doc of docs) {
            yield collection.insertOne(doc);
        }
    }));
    afterEach(() => __awaiter(void 0, void 0, void 0, function* () {
        yield client.close();
    }));
    it('should insert, create index, insert more, and find docs matching the index', () => __awaiter(void 0, void 0, void 0, function* () {
        const indexField = Object.keys(docs[0]).find(k => k !== '_id');
        const indexName = yield collection.createIndex({ [indexField]: 1 });
        expect(typeof indexName).toBe('string');
        // Insert more docs
        const moreDocs = Array.from({ length: 3 }, docCreator);
        for (const doc of moreDocs) {
            yield collection.insertOne(doc);
        }
        // Find a subset using the indexed field
        const subsetValue = docs[0][indexField];
        const subsetFound = yield collection.find({ [indexField]: subsetValue });
        // Should find at least one (the doc with that value)
        expect(subsetFound.length).toBeGreaterThanOrEqual(1);
        expect(subsetFound.some(d => d.email === docs[0].email)).toBe(true);
    }));
    it('should insert, create index, insert more, and find all docs', () => __awaiter(void 0, void 0, void 0, function* () {
        const indexField = Object.keys(docs[0]).find(k => k !== '_id');
        const indexName = yield collection.createIndex({ [indexField]: 1 });
        expect(typeof indexName).toBe('string');
        // Insert more docs
        const moreDocs = Array.from({ length: 3 }, docCreator);
        for (const doc of moreDocs) {
            yield collection.insertOne(doc);
        }
        // Find all docs (should get all 8)
        const found = yield collection.find({});
        expect(found.length).toBe(6);
        // All docs should be present
        const allDocs = [...docs, ...moreDocs];
        for (const doc of allDocs) {
            // Find by a unique field (email)
            const match = found.find(f => f.email === doc.email);
            expect(match).toBeDefined();
            expect(match).toMatchObject(doc);
        }
    }));
});
