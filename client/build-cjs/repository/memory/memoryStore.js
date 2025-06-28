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
exports.MemoryStore = void 0;
const memoryCollectionStore_js_1 = require("./memoryCollectionStore.js");
class MemoryStore {
    constructor() {
        this.stores = {};
        this.closed = false;
    }
    collection(name) {
        if (this.closed)
            throw new Error('Store is closed');
        if (!this.stores[name]) {
            this.stores[name] = new memoryCollectionStore_js_1.MemoryCollectionStore(name);
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
            this.stores = {}; // Remove all store objects to start fresh
        });
    }
}
exports.MemoryStore = MemoryStore;
