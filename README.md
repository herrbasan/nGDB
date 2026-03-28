# nGDB

> n000b General Database Platform - A service wrapper that makes ndb and nvdb runnable as network services.

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
- **Own your code** — Vanilla JS, no frameworks, minimal dependencies.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      nGDB Service                           │
│         Vanilla Node.js HTTP + WebSocket Server             │
├─────────────────────────────────────────────────────────────┤
│  Middleware: Auth, Tenancy, Rate Limiting, Logging          │
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
| `ndb/` | [herrbasan/nDB](https://github.com/herrbasan/nDB) | 🏗️ Ready | Document database — independent project |
| `nvdb/` | [herrbasan/nVDB](https://github.com/herrbasan/nVDB) | ✅ Complete | Vector database — independent project |

## Documentation

All specifications and development plans are in the `docs/` folder:

### Specifications (Detailed Reference)
- [docs/nGDB-spec.md](docs/nGDB-spec.md) - Service wrapper architecture (proxy design)
- [docs/nDB-spec.md](docs/nDB-spec.md) - Document database design  

### Development Plans (Execution Roadmaps)
- [docs/nGDB-development-plan.md](docs/nGDB-development-plan.md) - 6-phase service roadmap
- [docs/nDB-development-plan.md](docs/nDB-development-plan.md) - 6-phase database roadmap

Start with [docs/README.md](docs/README.md) for the full overview.

## Quick Start

### Development Setup

```bash
# Clone with all submodules
git clone --recursive https://github.com/herrbasan/nGDB.git

# Or if already cloned, init submodules
git submodule update --init --recursive

# Directory structure
nGDB/
├── docs/              # Documentation
├── ndb/               # Document database submodule (independent project)
├── nvdb/              # Vector database submodule (independent project)
└── README.md          # This file
```

### Usage (Future)

```javascript
// Via nGDB service — proxy routes
const result = await fetch('http://localhost:3000/db/insert', {
  method: 'POST',
  body: JSON.stringify({ collection: 'users', doc: { name: 'Alice' } })
});

// Or standalone in Node.js/Electron — no nGDB needed
const { Database } = require('ndb');
const db = Database.open('./my-data');
db.insert({ title: 'Hello World' });
```

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| nVDB | ✅ Complete | Vector database with internal N-API |
| nDB | 🏗️ Ready | Document database — implement core + N-API |
| nGDB | 🏗️ Ready | Service wrapper — scaffold proxy routes |

## Development Workflow

We follow a **submodule-based workflow**:

1. **Develop in nGDB workspace** - All modules together for integration testing
2. **Reference the specs** - Implementation details in `docs/`
3. **Follow the plans** - Phased approach in `docs/*-development-plan.md`
4. **Publish independently** - Stable modules released to npm as standalone packages

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
