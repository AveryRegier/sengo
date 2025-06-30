import { Readable } from 'stream';

export class S3BucketSimulator {
  private files: Record<string, string> = {};

  putObject(key: string, body: string) {
    this.files[key] = body;
  }

  getObject(key: string) {
    if (!(key in this.files)) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return {
      Body: Readable.from([this.files[key]])
    };
  }

  clear() {
    this.files = {};
  }

  listObjects(prefix: string = ''): string[] {
    return Object.keys(this.files).filter(k => k.startsWith(prefix));
  }

  getFile(key: string) {
    return this.files[key];
  }
}
