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
exports.S3Store = void 0;
const s3CollectionStore_js_1 = require("./s3CollectionStore.js");
class S3Store {
    constructor(bucket = 'sengo-default-bucket') {
        this.stores = {};
        this.closed = false;
        this.bucket = bucket;
    }
    collection(name) {
        if (this.closed)
            throw new Error('Store is closed');
        if (!this.stores[name]) {
            this.stores[name] = new s3CollectionStore_js_1.S3CollectionStore(name, this.bucket);
        }
        return this.stores[name];
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            this.closed = true;
            for (const store of Object.values(this.stores)) {
                if (typeof store.close === 'function') {
                    yield store.close();
                }
            }
        });
    }
}
exports.S3Store = S3Store;
