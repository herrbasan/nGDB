# nGDB Ecosystem Documentation

> Design specifications and development plans for the n000b Database Platform

## Quick Navigation

### Specifications (Reference Documents)

| Document | Description | Status |
|----------|-------------|--------|
| [nGDB Spec](./nGDB-spec.md) | Service platform architecture | 📝 Draft |
| [nDB Spec](./nDB-spec.md) | Document database (JSON Lines) | 📝 Draft |
| nVDB Spec | Vector database (HNSW) | ✅ Complete (reference) |

### Development Plans (Execution Roadmaps)

| Document | Phases | Current Phase |
|----------|--------|---------------|
| [nGDB Development Plan](./nGDB-development-plan.md) | 5 phases | Not started |
| [nDB Development Plan](./nDB-development-plan.md) | 6 phases | Not started |

## Project Structure

```
nGDB/                          ← This repository (development workspace)
├── docs/                      ← Documentation (you are here)
│   ├── README.md              ← This file
│   ├── nGDB-spec.md           ← Service platform spec
│   ├── nDB-spec.md            ← Document database spec
│   ├── nGDB-development-plan.md
│   └── nDB-development-plan.md
├── ndb/                       ← Git submodule
└── nvdb/                      ← Git submodule
```

## Ecosystem Overview

```
Clients (Web, Mobile, MCP Agents)
           │
           ▼ HTTP/WebSocket
    ┌──────────────────┐
    │   nGDB Platform  │  ← Node.js service (this repo's src/)
    │   (unified API)  │
    └──────────────────┘
           │ uses npm packages
           ▼
    ┌──────────────────┐
    │  ndb             │
    │  nvdb            │
    └──────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
┌─────────┐  ┌─────────┐
│   nDB   │  │  nVDB   │
│(Rust)   │  │ (Rust)  │
│         │  │         │
│N-API    │  │N-API    │
│(native) │  │(native) │
└─────────┘  └─────────┘
```

## Repository Structure

### Standalone Repositories

| Repository | Purpose | Contains |
|------------|---------|----------|
| [herrbasan/nGDB](https://github.com/herrbasan/nGDB) | Development workspace | This repo - docs, submodules |
| [herrbasan/nDB](https://github.com/herrbasan/nDB) | Document database | Rust core + N-API bindings |
| [herrbasan/nVDB](https://github.com/herrbasan/nVDB) | Vector database | Rust core + N-API bindings |

### Submodule Chain

```
nGDB/                          ← Development workspace
├── ndb/                       ← submodule to nDB repo
└── nvdb/                      ← submodule to nVDB repo
```

## Current Status

- ✅ **Specifications** - All drafted and ready for reference
- ✅ **Repository structure** - Submodules imported
- ⏳ **nDB** - Ready to implement core and internal N-API
- ⏳ **nGDB** - Ready to scaffold service layer
- ✅ **nVDB** - Complete reference implementation (internal N-API needs refactoring if applicable)

## Getting Started

### For nDB Development

1. Reference: [nDB-spec.md](./nDB-spec.md)
2. Plan: [nDB-development-plan.md](./nDB-development-plan.md)
3. Location: `ndb/` (currently empty)
4. Steps:
   - Implement Rust core (Phases 1-4)
   - Build internal N-API layer (Phase 5)

### For nGDB Development

1. Reference: [nGDB-spec.md](./nGDB-spec.md)
2. Plan: [nGDB-development-plan.md](./nGDB-development-plan.md)
3. Location: `src/` (create here)
4. Depends on: nDB Phase 2+ for API integration

## Development Workflow

1. **Reference the specs** - Implementation details are in the spec documents
2. **Follow the dev plans** - Phased approach with clear deliverables
3. **Internal N-API** - Implement Node.js bindings tightly coupled inside each Rust backend
4. **Test integration in nGDB** - All modules together for end-to-end testing
5. **Publish independently** - Stable modules released to npm

---

*Last updated: 2026-03-26*
