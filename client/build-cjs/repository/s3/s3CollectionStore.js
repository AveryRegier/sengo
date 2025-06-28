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
exports.S3CollectionStore = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
class S3CollectionStore {
    constructor(collection, bucket, opts) {
        this.closed = false;
        this.bucket = bucket;
        this.collection = collection;
        this.s3 = new client_s3_1.S3Client(Object.assign(Object.assign({}, ((opts === null || opts === void 0 ? void 0 : opts.region) ? { region: opts.region } : {})), ((opts === null || opts === void 0 ? void 0 : opts.credentials) ? { credentials: opts.credentials } : {})));
    }
    insertOne(doc) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.closed)
                throw new Error('Store is closed');
            const _id = doc._id || Math.random().toString(36).slice(2);
            const key = `${this.collection}/data/${_id}.json`;
            const body = JSON.stringify(Object.assign(Object.assign({}, doc), { _id }));
            yield this.s3.send(new client_s3_1.PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: body,
                ContentType: 'application/json',
            }));
            return { acknowledged: true, insertedId: _id };
        });
    }
    find(query) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.closed)
                throw new Error('Store is closed');
            // Only supports find by _id for now
            if (query._id) {
                const key = `${this.collection}/data/${query._id}.json`;
                try {
                    const result = yield this.s3.send(new client_s3_1.GetObjectCommand({
                        Bucket: this.bucket,
                        Key: key,
                    }));
                    const stream = result.Body;
                    const data = yield new Promise((resolve, reject) => {
                        let str = '';
                        stream.on('data', chunk => (str += chunk));
                        stream.on('end', () => resolve(str));
                        stream.on('error', reject);
                    });
                    return [JSON.parse(data)];
                }
                catch (err) {
                    if (err.name === 'NoSuchKey')
                        return [];
                    if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
                        throw new Error('MongoNetworkError: failed to connect to server');
                    }
                    throw err;
                }
            }
            // For other queries, list all objects (inefficient, for demo only)
            const prefix = `${this.collection}/data/`;
            let listed;
            try {
                listed = yield this.s3.send(new client_s3_1.ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: prefix,
                }));
            }
            catch (err) {
                if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
                    throw new Error('MongoNetworkError: failed to connect to server');
                }
                throw err;
            }
            const results = [];
            if (listed.Contents) {
                for (const obj of listed.Contents) {
                    if (!obj.Key)
                        continue;
                    let getObj;
                    try {
                        getObj = yield this.s3.send(new client_s3_1.GetObjectCommand({
                            Bucket: this.bucket,
                            Key: obj.Key,
                        }));
                    }
                    catch (err) {
                        if (err.name === 'NoSuchKey')
                            continue;
                        if (err.name === 'TimeoutError' || err.name === 'NetworkingError' || /network|timeout|etimedout|econnrefused/i.test(err.message)) {
                            throw new Error('MongoNetworkError: failed to connect to server');
                        }
                        throw err;
                    }
                    const stream = getObj.Body;
                    const data = yield new Promise((resolve, reject) => {
                        let str = '';
                        stream.on('data', chunk => (str += chunk));
                        stream.on('end', () => resolve(str));
                        stream.on('error', reject);
                    });
                    const parsed = JSON.parse(data);
                    let match = true;
                    for (const [k, v] of Object.entries(query)) {
                        if (parsed[k] !== v)
                            match = false;
                    }
                    if (match)
                        results.push(parsed);
                }
            }
            return results;
        });
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            this.closed = true;
        });
    }
}
exports.S3CollectionStore = S3CollectionStore;
