# nGDB Design Document

> n000b General Database Platform - A service wrapper that makes ndb and nvdb runnable as network services.

## Overview

nGDB is a **thin service wrapper** around independent database modules. It is NOT a database itself — it provides the network layer that makes standalone modules accessible via HTTP/WebSocket.

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
│  │  Middleware: Auth, Tenancy, Rate Limiting, Logging       │   │
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
│  │  /ws  /health  /metrics                                 │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Project Ecosystem

| Project | Language | Purpose | Deployment |
|---------|----------|---------|------------|
| **nGDB** | Vanilla JS | Service wrapper: HTTP/WS server, auth, multi-tenancy | Server/Container |
| **nDB** | Rust + N-API | Document database - standalone project | npm package |
| **nVDB** | Rust + N-API | Vector database - standalone project | npm package |

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

## Architecture

### Development Workspace

```
nGDB/                          <- Service wrapper
├── src/                       <- nGDB service layer
│   ├── server.js              <- HTTP server entry point
│   ├── middleware/             <- Auth, tenancy, rate limiting
│   ├── handlers/              <- Transport-agnostic proxy handlers
│   │   ├── db.js              <- /db/* -> ndb module calls
│   │   └── vdb.js             <- /vdb/* -> nvdb module calls
│   ├── transports/            <- Transport adapters
│   │   ├── http.js            <- HTTP request/response adapter
│   │   └── ws.js              <- WebSocket message adapter
│   └── ws.js                  <- WebSocket server setup
├── ndb/                       <- git submodule - independent project
├── nvdb/                      <- git submodule - independent project
├── tests/                     <- Integration tests
└── package.json
    "dependencies": {
      "ndb": "file:./ndb",
      "nvdb": "file:./nvdb"
    }
```

### Production Deployment

**Option A: Full nGDB Service - recommended**
```
nGDB Server
  ├── nGDB service layer - HTTP/WS, auth, tenancy
  ├── ndb  - bundled: nDB + Node.js bindings
  └── nvdb - bundled: nVDB + Node.js bindings
```

**Option B: Standalone Packages**
```bash
# For Node.js/Electron projects - no nGDB service needed
npm install ndb
npm install nvdb
```

**Option C: Rust Direct**
```toml
# Cargo.toml - no Node.js involved
dependencies.ndb = "0.1"
dependencies.nvdb = "0.1"
```

### Service Layer

```
┌─────────────────────────────────────────────┐
│           HTTP / WebSocket Server           │
│  - Vanilla Node.js HTTP server              │
│  - No Express/Fastify                       │
│  - Direct request/response pipelining       │
├─────────────────────────────────────────────┤
│         Middleware Pipeline                  │
│  - API key / JWT validation                 │
│  - Tenant isolation                         │
│  - Rate limiting                            │
│  - Request logging                          │
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
│  /metrics -> Prometheus metrics             │
└─────────────────────────────────────────────┘
```

## Proxy Routes

nGDB proxies each backend's native API. There is no translation layer — requests pass through to the module's Node.js API directly.

### nDB Routes - /db/*

All nDB operations are proxied through `/db/*`. The route structure mirrors nDB's native Node.js API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/db/open` | POST | Open database instance |
| `/db/close` | POST | Close database instance |
| `/db/insert` | POST | Insert document |
| `/db/get` | POST | Get document by ID |
| `/db/update` | POST | Update document |
| `/db/delete` | POST | Delete document |
| `/db/query` | POST | Query with filters |
| `/db/bucket/*` | * | File bucket operations |

Request bodies map directly to nDB's Node.js function parameters.

### nVDB Routes - /vdb/*

All nVDB operations are proxied through `/vdb/*`. The route structure mirrors nVDB's native Node.js API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/vdb/open` | POST | Open vector database |
| `/vdb/close` | POST | Close vector database |
| `/vdb/upsert` | POST | Upsert vector document |
| `/vdb/search` | POST | Similarity search |
| `/vdb/delete` | POST | Delete vector document |
| `/vdb/get` | POST | Get vector document by ID |

