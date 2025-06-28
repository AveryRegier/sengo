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
        const _id = Math.random().toString(36).slice(2);
        const document = Object.assign(Object.assign({}, doc), { _id });
        this.documents.push(document);
        return { acknowledged: true, insertedId: _id };
    }
    checkClosure() {
        if (this.closed)
            throw new Error('Store is closed');
    }
    find(query) {
        this.checkClosure();
        return this.documents.filter(doc => {
            return Object.entries(query).every(([k, v]) => doc[k] === v);
        });
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            this.closed = true;
        });
    }
}
exports.MemoryCollectionStore = MemoryCollectionStore;
