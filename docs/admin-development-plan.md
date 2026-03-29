# nGDB Admin — Development Plan

> **Status:** Planning. Do not implement until nDB refactor stabilizes.

## Goal

A data-browser-first web admin for nGDB, served at `/admin/`. Primary use case: browse, query, insert, update, delete documents and vectors in open nDB/nVDB instances. Operations dashboard and service health are secondary context features.

**"Scrap and start fresh."** The existing `admin/` implementation is structurally misaligned with NUI's recommended patterns and has accumulated backend gaps that make core workflows non-functional.

---

## 1. Architecture

### Pattern: Hybrid (Pattern 3 from NUI docs)

- **Centralized app logic** for complex data browser pages (Databases, Documents, Vectors, Buckets) using `nui.registerFeature()`
- **Fragment-based pages** only for static read-only views (Dashboard, Settings) where fragment isolation is appropriate

**Why:** The NUI docs explicitly state that fragment-based pages (`<script type="nui/page">` with `init()`) are for isolated demos and content-heavy sites — not interactive data apps. Centralized logic allows shared state (open database handles, current selection) across views, which fragment isolation prevents.

### Project Structure

```
admin/
├── index.html              # SPA shell — unchanged from current
├── js/
│   ├── main.js             # Bootstrap: nav setup, routing, global action handlers
│   ├── api.js              # Shared API client (nDB/nVDB direct calls via window.ngdb)
│   ├── store.js            # Centralized app state (open handles, current selections)
│   └── features/           # One file per registered feature (data browser pages)
│       ├── databases.js
│       ├── documents.js
│       ├── vectors.js
│       ├── buckets.js
│       └── editor.js       # Shared document/vector edit dialog logic
└── pages/                  # Static fragment pages (Dashboard, Settings)
    ├── dashboard.html
    └── settings.html
```

### Routing

```javascript
// #feature=databases  — registered feature (centralized JS)
// #page=settings       — HTML fragment fetch
nui.enableContentLoading({ container: 'nui-main', navigation: 'nui-sidebar', basePath: 'pages', defaultPage: 'dashboard' });
nui.registerFeature('databases', handleDatabasesPage);
nui.registerFeature('documents', handleDocumentsPage);
nui.registerFeature('vectors', handleVectorsPage);
nui.registerFeature('buckets', handleBucketsPage);
```

---

## 2. NUI Component Usage

All usage must follow the [playground-component-quickstart.md](../admin/NUI/docs/playground-component-quickstart.md) patterns.

### Component Selection

| Task | NUI Component | Pattern |
|---|---|---|
| App shell | `nui-app`, `nui-sidebar`, `nui-content` | Declarative (HTML) |
| Navigation | `nui-link-list` | Data-driven: `loadData(navData)` |
| Lists (large datasets) | `nui-list` | Data-driven: `loadData({data, render, search, sort, events})` |
| Action feedback | `nui-banner` | Factory: `nui.components.banner.show({content, priority, autoClose})` |
| Confirmation dialogs | `nui-dialog` + `nui.components.dialog.confirm()` | Data-driven factory |
| Input dialogs | `nui-dialog` + `nui.components.dialog.prompt()` | Data-driven factory |
| Document editing | `nui-dialog` + `nui-code-editor` | Declarative dialog + code-editor component |
| Detail panels | `nui-card` | Declarative |
| Tabbed sections | `nui-tabs` | Declarative: `data-tab`/`data-panel` |
| Stats/overview | `nui-card` + `nui-badge` | Declarative |
| Form fields | `nui-input`, `nui-textarea`, `nui-select` | Declarative wrapping native inputs |
| Loading state | `nui-progress` | Declarative |
| Accordion sections | `nui-accordion` | Declarative: `details`/`summary` |
| Search | `nui-input` with `nui-list` built-in search | Combined declarative + data-driven |

### Components NOT to use without evaluation

- `nui-table` — evaluate if it fits the query results display before committing
- `nui-sortable` — not needed for any planned workflow
- `nui-menu` — not needed (sidebar nav covers navigation)
- `nui-rich-text` — not needed
- `nui-lightbox` — not needed (file previews out of scope initially)
- `nui-overlay` — prefer `nui-dialog` for all modal needs
- `nui-tooltip` — use sparingly, only where it adds clear value

### Key patterns to follow strictly

