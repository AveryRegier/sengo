var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { ObjectId } from 'bson';
export class MemoryCollectionStore {
    constructor(name) {
        this.documents = [];
        this.closed = false;
        this.name = name || '';
    }
    insertOne(doc) {
        return __awaiter(this, void 0, void 0, function* () {
            const docWithId = doc._id ? doc : Object.assign(Object.assign({}, doc), { _id: new ObjectId() });
            yield this.replaceOne({ _id: docWithId._id }, docWithId);
            return { acknowledged: true, insertedId: docWithId._id };
        });
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
    updateOne(filter, doc) {
        this.checkClosure();
        // Only support update by _id for now
        const idx = this.documents.findIndex(d => { var _a, _b; return ((_a = d._id) === null || _a === void 0 ? void 0 : _a.toString()) === ((_b = filter._id) === null || _b === void 0 ? void 0 : _b.toString()); });
        if (idx === -1)
            return { matchedCount: 0, modifiedCount: 0 };
        this.documents[idx] = Object.assign({}, doc);
        return { matchedCount: 1, modifiedCount: 1 };
    }
    replaceOne(filter, doc) {
        return __awaiter(this, void 0, void 0, function* () {
            const idx = this.documents.findIndex(d => { var _a; return d._id === ((_a = filter._id) !== null && _a !== void 0 ? _a : doc._id); });
            if (idx !== -1) {
                this.documents[idx] = Object.assign({}, doc);
            }
            else {
                this.documents.push(Object.assign({}, doc));
            }
            return Promise.resolve();
        });
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            this.closed = true;
        });
    }
    isClosed() {
        return this.closed;
    }
}
