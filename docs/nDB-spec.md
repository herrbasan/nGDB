# nDB Design Document

> n000b's Document Database - Human-readable storage for the AI age.
> Standalone embeddable database for Node.js and Rust applications.

## Ecosystem Overview

nDB is developed as part of the **nGDB workspace** and published as a standalone npm package.

### Repository Structure

```
Development Workspace (nGDB)
├── src/                       ← nGDB service layer
├── ndb/                       ← git submodule (this project)
│   ├── src/                   ← Rust core
│   ├── napi/                  ← N-API bindings (napi-rs, internal)
│   └── package.json           ← Published as ndb
├── nvdb/                      ← git submodule (vector DB)
│   ├── src/                   ← Rust core
│   ├── napi/                  ← N-API bindings (napi-rs, internal)
│   └── package.json           ← Published as nvdb
└── tests/                     ← Integration tests

Standalone Repositories
├── nDB/    → https://github.com/herrbasan/nDB
└── nVDB/   → https://github.com/herrbasan/nVDB
```

### Development Workflow

1. **Develop in nGDB workspace** - All modules together with submodules
2. **Test integration** - End-to-end tests across nDB + nVDB + nGDB service
3. **Publish packages** - Stable modules published to npm independently
4. **Standalone use** - Apps can `npm install ndb` without nGDB

### Runtime Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     nGDB Platform                           │
│            (ORM + Service Layer + Unified API)              │
│         REST / WebSocket endpoints for clients              │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │     nDB      │  │    nVDB      │  │ Future Backends  │  │
│  │  (npm pkg)   │  │  (npm pkg)   │  │   (npm pkgs)     │  │
│  │              │  │              │  │                  │  │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │                  │  │
│  │ │  N-API   │ │  │ │  N-API   │ │  │                  │  │
│  │ │(internal)│ │  │ │(internal)│ │  │                  │  │
│  │ └────┬─────┘ │  │ └────┬─────┘ │  │                  │  │
│  │      │       │  │      │       │  │                  │  │
│  │  ┌───▼───┐   │  │  ┌───▼───┐   │  │                  │  │
│  │  │nDB    │   │  │  │nVDB   │   │  │                  │  │
│  │  │(core) │   │  │  │(core) │   │  │                  │  │
│  │  └───────┘   │  │  └───────┘   │  │                  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

| Project | Language | Purpose | API Style |
|---------|----------|---------|-----------|
| **nGDB** | Node.js | Service platform, unified REST/WebSocket API | HTTP / WebSocket |
| **nDB** | Rust + N-API | Document database with internal Node.js bindings | Rust / JS |
| **nVDB** | Rust + N-API | Vector database with internal Node.js bindings | Rust / JS |

**Key insight:** nGDB provides a **unified API surface** regardless of which backend serves the data. Clients don't care if a collection is stored in nDB (JSON) or nVDB (vectors) - the API stays the same.

**Architecture Note:** nDB and nVDB are standalone packages, each implementing N-API bindings internally using napi-rs directly (no shared bridge module). This allows:
- Independent npm packages: `npm install ndb` or `npm install nvdb`
- Both work standalone in Node.js/Electron projects
- Perfect coupling between each backend's specific needs and its JS interface
- Each package owns its binding code, optimized for its own API surface

**Core beliefs:**
- **Dumb = Fast**: Every abstraction layer adds indirection. Direct I/O is fastest.
- **Visible = Trustworthy**: Human-readable storage format (JSON Lines) means you can `cat`, `grep`, `jq` your database at any time.
- **Pay for what you use**: 90% of operations are simple read/write. Complex queries are opt-in and explicitly cost what they cost.
- **No magic**: No query parser, no optimizer, no ORM (at the backend level). Your code, your logic, your performance characteristics.
- **Own your code**: Minimal dependencies, maximum understanding. Build it ourselves when practical.

## Concurrency Model

nDB uses a **single-writer, multi-reader** model:

- **Single writer** — All writes (insert, update, delete, compact) go through one exclusive path. This matches Node.js's single-threaded event loop perfectly.
- **Multi-reader** — Reads (get, find, query, iter) can happen concurrently with each other. Readers never block other readers.
- **No MVCC, no transactions** — Simplicity over distributed correctness. The nGDB service layer handles request ordering at the Node.js level.
- **RwLock** for the document store — Multiple readers OR one exclusive writer, never both.

**Why not multi-writer?**
- Node.js event loop is inherently single-threaded
- N-API boundary serializes access from JavaScript
- Append-only JSON Lines is naturally single-writer (no concurrent append conflicts)
- nVDB proved this model works in production

## `_id` Generation

Document IDs are **NanoID-style**: 16 characters of base62 (`[a-zA-Z0-9]`).

```
Example: V1StGXR8Z5jdHi6B
```

