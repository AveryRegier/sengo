import { Readable } from 'stream';
export class S3BucketSimulator {
    constructor() {
        this.files = {};
    }
    putObject(key, body) {
        this.files[key] = body;
    }
    getObject(key) {
        if (!(key in this.files))
            throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
        return {
            Body: Readable.from([this.files[key]])
        };
    }
    clear() {
        this.files = {};
    }
    listObjects(prefix = '') {
        return Object.keys(this.files).filter(k => k.startsWith(prefix));
    }
    getFile(key) {
        return this.files[key];
    }
}
