# nDB Trash & Bucket Deletion Architecture

> **Status:** Phase 4a ✓ — Phase 4b ✓ — nDB Core Changes Pending
> **Related:** `_Archive/nDB-schema-redesign.md` (folder structure), `docs/admin-development-plan.md` (Phase 4+)

---

## 1. Problem Statement

The current implementation has a gap in how deletions are managed:

1. **Document trash is treated as a separate database** — `trash.jsonl` is discovered by `scanForDatabases()` as if it were an independent database, but it should be scoped to its parent database.
2. **No admin visibility into soft-deleted documents** — nDB marks documents as deleted in-memory (`_deleted` timestamp), but the admin has no way to see or manage them before compaction.
3. **Bucket file deletion is permanent** — `deleteFile()` removes the file immediately with no trash/undo mechanism.
4. **nVDB deletion model is undefined** — nVDB's `collection.delete()` is permanent with no trash concept.

---

## 2. nDB Deletion Lifecycle

### 2.1 Document Deletion Flow

```
User calls delete(id)
        │
        ▼
┌─────────────────────────────────────────┐
│  1. In-Memory Mark                       │  ← nDB core (Rust)
│     doc._deleted = ts                    │  ← Soft delete, queryable via deletedIds()
│     restore() still works at this stage  │
└─────────┬───────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  2. Append-Only Persistence              │  ← Instant persistence (serial write)
│     Appends tombstone to db.jsonl:       │
│     {"_id":"...","_deleted":ts,...}      │  ← Deleted doc preserved in append log
│     Optimized for reads, writes can be   │
│     slower (serial write model)          │
└─────────┬───────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  3. compact()                            │  ← Triggered manually or automatically
│     Removes tombstoned entries from      │
│     db.jsonl, appends them to trash.jsonl│
└─────────┬───────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  4. trash.jsonl                          │  ← Append-only log of deleted documents
│     (on disk, per-DB)                    │  ← NOT loaded into memory by default
└─────────┬───────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────┐
│  5. Admin UI                             │  ← On-demand: read trash.jsonl for display
│     Can restore (re-insert) or           │
│     permanently delete                   │
└─────────────────────────────────────────┘
```

**Key insight:** There is no "blind spot" between deletion and trash. The append-only `db.jsonl` always contains the tombstone (step 2), so deleted documents are never lost even before compaction. The admin can find recently-deleted documents by scanning `db.jsonl` for entries with `_deleted` set, in addition to reading `trash.jsonl` for post-compaction deletions.

### 2.2 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where does trash live? | `trash.jsonl` in the database folder | Per-database scope, not global |
| Is trash loaded in memory? | **No** — read on demand | Trash can be large; no need to keep it in RAM |
| When is trash written? | During `compact()` | Deleted docs are moved from db.jsonl to trash.jsonl |
| Are deletions persisted before compaction? | **Yes** — tombstone appended to db.jsonl | Append-only log provides instant persistence; no data loss |
| Can trash be queried? | Via admin API only | Read the file and parse; no nDB index needed |
| Can deleted docs be restored? | Yes — `restore()` in-memory or re-insert from trash | In-memory restore before compaction; file-based restore after |
| Can trash be purged? | Yes — delete trash.jsonl | Admin can empty trash permanently |

### 2.3 trash.jsonl Format

Each line is a JSON object — the full document as it was when deleted, plus deletion metadata:

```jsonl
{"_id":"V1StGXR8_Z5jdHi6B","_deleted":1743235300000,"_created":1743235200000,"_modified":1743235200000,"name":{"common":"Aruba","official":"Aruba"},"flag":"🇦🇼"}
{"_id":"Kx8Vn2Pq_9mRtLwY","_deleted":1743235400000,"_created":1743235100000,"_modified":1743235150000,"name":{"common":"Bahrain","official":"Bahrain"},"flag":"🇧🇭"}
```

The `_deleted` field is the Unix timestamp of when the document was deleted (set by nDB core during `delete()`). The rest of the document is preserved as-is.

---

## 3. Bucket File Deletion Flow

### 3.1 Current Behavior