**Properties:**
- **Length:** 16 characters — compact in the HashMap index
- **Alphabet:** base62 (a-z, A-Z, 0-9) — URL-safe, filesystem-safe
- **Collision space:** 62^16 ≈ 4.7 × 10^28 — effectively zero collision risk
- **Generation:** PRNG-based, ~20 lines of Rust, no external dependencies
- **Uniqueness check:** `HashMap::contains_key()` guard for O(1) safety

**Why not UUID?** 36 chars is verbose, wastes space in the index HashMap, harder to read in logs.

**Why not ULID?** Time-sortable is nice but nDB documents already carry `created` timestamps. Adds unnecessary complexity for the common case.

**Optional prefix:** IDs can optionally be prefixed for human readability:
```rust
db.insert_with_prefix("conv", doc)?;  // → "conv_V1StGXR8Z5jdHi6B"
```

## Storage Format

### Database = Folder

Each database is a **folder** named after the database. Inside: a metadata file, the data file, a trash file, and bucket folders.

```
data/
  ndb/
    countries/                      ← Database folder = database name
      meta.json                     ← Database metadata (config, display, buckets)
      db.jsonl                      ← Active documents (pure append-only)
      trash.jsonl                   ← Soft-deleted documents
      buckets/                      ← Binary file storage
        attachments/
          a3f5c2d1.png              ← hash.ext format
          _trash/                   ← Per-bucket trash for deleted files
            b7e9a4f2.jpg
        thumbnails/
          a3f5c2d1_128x128.png
          _trash/
    conversations/                  ← Another database
      meta.json
      db.jsonl
      trash.jsonl
      buckets/
        media/
          x1y2z3a4.mp3
          _trash/
```

**Key rules:**
- Database name = folder name — no indirection
- `db.jsonl` — standardized name, pure append-only log, no metadata line
- `trash.jsonl` — single file for all soft-deleted documents
- `buckets/` — binary storage, each bucket is a subfolder
- `_trash/` inside each bucket — deleted files (underscore prefix = hidden)
- Buckets must be declared in `meta.json` before use (enforced)

### meta.json — Database Metadata

Separate JSON file that defines the database's configuration and display hints.

```json
{
  "version": 2,
  "created": 1743235200000,
  "modified": 1743235200000,
  "display": {
    "title": "name.common",
    "content": null,
    "icon": "flag"
  },
  "buckets": ["attachments", "thumbnails"]
}
```

**Fields:**
- `version` — Schema version (currently 2)
- `created` — Database creation timestamp (Unix epoch ms)
- `modified` — Last modification timestamp (Unix epoch ms)
- `display.title` — Dot-notation path to the field for display title (optional)
- `display.content` — Dot-notation path to the field for content preview (optional)
- `display.icon` — Dot-notation path to the field for icon/emoji (optional)
- `buckets` — List of declared bucket names. **Enforced**: nDB rejects operations on undeclared buckets

**Why separate file (not inline in JSONL):**
- Data file (`db.jsonl`) stays a pure append-only log — no special first-line handling
- Metadata is configuration, not data — different lifecycle
- Admin can update display mappings without touching the data file
- `wc -l` on `db.jsonl` gives exact document count, no off-by-one
- Folder is the atomic unit — copy the folder, you have everything

### Document Schema — System Fields

Every document has these system-managed fields (prefixed with `_`):

```json
{
  "_id": "V1StGXR8Z5jdHi6B",
  "_created": 1743235200000,
  "_modified": 1743235200000,
  "name": {"common": "Aruba", "official": "Aruba"},
  "flag": "🇦🇼"
}
```

| Field | Type | Set by | Description |
|-------|------|--------|-------------|
| `_id` | string | nDB core | 16-char NanoID (base62), generated on insert |
| `_created` | number | nDB core | Unix epoch ms, set once on insert, never modified |
| `_modified` | number | nDB core | Unix epoch ms, set on insert, updated on every update |
| `_deleted` | number | nDB core | Unix epoch ms, set on soft delete (only present on deleted docs) |

**Rules:**
- System fields are managed by nDB core — users cannot set or modify them
- `_created` and `_modified` are always present on active documents
- `_deleted` only appears on soft-deleted documents in `trash.jsonl`
- User data must not use the `_` prefix for their own top-level fields

### JSON Lines (NDJSON) — Data Files

Each line in `db.jsonl` is one complete JSON object. Append-only. **No binary data inside.**

```jsonl
{"_id":"V1StGXR8Z5jdHi6B","_created":1743235200000,"_modified":1743235200000,"title":"AI Discussion","attachments":[{"_file":{"bucket":"attachments","id":"a3f5c2d1","ext":"png","name":"screenshot.png","size":45678,"type":"image/png"}}]}
```

Deleted documents are appended to `trash.jsonl`:
```jsonl
{"_id":"V1StGXR8Z5jdHi6B","_created":1743235200000,"_modified":1743235200000,"_deleted":1743235300000,"title":"AI Discussion"}
```

