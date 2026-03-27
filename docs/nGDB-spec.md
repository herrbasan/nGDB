# nGDB Design Document

> n000b General Database Platform - A unified service layer for modular backends.

## Overview

nGDB is a **service platform** and **development workspace** for the nDB ecosystem. It provides:

1. **Primary development workspace** - All modules (nDB, nVDB) are developed together as Git submodules. nBridge lives inside each as their submodule.
2. **Unified REST/WebSocket API** - Service layer for production deployments
3. **Integration testing** - End-to-end tests across all modules

Once individual modules are stable, they are published as standalone npm packages for embedded use.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Clients                                 │
│  (Web Apps, Mobile, MCP Agents, CLI tools, etc.)                │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ HTTP / WebSocket
┌─────────────────────────────────▼───────────────────────────────┐
│                      nGDB Platform                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Service Layer: Auth, Routing, Connection Management    │   │
│  │  ORM: Unified API translation                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │ uses npm packages
┌─────────────────────────────┼───────────────────────────────────┐
│                             ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  ndb  +  nvdb                              │  │
│  │                                                          │  │
│  │  ┌─────────────────────┐  ┌─────────────────────┐       │  │
│  │  │       nDB           │  │       nVDB          │       │  │
│  │  │   (Document DB)     │  │   (Vector DB)       │       │  │
│  │  │                     │  │                     │       │  │
│  │  │  ┌───────────────┐  │  │  ┌───────────────┐  │       │  │
│  │  │   Rust Core   │  │  │  │   Rust Core   │  │       │  │
│  │  │  JSON Lines   │  │  │  │  HNSW/SIMD    │  │       │  │
│  │  └───────┬───────┘  │  │  └───────┬───────┘  │       │  │
│  │          │          │  │          │          │       │  │
│  │  ┌───────▼───────┐  │  │  ┌───────▼───────┐  │       │  │
│  │  │N-API Bindings │  │  │  │N-API Bindings │  │       │  │
│  │  │  (internal)   │  │  │  │  (internal)   │  │       │  │
│  │  │  └───────────────┘  │  │  └───────────────┘  │       │  │
│  │  └─────────────────────┘  └─────────────────────┘       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Project Ecosystem

| Project | Language | Purpose | Deployment |
|---------|----------|---------|------------|
| **nGDB** | Node.js/TypeScript | Service platform, unified API, auth, multi-tenancy | Server/Container |
| **nDB** | Rust + N-API | Document database with internal Node.js bindings | npm package (standalone) |
| **nVDB** | Rust + N-API | Vector database with internal Node.js bindings | npm package (standalone) |

## Philosophy

**nGDB is not a database - it's a database platform.**

Instead of forcing one storage engine to handle all use cases poorly, nGDB lets you:
- Use **nDB** for documents, metadata, and general-purpose storage
- Use **nVDB** for embeddings and similarity search
- Add new backends as needed (graph DB, time-series, etc.)

**All through the same API.**

### Core Beliefs

- **The right tool for the job**: Documents and vectors need different storage models
- **Unified interface**: Clients shouldn't care which backend serves their data
- **Zero-copy where possible**: Rust backends, Node.js service layer
- **Extensible**: New backend? Implement the interface, register it, done.

## Architecture

nGDB serves as the **primary development workspace** where all modules are developed together before being split into standalone packages.

### Development Workspace (nGDB)

```
nGDB/                          ← Main development workspace
├── src/                       ← nGDB service layer
│   ├── api/                   ← HTTP/WebSocket handlers
│   ├── auth/                  ← Authentication
│   └── orm/                   ← Query translation
├── nDB/                       ← git submodule (nDB core)
│   ├── src/                   ← Rust core & N-API dev
│   └── package.json           ← ndb package
├── nVDB/                      ← git submodule (nVDB core)
│   ├── src/                   ← Rust core & N-API dev
│   └── package.json           ← nvdb package
├── tests/                     ← Integration tests
├── examples/                  ← Usage examples
└── package.json
    "dependencies": {
      "ndb": "file:./nDB",          ← local dev link
      "nvdb": "file:./nVDB"         ← local dev link
    }
```

### Production Deployment

Once modules are stable, they can be deployed independently:

**Option A: Full nGDB Platform (recommended)**
```
nGDB Server (includes nDB + nVDB via npm)
  ├── nGDB service layer
  ├── ndb  (bundled: nDB + internal Node.js bindings)
  └── nvdb (bundled: nVDB + internal Node.js bindings)
```

**Option B: Standalone Packages**
```bash
# For Node.js/Electron projects (no nGDB service)
npm install ndb
npm install nvdb
```

**Option C: Rust Direct**
```toml
# Cargo.toml - no Node.js involved
dependencies.ndb = "0.1"
dependencies.nvdb = "0.1"
```

### Why This Approach?

| Phase | Setup | Purpose |
|-------|-------|---------|
| **Development** | nGDB workspace with submodules | Develop all modules together, integration testing |
| **Production** | Published npm packages | Stable releases, semver versioning |
| **Standalone** | Individual npm packages | Embed in any Node.js/Electron project |

