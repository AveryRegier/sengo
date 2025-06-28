"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRepository = createRepository;
const index_js_1 = require("./memory/index.js");
const s3Store_js_1 = require("./s3/s3Store.js");
function createRepository(name) {
    if (name !== 'memory') {
        return new s3Store_js_1.S3Store(name);
    }
    else {
        return new index_js_1.MemoryStore();
    }
}