```
storeFile(bucket, name, data, mimeType)
  → Stores binary in: {dbDir}/buckets/{bucket}/{hash}.{ext}
  → Returns meta: { hash, ext, name, mimeType, size }

deleteFile(bucket, hash, ext)
  → Permanently deletes: {dbDir}/buckets/{bucket}/{hash}.{ext}
  → NO undo possible
```

### 3.2 Proposed Behavior: Move to _trash

```
deleteFile(bucket, hash, ext)
  → Moves file to: {dbDir}/buckets/{bucket}/_trash/{hash}.{ext}
  → Creates sidecar: {dbDir}/buckets/{bucket}/_trash/{hash}.{ext}.meta.json
  → NOT loaded into memory

restoreFile(bucket, hash, ext)
  → Moves file back: _trash/{hash}.{ext} → {hash}.{ext}
  → Reads and deletes sidecar .meta.json
  → Returns file meta

purgeBucketTrash(bucket)
  → Deletes entire: {dbDir}/buckets/{bucket}/_trash/
```

### 3.3 _trash Folder Structure

```
data/ndb/ngdb-countries/
├── db.jsonl
├── trash.jsonl
├── meta.json
└── buckets/
    ├── attachments/
    │   ├── a3f5c2d1.png              ← Active file
    │   ├── b7e9a4f2.jpg              ← Active file
    │   └── _trash/
    │       ├── x9y1z2a3.pdf          ← Deleted file (moved here)
    │       ├── x9y1z2a3.pdf.meta.json  ← Deletion metadata
    │       └── w4v5u6t7.gif          ← Deleted file
    │           w4v5u6t7.gif.meta.json
    └── thumbnails/
        ├── a3f5c2d1_128x128.png
        └── _trash/
            (empty)
```

### 3.4 File Trash Sidecar (.meta.json)

```json
{
  "originalName": "report.pdf",
  "hash": "x9y1z2a3",
  "ext": "pdf",
  "mimeType": "application/pdf",
  "size": 245760,
  "deletedAt": 1743235300000,
  "deletedBy": "admin"
}
```

### 3.5 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where does file trash live? | `_trash/` inside each bucket folder | Per-bucket scope, co-located with active files |
| Is file trash in memory? | **No** — pure filesystem | Files can be large; no reason to buffer them |
| How is deletion tracked? | Sidecar `.meta.json` | Preserves original metadata without loading the file |
| Can files be restored? | Yes — move back from `_trash/` | Simple filesystem move operation |
| Can trash be purged? | Yes — delete `_trash/` directory | Recursive delete of the trash folder |

---

## 4. Admin API Endpoints

### 4.1 Document Trash Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/ndb/:handle/trash` | List all trashed documents (merges in-memory tombstones + trash.jsonl) |
| POST | `/admin/api/ndb/:handle/trash/:id/restore` | Restore a trashed document (in-memory or from trash.jsonl) |
| DELETE | `/admin/api/ndb/:handle/trash/:id` | Permanently delete a trashed document |
| DELETE | `/admin/api/ndb/:handle/trash` | Purge all trash (delete trash.jsonl + compact in-memory tombstones) |

**Note on `GET /trash`:** Before reading trash, the endpoint runs `compact()` on the database to flush any in-memory tombstones into `trash.jsonl`. This ensures the trash view is always complete — no need to merge two sources. The trade-off is that viewing trash triggers a compaction, but this is acceptable since trash viewing is an infrequent admin operation.

### 4.2 Bucket File Trash Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/ndb/:handle/buckets/:bucket/trash` | List trashed files in a bucket |
| POST | `/admin/api/ndb/:handle/buckets/:bucket/trash/:hash/:ext/restore` | Restore a trashed file |
| DELETE | `/admin/api/ndb/:handle/buckets/:bucket/trash/:hash/:ext` | Permanently delete a trashed file |
| DELETE | `/admin/api/ndb/:handle/buckets/:bucket/trash` | Purge all trash in a bucket |

### 4.3 Response Formats

**GET /admin/api/ndb/:handle/trash**
```json
{
  "documents": [
    {
      "_id": "V1StGXR8_Z5jdHi6B",
      "_deleted": 1743235300000,
      "_created": 1743235200000,
      "name": { "common": "Aruba" },
      "flag": "🇦🇼"
    }
  ],
  "count": 1,
  "totalSize": 256
}
```