Request bodies map directly to nVDB's Node.js function parameters.

### Service Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health + backend status |
| `/metrics` | GET | Prometheus-format metrics |
| `/ws` | GET | WebSocket upgrade |

### Shared Handler Pattern

HTTP and WebSocket share the same handler code. The proxy logic is transport-agnostic — handlers receive a plain request object and return a plain response object, regardless of transport.

```javascript
// src/handlers/db.js — transport-agnostic handlers
const ndb = require('ndb');

// Handler: insert document
// Works identically for HTTP POST and WebSocket message
function insert(params) {
  return ndb.insert(params);
}

// Handler: query documents
function query(params) {
  return ndb.query(params);
}

module.exports = { insert, query, get, update, delete };

// src/transports/http.js — HTTP adapter
const handlers = require('../handlers/db');

async function route(req, res) {
  const body = await parseBody(req);
  const handler = handlers[req.params.action];
  const result = handler(body);
  json(res, 200, result);
}

// src/transports/ws.js — WebSocket adapter
const handlers = require('../handlers/db');

function onMessage(message) {
  const { action, params, requestId } = JSON.parse(message);
  const handler = handlers[action];
  const result = handler(params);
  ws.send(JSON.stringify({ requestId, result }));
}
```

**Key insight:** Code written for bundled nDB/nVDB usage works identically through the service. The handler layer IS the module's native API — no translation needed.

## WebSocket API

Real-time subscriptions and streaming over a single WebSocket connection:

```javascript
// Client connects via WebSocket
const ws = new WebSocket('ws://ngdb.example.com/ws');

// Subscribe to nDB collection changes
ws.send(JSON.stringify({
  action: 'subscribe',
  backend: 'db',
  collection: 'users',
  filter: { status: 'active' }
}));

// Receive real-time updates
ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  // { backend: 'db', type: 'insert'|'update'|'delete', doc: {...} }
};
```

## Configuration

```yaml
# ngdb.config.yaml
server:
  port: 3000
  host: 0.0.0.0

auth:
  type: jwt
  secret: ${JWT_SECRET}

backends:
  ndb:
    dataDir: ./data/ndb
  nvdb:
    dataDir: ./data/nvdb

limits:
  maxRequestSize: 10mb
  maxBatchSize: 1000
  rateLimitPerMinute: 1000
```

## Deployment Patterns

### Single-Node - Development

```
┌─────────────────────────────┐
│         nGDB Server         │
│  ┌───────┐    ┌───────┐    │
│  │  nDB  │    │ nVDB  │    │
│  │(local)│    │(local)│    │
│  └───────┘    └───────┘    │
└─────────────────────────────┘
```

### Multi-Tenant - Production

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

```rust
// Direct Rust usage
use ndb::Database;
let db = Database::open("./data")?;

// Or via Node.js bindings
const ndb = require('ndb');
const db = ndb.open('./data');
```

## Client SDK Examples

### JavaScript - nGDB Client

```javascript
// Document operations via nGDB proxy
const response = await fetch('http://localhost:3000/db/insert', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ngdb_sk_abc123', 'Content-Type': 'application/json' },
  body: JSON.stringify({ collection: 'users', doc: { name: 'Alice', email: 'alice@example.com' } })
});
const { id } = await response.json();

// Query documents
const results = await fetch('http://localhost:3000/db/query', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ngdb_sk_abc123', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    collection: 'users',
    query: { and: [{ field: 'status', eq: 'active' }] },
    sort: { created: 'desc' },
    limit: 10
  })
});

// Vector search via nGDB proxy
const similar = await fetch('http://localhost:3000/vdb/search', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ngdb_sk_abc123', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    collection: 'embeddings',
    vector: [0.1, 0.2, 0.3],
    topK: 5
  })
});
```

### JavaScript - Standalone nDB/nVDB

For embedded use in Node.js/Electron without the nGDB service:

