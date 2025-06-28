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
exports.MemoryCollectionStore = void 0;
class MemoryCollectionStore {
    constructor(name) {
        this.documents = [];
        this.closed = false;
        this.name = name || '';
    }
    insertOne(doc) {
        this.checkClosure();
        this.documents.push(doc);
        // No MongoDB-style response here; just return void
    }
    checkClosure() {
        if (this.closed)
            throw new Error('Store is closed');
    }
    find(query) {
        this.checkClosure();
        return this.documents.filter(doc => {
            return Object.entries(query).every(([k, v]) => { var _a; return ((_a = doc[k]) === null || _a === void 0 ? void 0 : _a.toString()) === (v === null || v === void 0 ? void 0 : v.toString()); });
        });
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            this.closed = true;
        });
    }
    createIndex(keys, options) {
        return __awaiter(this, void 0, void 0, function* () {
            // Noop for now
            return;
        });
    }
}
exports.MemoryCollectionStore = MemoryCollectionStore;