### Service Layer

```
┌─────────────────────────────────────────────┐
│           HTTP / WebSocket Server           │
│  - Raw Native Router (Zero Middleware)      │
│  - Direct Request/Response Pipelining       │
│  - Connection pooling                       │
├─────────────────────────────────────────────┤
│         Authentication & AuthZ              │
│  - API key / JWT validation                 │
│  - Tenant isolation                         │
│  - Permission checks                        │
├─────────────────────────────────────────────┤
│              ORM / Router                   │
│  - Collection type detection                │
│  - Backend selection                        │
│  - AST Request pass-through                 │
│  - Result formatting                        │
├─────────────────────────────────────────────┤
│         Backend Registry                    │
│  - nDB driver                               │
│  - nVDB driver                              │
│  - (extensible)                             │
└─────────────────────────────────────────────┘
```

### Backend Registration

Backends register themselves with nGDB at startup:

```typescript
// nGDB initialization
import { nDBBackend } from './backends/ndb';
import { nVDBBackend } from './backends/nvdb';

const ngdb = new NGDBServer({
  backends: {
    'document': nDBBackend,
    'vector': nVDBBackend,
    // Future: 'graph': graphBackend,
  },
  defaultBackend: 'document',
});

await ngdb.start();
```

### Collection Types

Collections declare their type on creation:

```javascript
// HTTP API
POST /collections
{
  "name": "users",
  "type": "document",      // → routed to nDB
  "config": { ... }
}

POST /collections
{
  "name": "embeddings", 
  "type": "vector",        // → routed to nVDB
  "config": {
    "dim": 768,
    "metric": "cosine"
  }
}
```

## Unified API

### REST Endpoints

All backends expose the same REST interface:

| Endpoint | Method | Description | Backend Mapping |
|----------|--------|-------------|-----------------|
| `/collections` | GET | List collections | All |
| `/collections` | POST | Create collection | All |
| `/collections/:name` | DELETE | Drop collection | All |
| `/collections/:name/docs` | GET | Query documents | nDB |
| `/collections/:name/docs` | POST | Insert document | nDB |
| `/collections/:name/docs/:id` | GET | Get by ID | nDB |
| `/collections/:name/docs/:id` | PUT | Update by ID | nDB |
| `/collections/:name/docs/:id` | DELETE | Delete by ID | nDB |
| `/collections/:name/search` | POST | Vector search | nVDB |
| `/collections/:name/upsert` | POST | Upsert vectors | nVDB |

### WebSocket API

Real-time subscriptions and streaming:

```javascript
// Client connects via WebSocket
const ws = new WebSocket('ws://ngdb.example.com/ws');

// Subscribe to collection changes
ws.send(JSON.stringify({
  action: 'subscribe',
  collection: 'users',
  filter: { status: 'active' }
}));

// Receive real-time updates
ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  // { type: 'insert'|'update'|'delete', doc: {...} }
};
```

### Query Language

Unified query syntax across backends:

```javascript
// Document queries (nDB)
POST /collections/users/docs
{
  "query": {
    "and": [
      { "field": "status", "eq": "active" },
      { "field": "created", "gt": "2024-01-01" }
    ]
  },
  "sort": { "created": "desc" },
  "limit": 100
}

// Vector search (nVDB)
POST /collections/embeddings/search
{
  "vector": [0.1, 0.2, ...],  // or "text" for auto-embed
  "topK": 10,
  "filter": {                 // metadata filter
    "and": [
      { "field": "category", "eq": "docs" }
    ]
  }
}
```

## Backend Driver Interface

Each backend implements a standard interface:

```typescript
interface BackendDriver {
  name: string;
  version: string;
  
  // Lifecycle
  initialize(config: BackendConfig): Promise<void>;
  shutdown(): Promise<void>;
  
  // Collections
  createCollection(name: string, config: unknown): Promise<Collection>;
  dropCollection(name: string): Promise<void>;
  listCollections(): Promise<string[]>;
  
  // Documents (nDB)
  insert?(collection: string, doc: unknown): Promise<string>;
  get?(collection: string, id: string): Promise<unknown>;
  update?(collection: string, id: string, doc: unknown): Promise<void>;
  delete?(collection: string, id: string): Promise<void>;
  query?(collection: string, query: Query): Promise<QueryResult>;
  
  // Vectors (nVDB)
  upsertVectors?(collection: string, vectors: VectorDoc[]): Promise<void>;
  searchVectors?(collection: string, query: VectorQuery): Promise<VectorResult[]>;
  rebuildIndex?(collection: string): Promise<void>;
  
  // Events (for WebSocket subscriptions)
  subscribe?(collection: string, filter: Filter): EventEmitter;
}
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
    trashMode: manual
    
  nvdb:
    dataDir: ./data/nvdb
    defaultMetric: cosine
    
  # Future: graph, timeseries, etc.
  
limits:
  maxRequestSize: 10mb
  maxBatchSize: 1000
  rateLimitPerMinute: 1000
```

## Deployment Patterns

### Single-Node (Development)

