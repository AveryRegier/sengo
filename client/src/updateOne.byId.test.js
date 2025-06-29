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
import { S3BucketSimulator } from './testutils/S3BucketSimulator';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
const chance = new Chance();
describe('SengoClient updateOne API (memory backend)', () => {
    it('should update a document by _id', () => __awaiter(void 0, void 0, void 0, function* () {
        const client = new SengoClient('memory');
        const collection = client.db().collection('animals');
        const animal = { name: chance.first(), kind: chance.animal() };
        const { insertedId } = yield collection.insertOne(animal);
        const updateResult = yield collection.updateOne({ _id: insertedId }, { $set: { name: 'UpdatedName' } });
        expect(updateResult).toHaveProperty('matchedCount', 1);
        expect(updateResult).toHaveProperty('modifiedCount', 1);
        const found = yield collection.find({ _id: insertedId });
        expect(found[0].name).toBe('UpdatedName');
    }));
});
describe('SengoClient updateOne API (s3 backend)', () => {
    let bucketSim;
    let s3Mock;
    beforeEach(() => {
        bucketSim = new S3BucketSimulator();
        s3Mock = mockClient(S3Client);
        s3Mock.reset();
        // Mock PutObjectCommand
        s3Mock.on(PutObjectCommand).callsFake((input) => {
            bucketSim.putObject(input.Key, input.Body);
            return {};
        });
        // Mock GetObjectCommand
        s3Mock.on(GetObjectCommand).callsFake((input) => {
            return bucketSim.getObject(input.Key);
        });
    });
    it('should update a document by _id', () => __awaiter(void 0, void 0, void 0, function* () {
        const client = new SengoClient('s3');
        const collection = client.db().collection('animals');
        const animal = { name: chance.first(), kind: chance.animal() };
        // Use a fixed _id for mock matching
        const { insertedId } = yield collection.insertOne(Object.assign(Object.assign({}, animal), { _id: 'mockid' }));
        const updateResult = yield collection.updateOne({ _id: 'mockid' }, { $set: { name: 'UpdatedName' } });
        expect(updateResult).toHaveProperty('matchedCount', 1);
        expect(updateResult).toHaveProperty('modifiedCount', 1);
        const found = yield collection.find({ _id: 'mockid' });
        expect(found[0].name).toBe('UpdatedName');
    }));
});
