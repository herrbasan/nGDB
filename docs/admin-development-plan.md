# nGDB Admin — Development Plan

> **Status:** Phase 5 In Progress — WebAdmin UI Redesign

## Goal

A data-browser-first web admin for nGDB, served at `/admin/`. Primary use case: browse, query, insert, update, delete documents and vectors in nDB/nVDB instances. The admin interfaces with the existing nDB/nVDB API endpoints.

**Key Design Principle:** Databases are auto-discovered on server startup. The nDB exposes the full list of all discoverable databases (both loaded and unloaded) so the Admin interface can enable/load or disable/unload them. The sidebar dynamically lists all available databases. Users click a database to browse it directly.

---

## 1. Architecture

### Pattern: Hybrid (Pattern 3 from NUI docs)

- **Centralized app logic** for complex data browser pages using `nui.registerFeature()`
- **Fragment-based pages** only for static read-only views (Dashboard, Settings)
- **Dynamic sidebar navigation** that lists all databases and updates automatically

### Project Structure

```
admin/
├── index.html              # SPA shell
├── css/
│   └── admin.css           # Shared admin styles (stat-grid, db-card, json-viewer, utilities)
├── js/
│   ├── main.js             # Bootstrap, dynamic nav, routing, feature registration
│   ├── api.js              # API client for /admin/api/* endpoints
│   ├── store.js            # Centralized reactive state
│   └── features/
│       ├── databases.js    # Database management (all DBs with load/unload)
│       ├── documents.js    # Document browser with JSON viewer
│       ├── buckets.js      # File bucket browser
│       └── vectors.js      # Vector DB browser
└── pages/
    ├── dashboard.html      # Dashboard with system metrics + per-DB breakdown
    └── settings.html       # Server configuration and runtime info
```

### Routing

```javascript
// Hash-based routing
#page=dashboard             → Load pages/dashboard.html fragment
#feature=databases          → Database management page
#feature=documents&handle=xxx → Document browser for a specific DB
#feature=vectors            → Vector DB browser
#action=open-ndb           → Show open database dialog
```

---

## 2. Navigation Design

### Sidebar Structure

```
Overview
  └── Dashboard

nDB Databases
  ├── 🟢 db-name-1 (1240 docs)  ← loaded, click to browse
  ├── 🔴 db-name-2 (42 docs)    ← unloaded, click to load
  └── 🟢 db-name-3 (0 docs)     ← loaded, click to browse

nVDB Vector DBs
  ├── + Open Vector DB...
  └── ● vdb-abc123

System
  └── Settings
```

The sidebar is **dynamic**:
- Fetches all databases via `GET /admin/api/ndb` (includes loaded/unloaded status)
- Shows loaded databases with green indicator, unloaded with red
- Clicking an unloaded database loads it; clicking a loaded one browses it
- Updates after load/unload operations

---

## 3. Backend Changes

### Database Discovery & Lifecycle

The server auto-discovers all database files on startup but does **not** auto-open them all. Instead:

1. **Discovery** — `scanForDatabases()` finds all `*.jsonl` files in the data directory
2. **Default persistence mode** — Databases are loaded in the persistence mode defined by their configuration (default: auto-load all)
3. **Admin control** — The Admin UI can load/unload individual databases at runtime

```javascript
// src/handlers/db.js
// Discovery runs on startup, returns metadata for all found databases
// Loading (opening) is separate from discovery
async function autoOpenDatabases() {
  // Scan ./data/ndb/ for *.jsonl files
  // Open each one automatically (default behavior)
  // Return count of opened databases
}
```

