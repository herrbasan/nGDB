# nGDB Specification

> n000b General Database Platform — A service wrapper that runs nDB and nVDB as network services, exposing their full native APIs over HTTP and WebSocket.

## Overview

nGDB is a **thin service wrapper** around two independent database modules. It is NOT a database itself — it provides the network layer that makes standalone Rust modules accessible via HTTP and WebSocket.

**Key principle:** nDB and nVDB are independent projects with fundamentally different data models. nGDB does NOT try to unify their APIs. Instead, it proxies each backend's native API through a common network layer with shared cross-cutting concerns.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Clients                                 │
│  Web Apps, Mobile, MCP Agents, CLI tools, etc.                  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ HTTP / WebSocket
┌─────────────────────────────────▼───────────────────────────────┐
│                      nGDB Service                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Middleware: Auth (API keys), Tenancy, Logging           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │  /db/*           │    │  /vdb/*          │                  │
│  │  nDB proxy       │    │  nVDB proxy      │                  │
│  │  passthrough     │    │  passthrough     │                  │
│  └────────┬─────────┘    └────────┬─────────┘                  │
│           │                       │                             │
│  ┌────────▼─────────┐    ┌───────▼──────────┐                  │
│  │  ndb module      │    │  nvdb module     │                  │
│  │  direct calls    │    │  direct calls    │                  │
│  └──────────────────┘    └──────────────────┘                  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  /ws  /health                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Project Ecosystem

| Project | Language | Purpose | Deployment |
|---------|----------|---------|------------|
| **nGDB** | Vanilla JS | Service wrapper: HTTP/WS server, auth, multi-tenancy | Server/Container |
| **nDB** | Rust + N-API | Document database — standalone project | npm package |
| **nVDB** | Rust + N-API | Vector database — standalone project | npm package |

## Philosophy

**nGDB is not a database — it is a service wrapper.**

nDB and nVDB have fundamentally different data models, query languages, and configurations. Attempting to unify them behind a single API creates leaky abstractions. Instead:

- **nDB** handles documents: JSON Lines storage, file buckets, field-level queries
- **nVDB** handles vectors: HNSW indices, SIMD distance, similarity search
- **nGDB** handles the network: HTTP routing, auth, tenancy, WebSocket multiplexing

Each module is a fully independent project with its own API. nGDB simply exposes them as network services.

### Core Beliefs

- **No leaky abstractions**: Proxy each backend's native API, don't try to unify them
- **Thin wrapper**: nGDB adds cross-cutting concerns, not business logic
- **Independent modules**: Each module works standalone without nGDB
- **Vanilla stack**: No frameworks, no TypeScript, no external dependencies
- **Fail fast**: No defensive coding, no fallback defaults, no silenced errors

## Architecture

### Source Layout

```
nGDB/                          <- Service wrapper (this repo)
├── src/
│   ├── server.js              <- HTTP server entry point
│   ├── config.js              <- Environment-driven configuration
│   ├── middleware/
│   │   ├── auth.js            <- API key authentication + private IP bypass
│   │   └── tenancy.js         <- Tenant isolation via header extraction
│   ├── handlers/
│   │   ├── db.js              <- Transport-agnostic nDB proxy handlers
│   │   ├── vdb.js             <- Transport-agnostic nVDB proxy handlers
│   │   └── admin.js           <- Admin API aggregation handlers
│   ├── transports/
│   │   ├── http.js            <- HTTP request/response adapter
│   │   └── ws.js              <- WebSocket frame protocol (RFC 6455)
│   └── ws.js                  <- WebSocket server, subscriptions, broadcast
├── admin/                     <- Web admin interface (SPA)
│   ├── index.html             <- SPA shell with nui-app layout
│   ├── js/
│   │   └── main.js            <- App bootstrap, routing, action handlers
│   ├── pages/                 <- SPA page fragments
│   │   ├── dashboard.html     <- Service overview & health
│   │   ├── databases.html     <- nDB instance management
│   │   ├── documents.html     <- Document CRUD for selected nDB
│   │   ├── vectors.html       <- nVDB instance & collection management
│   │   ├── buckets.html       <- File bucket browser
│   │   └── settings.html      <- Config overview
│   └── NUI/                   <- nui_wc2 library (git submodule)
├── tests/                     <- Integration tests (phases 1-5)
├── ndb/                       <- git submodule — nDB (independent project)
├── nvdb/                      <- git submodule — nVDB (independent project)
├── docs/                      <- Specifications and plans
└── package.json
    "dependencies": {
      "ndb": "file:./ndb/napi",
      "nvdb": "file:./nvdb/napi"
    }
```

### Service Layer

```
┌─────────────────────────────────────────────┐
│           HTTP / WebSocket Server           │
│  - Vanilla Node.js http.createServer        │
│  - No Express/Fastify                       │
│  - Direct request/response pipelining       │
├─────────────────────────────────────────────┤
│         Middleware Pipeline                  │
│  - API key validation (Bearer or query)     │
│  - Private IP bypass (local network)        │
│  - Tenant isolation (header-based)          │
├─────────────────────────────────────────────┤
│         Transport Adapters                  │
│  - HTTP adapter  -> parses req, calls handler│
│  - WS adapter    -> parses msg, calls handler│
│  - Same handlers for both transports        │
├─────────────────────────────────────────────┤
│         Shared Handlers                     │
│  - /db/*    -> ndb module direct calls      │
│  - /vdb/*   -> nvdb module direct calls     │
│  - Transport-agnostic: params in, result out│
├─────────────────────────────────────────────┤
│  /health  -> service health check           │
│  /ws      -> WebSocket upgrade              │
└─────────────────────────────────────────────┘
```

### Handle-Based Instance Management

nGDB manages database instances via UUID handles. When a client opens a database, nGDB creates an instance and returns a handle ID. All subsequent operations reference this handle.

```
Client                          nGDB
  │                               │
  │ POST /db/open { path }        │
  │──────────────────────────────►│  Database.open(path) -> handle "abc-123"
  │ { handle: "abc-123" }         │
  │◄──────────────────────────────│
  │                               │
  │ POST /db/insert               │
  │  { handle: "abc-123", doc }   │
  │──────────────────────────────►│  instances.get("abc-123").insert(doc)
  │ { id: "..." }                 │
  │◄──────────────────────────────│
  │                               │
  │ POST /db/close                │
  │  { handle: "abc-123" }        │
  │──────────────────────────────►│  instances.delete("abc-123")
  │ { ok: true }                  │
  │◄──────────────────────────────│
```

This pattern applies to both nDB and nVDB. The nVDB handler additionally caches collection objects to avoid re-locking.

## Proxy Routes

nGDB proxies each backend's native API. There is no translation layer — requests pass through to the module's Node.js API directly.

### nDB Routes — `/db/*`

All nDB operations are proxied through `/db/*`. The route structure mirrors nDB's native Node.js API:

#### Database Lifecycle

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/db/open` | POST | `{ path, options? }` | `{ handle }` | Open database instance |
| `/db/close` | POST | `{ handle }` | `{ ok: true }` | Flush and close database |
| `/db/openInMemory` | POST | `{}` | `{ handle }` | Open in-memory database |

#### Document CRUD

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/db/insert` | POST | `{ handle, doc }` | `{ id }` | Insert document |
| `/db/get` | POST | `{ handle, id }` | `{ doc }` | Get document by ID |
| `/db/update` | POST | `{ handle, id, doc }` | `{ ok: true }` | Update document |
| `/db/delete` | POST | `{ handle, id }` | `{ ok: true }` | Delete document |
| `/db/insertWithPrefix` | POST | `{ handle, prefix, doc }` | `{ id }` | Insert with prefixed ID |

#### Queries

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/db/query` | POST | `{ handle, ast }` | `{ results }` | Query with AST filter |
| `/db/queryWith` | POST | `{ handle, ast, options }` | `{ results }` | Query with sort/limit/offset |
| `/db/find` | POST | `{ handle, field, value }` | `{ results }` | Find by field value |
| `/db/findRange` | POST | `{ handle, field, min, max }` | `{ results }` | Find by field range |

#### Iteration and Info

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/db/iter` | POST | `{ handle }` | `{ docs }` | Iterate all documents |
| `/db/len` | POST | `{ handle }` | `{ count }` | Document count |
| `/db/contains` | POST | `{ handle, id }` | `{ exists }` | Check if ID exists |
| `/db/isEmpty` | POST | `{ handle }` | `{ empty }` | Check if database is empty |

#### Soft Delete

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/db/restore` | POST | `{ handle, id }` | `{ ok: true }` | Restore soft-deleted document |
| `/db/deletedIds` | POST | `{ handle }` | `{ ids }` | List soft-deleted IDs |

#### Indexes

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/db/createIndex` | POST | `{ handle, field }` | `{ ok: true }` | Create hash index |
| `/db/createBTreeIndex` | POST | `{ handle, field }` | `{ ok: true }` | Create BTree index |
| `/db/dropIndex` | POST | `{ handle, field }` | `{ ok: true }` | Drop index |
| `/db/hasIndex` | POST | `{ handle, field }` | `{ exists }` | Check if index exists |

#### Maintenance

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/db/flush` | POST | `{ handle }` | `{ ok: true }` | Flush to disk |
| `/db/compact` | POST | `{ handle }` | `{ ok: true }` | Compact database |

#### File Bucket Operations — `/db/bucket/*`

Buckets must be declared in the database's `meta.json` before use. nDB rejects operations on undeclared buckets.

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/db/bucket/storeFile` | POST | `{ handle, bucket, name, data, mimeType }` | `{ meta }` | Store file (data is base64) |
| `/db/bucket/getFile` | POST | `{ handle, bucket, hash, ext }` | `{ data }` | Get file (data is base64) |
| `/db/bucket/deleteFile` | POST | `{ handle, bucket, hash, ext }` | `{ ok: true }` | Delete file |
| `/db/bucket/listFiles` | POST | `{ handle, bucket }` | `{ files }` | List files in bucket |

#### Database Metadata — `/db/meta/*`

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/db/getMeta` | POST | `{ handle }` | `{ meta }` | Get database metadata (display mappings, buckets, version) |
| `/db/updateMeta` | POST | `{ handle, meta }` | `{ ok: true }` | Update database metadata (display mappings, bucket declarations) |

### nVDB Routes — `/vdb/*`

All nVDB operations are proxied through `/vdb/*`. The route structure mirrors nVDB's native Node.js API:

#### Database Lifecycle

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/vdb/open` | POST | `{ path }` | `{ handle }` | Open vector database |
| `/vdb/close` | POST | `{ handle }` | `{ ok: true }` | Close vector database |

#### Collection Management

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/vdb/createCollection` | POST | `{ handle, name, dimension, options? }` | `{ name }` | Create collection |
| `/vdb/getCollection` | POST | `{ handle, name }` | `{ name, config, stats }` | Get collection info |
| `/vdb/listCollections` | POST | `{ handle }` | `{ names }` | List all collections |

#### Document Operations

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/vdb/insert` | POST | `{ handle, collection, id, vector, payload? }` | `{ ok: true }` | Insert vector document |
| `/vdb/insertBatch` | POST | `{ handle, collection, docs }` | `{ ok: true }` | Batch insert |
| `/vdb/get` | POST | `{ handle, collection, id }` | `{ doc }` | Get vector document by ID |
| `/vdb/delete` | POST | `{ handle, collection, id }` | `{ existed }` | Delete vector document |

#### Search

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/vdb/search` | POST | `{ handle, collection, vector, topK?, distance?, approximate?, ef?, filter? }` | `{ results }` | Similarity search |

#### Collection Maintenance

| Endpoint | Method | Params | Returns | Description |
|----------|--------|--------|---------|-------------|
| `/vdb/flush` | POST | `{ handle, collection }` | `{ ok: true }` | Flush collection to disk |
| `/vdb/sync` | POST | `{ handle, collection }` | `{ ok: true }` | Force WAL sync |
| `/vdb/compact` | POST | `{ handle, collection }` | `{ result }` | Compact segments |
| `/vdb/rebuildIndex` | POST | `{ handle, collection }` | `{ ok: true }` | Build HNSW index |
| `/vdb/deleteIndex` | POST | `{ handle, collection }` | `{ ok: true }` | Delete HNSW index |
| `/vdb/hasIndex` | POST | `{ handle, collection }` | `{ exists }` | Check if HNSW index exists |

### Service Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health + backend status (no auth required) |
| `/ws` | GET | WebSocket upgrade (auth checked on upgrade) |

## Shared Handler Pattern

HTTP and WebSocket share the same handler code. The proxy logic is transport-agnostic — handlers receive a plain params object and a context, and return a plain result object, regardless of transport.

```javascript
// src/handlers/db.js — transport-agnostic handlers
const { Database } = require('ndb');

// Handler: insert document
// Works identically for HTTP POST and WebSocket message
function insert(params, ctx) {
  const db = instances.get(params.handle);
  const id = db.insert(params.doc);
  return { id };
}

// src/transports/http.js — HTTP adapter
const params = await parseBody(req);
const result = handler(params, { tenantId });
json(res, 200, result);

// src/ws.js — WebSocket adapter
const result = handler(msg, { tenantId: conn.tenantId });
conn.send({ action, backend, result, requestId: msg.requestId });
```

**Key insight:** Code written for bundled nDB/nVDB usage works identically through the service. The handler layer IS the module's native API — no translation needed.

## WebSocket API

Zero-dependency RFC 6455 WebSocket implementation. Real-time subscriptions and streaming over a single WebSocket connection.

### Connection

```javascript
// Client connects via WebSocket upgrade at /ws
const ws = new WebSocket('ws://ngdb.example.com/ws');
```

Auth is checked during the HTTP upgrade handshake. If auth fails, the upgrade is rejected with HTTP 401/403.

### Message Protocol

All messages are JSON. Each message has an `action` field that dispatches to the appropriate handler.

```javascript
// Request: dispatch to nDB handler
ws.send(JSON.stringify({
  action: 'insert',
  handle: 'abc-123',
  doc: { name: 'Alice' },
  requestId: 'req-1'
}));

// Response
{ action: 'insert', backend: 'db', result: { id: '...' }, requestId: 'req-1' }

// Request: dispatch to nVDB handler
ws.send(JSON.stringify({
  action: 'search',
  backend: 'vdb',
  handle: 'xyz-456',
  collection: 'embeddings',
  vector: [0.1, 0.2, 0.3],
  topK: 5,
  requestId: 'req-2'
}));

// Response
{ action: 'search', backend: 'vdb', result: { results: [...] }, requestId: 'req-2' }
```

The `backend` field defaults to `'db'` if omitted. Set `backend: 'vdb'` to route to nVDB handlers.

### Built-in Actions

| Action | Description |
|--------|-------------|
| `ping` | Server responds with `{ action: 'pong' }` |
| `subscribe` | Subscribe to collection changes |
| `unsubscribe` | Cancel a subscription |

### Subscriptions

```javascript
// Subscribe to nDB collection changes
ws.send(JSON.stringify({
  action: 'subscribe',
  backend: 'db',
  collection: 'users',
  filter: { status: 'active' },  // optional
  subId: 'my-sub-1'              // optional, auto-generated if omitted
}));

// Confirmation
{ action: 'subscribed', subId: 'my-sub-1', requestId: '...' }

// Receive real-time updates when mutations happen
{ action: 'update', backend: 'db', type: 'insert', data: { ... } }
```

Subscription features:
- **Filter-based**: Only receive updates matching the filter
- **Tenant-isolated**: Updates only broadcast within the same tenant
- **No echo**: Mutations from the originating connection are not echoed back
- **Auto-cleanup**: Subscriptions are removed when a connection disconnects

Mutations that trigger broadcasts: `insert`, `update`, `delete`, `storeFile`, `deleteFile`.

## Configuration

All configuration is via environment variables. No config files, no YAML.

```bash
# Server
PORT=3000                         # HTTP port (default: 3000)
HOST=0.0.0.0                      # Bind address (default: 0.0.0.0)

# Data directories
NDB_DATA_DIR=./data/ndb           # nDB storage root (default: ./data/ndb)
NVDB_DATA_DIR=./data/nvdb         # nVDB storage root (default: ./data/nvdb)

# Authentication
API_KEYS=key1,key2,key3           # Comma-separated API keys. Empty = auth disabled.
LOCAL_AUTH_BYPASS=true            # Private IPs skip auth (default: true). Set 'false' to disable.

# Multi-tenancy
TENANT_HEADER=x-tenant-id         # Header name for tenant ID. Empty = tenancy disabled.

# Admin interface
ADMIN_ENABLED=true                # Enable web admin UI (default: true)
ADMIN_PATH=./admin                # Path to admin static files (default: ./admin)
```

### Configuration Resolution

```javascript
// src/config.js
const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  ndbDataDir: process.env.NDB_DATA_DIR || './data/ndb',
  nvdbDataDir: process.env.NVDB_DATA_DIR || './data/nvdb',
  apiKeys: process.env.API_KEYS ? process.env.API_KEYS.split(',').map(k => k.trim()).filter(Boolean) : [],
  localAuthBypass: process.env.LOCAL_AUTH_BYPASS !== 'false',
  tenantHeader: process.env.TENANT_HEADER || '',
  adminEnabled: process.env.ADMIN_ENABLED !== 'false',
  adminPath: process.env.ADMIN_PATH || './admin',
};
```

## Authentication

### API Key Authentication

Simple static API key validation. No JWT, no sessions, no OAuth.

```http
POST /db/insert
Authorization: Bearer ngdb_sk_abc123xyz
Content-Type: application/json

{ "handle": "...", "doc": { "name": "Alice" } }
```

Alternative: pass the key as a query parameter:
```http
POST /db/insert?apiKey=ngdb_sk_abc123xyz
```

### Local Network Bypass

When `API_KEYS` is configured and `LOCAL_AUTH_BYPASS` is not `false`, requests from private IP ranges bypass authentication:

- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `127.0.0.0/8` (loopback)
- IPv6: `::1`, `fc00::/7`, `fe80::/10`

### Auth Behavior

| API_KEYS set | Request from | LOCAL_AUTH_BYPASS | Result |
|-------------|-------------|-------------------|--------|
| No | Any | — | ✅ Allowed (auth disabled) |
| Yes | Private IP | true (default) | ✅ Allowed (bypass) |
| Yes | Private IP | false | 🔑 Key required |
| Yes | Public IP | any | 🔑 Key required |

## Multi-Tenancy

When `TENANT_HEADER` is configured, nGDB extracts a tenant ID from the specified HTTP header and isolates data paths.

```bash
TENANT_HEADER=x-tenant-id
```

```http
POST /db/open
x-tenant-id: acme-corp
Content-Type: application/json

{ "path": "mydb" }
```

This opens the database at `./data/ndb/tenants/acme-corp/mydb` instead of `./data/ndb/mydb`.

Tenant ID validation: alphanumeric, dash, underscore only (`^[a-zA-Z0-9_-]+$`).

Both HTTP and WebSocket transports support tenancy. WebSocket connections extract the tenant ID from the upgrade request headers.

## Deployment Patterns

### Single-Node — Development

```
┌─────────────────────────────┐
│         nGDB Server         │
│  ┌───────┐    ┌───────┐    │
│  │  nDB  │    │ nVDB  │    │
│  │(local)│    │(local)│    │
│  └───────┘    └───────┘    │
└─────────────────────────────┘
```

### Multi-Tenant — Production

```
┌─────────────────────────────────────┐
│         Load Balancer               │
└───────────────┬─────────────────────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
┌────────┐  ┌────────┐  ┌────────┐
│ nGDB-1 │  │ nGDB-2 │  │ nGDB-3 │  - stateless
└────┬───┘  └────┬───┘  └────┬───┘
     │           │           │
     └───────────┼───────────┘
                 ▼
        ┌─────────────────┐
        │  Shared Storage │
        │  NFS/EFS/etc    │
        └─────────────────┘
```

### Embedded Mode

Clients use nDB/nVDB directly without nGDB:

```javascript
// Node.js — no nGDB service needed
const { Database: nDB } = require('ndb');
const db = nDB.open('./my-data');
db.insert({ title: 'Hello' });

const { Database: nVDB } = require('nvdb');
const vdb = new nVDB('./vectors');
const col = vdb.createCollection('embeddings', 768);
col.insert('doc1', [0.1, 0.2, ...], { metadata: '...' });
```

```rust
// Rust — no Node.js involved
use ndb::Database;
let db = Database::open("./data")?;
```

## Client SDK Examples

### JavaScript — nGDB HTTP Client

```javascript
// Document operations via nGDB proxy
const response = await fetch('http://localhost:3000/db/insert', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ngdb_sk_abc123',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ handle: 'my-handle', doc: { name: 'Alice', email: 'alice@example.com' } })
});
const { id } = await response.json();

// Query documents
const results = await fetch('http://localhost:3000/db/query', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ngdb_sk_abc123',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    handle: 'my-handle',
    ast: { and: [{ field: 'status', eq: 'active' }] }
  })
});

// Vector search via nGDB proxy
const similar = await fetch('http://localhost:3000/vdb/search', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ngdb_sk_abc123',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    handle: 'vdb-handle',
    collection: 'embeddings',
    vector: [0.1, 0.2, 0.3],
    topK: 5
  })
});
```

### JavaScript — WebSocket Client

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

// Open nDB database
ws.send(JSON.stringify({
  action: 'open',
  path: 'mydb',
  requestId: 'r1'
}));
// Response: { action: 'open', backend: 'db', result: { handle: '...' }, requestId: 'r1' }

// Subscribe to changes
ws.send(JSON.stringify({
  action: 'subscribe',
  collection: 'users',
  filter: { status: 'active' },
  requestId: 'r2'
}));

// Insert via WebSocket
ws.send(JSON.stringify({
  action: 'insert',
  handle: 'the-handle',
  doc: { name: 'Bob', status: 'active' },
  requestId: 'r3'
}));

// Search nVDB via WebSocket
ws.send(JSON.stringify({
  action: 'search',
  backend: 'vdb',
  handle: 'vdb-handle',
  collection: 'embeddings',
  vector: [0.1, 0.2],
  topK: 5,
  requestId: 'r4'
}));
```

### Python

```python
import requests

client = requests.Session()
client.headers['Authorization'] = 'Bearer ngdb_sk_abc123'
client.headers['Content-Type'] = 'application/json'

# Document query via nGDB proxy
docs = client.post('http://localhost:3000/db/query', json={
    'handle': 'my-handle',
    'ast': { 'and': [{ 'field': 'status', 'eq': 'active' }] }
}).json()

# Vector search via nGDB proxy
results = client.post('http://localhost:3000/vdb/search', json={
    'handle': 'vdb-handle',
    'collection': 'embeddings',
    'vector': [0.1, 0.2],
    'topK': 5
}).json()
```

## Error Handling

All errors are returned as JSON with an appropriate HTTP status code:

```json
{ "error": "missing api key" }        // 401
{ "error": "invalid api key" }        // 403
{ "error": "unknown action: foo" }    // 404
{ "error": "not found" }              // 404
{ "error": "..." }                    // 500 (unhandled errors)
```

The HTTP transport catches all unhandled errors at the server level and returns a 500 with the error message. There is no retry logic — fail fast, fix the root cause.

## Web Admin Interface

nGDB includes a built-in web admin interface for managing databases, collections, documents, and monitoring service health. The admin UI is served directly by the nGDB HTTP server at `/admin/` and uses the **nui_wc2** component library for a full SPA experience.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      nGDB Server                                │
│                                                                  │
│  /admin/*  ──►  Static file serving (admin SPA)                 │
│  /admin/api/* ──►  Admin API routes (auth-gated)                │
│                                                                  │
│  admin/                                                         │
│  ├── index.html          <- SPA shell (nui-app layout)          │
│  │   <base href="/admin/">  <- Required for relative URL res.   │
│  ├── js/                                                        │
│  │   └── main.js         <- App bootstrap, routing, actions     │
│  ├── pages/              <- SPA page fragments                  │
│  │   ├── dashboard.html  <- Service overview & health           │
│  │   ├── databases.html  <- nDB instance management             │
│  │   ├── documents.html  <- Document CRUD for selected nDB      │
│  │   ├── vectors.html    <- nVDB instance & collection mgmt     │
│  │   ├── buckets.html    <- File bucket browser                 │
│  │   └── settings.html   <- Config overview, API key mgmt       │
│  └── NUI/                <- nui_wc2 git submodule root          │
│      ├── NUI/             <- Library files (nui.js, css/, lib/) │
│      │   ├── nui.js       <- Core library                       │
│      │   ├── css/         <- Themes & module CSS                │
│      │   └── lib/modules/ <- Addon modules (list, code-editor)  │
│      └── Playground/      <- Component demos & documentation    │
└─────────────────────────────────────────────────────────────────┘
```

> **Note:** The nui_wc2 git submodule has a nested directory structure. The submodule is cloned to `admin/NUI/`, but the actual library files reside at `admin/NUI/NUI/`. This means CSS and JS references use paths like `NUI/NUI/css/nui-theme.css` and `NUI/NUI/nui.js` (relative to `admin/`). The `<base href="/admin/">` tag in `index.html` ensures these relative paths resolve correctly when served by the HTTP server.

### nui_wc2 Component Usage

The admin interface is built as a full SPA using nui_wc2's app-mode layout pattern:

| nui_wc2 Component | Admin Usage |
|---|---|
| `nui-app` | App shell with header, sidebar, content regions |
| `nui-app-header` | Top bar with service title, health indicator, theme toggle |
| `nui-sidebar` | Navigation sidebar with page links |
| `nui-content` / `nui-main` | Main content area for page fragments |
| `nui-link-list` | Sidebar navigation tree (fold mode) |
| `nui-list` | Virtualized lists for databases, documents, collections, files — with search, sort, filter, selection |
| `nui-tabs` | Tab panels within pages (e.g., document data vs. metadata) |
| `nui-card` | Dashboard stat cards, database info panels |
| `nui-dialog` | Confirm delete, edit document, create database/collection dialogs |
| `nui-banner` | Operation feedback (success/error notifications) |
| `nui-button` | Action buttons throughout the UI |
| `nui-input` / `nui-textarea` | Forms for queries, document editing, search |
| `nui-select` | Dropdowns for backend selection, sort options |
| `nui-badge` | Status indicators (healthy, error, count badges) |
| `nui-accordion` | Collapsible sections for index details, collection config |
| `nui-table` | Tabular data display for query results |
| `nui-progress` | Loading indicators for long operations |
| `nui-tooltip` | Hover info on actions and stats |
| `nui-icon` | Consistent iconography from the material-icons sprite |
| `nui-code-editor` | JSON document editing, AST query builder |
| `nui-overlay` | Full-screen busy states during compaction/index rebuild |

### Admin API Routes

The admin API is exposed at `/admin/api/*` and requires the same authentication as the main API. These routes aggregate data from the nGDB service layer for the admin UI.

| Endpoint | Method | Returns | Description |
|---|---|---|---|
| `/admin/api/status` | GET | `{ version, uptime, backends, connections, subscriptions }` | Service overview |
| `/admin/api/ndb/instances` | GET | `{ instances: [{ handle, path, docCount }] }` | List open nDB instances |
| `/admin/api/ndb/instances` | POST | `{ path, options? }` → `{ handle }` | Open nDB database |
| `/admin/api/ndb/instances/:handle` | DELETE | `{ ok: true }` | Close nDB database |
| `/admin/api/ndb/instances/:handle/docs` | GET | `{ docs, count }` | List documents (paginated) |
| `/admin/api/ndb/instances/:handle/docs` | POST | `{ doc }` → `{ id }` | Insert document |
| `/admin/api/ndb/instances/:handle/docs/:id` | GET | `{ doc }` | Get document |
| `/admin/api/ndb/instances/:handle/docs/:id` | PUT | `{ doc }` → `{ ok }` | Update document |
| `/admin/api/ndb/instances/:handle/docs/:id` | DELETE | `{ ok }` | Delete document |
| `/admin/api/ndb/instances/:handle/meta` | GET | `{ meta }` | Get database metadata (display, buckets, version) |
| `/admin/api/ndb/instances/:handle/meta` | PUT | `{ meta }` → `{ ok }` | Update database metadata (display mappings, bucket declarations) |
| `/admin/api/ndb/instances/:handle/indexes` | GET | `{ indexes }` | List indexes |
| `/admin/api/ndb/instances/:handle/buckets` | GET | `{ buckets }` | List declared file buckets (from meta.json) |
| `/admin/api/ndb/instances/:handle/buckets/:name/files` | GET | `{ files }` | List bucket files |
| `/admin/api/nvdb/instances` | GET | `{ instances: [{ handle, path }] }` | List open nVDB instances |
| `/admin/api/nvdb/instances` | POST | `{ path }` → `{ handle }` | Open nVDB database |
| `/admin/api/nvdb/instances/:handle` | DELETE | `{ ok: true }` | Close nVDB database |
| `/admin/api/nvdb/instances/:handle/collections` | GET | `{ collections }` | List collections with stats |
| `/admin/api/nvdb/instances/:handle/collections/:name` | GET | `{ config, stats }` | Collection details |
| `/admin/api/nvdb/instances/:handle/collections/:name/search` | POST | `{ vector, topK }` → `{ results }` | Vector search |

### Admin Pages

#### Dashboard (`pages/dashboard.html`)
- Service health card with backend status (using `nui-card`)
- Connection count and subscription count (using `nui-badge`)
- Uptime and version info
- Quick actions: open database, create collection

#### Databases (`pages/databases.html`)
- Virtualized list of open nDB instances using `nui-list` with search by path, sort by doc count/size
- Instance detail panel: document count, indexes, buckets, display mappings (from `meta.json`)
- Display configuration: title/content/icon field paths for document list views
- Bucket management: declare/remove buckets (enforced by nDB — undeclared buckets are rejected)
- Actions: open new database, close database, compact, flush
- Uses `nui-list` footer buttons for bulk actions

#### Documents (`pages/documents.html`)
- Virtualized document browser using `nui-list` with search across fields, sort by ID/timestamp
- Display title/content/icon driven by `meta.json` display mappings (falls back to `_id` if not configured)
- Filter by soft-deleted status using `nui-list` filters
- Inline document viewer with `nui-code-editor` for JSON editing
- CRUD operations via `nui-dialog` modals
- Query builder with `nui-textarea` for AST filters

#### Vectors (`pages/vectors.html`)
- Virtualized list of nVDB instances using `nui-list`
- Collection browser with stats (doc count, segment count, index status)
- Search interface: vector input, topK slider, distance metric select
- Collection maintenance: flush, compact, rebuild index
- Uses `nui-accordion` for collection config details

#### Buckets (`pages/buckets.html`)
- File bucket browser using `nui-list` with lazy loading for thumbnails
- File metadata display (hash, name, MIME type, size)
- Upload via `nui-dialog`, delete with `nui.components.dialog.confirm()`
- Buckets must be declared in `meta.json` before files can be stored — admin provides bucket management UI

#### Settings (`pages/settings.html`)
- Configuration overview (read-only display of current config)
- API key management (add/remove keys)
- Data directory paths
- Uses `nui-accordion` for grouped settings

### Static File Serving

The admin UI static files are served by the nGDB HTTP server itself. When a request matches `/admin/*` and is not an API route, the server serves the corresponding file from the `admin/` directory:

```javascript
// In src/transports/http.js — admin static file serving
if (path.startsWith('/admin')) {
  serveAdminStatic(req, res, path);
  return;
}
```

- `/admin/` → `admin/index.html` (SPA shell)
- `/admin/js/main.js` → `admin/js/main.js`
- `/admin/pages/dashboard.html` → `admin/pages/dashboard.html`
- `/admin/NUI/NUI/nui.js` → `admin/NUI/NUI/nui.js` (core library)
- `/admin/NUI/NUI/css/nui-theme.css` → theme CSS
- `/admin/NUI/NUI/lib/modules/nui-list.js` → list module
- Content-Type auto-detected from file extension
- SPA fallback: extensionless paths under `/admin/` serve `index.html`
- No caching headers in development, cache-busting via query params in production

### Configuration

```bash
# Admin interface
ADMIN_ENABLED=true              # Enable/disable admin UI (default: true)
ADMIN_PATH=./admin              # Path to admin static files (default: ./admin)
```

When `ADMIN_ENABLED` is `false`, all `/admin/*` routes return 404.

## Comparison with Alternatives

| Feature | nGDB + nDB/nVDB | MongoDB | PostgreSQL + pgvector | Pinecone | Supabase |
|---------|-----------------|---------|----------------------|----------|----------|
| **Self-hosted** | Yes | Yes | Yes | No | Partial |
| **Proxy architecture** | Yes | N/A | N/A | N/A | N/A |
| **Embeddings** | nVDB | Atlas only | pgvector | Yes | pgvector |
| **File storage** | Built-in | GridFS | External | No | External |
| **Human-readable** | JSON Lines | No | No | No | No |
| **Zero dependencies** | Rust core | Many | Many | N/A | Many |
| **Vanilla JS service** | Yes | No | No | N/A | No |