**GET /admin/api/ndb/:handle/buckets/:bucket/trash**
```json
{
  "files": [
    {
      "hash": "x9y1z2a3",
      "ext": "pdf",
      "originalName": "report.pdf",
      "mimeType": "application/pdf",
      "size": 245760,
      "deletedAt": 1743235300000
    }
  ],
  "count": 1
}
```

---

## 5. Discovery Changes

### 5.1 Current Problem

`scanForDatabases()` in `db.js` already skips `trash.jsonl`:

```javascript
// Skip trash files
if (entry === 'trash.jsonl') continue;
```

This is correct — trash files should NOT appear as separate databases in the admin UI.

### 5.2 Enhanced Database Info

The `GET /admin/api/ndb` response should include trash metadata:

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
    }
  ]
}
```

### 5.3 Bucket Listing Enhancement

The `GET /admin/api/ndb/:handle/buckets` response should include trash info per bucket:

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

---

## 6. nVDB Deletion Model

### 6.1 Current State

nVDB's `collection.delete(id)` is **immediate and permanent**:
- The document is removed from the in-memory memtable
- On `flush()`, the deletion is written to a segment file
- On `compact()`, segments are merged and deleted documents are physically removed
- There is **no restore mechanism** at the nVDB level

### 6.2 Proposed Approach

For nVDB, we take a **different approach** than nDB because vector data is fundamentally different:

| Aspect | nDB (documents) | nVDB (vectors) |
|--------|-----------------|-----------------|
| Data size | Small per doc | Vectors can be large |
| Restore value | High (structured data) | Low (can re-embed) |
| Storage cost | Low (JSON text) | High (float arrays) |
| Recommended | Soft delete + trash | Hard delete (no trash) |

**Recommendation: nVDB does NOT need a trash mechanism.**

Rationale:
1. Vector data can be regenerated from source documents (re-embed)
2. Storing deleted vectors wastes significant disk space
3. Vector similarity search doesn't benefit from "recently deleted" queries
4. If audit is needed, log deletions to an external system, not nVDB itself

### 6.3 Optional: Deletion Audit Log

If audit logging is desired for nVDB, it should be handled at the **nGDB service layer**, not in nVDB core:

```javascript
// Service-layer audit (not in nVDB core)
function nvdbDeleteWithAudit(params, ctx) {
  const doc = collection.get(params.id);
  if (doc) {
    auditLog.write({
      type: 'nvdb_delete',
      collection: params.collection,
      id: params.id,
      deletedAt: Date.now(),
      snapshot: { id: doc.id, payload: doc.payload }  // Don't store the vector
    });
  }
  collection.delete(params.id);
}
```

This is a future consideration, not part of the current implementation.

---

## 7. Implementation Plan

### Phase 4a: Document Trash ✓

1. **Modify `compact()` in nDB core** — Append deleted documents to `trash.jsonl` during compaction ⏳ (Rust change pending)
2. **Add trash handlers in `admin.js`** ✓:
   - `ndbInstanceTrash()` — Auto-compact, then read and parse `trash.jsonl`
   - `ndbInstanceTrashRestore()` — Re-insert document from trash into live DB, remove from trash
   - `ndbInstanceTrashDelete()` — Remove specific entry from trash.jsonl
   - `ndbInstanceTrashPurge()` — Delete entire trash.jsonl
3. **Add HTTP routes in `http.js`** for the 4 trash endpoints ✓
4. **Update `scanForDatabases()`** — Already skips trash.jsonl ✓
5. **Enhance `GET /admin/api/ndb`** — Include trash metadata (exists, size, count) ✓
6. **Frontend trash panel** — Collapsible accordion in document browser with restore/delete/purge ✓
7. **Sidebar trash indicators** — 🗑N badge next to databases with trash ✓

### Phase 4b: Bucket File Trash ✓

1. **Modify `deleteFile()` in nDB core** — Move file to `_trash/` instead of deleting ⏳ (Rust change pending)
2. **Add `restoreFile()` to nDB core** — Move file back from `_trash/` ⏳ (Rust change pending)
3. **Add bucket trash handlers in `admin.js`** ✓:
   - `ndbInstanceBucketTrash()` — List files in `_trash/` with sidecar metadata
   - `ndbInstanceBucketTrashRestore()` — Move file back, delete sidecar
   - `ndbInstanceBucketTrashDelete()` — Delete specific trashed file + sidecar
   - `ndbInstanceBucketTrashPurge()` — Delete entire `_trash/` directory
4. **Add HTTP routes in `http.js`** for the 4 bucket trash endpoints ✓
5. **Enhance `GET /admin/api/ndb/:handle/buckets`** — Include trash count per bucket ✓
6. **Frontend bucket browser** — Full bucket browser with file listing and trash management ✓

### Phase 4c: Admin UI ✓ (merged into 4a/4b)

1. **Trash panel in document browser** ✓ — Collapsible accordion with restore/delete/purge
2. **Trash indicator in sidebar** ✓ — 🗑N badge next to database name
3. **Bucket trash browser** ✓ — Full bucket page with file listing, trash view, restore/delete
4. **Purge confirmation dialogs** ✓ — "Empty trash" with confirmation via `nui.components.dialog.confirm()`

### Phase 4d: nVDB (Deferred)

- No trash mechanism needed
- Optional: Service-layer audit logging (future consideration)

---

## 7.1 Implementation Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Config architecture | Server config in `.env`, per-DB config in `meta.json` | Separation of concerns: server-level vs database-level settings |
| Trash auto-compact on view | `GET /trash` runs `compact()` first | Ensures trash view is always complete; acceptable since trash viewing is infrequent |
| Bucket listing format | Objects with `{ name, fileCount, trashCount, totalSize }` | Richer than plain name strings; enables trash indicators without extra API calls |
| Empty `_trash/` cleanup | Auto-remove empty `_trash/` dirs after restore/delete | Prevents accumulation of empty directories |
| Bucket trash in admin layer | Pure filesystem operations, no nDB core | `_trash/` is a filesystem convention; admin reads/writes directly |
| File conflict on restore | Fail with clear error message | Prevents silent overwrites; user must delete existing file first |

---

## 8. Filesystem Layout Summary

```
data/ndb/{database-name}/
├── meta.json                    ← Database metadata (display, buckets config)
├── db.jsonl                     ← Active documents (append-only, in-memory)
├── trash.jsonl                  ← Deleted documents (append-only, on-disk only)
└── buckets/
    └── {bucket-name}/
        ├── {hash}.{ext}         ← Active files
        └── _trash/
            ├── {hash}.{ext}                 ← Deleted files
            └── {hash}.{ext}.meta.json       ← Deletion metadata sidecars
