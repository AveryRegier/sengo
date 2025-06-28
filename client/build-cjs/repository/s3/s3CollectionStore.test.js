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
Object.defineProperty(exports, "__esModule", { value: true });
const s3CollectionStore_1 = require("./s3CollectionStore");
const client_s3_1 = require("@aws-sdk/client-s3");
jest.mock('@aws-sdk/client-s3');
const mockSend = jest.fn();
client_s3_1.S3Client.mockImplementation(() => ({ send: mockSend }));
const opts = { region: 'us-east-1' };
const bucket = 'test-bucket';
const collection = 'animals';
// Simulate a MongoDB network error
class MongoNetworkError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MongoNetworkError';
    }
}
describe('S3CollectionStore', () => {
    beforeEach(() => {
        mockSend.mockReset();
    });
    it('should insert a document successfully', () => __awaiter(void 0, void 0, void 0, function* () {
        mockSend.mockResolvedValueOnce({});
        const store = new s3CollectionStore_1.S3CollectionStore(collection, bucket, opts);
        const doc = { name: 'fuzzy', kind: 'cat' };
        const result = yield store.insertOne(doc);
        expect(result.acknowledged).toBe(true);
        expect(result.insertedId).toBeDefined();
        expect(mockSend).toHaveBeenCalledWith(expect.any(client_s3_1.PutObjectCommand));
    }));
    it('should find a document by _id successfully', () => __awaiter(void 0, void 0, void 0, function* () {
        const doc = { _id: 'abc123', name: 'fuzzy', kind: 'cat' };
        const body = JSON.stringify(doc);
        mockSend.mockResolvedValueOnce({
            Body: require('stream').Readable.from([body])
        });
        const store = new s3CollectionStore_1.S3CollectionStore(collection, bucket, opts);
        const found = yield store.find({ _id: 'abc123' });
        expect(found).toEqual([doc]);
        expect(mockSend).toHaveBeenCalledWith(expect.any(client_s3_1.GetObjectCommand));
    }));
    it('should return [] if document not found by _id', () => __awaiter(void 0, void 0, void 0, function* () {
        const error = new Error('Not found');
        error.name = 'NoSuchKey';
        mockSend.mockRejectedValueOnce(error);
        const store = new s3CollectionStore_1.S3CollectionStore(collection, bucket, opts);
        const found = yield store.find({ _id: 'notfound' });
        expect(found).toEqual([]);
    }));
    it('should throw a MongoDB compatible error on S3 command/network failure', () => __awaiter(void 0, void 0, void 0, function* () {
        // Simulate a real AWS SDK v3 network error
        const error = new Error('connect ETIMEDOUT');
        error.name = 'TimeoutError';
        mockSend.mockRejectedValueOnce(error);
        const store = new s3CollectionStore_1.S3CollectionStore(collection, bucket, opts);
        // Should throw a MongoDB-like network error (e.g., MongoNetworkError)
        yield expect(store.find({ _id: 'fail' })).rejects.toThrow(/MongoNetworkError|failed to connect|network error/i);
    }));
    it('should throw Store is closed after close()', () => __awaiter(void 0, void 0, void 0, function* () {
        const store = new s3CollectionStore_1.S3CollectionStore(collection, bucket, opts);
        yield store.close();
        yield expect(store.insertOne({ name: 'fuzzy' })).rejects.toThrow('Store is closed');
        yield expect(store.find({ _id: 'abc' })).rejects.toThrow('Store is closed');
    }));
});
