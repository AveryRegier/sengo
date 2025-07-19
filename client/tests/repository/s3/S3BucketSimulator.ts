import { Chance } from 'chance';
import { Readable } from 'stream';
const chance = new Chance();

export class S3BucketSimulator {
  /** Short hash for debug output, unique per instance */
  /** Short hash for debug output, unique per instance (can be set externally for test determinism) */
  public _debugHash: string;
  private files: Record<string, string> = {};
  private accessLog: string[] = [];
  private indexAccessLog: string[] = [];
  private documentAccessLog: string[] = [];
  private getObjectCallCount: Record<string, number> = {};

  constructor() {
    // Allow external override for deterministic test output
    this._debugHash = Math.random().toString(36).slice(2, 8);
  }
  /**
   * Dump the current S3 state for debug (returns a shallow copy of the bucket)
   */
  dump() {
    return { ...this.files };
  }

  // --- Command normalization helpers ---
  static extractKey(cmd: any): string | undefined {
    if (!cmd) return undefined;
    if (typeof cmd === 'string') return cmd;
    // Try direct property access (for proxies/mocks)
    let input = cmd.input;
    if (!input && typeof cmd === 'object') {
      input = Object.getOwnPropertyDescriptor(cmd, 'input')?.value;
    }
    if (input && (input.Key || input.key)) return input.Key || input.key;
    if (cmd.Key || cmd.key) return cmd.Key || cmd.key;
    // Try to find a key property anywhere
    if (typeof cmd === 'object') {
      for (const k of Object.keys(cmd)) {
        if (k.toLowerCase() === 'key') return cmd[k];
      }
    }
    // Fallback: try to extract from JSON string
    try {
      const str = JSON.stringify(cmd);
      const match = str.match(/"Key"\s*:\s*"([^"]+)"/);
      if (match) return match[1];
    } catch {}
    // eslint-disable-next-line no-console
    console.warn('extractKey: Could not extract key from', cmd);
    return undefined;
  }
  static extractBody(cmd: any): string | undefined {
    if (!cmd) return undefined;
    if (typeof cmd === 'string') return undefined;
    let input = cmd.input;
    if (!input && typeof cmd === 'object') {
      input = Object.getOwnPropertyDescriptor(cmd, 'input')?.value;
    }
    if (input && (input.Body || input.body)) {
      const val = input.Body || input.body;
      return typeof val === 'string' ? val : (val?.toString?.() ?? '');
    }
    if (cmd.Body || cmd.body) return typeof cmd.Body === 'string' ? cmd.Body : (cmd.Body?.toString?.() ?? '');
    // Try to find a body property anywhere
    if (typeof cmd === 'object') {
      for (const k of Object.keys(cmd)) {
        if (k.toLowerCase() === 'body') {
          const val = cmd[k];
          return typeof val === 'string' ? val : (val?.toString?.() ?? '');
        }
      }
    }
    // Fallback: try to extract from JSON string
    try {
      const str = JSON.stringify(cmd);
      const match = str.match(/"Body"\s*:\s*"([^"]+)"/);
      if (match) return match[1];
    } catch {}
    // eslint-disable-next-line no-console
    console.warn('extractBody: Could not extract body from', cmd);
    return undefined;
  }
  static extractPrefix(cmd: any): string {
    if (!cmd) return '';
    if (typeof cmd === 'string') return cmd;
    let input = cmd.input;
    if (!input && typeof cmd === 'object') {
      input = Object.getOwnPropertyDescriptor(cmd, 'input')?.value;
    }
    if (input && (input.Prefix || input.prefix)) return input.Prefix || input.prefix;
    if (cmd.Prefix || cmd.prefix) return cmd.Prefix || cmd.prefix;
    // Try to find a prefix property anywhere
    if (typeof cmd === 'object') {
      for (const k of Object.keys(cmd)) {
        if (k.toLowerCase() === 'prefix') return cmd[k];
      }
    }
    // Fallback: try to extract from JSON string
    try {
      const str = JSON.stringify(cmd);
      const match = str.match(/"Prefix"\s*:\s*"([^"]+)"/);
      if (match) return match[1];
    } catch {}
    return '';
  }

  // --- S3-like API accepting either key/values or command objects ---
  putObject(keyOrCmd: string | any, body?: string) {
    const key = typeof keyOrCmd === 'string' ? keyOrCmd : S3BucketSimulator.extractKey(keyOrCmd);
    const b = body !== undefined ? body : S3BucketSimulator.extractBody(keyOrCmd);
    if (!key) throw new Error('putObject: missing key');
    if (b === undefined) throw new Error('putObject: missing body');
    this.files[key] = b;
    // Log all index/document file writes
    if (key.includes('/indices/')) {
      this.indexAccessLog.push(key);
    } else if (key.includes('/documents/')) {
      this.documentAccessLog.push(key);
    }
    // For backward compatibility
    this.accessLog.push(key);
  }

  getObject(keyOrCmd: string | any) {
    const key = typeof keyOrCmd === 'string' ? keyOrCmd : S3BucketSimulator.extractKey(keyOrCmd);
    if (!key) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    // Log all index/document file reads
    if (key.includes('/indices/')) {
      this.indexAccessLog.push(key);
    } else if (key.includes('/data/')) {
      this.documentAccessLog.push(key);
    }
    // For backward compatibility
    this.accessLog.push(key);
    this.getObjectCallCount[key] = (this.getObjectCallCount[key] || 0) + 1;
    if (!(key in this.files)) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return {
      Body: Readable.from([this.files[key]])
    };
  }

  deleteObject(keyOrCmd: string | any) {
    const key = typeof keyOrCmd === 'string' ? keyOrCmd : S3BucketSimulator.extractKey(keyOrCmd);
    if (!key) return { DeleteMarker: false };
    // Log all index/document file deletes
    if (key.includes('/indices/')) {
      this.indexAccessLog.push(key);
    } else if (key.includes('/documents/')) {
      this.documentAccessLog.push(key);
    }
    // For backward compatibility
    this.accessLog.push(key);
    const existed = key in this.files;
    delete this.files[key];
    return { DeleteMarker: existed };
  }

  clear() {
    this.files = {};
    this.accessLog = [];
    this.indexAccessLog = [];
    this.documentAccessLog = [];
    this.getObjectCallCount = {};
  }

  clearAccessLog() {
    this.accessLog = [];
    this.indexAccessLog = [];
    this.documentAccessLog = [];
  }

  getAccessLog() {
    return [...this.accessLog];
  }

  getIndexAccessLog() {
    return [...this.indexAccessLog];
  }

  getDocumentAccessLog() {
    return [...this.documentAccessLog];
  }

  listObjects(prefix: string = ''): string[] {
    return Object.keys(this.files).filter(k => k.startsWith(prefix));
  }

  /**
   * Simulate AWS S3 ListObjectsV2Command response.
   * Returns { Contents: [{ Key }] } or { Contents: [] }.
   */
  listObjectsV2(prefixOrCmd: string | any = ''): { Contents: { Key: string }[] } {
    const prefix = typeof prefixOrCmd === 'string' ? prefixOrCmd : S3BucketSimulator.extractPrefix(prefixOrCmd);
    const keys = this.listObjects(prefix);
    return { Contents: keys.map(Key => ({ Key })) };
  }

  getFile(key: string) {
    return this.files[key];
  }

  /**
   * Handle any S3 command object, dispatching to the correct simulator method.
   * Returns S3-like responses or dummy values for unknown commands.
   * Supports both AWS SDK command instances and plain objects with a .type property.
   */
  handleCommand(cmd: any): Promise<any> {
    // Prefer .type property (plain-object mock), fallback to constructor name
    const type = cmd?.type || cmd?.constructor?.name;
    switch (type) {
      case 'PutObjectCommand':
        this.putObject(cmd);
        return Promise.resolve({ ETag: chance.guid() }); // Simulate ETag response
      case 'GetObjectCommand':
        return Promise.resolve(this.getObject(cmd));
      case 'DeleteObjectCommand':
        return Promise.resolve(this.deleteObject(cmd));
      case 'ListObjectsV2Command':
        // Always return { Contents: [...] }
        return Promise.resolve(this.listObjectsV2(cmd)) ;
      default:
        // Unknown command: mimic S3 by returning an empty object
        // eslint-disable-next-line no-console
        console.warn('S3BucketSimulator: Unknown command', type, cmd);
        return Promise.resolve({});
    }
  }
}