**Why this format:**
- Human readable: `cat db.jsonl | jq '.title'`
- Streamable: Process TB without loading into memory
- Append-only: O(1) writes, no corruption on crash
- Git-friendly: Line-by-line diffs
- Unix-native: Works with `grep`, `tail -f`, `awk`
- **Small**: References to files (hashes), not the file contents
- **Rich metadata**: Original name, MIME type, size all queryable
- **Separation of concerns**: Documents in JSON Lines, binary content in filesystem

### File Buckets - Binary Storage

Binaries are stored as files in folders. The database manages references; the filesystem stores bytes.

**Buckets must be declared** in `meta.json` before use. nDB rejects operations on undeclared buckets. This prevents typo-based duplicate buckets (e.g., `attachements` vs `attachments`).

```json
// meta.json
{
  "buckets": ["attachments", "thumbnails"]
}
```

```rust
// Bucket must exist in meta.json, otherwise this returns an error
let bucket = db.bucket("attachments")?;   // OK — declared
let bucket = db.bucket("attachements")?;  // ERROR — not declared
```

**File naming:** SHA-256 hash (first 8 chars) + original extension
- Original: `vacation_photo.png` → Stored: `a3f5c2d1.png`
- Prevents collisions, enables deduplication
- Extension preserved for MIME type detection
- Full hash stored in index for integrity verification

**Trash handling (Per-Bucket):**
Because files are stored by their content hash, file deduplication happens naturally. Each bucket maintains its own `_trash` folder (underscore prefix keeps it hidden from normal listing).

```text
countries/
  buckets/
    attachments/
      a3f5c2d1.png
      _trash/
        b7e9a4f2.jpg              # Moved/copied here on deletion
    thumbnails/
      a3f5c2d1_128x128.png
      _trash/
```

*Note on hash collisions in trash:* If identically hashed files are moved to the same bucket's trash folder, overwriting the existing file is completely acceptable. The byte content is exactly the same by definition, eliminating the need for complex reference-counting or file tracking.

### Compaction & Document Trash

Nothing is ever truly deleted. Soft-deleted documents live in `trash.jsonl` alongside the active `db.jsonl`.

```text
countries/
  db.jsonl                      # Active documents
  trash.jsonl                   # Soft-deleted documents (append-only)
```

On `compact()`:
1. Rewrite `db.jsonl` — keep only active documents (those without `_deleted`)
2. Rewrite `trash.jsonl` — keep only deleted documents within the retention window
3. Atomic file swap for both files — no corruption on crash

**Compaction Strategy:**
Because nDB relies on append-only logs for speed, the `compact()` step is critical for preventing bloat. The compaction strategy is flexible depending on the database's deployment context:
- **Embedded App (Small Data):** Run lazily on application startup/shutdown, or automatically when a file size threshold is reached.
- **Service Environment (Drive-Based nGDB):** Run as a scheduled background job. The rewrite utilizes an atomic file-swap to ensure active reads and writes are not blocked.
- **In-Memory Operations:** When running with an in-memory primary state, a very tight compaction schedule (e.g., every 60 seconds) is used to continuously flush and prune tombstones, keeping state footprint as small as possible.

**Trash retention:**
```rust
TrashMode::Manual                              // Never auto-delete (default)
TrashMode::TTL(Duration::from_hours(24 * 7))   // Auto-purge after 7 days
TrashMode::Off                                 // Hard delete immediately (dangerous)
```

## Architecture: Three Layers + File Buckets

```
┌─────────────────────────────────────────┐
│  LAYER 3: JSON AST Queries              │
│  (Raw AST pass-through to core)         │
├─────────────────────────────────────────┤
│  LAYER 2: Single Field Queries          │
│  db.find("user_id", "alice")            │
├─────────────────────────────────────────┤
│  LAYER 1: Core (90% of operations)      │
│  insert, get, update, delete            │
│  O(1) via _id index                     │
├─────────────────────────────────────────┤
│  FILE BUCKETS: Binary Storage           │
│  Pipelined file streams to Rust         │
│  Hash-named files in folders            │
├─────────────────────────────────────────┤
│  STORAGE: Append-only JSON Lines        │
│  _id → byte offset index in memory      │
└─────────────────────────────────────────┘
```

**Documents and Files are separate but linked:**
- JSON Lines stores metadata and file references (hashes)
- File Buckets store actual bytes in hashed filenames
- Trash is coordinated: deleting a document can optionally delete referenced files
- Files can be deduplicated across documents (same hash = same storage)

### Layer 1: Core (The Fast Path)

```rust
let db = Database::open("countries")?;

// WRITE - O(1), append-only
db.insert(doc)?;                               // Returns generated _id
db.get("V1StGXR8Z5jdHi6B")?;                  // O(1) index lookup
db.update("V1StGXR8Z5jdHi6B", new_doc)?;      // O(1) append + tombstone
db.delete("V1StGXR8Z5jdHi6B")?;               // O(1) soft delete

// RAW ACCESS - Your logic, zero overhead
db.iter()                                      // Iterator over all docs
  .filter(|d| d["score"].as_i64() > 100);

// MAINTENANCE
db.compact()?;                                 // Remove deleted, archive to trash
db.trash().list()?;                            // Browse deleted items
db.trash().restore("V1StGXR8Z5jdHi6B")?;      // Undelete
```

