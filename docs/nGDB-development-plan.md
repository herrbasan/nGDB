# nGDB Development Plan

> Service platform development roadmap

**Reference:** [nGDB Specification](./nGDB-spec.md)

---

## Core Development Maxims
- **Priorities:** Reliability > Performance > Everything else.
- **LLM-Native Codebase:** Code readability and structure for *humans* is a non-goal. The code will not be maintained by humans. Optimize for the most efficient structure an LLM can understand. Do not rely on conventional human coding habits.
- **Vanilla JS:** No TypeScript anywhere. Code must stay as close to the bare platform as possible for easy optimization and debugging.
- **Vanilla Node.js HTTP server skeleton (no Express/Fastify)build it ourselves using raw standard libraries, we build it. Avoid external third-party packages.
- **Fail Fast, Always:** No defensive coding. No mock data, no fallback defaults, and no silencing `try/catch` blocks. The goal is to write perfect, deterministic software. When it breaks, let it crash and fix the root cause.

---

## Phase 1: Foundation
**Goal:** Basic HTTP server with nDB integration

- [ ] **Setup project structure** ([nGDB-spec §Architecture](./nGDB-spec.md#architecture))
  - Express/Fastify server skeleton
  - Environment config (port, auth, etc.)
  - Docker compose for local dev

- [ ] **nDB integration** ([nGDB-spec §Backend Registration](./nGDB-spec.md#backend-registration))
  - Import `ndb` from local submodule
  - Basic database lifecycle (open/close)
  - Health check endpoint

- [ ] **Core REST endpoints** ([nGDB-spec §REST Endpoints](./nGDB-spec.md#rest-endpoints))
  - `GET /health`
  - `GET /collections` - list
  - `POST /collections/:name/docs` - insert
  - `GET /collections/:name/docs/:id` - get

- [ ] **Testing setup**
  - Integration tests with supertest
  - CI workflow (GitHub Actions)

**Deliverable:** `curl http://localhost:3000/health` returns OK with nDB connected

---

## Phase 2: Document API
**Goal:** Complete nDB REST API surface

- [ ] **CRUD operations** ([nDB-spec §Core Methods](./nDB-spec.md#api-reference))
  - `PUT /collections/:name/docs/:id` - update
  - `DELETE /collections/:name/docs/:id` - delete
  - `POST /collections/:name/query` - query with filters

- [ ] **Query builder translation** ([nGDB-spec §Query Language](./nGDB-spec.md#query-language))
  - Parse JSON query DSL
  - Map to nDB Layer 2/3 APIs
  - Pagination support

- [ ] **File uploads** ([nDB-spec §File Buckets](./nDB-spec.md#file-buckets---binary-storage))
  - Multipart upload endpoint
  - File serving endpoint
  - Bucket management

**Deliverable:** Full CRUD API testable via HTTP client

---

## Phase 3: Real-Time
**Goal:** WebSocket support for live updates

- [ ] **WebSocket server** ([nGDB-spec §WebSocket API](./nGDB-spec.md#websocket-api))
  - Native Node.js WebSocket integration (zero-dependency)
  - Connection management

- [ ] **Subscriptions** ([nGDB-spec §Events](./nGDB-spec.md#events))
  - Subscribe to collection changes
  - Filter-based subscriptions
  - Broadcast updates

**Deliverable:** Client can subscribe and receive real-time doc updates

---

## Phase 4: Production Features
**Goal:** Auth, multi-tenancy, monitoring

- [ ] **Authentication** ([nGDB-spec §Authentication & Security](./nGDB-spec.md#authentication--security))
  - JWT middleware
  - API key support

- [ ] **Multi-tenancy** ([nGDB-spec §Tenant Isolation](./nGDB-spec.md#tenant-isolation))
  - Tenant header extraction
  - Isolated data paths

- [ ] **Observability** ([nGDB-spec §Monitoring](./nGDB-spec.md#monitoring--observability))
  - Prometheus metrics endpoint
  - Structured logging

**Deliverable:** Production-ready service with auth and monitoring

---

## Phase 5: Ecosystem
**Goal:** nVDB integration and client SDKs

- [ ] **nVDB backend** ([nGDB-spec §Backend Registration](./nGDB-spec.md#backend-registration))
  - Vector collection type detection
  - Search endpoint mapping

- [ ] **JavaScript client SDK** ([nGDB-spec §JavaScript/TypeScript](./nGDB-spec.md#javascripttypescript-ngdb-client))
  - Vanilla JS client library (no TypeScript)
  - Published to npm

**Deliverable:** Full platform with both document and vector support

---

## Dependencies

| Phase | Blocked By |
|-------|------------|
| 1 | nDB Phase 1+2 (working core) |
| 2 | nDB Phase 3+4 (query API) |
| 3 | - |
| 4 | - |
| 5 | nVDB integrated natively |