```

```
data/nvdb/{database-name}/
├── {collection-name}/
│   ├── wal.log                  ← Write-ahead log
│   ├── segment_001.dat          ← Merged data segments
│   └── index.hnsw               ← HNSW index file
└── (no trash — deletions are permanent)
```

---

## 9. Open Questions

1. **Should `compact()` auto-create trash.jsonl or should it be pre-created?**
   → Auto-create on first deletion during compaction. If trash.jsonl doesn't exist, create it.

2. **Should trash.jsonl have a size limit?**
   → Not enforced at the nDB level. Admin can purge trash manually. Future: configurable auto-purge after N days.

3. **Should `restore()` from trash preserve the original `_id`?**
   → Yes. The document is re-inserted with its original `_id`, `_created`, and `_modified` timestamps. Only `_deleted` is removed.

4. **What happens if a document with the same `_id` already exists when restoring?**
   → The restore should fail with a clear error: "Document with _id already exists. Delete or rename it first."

5. **Should bucket file trash be configurable (enable/disable)?**
   → Yes, per-database via `meta.json`: `{ "buckets": { "attachments": { "trash": true } } }`. Default: enabled.

6. **Should the nDB core handle trash, or should the nGDB service layer?**
   → **nDB core** handles writing trash.jsonl during `compact()` (it has access to the deleted documents). The **nGDB service layer** handles reading trash and restore/purge operations (filesystem-level, no nDB core needed).