**Memory footprint:** One `HashMap<String, u64>` - ~50 bytes per document (16-char `_id` + 8-byte offset + HashMap overhead).

### Layer 2: Single Field Queries (The 9%)

```rust
// Find all docs where field == value
// Uses index if available, otherwise linear scan
let results: Vec<&Value> = db.find("user_id", "alice");

// Find with predicate
let results = db.find_where("score", |v| v.as_i64() > 100);

// Returns iterator - lazy evaluation
let count = db.find_iter("status", "active").count();

// Range queries (requires BTree index)
let results = db.find_range("created", start_ts, end_ts);
```

**Performance:** O(n) scan for unindexed fields. For 100K docs ~10ms. Acceptable for occasional use.

### Layer 3: JSON AST Queries (The 1%)

Complex queries are formulated as **raw JSON ASTs**. No fluent builders, no DSL strings — just JSON objects that pass directly from the API to the query executor.

**Why JSON AST:**
- **Zero-allocation overhead** in Node.js — JSON arrives as-is, no parsing into builder objects
- **Perfect serialization for LLMs** — language models can generate and reason about JSON natively
- **Direct deserialization** — serde_json parses directly into Rust query structs
- **No builder API to maintain** — one struct definition, one evaluator, done

```rust
// Raw JSON AST deserialized directly from API
let query_ast = serde_json::json!({
    "$and": [
        {"user_id": {"$eq": "alice"}},
        {"status": {"$eq": "active"}},
        {"score": {"$gt": 100}}
    ]
});

// Passed directly to the query executor
let results = db.query(query_ast);
```

**Supported operators:**

| Operator | Meaning | Example |
|----------|---------|---------|
| `$eq` | Equal | `{"status": {"$eq": "active"}}` |
| `$ne` | Not equal | `{"status": {"$ne": "deleted"}}` |
| `$gt` | Greater than | `{"score": {"$gt": 100}}` |
| `$gte` | Greater than or equal | `{"score": {"$gte": 100}}` |
| `$lt` | Less than | `{"created": {"$lt": 1234567890}}` |
| `$lte` | Less than or equal | `{"created": {"$lte": 1234567890}}` |
| `$in` | In array | `{"status": {"$in": ["active", "pending"]}}` |
| `$nin` | Not in array | `{"status": {"$nin": ["deleted", "banned"]}}` |
| `$exists` | Field exists | `{"avatar": {"$exists": true}}` |

**Logical combinators:**

| Combinator | Meaning | Example |
|------------|---------|---------|
| `$and` | All conditions must match | `{"$and": [{...}, {...}]}` |
| `$or` | Any condition must match | `{"$or": [{...}, {...}]}` |
| `$not` | Negate condition | `{"$not": {"status": {"$eq": "deleted"}}}` |

**Query with options:**
```rust
let results = db.query_with(query_ast, QueryOptions {
    limit: Some(100),
    sort_by: Some(("created".to_string(), SortDir::Desc)),
    offset: Some(0),
});
```

**Implementation:** The AST is deserialized into a `QueryNode` enum. The evaluator walks the tree and filters `iter()`. No query parser, no optimizer — just recursive evaluation over the in-memory document set.

## Operating Modes

All data is **always in-memory**. The persistence model determines when data is written to disk.

```rust
// Default: In-memory with lazy persistence
// Data lives in RAM. Persisted to disk periodically or on explicit flush.
let db = Database::open("countries")?;

// Immediate persistence
// Every write is fsynced to disk before returning. Slower, no data loss on crash.
let db = Database::open("countries")?
    .with_persistence(Persistence::Immediate);

// Scheduled persistence
// Flush to disk every N seconds. Good balance of speed and safety.
let db = Database::open("countries")?
    .with_persistence(Persistence::Scheduled(Duration::from_secs(60)));

// Pure in-memory (no disk file)
// Data evaporates when the process exits. Useful for caches, tests.
let db = Database::open_in_memory()?;
```

| Persistence | Write Speed | Crash Safety | Use Case |
|-------------|-------------|--------------|----------|
| `None` (in-memory) | RAM speed | None | Caches, tests, ephemeral data |
| `Lazy` (default) | RAM speed | Last flush only | General embedded use |
| `Scheduled(N)` | RAM speed | Last scheduled flush | Balanced production use |
| `Immediate` | Disk speed | Every write | Critical data |

**Why always in-memory?**
- nDB targets Node.js/Electron embedded use — datasets typically fit in RAM
- In-memory reads are orders of magnitude faster than disk reads
- The `_id → offset` index plus all documents in a HashMap is ~100-200 bytes/doc
- 1M documents ≈ 100-200MB RAM — well within modern device capabilities
- Persistence is about durability, not about serving reads from disk

