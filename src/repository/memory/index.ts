export class Storage {
  private documents: Record<string, any>[] = [];

  insertOne(doc: Record<string, any>) {
    const _id = Math.random().toString(36).slice(2);
    const document = { ...doc, _id };
    this.documents.push(document);
    return { acknowledged: true, insertedId: _id };
  }

  find(query: Record<string, any>) {
    return this.documents.filter(doc => {
      return Object.entries(query).every(([k, v]) => doc[k] === v);
    });
  }
}
