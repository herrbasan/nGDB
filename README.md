# nGDB

> n000b General Database Platform — A service wrapper that runs nDB and nVDB as network services, exposing their full native APIs over HTTP and WebSocket.

## Vision

nGDB is not a database — it's a **thin service wrapper**. It takes two independent database modules and exposes them as a network service with shared cross-cutting concerns:

- **nDB** — Document database (JSON Lines, file buckets, field-level queries) — independent project
- **nVDB** — Vector database (HNSW, SIMD, similarity search) — independent project
- **nGDB** — HTTP/WS service layer (auth, tenancy, routing) — this repo

**Each backend keeps its own native API. nGDB proxies, it doesn't translate.**

## Philosophy

- **No leaky abstractions** — nDB and nVDB have fundamentally different data models. Don't unify them.
- **Proxy, don't translate** — `/db/*` maps to nDB, `/vdb/*` maps to nVDB. Direct passthrough.
- **Independent modules** — Each module works standalone without nGDB.
- **Thin wrapper** — nGDB adds cross-cutting concerns (auth, tenancy, WebSocket), not business logic.
- **Own your code** — Vanilla JS, no frameworks, no external dependencies.
- **Fail fast** — No defensive coding, no fallback defaults, no silenced errors.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      nGDB Service                           │
│         Vanilla Node.js HTTP + WebSocket Server             │
├─────────────────────────────────────────────────────────────┤
│  Middleware: API Key Auth, Private IP Bypass, Tenancy       │
├────────────────────────┬────────────────────────────────────┤
│     /db/*              │         /vdb/*                     │
│     nDB proxy          │         nVDB proxy                 │
│     passthrough        │         passthrough                │
├────────────────┬───────┴──────────────┬─────────────────────┤
│    ndb module  │                      │  nvdb module        │
│    direct call │                      │  direct call        │
└────────────────┘                      └─────────────────────┘
         │                                       │
    ┌────▼─────────┐                    ┌────────▼──────┐
    │     nDB      │                    │     nVDB      │
    │ Document DB  │                    │  Vector DB    │
    │ JSON Lines   │                    │  HNSW/SIMD    │
    │ File Buckets │                    │ Binary Store  │
    │ Rust + N-API │                    │ Rust + N-API  │
    └──────────────┘                    └───────────────┘
```

## Repositories

This is the **development workspace** containing all components as Git submodules:

| Submodule | Repository | Status | Description |
|-----------|------------|--------|-------------|
| `ndb/` | [herrbasan/nDB](https://github.com/herrbasan/nDB) | ✅ Complete | Document database — independent project |
| `nvdb/` | [herrbasan/nVDB](https://github.com/herrbasan/nVDB) | ✅ Complete | Vector database — independent project |

## Documentation

All specifications and development plans are in the `docs/` folder:

### Specifications (Detailed Reference)
- [docs/nGDB-spec.md](docs/nGDB-spec.md) — Service wrapper architecture, proxy routes, WebSocket protocol
- [docs/nDB-spec.md](docs/nDB-spec.md) — Document database design

### Development Plans (Execution Roadmaps)
- [docs/nGDB-development-plan.md](docs/nGDB-development-plan.md) — 6-phase service roadmap
- [docs/nDB-development-plan.md](docs/nDB-development-plan.md) — 6-phase database roadmap

Start with [docs/README.md](docs/README.md) for the full overview.

## Quick Start

### Development Setup

```bash
# Clone with all submodules
git clone --recursive https://github.com/herrbasan/nGDB.git

# Or if already cloned, init submodules
git submodule update --init --recursive

# Install dependencies
npm install

# Start the server
npm start
# nGDB listening on 0.0.0.0:3000
```

### Configuration

All config via environment variables — no config files:

```bash
PORT=3000                       # HTTP port
HOST=0.0.0.0                    # Bind address
NDB_DATA_DIR=./data/ndb         # nDB storage root
NVDB_DATA_DIR=./data/nvdb       # nVDB storage root
API_KEYS=key1,key2              # Auth keys (empty = disabled)
TENANT_HEADER=x-tenant-id       # Multi-tenancy header (empty = disabled)
```

### Usage Examples

```bash
# Health check
curl http://localhost:3000/health

# Open a database
curl -X POST http://localhost:3000/db/open \
  -H 'Content-Type: application/json' \
  -d '{"path":"mydb"}'
# {"handle":"abc-123-..."}

# Insert a document
curl -X POST http://localhost:3000/db/insert \
  -H 'Content-Type: application/json' \
  -d '{"handle":"abc-123-...","doc":{"name":"Alice","email":"alice@example.com"}}'
# {"id":"..."}

# Open a vector database
curl -X POST http://localhost:3000/vdb/open \
  -H 'Content-Type: application/json' \
  -d '{"path":"vectors"}'
# {"handle":"xyz-456-..."}

# Create a collection and search
curl -X POST http://localhost:3000/vdb/createCollection \
  -H 'Content-Type: application/json' \
  -d '{"handle":"xyz-456-...","name":"embeddings","dimension":768}'

curl -X POST http://localhost:3000/vdb/search \
  -H 'Content-Type: application/json' \
  -d '{"handle":"xyz-456-...","collection":"embeddings","vector":[0.1,0.2,...],"topK":5}'
```

### Standalone Usage (No nGDB)

```javascript
// Use nDB directly in Node.js — no service needed
const { Database } = require('ndb');
const db = Database.open('./my-data');
db.insert({ title: 'Hello World' });

// Use nVDB directly
const { Database: nVDB } = require('nvdb');
const vdb = new nVDB('./vectors');
const col = vdb.createCollection('embeddings', 768);
col.insert('doc1', [0.1, 0.2], { metadata: '...' });
```

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| nVDB | ✅ Complete | Vector database with HNSW, SIMD, filter DSL |
| nDB | ✅ Complete | Document database with queries, indexes, file buckets |
| nGDB | ✅ Phases 1-5 | Service wrapper with HTTP, WebSocket, auth, tenancy |

## API Surface

### nDB Routes (`/db/*`)

26 proxy routes covering: database lifecycle, document CRUD, queries (AST, field, range), iteration, soft delete, indexes (hash + BTree), maintenance, and file bucket operations.

### nVDB Routes (`/vdb/*`)

16 proxy routes covering: database lifecycle, collection management, document operations, similarity search (exact + HNSW with filters), and collection maintenance (flush, sync, compact, index management).

### WebSocket (`/ws`)

Zero-dependency RFC 6455 implementation with: message routing to both backends, subscriptions with filters, mutation broadcasting, tenant isolation, and auto-cleanup.

## Why?

Most database projects try to be everything:
- Document DBs struggle with vector search
- Vector DBs struggle with complex metadata queries
- SQL databases force tabular structure on everything

**nGDB embraces specialization without forced unification:**
- Use nDB for documents (human-readable JSON Lines)
- Use nVDB for vectors (optimized HNSW graphs)
- nGDB proxies each backend's native API — no leaky abstractions

## License

MIT OR Apache-2.0

---

*Part of the [n000b](https://github.com/herrbasan) ecosystem.*
