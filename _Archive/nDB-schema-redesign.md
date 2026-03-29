# nDB Schema & File Structure Redesign

> Analysis and recommendations for the nDB data format, metadata, and file structure.

---

## 1. Standard Fields: `_created` and `_modified`

**Recommendation: Add to every document.**

Every document should have auto-managed timestamps. Looking at the current `ngdb-countries` data, the `_meta` line has `created` but individual documents have no timestamps at all.

- `_created` — set once on `insert()`, never modified afterward
- `_modified` — set on `insert()` and updated on every `update()`
- Both as Unix epoch milliseconds (integer), not ISO strings — consistent with the existing `_deleted` timestamp pattern in the spec
- These are **system fields** (prefixed with `_`), managed by nDB itself, not user-settable

This aligns with the existing `_id` and `_deleted` patterns already in the spec.

---

## 2. Title/Content Field Mappings in Metadata

**Recommendation: Add `display` mappings to metadata.**

The admin UI needs to know what to display in list views and detail views without guessing.

```json
{
  "_meta": {
    "version": 2,
    "created": 1743235200000,
    "display": {
      "title": "name.common",
      "content": null,
      "icon": "flag"
    },
    "buckets": ["attachments", "thumbnails"]
  }
}
```

- `display.title` — dot-notation path to the field that serves as the display title
- `display.content` — optional path to a field for preview/content display
- `display.icon` — optional path to a field for icon/emoji display
- All optional — if not defined, the admin falls back to showing `_id`

---

## 3. Metadata: Inline vs. Separate File

### Analysis

| Aspect | Inline in JSONL | Separate `meta.json` |
|--------|----------------|---------------------|
| Portability | Single file — copy and go | Folder is the unit — copy folder |
| Atomic updates | Hard — rewrite first line of append-only | Easy — just write the JSON file |
| Data purity | First line is special, not real data | Data file is pure append-only log |
| Admin writes | Must touch data file | Independent — no data file concern |
| Tooling | `wc -l` off by one, `grep` hits meta | Clean — data file is pure documents |
| Sync risk | Zero — it is one file | Minimal — folder is atomic unit |

### Recommendation: Separate `meta.json` file

Reasons:

1. **Folder-based structure already committed** — a `meta.json` alongside `db.jsonl` is natural
2. **Metadata is configuration, not data** — it defines how to interpret the data
3. **Admin needs to write it** — update display mappings without touching the data file
4. **Append-only purity** — data file is a pure append-only log, no special first-line handling
5. **Versioning** — `meta.json` can evolve independently from the data format

---

## 4. Folder-Based Database Structure

### Current structure (flat file):

```
data/ndb/data/ngdb-countries    ← Single file, metadata in first line
```

### Proposed structure (folder per database):

```
data/
  ndb/
    countries/                    ← Database folder = database name
      meta.json                   ← Database metadata (version, display, buckets)
      db.jsonl                    ← Active documents (pure append-only)
      trash.jsonl                 ← Soft-deleted documents
      buckets/                    ← File storage root
        attachments/
          a3f5c2d1.png
          _trash/                 ← Per-bucket trash for deleted files
            b7e9a4f2.jpg
        thumbnails/
          a3f5c2d1_128x128.png
          _trash/
    conversations/                ← Another database
      meta.json
      db.jsonl
      trash.jsonl
      buckets/
        media/
          x1y2z3a4.mp3
          _trash/
```

### Key design decisions:

- `db.jsonl` — standardized name, no guessing
- `trash.jsonl` — single file replaces dated trash files, simpler, still append-only
- `buckets/` — clearly separated from document storage
- `_trash/` inside each bucket — underscore prefix keeps it hidden from normal listing
- Database name = folder name — no indirection

---

## 5. Proposed Schema Examples

### `meta.json`

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

### Document in `db.jsonl`

```json
{
  "_id": "V1StGXR8Z5jdHi6B",
  "_created": 1743235200000,
  "_modified": 1743235200000,
  "name": {"common": "Aruba", "official": "Aruba"},
  "flag": "🇦🇼"
}
```

### Deleted document in `trash.jsonl`

```json
{
  "_id": "V1StGXR8Z5jdHi6B",
  "_deleted": 1743235300000,
  "_created": 1743235200000,
  "_modified": 1743235200000,
  "name": {"common": "Aruba", "official": "Aruba"}
}
```

---

## Resolved Decisions

1. **Should `_created`/`_modified` be injected by nDB core (Rust) or by the nGDB service layer (Node.js)?**
   - **Decision: Rust core** — all entries get timestamps regardless of context

2. **Should `buckets` in meta be declarative only, or should nDB enforce that only declared buckets can be used?**
   - **Decision: Enforced (Option B)** — buckets must be declared in meta.json before use. nDB rejects operations on undeclared buckets. Prevents typo-based duplicate buckets.

3. **Migration path for existing data?**
   - **Decision: Manual edit** — simple file, just restructure by hand