```javascript
// Document database only
const { Database: nDB } = require('ndb');
const db = nDB.open('./my-data');
const id = db.insert({ title: 'Hello', tags: ['a', 'b'] });

// Vector database only
const { Database: nVDB } = require('nvdb');
const vdb = nVDB.open('./vectors', { dim: 768 });
vdb.upsert({ id: 'doc1', vector: embedding });
const results = vdb.search(queryVector, { topK: 10 });
```

### Python

```python
import requests

client = requests.Session()
client.headers['Authorization'] = 'Bearer ngdb_sk_abc123'
client.headers['Content-Type'] = 'application/json'

# Document query via nGDB proxy
docs = client.post('http://localhost:3000/db/query', json={
    'collection': 'users',
    'query': { 'and': [{ 'field': 'status', 'eq': 'active' }] },
    'limit': 10
}).json()

# Vector search via nGDB proxy
results = client.post('http://localhost:3000/vdb/search', json={
    'collection': 'embeddings',
    'vector': [0.1, 0.2],
    'topK': 5
}).json()
```

## Authentication and Security

### API Key Authentication

```http
POST /db/insert
Authorization: Bearer ngdb_sk_abc123xyz
Content-Type: application/json
```

### Tenant Isolation

```javascript
// Multi-tenant deployment
const ngdb = new NGDBServer({
  tenancy: 'strict',  // each tenant gets isolated storage
  extractTenant: (req) => req.headers['x-tenant-id']
});
```

### Permission Model

```yaml
# permissions.yaml
roles:
  admin:
    - db:*
    - vdb:*
  developer:
    - db:read
    - db:write
    - vdb:read
    - vdb:write
  readonly:
    - db:read
    - vdb:read
```

## Monitoring and Observability

```typescript
// Metrics exposed at /metrics - Prometheus format
ngdb_requests_total{backend="ndb", route="insert"} 1024
ngdb_requests_duration_seconds_bucket{backend="nvdb", route="search", le="0.1"} 950
ngdb_active_connections 42

// Health check
GET /health
{
  "status": "healthy",
  "backends": {
    "ndb": "connected",
    "nvdb": "connected"
  }
}
```

## Comparison with Alternatives

| Feature | nGDB + nDB/nVDB | MongoDB | PostgreSQL + pgvector | Pinecone | Supabase |
|---------|-----------------|---------|----------------------|----------|----------|
| **Self-hosted** | Yes | Yes | Yes | No | Partial |
| **Proxy architecture** | Yes | N/A | N/A | N/A | N/A |
| **Embeddings** | nVDB | Atlas only | pgvector | Yes | pgvector |
| **File storage** | Built-in | GridFS | External | No | External |
| **Human-readable** | JSON Lines | No | No | No | No |
| **Zero dependencies** | Rust core | Many | Many | N/A | Many |

## Roadmap

### Phase 1: Core Service ✅
- [x] Vanilla Node.js HTTP server
- [x] nDB proxy routes - /db/*
- [ ] Basic auth - API keys
- [x] Health check endpoint

### Phase 2: Document API ✅
- [x] Complete nDB proxy surface
- [x] Query passthrough
- [x] File bucket proxy

### Phase 3: Real-Time ✅
- [x] WebSocket server
- [x] Subscriptions
- [x] Change streams

### Phase 4: Production Features
- [ ] JWT authentication
- [ ] Multi-tenancy
- [ ] Rate limiting
- [ ] Prometheus metrics

### Phase 5: Vector Support
- [ ] nVDB proxy routes - /vdb/*
- [ ] Search passthrough

### Phase 6: Ecosystem
- [ ] JavaScript client SDK
- [ ] Python SDK
- [ ] Admin dashboard

## Related Documents

- [nDB Specification](./nDB-spec.md) - Document database - independent project
- [nVDB Documentation](../nvdb/README.md) - Vector database - independent project

---

*"Thin wrapper, independent engines, no leaky abstractions."*