### Admin API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/status` | Service health |
| **GET** | **`/admin/api/ndb`** | **List ALL databases (loaded + unloaded) with status + trash metadata** |
| **GET** | **`/admin/api/ndb/available`** | **List only unloaded/available databases** |
| POST | `/admin/api/ndb/open` | Open a database by path (manual) |
| **POST** | **`/admin/api/ndb/load`** | **Load a discovered database by path** |
| **POST** | **`/admin/api/ndb/:handle/unload`** | **Unload a loaded database (flush + close)** |
| DELETE | `/admin/api/ndb/:handle` | Close a database (legacy, same as unload) |
| GET | `/admin/api/ndb/:handle/docs` | List documents (paginated) |
| GET | `/admin/api/ndb/:handle/docs/:id` | Get single document |
| POST | `/admin/api/ndb/:handle/docs` | Insert document |
| PUT | `/admin/api/ndb/:handle/docs/:id` | Update document |
| DELETE | `/admin/api/ndb/:handle/docs/:id` | Delete document |
| **GET** | **`/admin/api/ndb/:handle/trash`** | **List trashed documents (auto-compacts first)** |
| **POST** | **`/admin/api/ndb/:handle/trash/:id/restore`** | **Restore a trashed document** |
| **DELETE** | **`/admin/api/ndb/:handle/trash/:id`** | **Permanently delete a trashed document** |
| **DELETE** | **`/admin/api/ndb/:handle/trash`** | **Purge all trash** |
| GET | `/admin/api/ndb/:handle/buckets` | List buckets (with file count, trash count, size) |
| GET | `/admin/api/ndb/:handle/buckets/:bucket/files` | List files in a bucket |
| POST | `/admin/api/ndb/:handle/buckets/:bucket/files` | Store file in bucket |
| DELETE | `/admin/api/ndb/:handle/buckets/:bucket/files/:hash/:ext` | Delete file from bucket |
| **GET** | **`/admin/api/ndb/:handle/buckets/:bucket/trash`** | **List trashed files in bucket** |
| **POST** | **`/admin/api/ndb/:handle/buckets/:bucket/trash/:hash/:ext/restore`** | **Restore a trashed file** |
| **DELETE** | **`/admin/api/ndb/:handle/buckets/:bucket/trash/:hash/:ext`** | **Permanently delete a trashed file** |
| **DELETE** | **`/admin/api/ndb/:handle/buckets/:bucket/trash`** | **Purge all bucket trash** |
| GET | `/admin/api/nvdb` | List open nVDB instances |
| POST | `/admin/api/nvdb/open` | Open a vector DB |
| DELETE | `/admin/api/nvdb/:handle` | Close a vector DB |

### `GET /admin/api/ndb` Response Format

The enhanced endpoint returns **all** databases with their load status and trash metadata:

```json
{
  "databases": [
    {
      "name": "ngdb-countries",
      "path": "./data/ndb/ngdb-countries/db.jsonl",
      "size": 245760,
      "modified": "2026-03-31T10:00:00.000Z",
      "loaded": true,
      "handle": "a1b2c3d4-...",
      "docCount": 1240,
      "trash": {
        "exists": true,
        "size": 8192,
        "count": 3
      }
    },
    {
      "name": "ngdb-products",
      "path": "./data/ndb/ngdb-products/db.jsonl",
      "size": 8192,
      "modified": "2026-03-30T15:00:00.000Z",
      "loaded": false,
      "handle": null,
      "docCount": 0,
      "trash": {
        "exists": false,
        "size": 0,
        "count": 0
      }
    }
  ]
}
```

### `GET /admin/api/ndb/:handle/buckets` Response Format

Enhanced to include file counts and trash info per bucket:

```json
{
  "buckets": [
    {
      "name": "attachments",
      "fileCount": 5,
      "trashCount": 2,
      "totalSize": 1048576
    }
  ]
}
```

### Bug Fixes

1. **Path traversal regex** - Fixed `/^//` to `/^\//` in serveAdminStatic
2. **Local network bypass** - Added IPv4-mapped IPv6 support (`::ffff:192.168.x.x`)
3. **Proxy support** - Added X-Forwarded-For and X-Real-IP header handling

---

## 4. Frontend Features

### Database Management Page (`databases` feature)

Redesigned to show **all** databases with load/unload controls:

- **Loaded databases** (green indicator): Shows name, doc count, path. Actions: Browse Documents, Unload
- **Unloaded databases** (red/gray indicator): Shows name, file size, modified date. Actions: Load
- **Manual open**: "+ Open Database" button for entering a custom path
- **Search/filter**: Filter databases by name

### Document Browser (`documents` feature)

When a database is selected from sidebar:
- Shows header with database name
- Actions: Refresh, Insert, Unload
- `nui-list` showing all documents
- Columns: Type badge (DOC), ID, preview
- Search/filter support

---

## 5. Implementation Phases

### Phase 1: Backend ✓
- Auto-open databases on startup
- Admin API endpoints
- Fixed auth/path traversal bugs

