import { MemoryStore } from './memory/index';
import { S3Store } from './s3/s3Store';
export function createRepository(name) {
    if (name !== 'memory') {
        return new S3Store(name);
    }
    else {
        return new MemoryStore();
    }
}