```javascript
// ALWAYS: Banner for async feedback
nui.components.banner.show({ content: 'Saved', priority: 'success', autoClose: 2000 });
nui.components.banner.show({ content: err.message, priority: 'danger' });

// ALWAYS: Dialog confirm/prompt for blocking actions
const confirmed = await nui.components.dialog.confirm('Delete?', 'This cannot be undone.');
if (!confirmed) return;

// NEVER: Manual string-based DOM building for list items
// ALWAYS: nui-list render function with DOM APIs or nui.util.createElement
```

---

## 3. State Management

Centralized state in `store.js`. No `window` scattering of handle/selection state.

```javascript
// store.js — shared app state
export const store = {
  // Open database instances
  ndbInstances: [],      // [{ handle, path, docCount }]
  nvdbInstances: [],     // [{ handle, path }]

  // Current selections
  currentNdbHandle: null,
  currentNvdbHandle: null,
  currentCollection: null,

  // Edit state
  editingDoc: null,      // { handle, id, doc } — null when dialog closed

  // Listeners for reactive updates
  listeners: new Set(),

  subscribe(fn) { this.listeners.add(fn); },
  notify() { this.listeners.forEach(fn => fn(this)); },
};
```

Each registered feature reads from `store` and calls `store.notify()` on mutation. No prop drilling between features needed — they share state centrally.

---

## 4. API Layer

Call nDB/nVDB directly via the same handler layer the HTTP transport uses — no separate `/admin/api/*` routes needed. The backend handlers (`src/handlers/db.js`, `src/handlers/vdb.js`) are transport-agnostic and can be called directly from the same Node.js process.

```javascript
// admin/js/api.js
// Direct imports — same process, no HTTP needed
const { instances: dbInstances } = require('../../src/handlers/db');
const { instances: vdbInstances } = require('../../src/handlers/vdb');
```

However: since the admin SPA is served as static files and loaded in a browser, it needs HTTP/WebSocket to communicate with the server. The `/admin/api/*` routes serve a real purpose as the browser client's interface to server-side state (which is different from the handler layer's in-memory instances).

**Decision:** Keep `/admin/api/*` routes but design them properly:
- Browser client calls `/admin/api/*`
- Routes proxy to handlers directly (same process, no network)
- Clean, flat URL shapes — no nested `:handle/docs/:id` patterns
- No duplication between `/db/*` and `/admin/api/*` for the same operations

### Revised Admin API design

All state (open instances, handles) lives server-side in the handler layer. The admin API surfaces a subset of operations plus aggregation/status.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/api/status` | Service health, open handle counts, connections |
| `GET` | `/admin/api/ndb` | List open nDB instances |
| `POST` | `/admin/api/ndb/open` | Open a database |
| `DELETE` | `/admin/api/ndb/:handle` | Close a database |
| `GET` | `/admin/api/ndb/:handle/docs` | List docs (paginated) |
| `POST` | `/admin/api/ndb/:handle/docs` | Insert doc |
| `GET` | `/admin/api/ndb/:handle/docs/:id` | Get single doc |
| `PUT` | `/admin/api/ndb/:handle/docs/:id` | Update doc |
| `DELETE` | `/admin/api/ndb/:handle/docs/:id` | Delete doc |
| `POST` | `/admin/api/ndb/:handle/query` | Query with AST |
| `GET` | `/admin/api/ndb/:handle/indexes` | List indexes |
| `GET` | `/admin/api/ndb/:handle/buckets` | List bucket names |
| `GET` | `/admin/api/ndb/:handle/buckets/:bucket` | List files in bucket |
| `POST` | `/admin/api/ndb/:handle/buckets/:bucket` | Upload file (binary) |
| `DELETE` | `/admin/api/ndb/:handle/buckets/:bucket/:hash` | Delete file |
| `GET` | `/admin/api/nvdb` | List open nVDB instances |
| `POST` | `/admin/api/nvdb/open` | Open a vector DB |
| `DELETE` | `/admin/api/nvdb/:handle` | Close a vector DB |
| `GET` | `/admin/api/nvdb/:handle/collections` | List collections with stats |
| `POST` | `/admin/api/nvdb/:handle/collections` | Create collection |
| `GET` | `/admin/api/nvdb/:handle/collections/:name` | Collection details |
| `POST` | `/admin/api/nvdb/:handle/collections/:name/search` | Vector search |
| `POST` | `/admin/api/nvdb/:handle/collections/:name/flush` | Flush |
| `POST` | `/admin/api/nvdb/:handle/collections/:name/compact` | Compact |

**Key changes from current:**
- `POST /ndb/open` instead of `POST /ndb/instances`
- Flat `:handle` at top level, no nested `:handle/docs/:id`
- Binary file upload on `POST /ndb/:handle/buckets/:bucket` (see Binary Protocol below)

---

## 5. Binary File Protocol (Separate Protocol Concern)

Base64 encoding for file upload/download is messy and inefficient. This is a protocol-level concern that affects both the admin UI and the general HTTP/WebSocket transport.

**This plan does not define the binary protocol.** It requires a separate design doc covering:

1. **HTTP:** Multipart form upload, `Content-Type: application/octet-stream` with `Content-Length`, or a `Transfer-Encoding: binary` variant
2. **WebSocket:** A binary frame type (0x02?) distinct from the JSON text frame (0x01) currently used
3. **Admin API:** How to upload a file from the browser (File API → binary fetch) and download (fetch → Blob → URL.createObjectURL)

**Deferred.** When the binary protocol is designed, the Buckets feature will be implemented using it. Until then, bucket upload/download is out of scope.

---

## 6. Page Designs

### 6.1 Dashboard (`pages/dashboard.html` — fragment)

Read-only health overview. Fragment-based is appropriate here — no shared state, no complex interactivity.

- 4 stat cards: Service status, nDB instances, nVDB instances, WS connections
- Quick actions: Open nDB, Open nVDB (buttons that navigate to `#feature=databases` / `#feature=vectors`)
- Backend status accordion
- Auto-refresh every 10s, pause on page hide