### Phase 2: Frontend Shell ✓
- Dynamic sidebar navigation
- Feature registration
- API client

### Phase 3: Database Browser ✓
- Simplified databases list
- Document browser
- Open/close workflows

### Phase 4: Database Management Redesign ✓
- **Backend:** Enhanced `GET /admin/api/ndb` to return all databases with loaded/unloaded status
- **Backend:** New `GET /admin/api/ndb/available` endpoint for unloaded databases only
- **Backend:** New `POST /admin/api/ndb/load` endpoint to load a discovered database
- **Backend:** New `POST /admin/api/ndb/:handle/unload` endpoint to unload a database
- **Frontend:** Updated `api.js` with new endpoints
- **Frontend:** Redesigned `databases.js` to show all databases with load/unload controls
- **Frontend:** Updated sidebar to show loaded/unloaded status indicators

### Phase 4a: Document Trash ✓
> See `docs/trash-and-bucket-architecture.md` for full design
- **nDB core:** `compact()` appends deleted documents to per-database `trash.jsonl` (Rust change — pending)
- **Backend:** Trash CRUD endpoints (list, restore, delete, purge) ✓
- **Backend:** Enhanced `GET /admin/api/ndb` includes trash metadata ✓
- **Frontend:** Trash panel in document browser ✓
- **Frontend:** Trash indicators in sidebar and databases page ✓

### Phase 4b: Bucket File Trash ✓
> See `docs/trash-and-bucket-architecture.md` for full design
- **nDB core:** `deleteFile()` moves to `_trash/` instead of permanent delete (Rust change — pending)
- **nDB core:** New `restoreFile()` to move files back from `_trash/` (Rust change — pending)
- **Backend:** Bucket trash CRUD endpoints (list, restore, delete, purge) ✓
- **Backend:** Enhanced bucket listing includes trash counts ✓
- **Frontend:** Bucket trash browser with restore/delete actions ✓
- **Frontend:** Full bucket browser with file listing and delete-to-trash ✓

### Phase 5: WebAdmin UI Redesign (In Progress)
- **Shared CSS:** Created `admin/css/admin.css` with reusable classes (stat-grid, db-card, info-grid, json-viewer, flex utilities, responsive breakpoints) ✓
- **Dashboard redesign:** 6 stat cards (status, nDB count, total docs, trashed items, nVDB count, WS connections), per-DB breakdown with browse/load actions, quick actions for all features ✓
- **Document browser improvements:** Added "View" button with syntax-highlighted JSON viewer dialog, fixed DB selector to use `databases` API response, improved preview (excludes system fields) ✓
- **Vector DB management UI:** Registered `vectors` feature in main.js, added "Manage Vector DBs" sidebar link ✓
- **Settings page improvements:** Added config overview cards (auth, admin, multi-tenancy), new "Backend Modules" accordion section, Node.js/platform info ✓
- **Databases page:** Migrated to admin.css classes (db-card, status-dot, flex utilities) ✓
- **All pages:** Reduced inline styles, using shared CSS classes for consistency ✓

---

## 6. Configuration

### 6.1 Server Configuration (`.env` → `src/config.js`)

Environment variables control the nGDB server process:

```
API_KEYS=                    # Empty = auth disabled
LOCAL_AUTH_BYPASS=true       # Allow local network access
ADMIN_ENABLED=true           # Enable admin UI
ADMIN_PATH=./admin           # Path to admin files
NDB_DATA_DIR=./data/ndb      # nDB data directory
NVDB_DATA_DIR=./data/nvdb    # nVDB data directory
TENANT_HEADER=               # Multi-tenancy header (empty = disabled)
```

### 6.2 Per-Database Configuration (`meta.json`)

Each database folder can contain a `meta.json` for database-level settings:

```json
{
  "version": 1,
  "display": {
    "title": "Countries",
    "content": "name.common",
    "icon": "flag"
  },
  "buckets": {
    "attachments": { "trash": true },
    "thumbnails": { "trash": true }
  },
  "maintenance": {
    "autoCompact": true,
    "compactInterval": 300,
    "trashRetentionDays": 30
  }
}
```