## Opt-In Indexing

Indexes are explicit. You pay the memory cost consciously.

```rust
// Build secondary index
// Scans entire database once, builds HashMap
// Subsequent queries use index automatically
db.create_index("user_id")?;        // Hash index - O(1) equality
db.create_index("created")?;        // BTree index - O(log n) + ranges

// Now fast
db.find("user_id", "alice");        // O(1) indexed

// Drop when done
db.drop_index("user_id")?;
```

**Index types:**
- `HashIndex`: O(1) equality lookups. Memory: ~50 bytes/entry.
- `BTreeIndex`: O(log n) lookups + range queries. Memory: ~100 bytes/entry.

## Node.js / Electron Usage

nDB is a self-contained npm package with internal N-API bindings via napi-rs.

**JS runtime:** Vanilla JavaScript (no TypeScript). `.d.ts` definition files are generated strictly for LLM context and editor hints, not used at runtime.

### Installation

```bash
npm install ndb
# or
yarn add ndb
```

### Basic Usage

```javascript
const { Database } = require('ndb');

// Open or create database
const db = Database.open('./my-data');

// Insert document - returns generated NanoID
const id = db.insert({
  title: 'Hello World',
  tags: ['demo', 'test'],
  created: Date.now()
});

// Get by ID
const doc = db.get(id);

// Query with JSON AST
const results = db.query({
  "$and": [
    { "tags": { "$eq": "demo" } },
    { "created": { "$gt": Date.now() - 86400000 } }
  ]
});

// Query with options
const page = db.query({ "status": { "$eq": "active" } }, {
  limit: 10,
  sortBy: 'created',
  sortDir: 'desc'
});

// File attachments
const fileRef = db.bucket('attachments').store('photo.png', imageBuffer);
db.insert({
  title: 'My Photo',
  image: fileRef
});
```

### Using with nVDB (separate package)

```javascript
const { Database: nDB } = require('ndb');
const { Database: nVDB } = require('nvdb');

// Document database
const docs = nDB.open('./documents');
docs.insert({ name: 'Alice' });

// Vector database (separate install)
const vectors = nVDB.open('./embeddings', { dim: 768 });
vectors.upsert({ id: 'doc1', vector: [0.1, 0.2, ...] });
const similar = vectors.search([0.1, 0.2, ...], { topK: 5 });
```

### Electron Considerations

nDB works in both Electron main and renderer processes:

```javascript
// Main process
const { Database } = require('ndb');
const db = Database.open(app.getPath('userData') + '/db');

// IPC to renderer
ipcMain.handle('db:insert', (event, doc) => db.insert(doc));
ipcMain.handle('db:get', (event, id) => db.get(id));
```

**Benefits for Electron:**
- Prebuilt binaries - no `electron-rebuild` needed
- Native performance for file I/O
- Small bundle size (~1MB)
- Works with Electron's ASAR packaging

## Usage Patterns

### Pattern 1: Write-Heavy Log
```rust
let logs = Database::open("logs")?;
logs.insert(json!({"event": "click", "ts": now()}))?;  // O(1)
// Never query, just append. Zero index memory.
```

### Pattern 2: User Lookup (one index)
```rust
let users = Database::open("users")?;
users.create_index("email")?;
users.find("email", "alice@example.com");  // O(1)
```

### Pattern 3: Complex Analytics (accept the cost)
```rust
// O(n) scan, but OK for nightly reports
let report = db.query(json!({
    "$and": [
        {"timestamp": {"$gt": yesterday}},
        {"event_type": {"$eq": "purchase"}},
        {"amount": {"$gt": 100}}
    ]
}));
```

### Pattern 4: Build Ad-Hoc Index
```rust
// Temporary in-memory index for session
let mut idx: HashMap<String, Vec<&Value>> = HashMap::new();
for doc in db.iter() {
    idx.entry(doc["category"].as_str().unwrap().to_string())
       .or_default()
       .push(doc);
}
// Now O(1) lookups by category. Dropped when scope ends.
```

### Pattern 5: Documents with Attachments
```rust
let db = Database::open("conversations")?;
let files = db.bucket("attachments");  // Must be declared in meta.json

// Store uploaded image
let image_data = fs::read("upload.png")?;
let file_ref = files.store("upload.png", &image_data)?;
// Returns: FileRef { hash: "a3f5c2d1...", ext: "png", size: 45678 }

// Store reference in document
let doc = json!({
    "_id": "V1StGXR8Z5jdHi6B",
    "title": "Screenshot discussion",
    "attachments": [file_ref.to_string()],  // ["a3f5c2d1.png"]
});
db.insert(doc)?;

// Later: retrieve file
let conv = db.get("V1StGXR8Z5jdHi6B")?;
for attachment_hash in conv["attachments"].as_array().unwrap() {
    let data = files.get_by_hash(attachment_hash.as_str().unwrap())?;
    // Serve bytes over HTTP, etc.
}
```

