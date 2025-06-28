"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRepository = createRepository;
const index_1 = require("./memory/index");
const s3Store_1 = require("./s3/s3Store");
function createRepository(name) {
    if (name !== 'memory') {
        return new s3Store_1.S3Store(name);
    }
    else {
        return new index_1.MemoryStore();
    }
}
