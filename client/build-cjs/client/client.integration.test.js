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
describe('SengoClient Integration (Memory)', () => {
    const chance = new chance_1.default();
    let client;
    let collectionName;
    let doc;
    beforeAll(() => {
        client = new client_1.SengoClient('memory');
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
