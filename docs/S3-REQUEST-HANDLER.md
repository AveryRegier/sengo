S3 client keep-alive and requestHandler option

Sengo's S3 repository implementation (S3CollectionStore) supports passing a shared HTTP request handler to the underlying AWS S3 client. This enables connection reuse (keep-alive) across multiple S3Client instances which can reduce latency and resource usage when the library performs many S3 requests in short succession.

Key points

- `S3CollectionStoreOptions.requestHandler?: any` — an optional field you can set to provide a pre-built request handler (for example, an instance of `NodeHttpHandler`). When present, the provided handler will be used by the S3 client.
- If you don't provide `requestHandler`, Sengo will try to lazily create a `NodeHttpHandler` configured with an `https.Agent({ keepAlive: true })`. If the optional package `@aws-sdk/node-http-handler` is not available at runtime (for example, in lightweight test environments), the code will fall back to the AWS SDK's default handler and continue functioning.
- The `S3CollectionStore` instance also exposes the chosen handler on the instance as `requestHandler` which tests and callers can use to confirm handler reuse without reaching into AWS SDK internals.

Usage example

```ts
// Recommended (install @aws-sdk/node-http-handler as a devDependency when you
// want to run the integration test or use the built-in Node handler):
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import { Agent as HttpsAgent } from 'https';
import { S3CollectionStore } from 'sengo';

const sharedHandler = new NodeHttpHandler({ httpsAgent: new HttpsAgent({ keepAlive: true }) });

const opts = { region: 'us-east-1', requestHandler: sharedHandler };

const storeA = new S3CollectionStore('colA', 'my-bucket', opts);
const storeB = new S3CollectionStore('colB', 'my-bucket', opts);

// Both stores will use the same handler instance
console.log(storeA.requestHandler === storeB.requestHandler); // true
```

Notes

- The handler option is intentionally unopinionated (`any`) to avoid adding a hard dependency on the AWS node HTTP handler package to every consumer.
- If you want stronger runtime verification of socket reuse (for example, counting sockets on the agent), add `@aws-sdk/node-http-handler` to your `devDependencies` and write an integration test that constructs a real agent and inspects it.

Tests

- A unit test was added at `client/tests/repository/s3/requestHandler.reuse.test.ts` to assert the store exposes and reuses the provided handler object. This avoids asserting against AWS SDK implementation details.
