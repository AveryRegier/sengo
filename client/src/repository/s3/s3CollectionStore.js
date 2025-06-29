var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
export class S3CollectionStore {
    constructor(collection, bucket, opts) {
        this.closed = false;
        this.bucket = bucket;
        this.collection = collection;
        this.s3 = new S3Client(Object.assign(Object.assign({}, ((opts === null || opts === void 0 ? void 0 : opts.region) ? { region: opts.region } : {})), ((opts === null || opts === void 0 ? void 0 : opts.credentials) ? { credentials: opts.credentials } : {})));
    }
    isClosed() {
        return this.closed;
    }
    replaceOne(filter, doc) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            if (this.closed)
                throw new Error('Store is closed');
            const _id = (_a = filter._id) !== null && _a !== void 0 ? _a : doc._id;
            if (!_id)
                throw new Error('replaceOne requires _id');
            const key = `${this.collection}/data/${_id}.json`;
            const body = JSON.stringify(doc);
            yield this.s3.send(new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: body,
                ContentType: 'application/json',
            }));
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
                    const result = yield this.s3.send(new GetObjectCommand({
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
                listed = yield this.s3.send(new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: prefix,
                }));
            }
            catch (err) {
                if (err.name === 'NoSuchBucket')
                    return [];
                throw err;
            }
            if (!listed.Contents)
                return [];
            const results = [];
            for (const obj of listed.Contents) {
                const key = obj.Key;
                try {
                    const result = yield this.s3.send(new GetObjectCommand({
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
                    const parsed = JSON.parse(data);
                    // Only push if parsed is an object and has _id
                    if (parsed && typeof parsed === 'object' && parsed._id !== undefined) {
                        if (Object.entries(query).every(([k, v]) => { var _a; return ((_a = parsed[k]) === null || _a === void 0 ? void 0 : _a.toString()) === (v === null || v === void 0 ? void 0 : v.toString()); })) {
                            results.push(parsed);
                        }
                    }
                }
                catch (err) {
                    // Skip this document if any error occurs (missing, invalid JSON, etc)
                    continue;
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
