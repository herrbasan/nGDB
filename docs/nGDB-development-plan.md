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
  - Vanilla Node.js HTTP server skeleton (`src/server.js`)
  - Environment-driven config (`src/config.js`) — no YAML, pure `process.env`
  - Shared handler pattern: transport-agnostic handlers + HTTP adapter

- [x] **nDB proxy routes** ([nGDB-spec §nDB Routes](./nGDB-spec.md#nbd-routes----db))
  - Import `ndb` from local submodule
  - Transport-agnostic handlers: `open()`, `close()`, `insert()`, `get()`
  - HTTP adapter: `/db/:action` routes
  - Health check endpoint (`/health`)

- [x] **Testing setup**
  - Integration tests against live HTTP server (`tests/phase1_test.js`)
  - No test frameworks — plain Node.js assertions

**Deliverable:** `curl http://localhost:3000/health` returns OK with nDB connected

---

## Phase 2: Document API ✅
**Goal:** Complete nDB proxy surface

- [x] **CRUD proxy routes** ([nGDB-spec §nDB Routes](./nGDB-spec.md#nbd-routes----db))
  - `/db/update` — update document
  - `/db/delete` — delete document
  - `/db/query` — query with AST filter
  - `/db/queryWith` — query with sort/limit/offset
  - `/db/find` — find by field value
  - `/db/findRange` — find by field range
  - `/db/iter` — iterate all documents
  - `/db/len` — document count
  - `/db/contains` — check if ID exists
  - `/db/insertWithPrefix` — insert with prefixed ID
  - `/db/openInMemory` — open in-memory database
  - `/db/restore` — restore soft-deleted document
  - `/db/deletedIds` — list soft-deleted IDs
  - `/db/isEmpty` — check if database is empty
  - `/db/compact` — compact database
  - `/db/flush` — flush to disk
  - `/db/createIndex` — create hash index
  - `/db/createBTreeIndex` — create BTree index
  - `/db/dropIndex` — drop index
  - `/db/hasIndex` — check if index exists

- [x] **File bucket proxy** ([nGDB-spec §File Bucket Operations](./nGDB-spec.md#file-bucket-operations----dbbucket))
  - `/db/bucket/storeFile` — store file in bucket (base64-encoded)
  - `/db/bucket/getFile` — get file from bucket (base64-encoded)
  - `/db/bucket/deleteFile` — delete file from bucket
  - `/db/bucket/listFiles` — list files in bucket

**Deliverable:** Full nDB API testable via HTTP client

---

## Phase 3: Real-Time ✅
**Goal:** WebSocket support for live updates

- [x] **WebSocket server** ([nGDB-spec §WebSocket API](./nGDB-spec.md#websocket-api))
  - Zero-dependency RFC 6455 WebSocket implementation (`src/transports/ws.js`)
  - Frame parsing, masking/unmasking, ping/pong, close handling
  - WS adapter reusing same handlers as HTTP (`src/ws.js`)

- [x] **Subscriptions**
  - Subscribe to collection changes with optional filters
  - Broadcast mutations to subscribers (insert, update, delete, storeFile, deleteFile)
  - No echo (don't broadcast back to originating connection)
  - Auto-cleanup on disconnect

**Deliverable:** Client can subscribe and receive real-time doc updates

---

## Phase 4: Production Features ✅
**Goal:** Auth, multi-tenancy

- [x] **Authentication** ([nGDB-spec §Authentication](./nGDB-spec.md#authentication))
  - Simple API key middleware (`src/middleware/auth.js`)
  - `Authorization: Bearer <key>` header or `?apiKey=<key>` query param
  - Local network (private IP range) bypasses auth entirely
  - No JWT — static key check only

- [x] **Multi-tenancy** ([nGDB-spec §Multi-Tenancy](./nGDB-spec.md#multi-tenancy))
  - Tenant header extraction (`src/middleware/tenancy.js`)
  - Isolated data paths per tenant (`{dataDir}/tenants/{tenantId}/`)
  - Tenant ID validation (alphanumeric, dash, underscore)
  - Works for both HTTP and WebSocket transports

**Deliverable:** Production-ready service with auth and multi-tenancy

---

## Phase 5: Vector Support ✅
**Goal:** nVDB proxy routes

- [x] **nVDB proxy routes** ([nGDB-spec §nVDB Routes](./nGDB-spec.md#nvdb-routes----vdb))
  - `/vdb/open` — open vector database
  - `/vdb/close` — close vector database
  - `/vdb/createCollection` — create collection with dimension
  - `/vdb/getCollection` — get collection info (config + stats)
  - `/vdb/listCollections` — list all collections
  - `/vdb/insert` — insert vector document
  - `/vdb/insertBatch` — batch insert vector documents
  - `/vdb/get` — get vector document by ID
  - `/vdb/search` — similarity search (exact + HNSW, with filter support)
  - `/vdb/delete` — delete vector document
  - `/vdb/flush` — flush collection to disk
  - `/vdb/sync` — force WAL sync
  - `/vdb/compact` — compact segments
  - `/vdb/rebuildIndex` — build HNSW index
  - `/vdb/deleteIndex` — delete HNSW index
  - `/vdb/hasIndex` — check if HNSW index exists

- [x] **Collection caching**
  - nVDB collections are locked when opened; caching avoids re-locking
  - Cache keyed by `handle::collectionName`
  - Auto-cleanup on database close

- [x] **WebSocket support for vdb**
  - `backend: 'vdb'` field in WS messages routes to vdb handlers
  - Same handler pattern as nDB

- [x] **Health check updated**
  - `/health` reports both `ndb` and `nvdb` backend status

**Deliverable:** Full platform with both document and vector proxy routes

---

## Phase 6: Ecosystem
**Goal:** Client SDKs and tooling

- [ ] **JavaScript client SDK**
  - Vanilla JS client library (no TypeScript)
  - HTTP client with handle management
  - WebSocket client with subscription helpers

**Deliverable:** Complete ecosystem

---

## Phase 7: Web Admin Interface
**Goal:** Full admin dashboard using nui_wc2 component library

**Reference:** [nGDB Spec §Web Admin Interface](./nGDB-spec.md#web-admin-interface)

- [x] **Admin infrastructure** ([nGDB-spec §Static File Serving](./nGDB-spec.md#static-file-serving))
  - [x] Add nui_wc2 as git submodule under `admin/NUI/`
  - [x] Static file serving in `src/transports/http.js` for `/admin/*` routes
  - [x] Admin config flags: `ADMIN_ENABLED`, `ADMIN_PATH` in `src/config.js`
  - [x] Admin API routes under `/admin/api/*` with auth gating
  - [x] MIME type detection for HTML, CSS, JS, SVG, JSON

- [x] **SPA shell** ([nGDB-spec §Architecture](./nGDB-spec.md#architecture-1))
  - [x] `admin/index.html` — nui-app layout with header, sidebar, content
  - [x] `admin/js/main.js` — bootstrap, routing via `nui.enableContentLoading()`, action delegation
  - [x] Sidebar navigation using `nui-link-list` (fold mode)
  - [x] Theme toggle (light/dark) via `data-action` pattern
  - [x] FOUC prevention with `nui-loading` bar

- [x] **Dashboard page** (`admin/pages/dashboard.html`)
  - [x] Service health card with backend status using `nui-card`
  - [x] Connection count, subscription count using `nui-badge`
  - [x] Uptime and version display
  - [x] Quick actions: open database, create collection via `nui-dialog`

- [x] **Databases page** (`admin/pages/databases.html`)
  - [x] Virtualized list of open nDB instances using `nui-list`
  - [x] Search by path, sort by doc count/size
  - [x] Instance detail panel: document count, indexes, buckets
  - [x] Actions: open, close, compact, flush via `nui-button` + `nui-dialog`
  - [x] Bulk actions via `nui-list` footer buttons

- [x] **Documents page** (`admin/pages/documents.html`)
  - [x] Virtualized document browser using `nui-list` with multi-field search
  - [x] Sort by ID, filter by soft-deleted status using `nui-list` filters
  - [x] JSON document viewer/editor using `nui-code-editor`
  - [x] CRUD operations via `nui-dialog` modals
  - [x] AST query builder with `nui-textarea`
  - [x] Selection-based bulk delete via footer buttons

- [x] **Vectors page** (`admin/pages/vectors.html`)
  - [x] Virtualized list of nVDB instances using `nui-list`
  - [x] Collection browser with stats (doc count, segment count, index status)
  - [x] Search interface: vector input, topK `nui-slider`, distance metric `nui-select`
  - [x] Collection maintenance: flush, compact, rebuild index via `nui-button`
  - [x] Collection config details in `nui-accordion`

- [x] **Buckets page** (`admin/pages/buckets.html`)
  - [x] File bucket browser using `nui-list` with lazy loading for thumbnails
  - [x] File metadata display (hash, name, MIME type, size)
  - [x] Upload via `nui-dialog`, delete with `nui.components.dialog.confirm()`
  - [x] File preview using `nui-lightbox`

- [x] **Settings page** (`admin/pages/settings.html`)
  - [x] Configuration overview (read-only) using `nui-accordion`
  - [x] API key management (add/remove)
  - [x] Data directory paths display
  - [x] Service restart/shutdown controls (if applicable)

- [x] **Admin API handlers** (`src/handlers/admin.js`)
  - [x] `/admin/api/status` — aggregated service status
  - [x] `/admin/api/ndb/instances` — CRUD for nDB instances
  - [x] `/admin/api/ndb/instances/:handle/docs` — document listing with pagination
  - [x] `/admin/api/ndb/instances/:handle/docs/:id` — single document get/update/delete
  - [x] `/admin/api/ndb/instances/:handle/indexes` — index listing
  - [x] `/admin/api/ndb/instances/:handle/buckets` — bucket listing
  - [x] `/admin/api/nvdb/instances` — CRUD for nVDB instances
  - [x] `/admin/api/nvdb/instances/:handle/collections` — collection listing with stats
  - [x] `/admin/api/nvdb/instances/:handle/collections/:name/search` — vector search proxy

- [ ] **Runtime verification & fixes**
  - [ ] Resolve nui_wc2 submodule path issue — library files are at `admin/NUI/NUI/` due to repo structure; consider restructuring or adding a build/copy step
  - [ ] End-to-end browser test of all admin pages against live nGDB server
  - [ ] Verify all nui_wc2 component APIs match current library version (dialog, list, select, code-editor, etc.)
  - [ ] Fix any remaining CSS/JS resource 404 errors

- [ ] **Testing**
  - [ ] Integration tests for admin API routes (`tests/phase7_test.js`)
  - [ ] Verify static file serving (HTML, CSS, JS, SVG)
  - [ ] Verify auth gating on admin API (unauthenticated requests rejected)
  - [ ] Verify admin disabled when `ADMIN_ENABLED=false` (all `/admin/*` return 404)

**Deliverable:** Full web admin interface for managing nGDB databases, documents, vectors, and file buckets

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
| 7 | Phases 1-5, nui_wc2 library |