### 6.2 Databases (`features/databases.js` — registered feature)

Primary data browser for nDB.

```
┌─ Sidebar ─┬─ Main Content ──────────────────────────────────┐
│ Dashboard  │                                              │
│ > Databases │  Databases                    [+ Open]        │
│   Documents │  ─────────────────────────────────────────     │
│   Vectors   │  [Search...]                Sort: [Handle ▾] │
│   Buckets   │  ┌────────────────────────────────────────┐   │
│   Settings  │  │ ● handle-abc123  /path/mydb  1,240 ⎘ │   │
│             │  │ ● handle-def456  /path/test     42 ⎘  │   │
│             │  └────────────────────────────────────────┘   │
│             │                                              │
│             │  Database handle-abc123                      │
│             │  Path: /path/mydb   Docs: 1,240              │
│             │  [Flush] [Compact] [Close]                  │
│             │  ─────────────────────────────────────────    │
│             │  Tabs: [Documents] [Indexes] [Actions]       │
└─────────────┴──────────────────────────────────────────────┘
```

- Left: `nui-list` of open instances (path, docCount badge)
- Right: detail panel with tabs
- Documents tab: navigate to `#feature=documents&handle=xxx`
- Indexes tab: `nui-accordion` listing index fields + types
- Actions tab: Flush, Compact, Close buttons

### 6.3 Documents (`features/documents.js` — registered feature)

Document browser for the selected nDB handle. The handle comes from URL params (`#feature=documents&handle=abc123`) and is the single source of truth.

```
┌─ Documents ─────────────────────────────────────────────────┐
│  [+ Insert]  [Delete Selected]     [Query ▾]               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🔍 Search...                                         │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ ● doc-id-001  {"name":"Alice","age":30}        [✎] │    │
│  │ ● doc-id-002  {"name":"Bob","age":25}          [✎] │    │
│  └─────────────────────────────────────────────────────┘    │
│  Total: 1,240                             [◀ Prev] [Next ▶]  │
└─────────────────────────────────────────────────────────────┘
```

- `nui-list` with search and sort — virtualized for large doc sets
- Row: ID badge + truncated JSON preview + Edit button
- Edit → opens `nui-dialog` with `nui-code-editor` (JSON mode)
- Insert → same dialog with empty editor
- Query panel → collapsible `nui-accordion` with `nui-textarea` for AST + Run button, results replace list
- Pagination: `nui-list` footer with prev/next

**Editor dialog** (shared with Buckets, in `features/editor.js`):
- `nui-dialog` with `nui-code-editor`
- Title: "Edit Document" or "Insert Document"
- JSON validation on Save attempt — banner on parse error
- Save calls PUT or POST accordingly

### 6.4 Vectors (`features/vectors.js` — registered feature)

Vector database browser with search.