### Pattern 6: Multiple Buckets
```rust
let db = Database::open("app")?;

// Different buckets for different purposes
let avatars = db.bucket("avatars");      // User profile pictures
let uploads = db.bucket("uploads");      // Generic user uploads
let exports = db.bucket("exports");      // Generated PDFs/CSVs
let cache = db.bucket("cache");          // Ephemeral thumbnails

// Each bucket is just a folder, independently trash-managed
let avatar = avatars.store("profile.png", &data)?;
let thumbnail = cache.store("thumb.jpg", &thumb_data)?;

// Documents reference cross-bucket if needed
let user = json!({
    "name": "Alice",
    "avatar": avatars.ref_to_string(&avatar),      // "avatars:c9d1e3f5.png"
    "exports": [exports.ref_to_string(&pdf)],      // ["exports:a1b2c3d4.pdf"]
});
```

### Pattern 7: Deduplication
```rust
let files = db.bucket("attachments");

// Same file uploaded twice? Same hash = same storage.
let ref1 = files.store("report.pdf", &data)?;  // Stores bytes
let ref2 = files.store("report_copy.pdf", &data)?;  // Just links existing

assert_eq!(ref1.hash, ref2.hash);  // Same underlying file
// Storage used: size of data (once), not 2x
```

## File Layout

Each database is a **folder**. The folder name IS the database name. Inside: metadata, data, trash, and bucket folders.

```
countries/                          ← Database folder = database name
├── meta.json                       ← Database metadata (version, display, buckets)
├── db.jsonl                        ← Active documents (pure append-only)
├── trash.jsonl                     ← Soft-deleted documents
├── buckets/                        ← Binary file storage
│   ├── attachments/
│   │   ├── a3f5c2d1.png            ← hash.ext format
│   │   └── _trash/                 ← Per-bucket trash for deleted files
│   │       └── b7e9a4f2.jpg
│   └── thumbnails/
│       ├── a3f5c2d1_128x128.png
│       └── _trash/
└── indexes/                        ← Optional persisted indexes
    ├── user_id.idx
    └── created.idx
```

**Key rules:**
- Database name = folder name — no indirection
- `db.jsonl` — standardized name, pure append-only log, no metadata line
- `trash.jsonl` — single file for all soft-deleted documents
- `buckets/` — binary storage, each bucket is a subfolder
- `_trash/` inside each bucket — deleted files (underscore prefix = hidden)
- Buckets must be declared in `meta.json` before use (enforced)

**Trash behavior:**
- `bucket.delete()` → moves file to `buckets/{bucket}/_trash/`
- `db.delete()` → appends doc to `trash.jsonl`, optionally moves referenced files to bucket trash
- `trash().restore(id)` → moves doc back to `db.jsonl`
- `trash().purge(older_than)` → permanent deletion from `trash.jsonl`

## API Reference

### Core Methods

| Method | Complexity | Description |
|--------|-----------|-------------|
| `insert(doc)` | O(1) | Append document, return generated `_id` (NanoID) |
| `get(id)` | O(1) | Lookup by primary key |
| `update(id, doc)` | O(1) | Append new version, tombstone old |
| `delete(id)` | O(1) | Append tombstone (soft delete) |
| `iter()` | O(1) | Iterator over all non-deleted docs |
| `compact()` | O(n) | Rewrite without deleted, archive trash |

### Query Methods

| Method | Complexity | Description |
|--------|-----------|-------------|
| `find(field, value)` | O(1) or O(n) | Equality query (uses index if exists) |
| `find_where(field, pred)` | O(n) | Predicate query |
| `find_range(field, min, max)` | O(log n + k) | Range query (requires BTree index) |
| `query(ast)` | O(n) | JSON AST query (raw pass-through) |
| `query_with(ast, opts)` | O(n) | JSON AST query with limit/sort/offset |

### Index Methods

| Method | Complexity | Description |
|--------|-----------|-------------|
| `create_index(field)` | O(n) | Build secondary index |
| `drop_index(field)` | O(1) | Remove index, free memory |
| `has_index(field)` | O(1) | Check if index exists |

### Trash Methods

| Method | Complexity | Description |
|--------|-----------|-------------|
| `trash().list()` | O(n) | List deleted items |
| `trash().restore(id)` | O(1) | Move from trash to active |
| `trash().purge(before)` | O(n) | Permanently delete old trash |

### File Bucket Methods

| Method | Complexity | Description |
|--------|-----------|-------------|
| `bucket(name)` | O(1) | Get named bucket (must be declared in meta.json) |
| `bucket.store(name, &[u8])` | O(1) | Store file, returns `FileMeta` |
| `bucket.get(&FileRef)` | O(1) | Read file bytes |
| `bucket.exists(hash)` | O(1) | Check if file exists |
| `bucket.delete(&FileRef)` | O(1) | Move to trash (soft delete) |
| `bucket.list()` | O(n) | List all files in bucket |
| `bucket.link(hash)` | O(1) | Reference existing file (dedup) |

