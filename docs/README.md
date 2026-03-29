# nGDB Ecosystem Documentation

> Design specifications and development plans for the n000b Database Platform

## Quick Navigation

### Specifications (Reference Documents)

| Document | Description | Status |
|----------|-------------|--------|
| [nGDB Spec](./nGDB-spec.md) | Service wrapper architecture, proxy routes, WebSocket protocol | ✅ Current |
| [nDB Spec](./nDB-spec.md) | Document database (JSON Lines) | 📝 Draft |
| nVDB Spec | Vector database (HNSW) | ✅ Complete (in nvdb repo) |

### Development Plans (Execution Roadmaps)

| Document | Phases | Current Phase |
|----------|--------|---------------|
| [nGDB Development Plan](./nGDB-development-plan.md) | 6 phases | Phase 5 complete |
| [nDB Development Plan](./nDB-development-plan.md) | 6 phases | Complete |

## Project Structure

```
nGDB/                          <- This repository (service wrapper)
├── src/                       <- nGDB service layer
│   ├── server.js              <- HTTP server entry point
│   ├── config.js              <- Environment-driven configuration
│   ├── middleware/             <- Auth, tenancy
│   ├── handlers/              <- Transport-agnostic proxy handlers
│   │   ├── db.js              <- nDB proxy (26 routes)
│   │   └── vdb.js             <- nVDB proxy (16 routes)
│   ├── transports/            <- Transport adapters
│   │   ├── http.js            <- HTTP request/response adapter
│   │   └── ws.js              <- WebSocket frame protocol (RFC 6455)
│   └── ws.js                  <- WebSocket server, subscriptions, broadcast
├── tests/                     <- Integration tests (phases 1-5)
├── docs/                      <- Documentation (you are here)
├── ndb/                       <- Git submodule (independent project)
└── nvdb/                      <- Git submodule (independent project)
```

## Ecosystem Overview

```
Clients (Web, Mobile, MCP Agents)
           │
           ▼ HTTP/REST or WebSocket
    ┌──────────────────┐
    │   nGDB Service   │  <- Thin service wrapper (this repo)
    │   Proxy + Auth   │
    └──────┬───────────┘
           │ direct module calls
    ┌──────┴───────────┐
    ▼                  ▼
┌─────────┐     ┌─────────┐
│   nDB   │     │  nVDB   │
│(Rust)   │     │ (Rust)  │
│N-API    │     │N-API    │
│(native) │     │(native) │
└─────────┘     └─────────┘
```

nGDB is a **thin service wrapper** — it proxies each backend's native API through `/db/*` and `/vdb/*` routes. No ORM, no query translation, no unified abstraction. Code written for bundled nDB/nVDB usage works identically through the service.

HTTP and WebSocket share the same handler code — the proxy logic is transport-agnostic.

## Repository Structure

### Standalone Repositories

| Repository | Purpose | Contains |
|------------|---------|----------|
| [herrbasan/nGDB](https://github.com/herrbasan/nGDB) | Service wrapper | This repo — service layer, docs, submodules |
| [herrbasan/nDB](https://github.com/herrbasan/nDB) | Document database | Rust core + N-API bindings (independent project) |
| [herrbasan/nVDB](https://github.com/herrbasan/nVDB) | Vector database | Rust core + N-API bindings (independent project) |

### Submodule Chain

```
nGDB/                          <- Service wrapper
├── ndb/                       <- submodule to nDB repo
└── nvdb/                      <- submodule to nVDB repo
```

## Current Status

- ✅ **nGDB Phases 1-5** — HTTP server, nDB proxy, nVDB proxy, WebSocket, auth, tenancy
- ✅ **nDB** — Document database with queries, indexes, file buckets
- ✅ **nVDB** — Vector database with HNSW, SIMD, filter DSL
- ⏳ **Phase 6** — Client SDKs and tooling (not started)

## Getting Started

### Running nGDB

```bash
# Clone with submodules
git clone --recursive https://github.com/herrbasan/nGDB.git
cd nGDB

# Install dependencies
npm install

# Start the server
npm start

# Test
curl http://localhost:3000/health
```

### Configuration

All config via environment variables:

```bash
PORT=3000                       # HTTP port (default: 3000)
HOST=0.0.0.0                    # Bind address
NDB_DATA_DIR=./data/ndb         # nDB storage root
NVDB_DATA_DIR=./data/nvdb       # nVDB storage root
API_KEYS=key1,key2              # Auth keys (empty = disabled)
LOCAL_AUTH_BYPASS=true          # Private IPs skip auth (default: true)
TENANT_HEADER=x-tenant-id       # Multi-tenancy header (empty = disabled)
```

### For nDB Development

1. Reference: [nDB-spec.md](./nDB-spec.md)
2. Plan: [nDB-development-plan.md](./nDB-development-plan.md)
3. Location: `ndb/` (git submodule)

### For nGDB Development

1. Reference: [nGDB-spec.md](./nGDB-spec.md)
2. Plan: [nGDB-development-plan.md](./nGDB-development-plan.md)
3. Location: `src/`

## Development Workflow

1. **Reference the specs** — Implementation details are in the spec documents
2. **Follow the dev plans** — Phased approach with clear deliverables
3. **Test integration in nGDB** — All modules together for end-to-end testing
4. **Publish independently** — Stable modules released to npm as standalone packages

---

*Last updated: 2026-03-28*
