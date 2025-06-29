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
export class SengoCollection {
    constructor(name, store) {
        this.name = name;
        this.store = store;
    }
    insertOne(doc) {
        return __awaiter(this, void 0, void 0, function* () {
            // Check for closed store (if supported)
            if (typeof this.store.isClosed === 'function' && this.store.isClosed()) {
                throw new Error('Store is closed');
            }
            const docWithId = doc._id ? doc : Object.assign(Object.assign({}, doc), { _id: new ObjectId() });
            yield this.store.replaceOne({ _id: docWithId._id }, docWithId);
            return { acknowledged: true, insertedId: docWithId._id };
        });
    }
    find(query) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.store.find(query);
        });
    }
    updateOne(filter, update) {
        return __awaiter(this, void 0, void 0, function* () {
            // Find the first matching document
            const docs = yield this.find(filter);
            if (!docs.length) {
                return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
            }
            // Only update the first match (MongoDB semantics)
            const doc = docs[0];
            // Create a new object for the updated doc
            let updatedDoc = Object.assign({}, doc);
            // Apply $set only (for now)
            if (update.$set) {
                updatedDoc = Object.assign(Object.assign({}, updatedDoc), update.$set);
            }
            else {
                // If no supported update operator, throw MongoDB-like error
                throw Object.assign(new Error('Update document must contain update operators (e.g. $set). Full document replacement is not yet supported.'), {
                    code: 9,
                    name: 'MongoServerError',
                });
            }
            // Save the updated doc
            yield this.store.replaceOne({ _id: updatedDoc._id }, updatedDoc);
            return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
        });
    }
}
SengoCollection.collections = {};