### File Trash Methods

| Method | Complexity | Description |
|--------|-----------|-------------|
| `file_trash().list()` | O(n) | List all trashed files |
| `file_trash().restore(hash)` | O(1) | Restore file to original bucket |
| `file_trash().purge(older_than)` | O(n) | Permanently delete old files |
| `file_trash().clear()` | O(n) | Empty entire file trash |

**Configuration:**
```rust
let db = Database::open(Config {
    persistence: Persistence::Lazy,                // Default
    file_trash_mode: TrashMode::Manual,            // Never auto-delete
    // OR
    file_trash_mode: TrashMode::TTL(Duration::hours(24 * 7)), // 1 week
    // OR
    file_trash_mode: TrashMode::Off,               // Hard delete (dangerous)
})
```

### File Metadata Structure

```rust
/// Stored in database document (JSON)
pub struct FileMeta {
    pub _file: FileRef,      // Marker + reference
    pub name: String,        // Original filename
    pub size: usize,         // File size in bytes
    pub type_: String,       // MIME type
    pub created: u64,        // Timestamp
    pub modified: u64,       // Timestamp
    // ... extensible
}

/// Reference to actual file on disk
pub struct FileRef {
    pub bucket: String,      // Bucket name (folder)
    pub id: String,          // Hash (first 8 chars = filename stem)
    pub ext: String,         // Extension (preserves original)
}

// Disk path construction
// bucket="attachments", id="a3f5c2d1", ext="png"
// → countries/buckets/attachments/a3f5c2d1.png
```

**JSON in document:**
```json
{
  "_file": {
    "bucket": "attachments",
    "id": "a3f5c2d1",
    "ext": "png"
  },
  "name": "vacation_photo.png",
  "size": 45678,
  "type": "image/png",
  "created": 1234567890
}
```

**Compact string form (optional):** `attachments:a3f5c2d1.png`

## Implementation Notes

### Language: Rust + Internal N-API (napi-rs)

nDB is a Rust core with **internal N-API bindings** via napi-rs. Each package (nDB, nVDB) owns its own bindings — no shared bridge module.

```
nDB Package Structure
├── package.json              ← npm package config
├── index.js                  ← Vanilla JS entry point
├── index.d.ts                ← Type definitions (for LLM/editor context only)
├── src/                      ← Rust source
│   ├── lib.rs                ← nDB core
│   ├── id.rs                 ← NanoID generation
│   ├── query.rs              ← JSON AST query evaluator
│   └── ...
├── napi/                     ← N-API bindings (internal, napi-rs)
│   ├── src/
│   │   └── lib.rs            ← napi-rs binding definitions
│   ├── Cargo.toml
│   └── build.rs
├── Cargo.toml                ← Workspace manifest
└── prebuilds/                ← Prebuilt binaries
    ├── linux-x64/
    ├── darwin-x64/
    └── win32-x64/
```

**Why Rust:**
- Zero runtime, no GC pauses
- Memory safety (no corruption bugs)
- Single binary deployment (~1MB)
- N-API for native Node.js integration

**Development Workflow:**
All modules are initially developed together in the **nGDB** workspace:
```
nGDB/                          ← Main development workspace
├── src/                       ← nGDB service code
├── ndb/                       ← git submodule
│   ├── napi/                  ← nDB's own N-API bindings
│   └── src/                   ← nDB core development
├── nvdb/                      ← git submodule
│   ├── napi/                  ← nVDB's own N-API bindings
│   └── src/                   ← nVDB core development
├── tests/                     ← Integration tests
└── package.json               ← Links to local submodules
```

Once stable, nDB and nVDB are published as standalone packages:
```bash
# Standalone use (after initial development)
npm install ndb   # or nvdb
```

### Core Data Structures

```rust
pub struct Database {
    // Folder-based paths
    db_path: PathBuf,                            // Database folder (e.g. "countries/")
    meta_path: PathBuf,                          // meta.json inside folder
    data_path: PathBuf,                          // db.jsonl inside folder
    trash_path: PathBuf,                         // trash.jsonl inside folder

    // In-memory state
    docs: RwLock<HashMap<String, Value>>,        // _id → document (in-memory)
    deleted: RwLock<HashSet<String>>,            // Soft-deleted _id set
    indexes: RwLock<HashMap<String, Box<dyn Index>>>, // opt-in secondary indexes
    writer: Mutex<()>,                           // single-writer lock
    persistence: Persistence,                    // when to flush to disk
    trash_mode: TrashMode,                       // trash retention policy
    file_handle: Mutex<Option<fs::File>>,        // append handle for db.jsonl
}

pub trait Index {
    fn insert(&mut self, value: &Value, id: &str);
    fn remove(&mut self, value: &Value, id: &str);
    fn get(&self, value: &Value) -> Vec<String>;
}
```