```
┌─────────────────────────────┐
│         nGDB Server         │
│  ┌───────┐    ┌───────┐    │
│  │  nDB  │    │ nVDB  │    │
│  │(local)│    │(local)│    │
│  └───────┘    └───────┘    │
└─────────────────────────────┘
```

### Multi-Tenant (Production)

```
┌─────────────────────────────────────┐
│         Load Balancer               │
└───────────────┬─────────────────────┘
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
┌────────┐  ┌────────┐  ┌────────┐
│ nGDB-1 │  │ nGDB-2 │  │ nGDB-3 │  (stateless)
└────┬───┘  └────┬───┘  └────┬───┘
     │           │           │
     └───────────┼───────────┘
                 ▼
        ┌─────────────────┐
        │  Shared Storage │
        │  (NFS/EFS/etc)  │
        └─────────────────┘
```

### Embedded Mode

Clients can use nDB/nVDB directly without nGDB:

```rust
// Direct Rust usage
use ndb::Database;
let db = Database::open("./data")?;

// Or via Node.js bindings
const ndb = require('ndb');
const db = ndb.open('./data');
```

## Client SDK Examples

### JavaScript/TypeScript (nGDB Client)

```typescript
impjavascript
// Document operations
await client.collections('users').insert({ name: 'Alice', email: 'alice@example.com' });
const user = await client.collections('users').get('alice-id');

// LLM-Native JSON AST Query (No fluent builders)
const activeUsers = await client.postQuery('users', {
  $and: [{ status: { $eq: 'active' } }],
  $sort: { created: 'desc' },
  $limit: 10
});

// Vector operations
await client.collections('embeddings').upsert({
  id: 'doc1',
  vector: [0.1, 0.2, 0.3],
  metadata: { category: 'tech' }
});

const similar = await client.postVectorSearch('embeddings', {
  vector: [0.1, 0.2, 0.3],
  topK: 5,
  filter: { category: { $eq: 'tech' } }
}

### JavaScript/TypeScript (Standalone nDB/nVDB)

For embedded use in Node.js/Electron without the nGDB service:

```typescript
// Document database only
import { Database as nDB } from 'ndb';

const db = nDB.open('./my-data');
const id = db.insert({ title: 'Hello', tags: ['a', 'b'] });

// Vector database only  
import { Database as nVDB } from 'nvdb';

const vdb = nVDB.open('./vectors', { dim: 768 });
vdb.upsert({ id: 'doc1', vector: embedding });
const results = vdb.search(queryVector, { topK: 10 });
```

### Python

```python
from ngdb import Client

client = Client("https://api.example.com")

# Same API surface regardless of backend
docs = client.collections("users").query(
    filter={"status": "active"},
    sort=[("created", "desc")],
    limit=10
)

results = client.collections("embeddings").search(
    vector=[0.1, 0.2, ...],
    top_k=5
)
```

## Authentication & Security

### API Key Authentication

```http
GET /collections/users/docs
Authorization: Bearer ngdb_sk_abc123xyz
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
    - collections:*
  developer:
    - collections:read
    - collections:write
  readonly:
    - collections:read
```

## Monitoring & Observability

```typescript
// Metrics exposed at /metrics (Prometheus format)
ngdb_requests_total{backend="ndb", operation="insert"} 1024
ngdb_requests_duration_seconds_bucket{le="0.1"} 950
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
| **Self-hosted** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No | ⚠️ Partial |
| **Unified API** | ✅ Yes | ❌ Separate | ⚠️ Extensions | ❌ Vectors only | ❌ Separate |
| **Embeddings** | ✅ nVDB | ⚠️ Atlas only | ✅ pgvector | ✅ Yes | ✅ pgvector |
| **File storage** | ✅ Built-in | ⚠️ GridFS | ❌ External | ❌ No | ❌ External |
| **Human-readable** | ✅ JSON Lines | ❌ Binary | ❌ Binary | ❌ No | ❌ Binary |
| **Zero dependencies** | ⚠️ Rust core | ❌ Many | ❌ Many | N/A | ❌ Many |

## Roadmap

### Phase 1: Core Platform
- [ ] HTTP REST API
- [ ] nDB backend integration
- [ ] Basic auth
- [ ] JavaScript client SDK

### Phase 2: Real-Time
- [ ] WebSocket API
- [ ] Subscriptions
- [ ] Change streams

### Phase 3: Vector Support
- [ ] nVDB backend integration
- [ ] Embedding service integration
- [ ] Hybrid search (vector + filter)

### Phase 4: Scale
- [ ] Multi-tenancy
- [ ] Horizontal scaling
- [ ] Replication

### Phase 5: Ecosystem
- [ ] Python SDK
- [ ] Go SDK
- [ ] GraphQL API
- [ ] Admin dashboard

## Related Documents

- [nDB Specification](./nDB-spec.md) - Document database backend
- nVDB Specification (TBD) - Vector database backend
- [nBridge Documentation](./nBridge-spec.md) - Rust/Node.js bridge

---

*"One platform, multiple engines, unified API."*
