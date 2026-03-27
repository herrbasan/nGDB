# nGDB

> n000b General Database Platform - A modular database ecosystem for the AI age.

## Vision

nGDB is not a single database—it's a **database platform**. Instead of forcing one storage engine to handle every use case poorly, we provide specialized backends with a unified API:

- **nDB** for documents, metadata, and general-purpose storage (JSON Lines)
- **nVDB** for embeddings and similarity search (HNSW, SIMD)
- **Future backends** for graphs, time-series, etc.

**All through the same REST/WebSocket API.**

## Philosophy

- **The right tool for the job** - Documents and vectors need different storage models
- **Unified interface** - Clients shouldn't care which backend serves their data  
- **Zero-copy where possible** - Rust backends, Node.js service layer
- **Human-readable** - When it makes sense (nDB uses JSON Lines)
- **Own your code** - Minimal dependencies, maximum understanding

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     nGDB Platform                           │
│         (REST API + WebSocket + Service Layer)              │
│                    Node.js / TypeScript                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ uses npm packages
┌─────────────────────────────────────────────────────────────┐
│              @ngdb/ndb  +  @ngdb/nvdb                       │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │       nDB           │  │       nVDB          │          │
│  │   (Document DB)     │  │   (Vector DB)       │          │
│  │   JSON Lines        │  │   HNSW / SIMD       │          │
│  │   File Buckets      │  │   Binary Storage    │          │
│  │                     │  │                     │          │
│  ┌───────────────┐  │  │  ┌───────────────┐  │          │
│  │   Rust Core   │  │  │  │   Rust Core   │  │          │
│  │  JSON Lines   │  │  │  │  HNSW/SIMD    │  │          │
│  └───────┬───────┘  │  │  └───────┬───────┘  │          │
│          │          │  │          │          │          │
│  ┌───────▼───────┐  │  │  ┌───────▼───────┐  │          │
│  │ N-API Bindings│  │  │  │ N-API Bindings│  │          │
│  │  (internal)   │  │  │  │  (internal)   │  │          │
│  └───────────────┘  │  │  └───────────────┘  │          │
└─────────────────────┘  └─────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Repositories

This is the **development workspace** containing all components as Git submodules:

| Submodule | Repository | Status | Description |
|-----------|------------|--------|-------------|
| `ndb/` | [herrbasan/nDB](https://github.com/herrbasan/nDB) | 🏗️ Empty | Document database (JSON Lines). Custom N-API bindings built in. |
| `nvdb/` | [herrbasan/nVDB](https://github.com/herrbasan/nVDB) | ✅ Complete | Vector database (HNSW, SIMD). Custom N-API bindings built in. |

## Documentation

All specifications and development plans are in the `docs/` folder:

### Specifications (Detailed Reference)
- [docs/nGDB-spec.md](docs/nGDB-spec.md) - Service platform architecture
- [docs/nDB-spec.md](docs/nDB-spec.md) - Document database design  

### Development Plans (Execution Roadmaps)
- [docs/nGDB-development-plan.md](docs/nGDB-development-plan.md) - 5-phase service roadmap
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
├── ndb/               # Document database submodule
├── nvdb/              # Vector database submodule
└── README.md          # This file
```

### Usage (Future)

```javascript
// Via nGDB service
const client = new NGDBClient('https://api.example.com');
await client.collections('users').insert({ name: 'Alice' });

// Or standalone in Node.js/Electron
const { Database } = require('@ngdb/ndb');
const db = Database.open('./my-data');
db.insert({ title: 'Hello World' });
```

## Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| nVDB | ✅ Complete | Reference implementation with internal N-API |
| nDB | 🏗️ Ready | Implement core, implement N-API directly |
| nGDB | 🏗️ Ready | Scaffold service layer |

## Development Workflow

We follow a **submodule-based workflow**:

1. **Develop in nGDB workspace** - All modules together for integration testing
2. **Reference the specs** - Implementation details in `docs/`
3. **Follow the plans** - Phased approach in `docs/*-development-plan.md`
4. **Publish independently** - Stable modules released to npm

## Why?

Most database projects try to be everything:
- Document DBs struggle with vector search
- Vector DBs struggle with complex metadata queries
- SQL databases force tabular structure on everything

**nGDB embraces specialization:**
- Use nDB for documents (human-readable JSON Lines)
- Use nVDB for vectors (optimized HNSW graphs)
- Same API, different backends

## License

MIT OR Apache-2.0

---

*Part of the [n000b](https://github.com/herrbasan) ecosystem.*
