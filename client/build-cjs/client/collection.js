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
exports.SengoCollection = void 0;
const bson_1 = require("bson");
class SengoCollection {
    constructor(name, store) {
        this.name = name;
        this.store = store;
    }
    insertOne(doc) {
        return __awaiter(this, void 0, void 0, function* () {
            const docWithId = doc._id ? doc : Object.assign(Object.assign({}, doc), { _id: new bson_1.ObjectId() });
            yield this.store.insertOne(docWithId);
            return { acknowledged: true, insertedId: docWithId._id };
        });
    }
    find(query) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.store.find(query);
        });
    }
}
exports.SengoCollection = SengoCollection;
SengoCollection.collections = {};
