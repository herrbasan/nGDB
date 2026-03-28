# nGDB Development Plan

> Service wrapper development roadmap — proxy architecture

**Reference:** [nGDB Specification](./nGDB-spec.md)

---

## Core Development Maxims
- **Priorities:** Reliability > Performance > Everything else.
- **LLM-Native Codebase:** Code readability and structure for *humans* is a non-goal. The code will not be maintained by humans. Optimize for the most efficient structure an LLM can understand. Do not rely on conventional human coding habits.
- **Vanilla JS:** No TypeScript anywhere. Code must stay as close to the bare platform as possible for easy optimization and debugging.
- **Vanilla Node.js HTTP server:** No Express/Fastify. Build it ourselves using raw standard libraries. Avoid external third-party packages.
- **Fail Fast, Always:** No defensive coding. No mock data, no fallback defaults, and no silencing `try/catch` blocks. The goal is to write perfect, deterministic software. When it breaks, let it crash and fix the root cause.
- **Proxy, Don't Translate:** nGDB is a thin wrapper. Each route maps directly to the module's native API. No ORM, no query translation, no abstraction layers.
- **Shared Handlers:** HTTP and WebSocket use the same transport-agnostic handler code. Handlers receive params, return results. Transports are thin adapters.

---

## Phase 1: Foundation ✅
**Goal:** Vanilla HTTP server with nDB proxy routes

- [x] **Setup project structure** ([nGDB-spec §Architecture](./nGDB-spec.md#architecture))
  - Vanilla Node.js HTTP server skeleton
  - Environment config (port, auth, etc.)
  - Shared handler pattern: transport-agnostic handlers + HTTP/WS adapters

- [x] **nDB proxy routes** ([nGDB-spec §nDB Routes](./nGDB-spec.md#nbd-routes----db))
  - Import `ndb` from local submodule
  - Transport-agnostic handlers: `insert()`, `get()`, `open()`, `close()`
  - HTTP adapter: `/db/:action` routes
  - Health check endpoint

- [x] **Testing setup**
  - Integration tests against live HTTP server
  - ~~CI workflow (GitHub Actions)~~

**Deliverable:** `curl http://localhost:3000/health` returns OK with nDB connected

---

## Phase 2: Document API ✅
**Goal:** Complete nDB proxy surface

- [x] **CRUD proxy routes** ([nGDB-spec §nDB Routes](./nGDB-spec.md#nbd-routes----db))
  - `/db/update` - update document
  - `/db/delete` - delete document
  - `/db/query` - query passthrough
  - `/db/queryWith` - query with sort/limit/offset
  - `/db/find` - find by field value
  - `/db/findRange` - find by field range
  - `/db/insertWithPrefix` - insert with prefixed ID
  - `/db/openInMemory` - open in-memory database
  - `/db/restore` - restore soft-deleted document
  - `/db/deletedIds` - list soft-deleted IDs
  - `/db/isEmpty` - check if database is empty
  - `/db/compact` - compact database
  - `/db/createBTreeIndex` - create BTree index
  - `/db/hasIndex` - check if index exists

- [x] **File bucket proxy**
  - `/db/bucket/storeFile` - store file in bucket
  - `/db/bucket/getFile` - get file from bucket
  - `/db/bucket/deleteFile` - delete file from bucket
  - `/db/bucket/listFiles` - list files in bucket

**Deliverable:** Full nDB API testable via HTTP client

---

## Phase 3: Real-Time ✅
**Goal:** WebSocket support for live updates

- [x] **WebSocket server** ([nGDB-spec §WebSocket API](./nGDB-spec.md#websocket-api))
  - Native Node.js WebSocket integration (zero-dependency)
  - WS adapter reusing same handlers as HTTP
  - Connection management

- [x] **Subscriptions**
  - Subscribe to nDB collection changes
  - Filter-based subscriptions
  - Broadcast updates

**Deliverable:** Client can subscribe and receive real-time doc updates

---

## Phase 4: Production Features
**Goal:** Auth, multi-tenancy

- [x] **Authentication** ([nGDB-spec §Authentication](./nGDB-spec.md#authentication-and-security))
  - Simple API key middleware (no JWT)
  - Local network (private IP range) bypasses auth entirely
  - API key passed via `Authorization: Bearer <key>` header or `?apiKey=` query param

- [x] **Multi-tenancy** ([nGDB-spec §Tenant Isolation](./nGDB-spec.md#tenant-isolation))
  - Tenant header extraction
  - Isolated data paths per tenant

**Deliverable:** Production-ready service with auth and multi-tenancy

---

## Phase 5: Vector Support ✅
**Goal:** nVDB proxy routes

- [x] **nVDB proxy routes** ([nGDB-spec §nVDB Routes](./nGDB-spec.md#nvdb-routes----vdb))
  - `/vdb/open` - open vector database
  - `/vdb/close` - close vector database
  - `/vdb/createCollection` - create collection with dimension
  - `/vdb/getCollection` - get collection info
  - `/vdb/listCollections` - list all collections
  - `/vdb/insert` - insert vector document
  - `/vdb/insertBatch` - batch insert vector documents
  - `/vdb/get` - get vector document by ID
  - `/vdb/search` - similarity search (exact + HNSW)
  - `/vdb/delete` - delete vector document
  - `/vdb/flush` - flush collection to disk
  - `/vdb/sync` - force WAL sync
  - `/vdb/compact` - compact segments
  - `/vdb/rebuildIndex` - build HNSW index
  - `/vdb/deleteIndex` - delete HNSW index
  - `/vdb/hasIndex` - check if HNSW index exists

- [x] **WebSocket support for vdb**
  - `backend: 'vdb'` field in WS messages routes to vdb handlers
  - Same handler pattern as nDB

- [x] **Health check updated**
  - `/health` now reports both `ndb` and `nvdb` backend status

**Deliverable:** Full platform with both document and vector proxy routes

---

## Phase 6: Ecosystem
**Goal:** Client SDKs and tooling

- [ ] **JavaScript client SDK**
  - Vanilla JS client library (no TypeScript)

- [ ] **Admin dashboard**
  - Basic web UI for monitoring

**Deliverable:** Complete ecosystem

---

## Dependencies

| Phase | Blocked By |
|-------|------------|
| 1 | nDB working core + Node.js bindings |
| 2 | nDB query API |
| 3 | Phase 1 |
| 4 | Phase 1 |
| 5 | nVDB working core + Node.js bindings |
| 6 | Phases 1-5 |
