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
exports.SengoClient = void 0;
const index_js_1 = require("../repository/index.js");
const collection_js_1 = require("./collection.js");
class SengoClient {
    constructor(repositoryType = 'memory') {
        this.dbStore = (0, index_js_1.createRepository)(repositoryType);
    }
    db(dbName) {
        return {
            collection: (name) => new collection_js_1.SengoCollection(name, this.dbStore.collection(name))
        };
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof this.dbStore.close === 'function') {
                yield this.dbStore.close();
            }
        });
    }
}
exports.SengoClient = SengoClient;