### `_id` Generation (NanoID-style)

```rust
const ID_LENGTH: usize = 16;
const BASE62: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

fn generate_id() -> String {
    let mut rng = fastrand::Rng::new();
    let id: String = (0..ID_LENGTH)
        .map(|_| BASE62[rng.usize(..62)] as char)
        .collect();
    id
}
```

### Compaction Strategy

1. Read through `db.jsonl` sequentially
2. Skip documents where `_deleted` is set
3. Rewrite active documents to `db.jsonl.tmp`
4. Atomic rename `tmp` → `db.jsonl`
5. Read through `trash.jsonl`, keep only documents within retention window
6. Rewrite to `trash.jsonl.tmp`, atomic rename
7. Rebuild in-memory index from new `db.jsonl`

Crash safety: Original files untouched until final rename.

## Comparison

| Feature | NeDB | nDB |
|---------|------|-----|
| Format | JSON Lines | JSON Lines + file buckets |
| Default memory | All docs | All docs (always in-memory) |
| Query engine | Mongo-like | Layered: O(1) → field scan → JSON AST |
| Soft delete | No | First-class (trash bucket) |
| Binary storage | Inline base64 | External hashed files |
| File deduplication | No | By hash |
| `_id` format | 16-char hex | 16-char NanoID (base62) |
| Concurrency | Single-threaded | Single-writer, multi-reader |
| Language | JS | Rust (N-API) |
| Dependencies | Several | Minimal (std + serde_json) |

## Relationship to nVDB

**nDB** and **nVDB** are sister projects with different specialties:

| Aspect | nDB (this doc) | nVDB |
|--------|----------------|------|
| **Data type** | JSON documents | Float vectors (f32 arrays) |
| **Storage** | JSON Lines | Binary segments (mmap) |
| **Query type** | Field equality, ranges, JSON AST | Similarity search |
| **Index** | Hash/BTree | HNSW graph |
| **Acceleration** | N/A | SIMD (AVX2/NEON) |
| **Use case** | General documents, metadata | Embeddings, RAG, semantic search |
| **Concurrency** | Single-writer, multi-reader | Single-writer, multi-reader |

**Unified via nGDB:**
Both expose the same high-level API when accessed through the nGDB service layer:

```javascript
// nGDB unifies the API - client doesn't care which backend
await ngdb.insert('users', { name: 'Alice' });           // → nDB
await ngdb.search('embeddings', { vector: q, k: 10 });   // → nVDB
```

## Open Questions

1. **Index persistence**: Rebuild on startup, or save index files?
2. **WASM build**: Browser-compatible version (separate from N-API build)?
3. **Trash coordination**: Delete file when last reference removed (ref counting)?

## Resolved Decisions

| Decision | Resolution |
|----------|------------|
| Storage format | Folder per database: `meta.json` + `db.jsonl` + `trash.jsonl` + `buckets/`. |
| Metadata | Separate `meta.json` file — not inline in JSONL. Configuration, not data. |
| System timestamps | `_created` and `_modified` injected by nDB core (Rust) on every insert/update. |
| Display mappings | `display.title`, `display.content`, `display.icon` in `meta.json` for admin UI. |
| Bucket enforcement | Buckets must be declared in `meta.json` before use. nDB rejects undeclared buckets. |
| Trash behavior | Soft delete for both docs and files. Manual or TTL cleanup. |
| File storage | Hashed filenames in buckets. Original name in document metadata. |
| Binary handling | Files stored on disk, only references (`_file` objects) in JSON. |
| Query approach | Layered: Core O(1) → Single field scan → JSON AST (no builder pattern). |
| Language | Rust. Minimal dependencies for core. N-API for Node.js. |
| `_id` format | NanoID-style: 16 chars, base62, PRNG-generated, uniqueness check. |
| Concurrency | Single-writer, multi-reader. RwLock for docs, Mutex for writer. |
| Operating mode | Always in-memory. Persistence is configurable (lazy/scheduled/immediate). |
| N-API approach | Direct napi-rs per package (no shared nBridge module). |
| Ecosystem position | nDB = document backend, nVDB = vector backend, nGDB = service platform. |
| JS runtime | Vanilla JavaScript. `.d.ts` for LLM/editor hints only. |
| Migration path | Manual edit — simple file format, restructure by hand. |

## Next Steps

- [ ] Implement Layer 1 core (insert/get/iter/compaction)
- [ ] Implement NanoID `_id` generation
- [ ] Implement trash bucket
- [ ] Implement Layer 2 single-field queries
- [ ] Implement Layer 3 JSON AST query evaluator
- [ ] Add opt-in indexing
- [ ] Implement N-API bindings (Phase 5)
- [ ] Prebuilt binaries for all platforms
- [ ] nGDB service wrapper (REST/WebSocket)

---

*"The database is just a file + HashMap. Need more? Add code, not complexity."*