> **Note:** The `meta.json` schema is defined in the nDB spec (`docs/nDB-spec.md`) but the Node.js service layer does not yet read/write it. This is a future implementation task. The nDB Rust core reads `meta.json` for bucket declarations.

### 6.3 Config Architecture Decision

| Level | Location | Scope | Examples |
|-------|----------|-------|---------|
| **Server** | `.env` → `src/config.js` | Process-wide | Port, auth, data dirs, admin toggle |
| **Database** | `{dbDir}/meta.json` | Per-database | Display mappings, bucket config, maintenance settings |
| **Bucket-trash** | `{bucket}/_trash/{file}.meta.json` | Per-deleted-file | Original name, MIME type, deletion timestamp |

---

## 7. Gap Analysis: Database Management

### Problem

The original spec assumed databases would be auto-opened on startup and the admin would only show "open" databases. During development it became clear this is insufficient:

1. **No visibility into unloaded databases** — The admin could only see databases that were already open. If a database existed on disk but wasn't opened (e.g., new deployment, after server restart with selective loading), it was invisible.

2. **No runtime control** — There was no way to load or unload individual databases without restarting the server.

3. **`listAvailable` existed but was disconnected** — The `db.js` handler had a `listAvailable` function that scanned for database files, but it was only accessible via the WebSocket `POST /db/listAvailable` route, not through the admin API.

### Solution

- Merge discovery and instance listing into a single `GET /admin/api/ndb` endpoint that returns **all** databases with their load status
- Add explicit `load`/`unload` endpoints for runtime database management
- Keep `autoOpenDatabases()` as the default startup behavior (all databases loaded by default)
- The admin UI can then selectively unload databases to free memory, or load previously unloaded ones

---

## 8. Lessons Learned

1. **Auto-open vs manual open:** Auto-opening databases on startup provides better UX - users see their data immediately without manual "open" steps.

2. **Discovery vs loading are separate concerns:** Scanning for database files (discovery) should be decoupled from opening them (loading). This allows the admin to show all databases regardless of their runtime state.

3. **Dynamic sidebar:** The sidebar must update after state changes (load/unload). This requires careful event handling.

4. **NUI integration:** Custom elements like `nui-card` don't bubble events the same way as regular divs. Use standard elements for clickable items or attach handlers directly.

5. **Path handling:** Windows paths need special attention in regex patterns (escape backslashes properly).

6. **Local development:** `.env` file support via `dotenv` is essential for easy configuration.

7. **API design:** The admin API should expose the full state of the system, not just the active subset. Listing only "open" databases creates a gap where the admin can't manage what it can't see.

8. **Trash is per-database, not global:** `trash.jsonl` lives in the database folder. `scanForDatabases()` already skips it. This keeps trash scoped and simplifies cleanup.

9. **Auto-compact on trash view:** `GET /trash` runs `compact()` first so `trash.jsonl` is always complete. The trade-off (compaction on view) is acceptable since trash viewing is an infrequent admin operation.

10. **Bucket trash is pure filesystem:** Unlike document trash (which requires nDB core changes to `compact()`), bucket file trash uses `_trash/` directories with `.meta.json` sidecars. The admin layer handles this entirely via filesystem operations — no nDB core changes needed for the admin to work (though `deleteFile()` should eventually move to `_trash/` instead of permanent delete).

11. **Empty directory cleanup:** After restoring or permanently deleting the last trashed file in a bucket, the `_trash/` directory is automatically removed to prevent accumulation of empty directories.

12. **Config separation:** Server-level config (`.env`) and per-database config (`meta.json`) serve different purposes. Server config controls the process; database config controls data behavior. Don't mix them.

13. **Shared CSS reduces maintenance:** Extracting inline styles into a shared `admin.css` with reusable classes (`.stat-grid`, `.db-card`, `.info-grid`, `.json-viewer`) makes all pages consistent and easier to maintain. Use CSS custom properties from NUI (`--nui-*`) for theme consistency.

14. **JSON viewer adds value:** A syntax-highlighted JSON viewer dialog (using regex-based token coloring) is a low-effort, high-value feature for a data browser. It avoids the need for a full code editor just to view documents.

15. **Feature registration must match sidebar:** When adding a new feature (like vectors), remember to both `nui.registerFeature()` in main.js AND add a sidebar link. Forgetting either creates a dead feature or a broken link.
