# koatty_serverless

Serverless adapter for Koatty framework - deploy to AWS Lambda, Alibaba Cloud FC, Tencent SCF.

## Installation

```bash
npm install koatty_serverless
```

For AWS Lambda, also install the optional dependency:

```bash
npm install @codegenie/serverless-express
```

## Quick Start

### AWS Lambda

```typescript
// src/lambda.ts
import { createHandler } from 'koatty_serverless';
import { App } from './App';

export const handler = createHandler(App, {
  platform: 'aws',
  healthCheck: async (app) => {
    // Check database connections after Lambda thaw
    // const ds = IOC.get('TypeormStore')?.getDataSource();
    // if (ds && !ds.isInitialized) await ds.initialize();
  },
  eventHandlers: {
    scheduled: async (event, context, app) => {
      // Handle CloudWatch scheduled events
      return { statusCode: 200 };
    },
  },
});
```

### Alibaba Cloud Function Compute (FC)

```typescript
// src/fc.ts
import { createHandler } from 'koatty_serverless';
import { App } from './App';

export const handler = createHandler(App, { platform: 'alicloud' });
```

### Tencent Cloud SCF

```typescript
// src/scf.ts
import { createHandler } from 'koatty_serverless';
import { App } from './App';

export const handler = createHandler(App, { platform: 'tencent' });
```

## Without koatty-serverless

For platforms like Alibaba Cloud FC HTTP trigger where the input is already a standard HTTP object:

```typescript
// src/handler.ts
import { createApplication } from 'koatty';
import { App } from './App';

let handler: (req: any, res: any) => Promise<any>;

export async function httpHandler(req: any, resp: any, context: any) {
  if (!handler) {
    const app = await createApplication(App);
    handler = app.getRequestHandler();
  }
  return handler(req, resp);
}
```

## API Reference

### `createHandler(AppClass, options?)`

Creates a serverless handler function.

**Parameters:**
- `AppClass` - Your Koatty application class
- `options` - Configuration options

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `platform` | `'aws' \| 'alicloud' \| 'tencent'` | `'aws'` | Target cloud platform |
| `adapter` | `ServerlessAdapter` | - | Custom adapter (overrides platform) |
| `bootFunc` | `Function` | - | Custom bootstrap function |
| `eventHandlers` | `Record<string, EventHandler>` | - | Non-HTTP event handlers |
| `healthCheck` | `(app) => Promise<void>` | - | Health check before each invocation |

### `EventHandler`

```typescript
type EventHandler = (
  event: any,
  context: any,
  app: KoattyApplication,
) => Promise<any>;
```

### `ServerlessAdapter` Interface

```typescript
interface ServerlessAdapter {
  readonly name: string;
  createHandler(app: KoattyApplication): (...args: any[]) => Promise<any>;
}
```

## Custom Adapters

Implement `ServerlessAdapter` for other platforms:

```typescript
import type { ServerlessAdapter } from 'koatty_serverless';
import type { KoattyApplication } from 'koatty_core';

class CloudflareAdapter implements ServerlessAdapter {
  readonly name = 'cloudflare-workers';

  createHandler(app: KoattyApplication) {
    const httpHandler = app.getRequestHandler();
    return async (request: Request) => {
      // Convert Cloudflare Request to Node.js HTTP format
      // ...
    };
  }
}

// Usage
export const handler = createHandler(App, {
  adapter: new CloudflareAdapter(),
});
```

## License

BSD-3-Clause