```
┌─ Vectors ──────────────────────────────────────────────────┐
│  [+ Open nVDB]                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ● vdb-abc123  /path/vectors                    [▶] │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                            │
│  Collections in vdb-abc123                                 │
│  ┌──────────────┐ ┌──────────────┐                         │
│  │ embeddings   │ │  metadata    │                         │
│  │ dim: 768     │ │  dim: 128    │                         │
│  │ docs: 12,440 │ │  docs: 890   │                         │
│  │ segments: 3  │ │  segments: 1 │                         │
│  │ [Flush][⛁]  │ │  [Flush][⛁]  │                         │
│  └──────────────┘ └──────────────┘                         │
│                                                            │
│  Search: [embeddings ▾]  [0.1, 0.2, ...        ] [K: 10]  │
│  [Cosine ▾]                                        [Search] │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ id-001  score: 0.934  {"text":"hello"}              │    │
│  │ id-002  score: 0.891  {"text":"world"}              │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

- Instance list → click to expand collection grid
- Collection cards: stats, index status badge, Flush/Rebuild-Index buttons
- Search bar: collection select, vector textarea, topK slider, distance select
- Results: simple list with ID, score badge, payload preview
- Vector input: comma-separated floats in `nui-textarea`; "Random" helper button for testing

### 6.5 Buckets (`features/buckets.js` — registered feature, deferred)

Deferred until binary protocol is designed. Out of scope for initial version.

### 6.6 Settings (`pages/settings.html` — fragment)

Read-only config display. Fragment-based is appropriate.

- Accordion sections: Server, Auth, Data Dirs, Multi-tenancy
- Runtime info: connections, subscriptions, instance counts
- Refresh button

---

## 7. Backend Fixes Required

Before the admin frontend can work, these backend gaps must be filled. They are in `src/handlers/admin.js`:

| Issue | Fix |
|---|---|
| No `POST /ndb/open` | Add open handler using `Database.open()` |
| No `DELETE /ndb/:handle` | Add close handler using `db.close()` |
| No `POST /nvdb/open` | Add open handler using `nvdb.open()` |
| No `DELETE /nvdb/:handle` | Add close handler |
| `ndbInstanceIndexes` returns `[]` | Call actual nDB index introspection |
| `ndbInstanceBuckets` returns `[]` | Iterate bucket directory |
| Bucket store/delete not wired | Wire to `db.bucket.storeFile()` / `deleteFile()` |
| No pagination on doc listing | Add `limit`/`offset` to `ndbInstanceDocs` |

---

## 8. Implementation Order

### Phase 1: Backend completeness
1. Implement `POST /admin/api/ndb/open` and `DELETE /admin/api/ndb/:handle`
2. Implement `POST /admin/api/nvdb/open` and `DELETE /admin/api/nvdb/:handle`
3. Fix `ndbInstanceIndexes` to return real data
4. Add pagination to doc listing
5. Fix bucket handlers (store/list/delete)

### Phase 2: Shell and routing
1. Refactor `admin/js/main.js` to use centralized pattern: `nui.registerFeature()` for databases, documents, vectors, buckets
2. Move nav data, api client, store to separate files
3. Remove `<script type="nui/page">` from all data browser pages
4. Set up shared action handling in main.js

### Phase 3: Dashboard + Settings
1. Rewrite dashboard as fragment-based SPA page
2. Rewrite settings as fragment-based SPA page
3. Verify health badge polling and quick actions

### Phase 4: Databases feature
1. Implement `databases.js` registered feature
2. List open instances in `nui-list`
3. Instance detail panel with tabs
4. Open/close/flush/compact actions wired to API

### Phase 5: Documents feature
1. Implement `documents.js` registered feature
2. DB selector wired to store
3. `nui-list` for doc browsing with search/sort
4. Editor dialog with `nui-code-editor`
5. Query panel with AST textarea

### Phase 6: Vectors feature
1. Implement `vectors.js` registered feature
2. Instance → collection grid flow
3. Search interface with vector textarea, topK, distance
4. Collection maintenance actions

### Phase 7: Buckets feature (deferred)
- Deferred until binary protocol decision

---

## 9. Principles

1. **Centralized logic for interactive features, fragments for static pages.** Don't force everything into fragment pages.
2. **Data-driven components for dynamic content.** Use `nui-list.loadData()`, not manual HTML string concatenation.
3. **Factory APIs for ephemeral UI.** `nui.components.dialog.confirm()`, `nui.components.banner.show()` — don't reinvent these.
4. **Minimal custom styling.** If NUI components can achieve the layout, use them. CSS overrides should be rare and scoped.
5. **Server-side state, not client-side.** Handles, instances, and live data live on the server. The client reflects it via API calls.
6. **No polling where WebSocket subscriptions can replace it.** Once WS subscriptions are in place for doc changes, the documents list should update reactively rather than polling.
