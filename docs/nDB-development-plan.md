# nDB Development Plan

> Document database development roadmap

**Reference:** [nDB Specification](./nDB-spec.md)

---

## Core Development Maxims
- **Priorities:** Reliability > Performance > Everything else.
- **LLM-Native Codebase:** Code readability and structure for *humans* is a non-goal. The code will not be maintained by humans. Optimize for the most efficient structure an LLM can understand. Do not rely on conventional human coding habits.
- **Vanilla JS:** No TypeScript anywhere. Code must stay as close to the bare platform as possible for easy optimization and debugging. `.d.ts` files are generated strictly for LLM/editor context, not used at runtime.
- **Zero Dependencies:** If we can build it ourselves using raw standard libraries, we build it. Avoid external third-party packages. Evaluate per-case if a dependency is truly necessary.
- **Fail Fast, Always:** No defensive coding. No mock data, no fallback defaults, and no silencing `try/catch` blocks. The goal is to write perfect, deterministic software. When it breaks, let it crash and fix the root cause.

---

## Key Design Decisions

These decisions were resolved before implementation begins. See [nDB-spec §Resolved Decisions](./nDB-spec.md#resolved-decisions) for full details.

| Decision | Resolution |
|----------|------------|
| Concurrency | **Single-writer, multi-reader.** RwLock for docs, Mutex for writer. Matches Node.js event loop. |
| `_id` format | **NanoID-style: 16 chars, base62.** PRNG-generated, uniqueness check, no external crate. |
| Query API (Layer 3) | **Raw JSON AST only.** No builder pattern, no closures. JSON passes directly from API to evaluator. |
| N-API approach | **Direct napi-rs per package.** No shared nBridge module. Each package owns its bindings. |
| Operating mode | **Always in-memory.** Persistence is configurable: lazy (default), scheduled, or immediate. |
| Dependencies | **Minimize aggressively.** Build ourselves when practical. Decide per-case for true necessities. |

---

## Phase 1: Storage Core ✅
**Goal:** Basic JSON Lines storage with O(1) operations, in-memory document store

- [x] **Project setup** ([nDB-spec §Implementation Notes](./nDB-spec.md#language-rust--internal-n-api-napi-rs))
  - Rust crate structure (workspace with `napi/` sub-crate, following nVDB pattern)
  - Dev dependencies only (tempfile, criterion)

- [x] **NanoID `_id` generation** ([nDB-spec §`_id` Generation](./nDB-spec.md#_id-generation))
  - 16-char base62 PRNG-based ID generation
  - Uniqueness check against existing HashMap
  - Optional prefix support (`insert_with_prefix`)

- [x] **JSON Lines I/O** ([nDB-spec §Storage Format](./nDB-spec.md#storage-format))
  - Append-only file writer
  - Line parsing (serde_json)
  - Basic metadata header (`_meta` line)

- [x] **In-memory document store** ([nDB-spec §Layer 1: Core](./nDB-spec.md#layer-1-core-the-fast-path))
  - `RwLock<HashMap<String, Value>>` for `_id → document`
  - Load all documents from JSON Lines on open
  - Single-writer Mutex for write operations

- [x] **Core operations**
  - `insert(doc)` → generate NanoID, store in HashMap, append to file
  - `get(id)` → O(1) HashMap lookup
  - `delete(id)` → soft delete (tombstone in HashMap, append `_deleted` to file)

**Deliverable:** In-memory test passing basic CRUD with NanoID identifiers ✅

---

## Phase 2: Advanced Core ✅
**Goal:** Updates, iteration, compaction, and trash

- [x] **Update operation** ([nDB-spec §Core Methods](./nDB-spec.md#core-methods))
  - Replace document in HashMap
  - Append new version to file (old version superseded by index)

- [x] **Iteration** ([nDB-spec §iter()](./nDB-spec.md#layer-1-core-the-fast-path))
  - `iter()` over all non-deleted docs from HashMap
  - Filter out tombstones

- [x] **Compaction** ([nDB-spec §Compaction Strategy](./nDB-spec.md#compaction-strategy))
  - Scan active docs from HashMap
  - Rewrite to temp file
  - Atomic swap
  - Archive deleted docs to trash

- [x] **Trash bucket** ([nDB-spec §Compaction & Document Trash](./nDB-spec.md#compaction--document-trash))
  - Soft delete (tombstone in HashMap)
  - Trash directory structure
  - `restore()` from trash

- [x] **Persistence modes** ([nDB-spec §Operating Modes](./nDB-spec.md#operating-modes))
  - `Persistence::Lazy` (default) — flush on explicit call or shutdown
  - `Persistence::Scheduled(N)` — flush every N seconds
  - `Persistence::Immediate` — fsync after every write

**Deliverable:** Compaction working, deleted docs recoverable, configurable persistence ✅

---

## Phase 3: File Buckets ✅
**Goal:** Binary storage with deduplication

- [x] **File bucket I/O** ([nDB-spec §File Buckets](./nDB-spec.md#file-buckets---binary-storage))
  - SHA-256 hash calculation (implement ourselves)
  - Hash-based storage path
  - Atomic file writes

- [x] **File operations** ([nDB-spec §File Bucket Methods](./nDB-spec.md#file-bucket-methods))
  - `store(name, data)` → `FileRef`
  - `get(hash)` → bytes
  - `delete(hash)` → move to trash

- [x] **Trash coordination** ([nDB-spec §Trash behavior](./nDB-spec.md#file-layout))
  - File trash directory
  - Restore from trash
  - Optional TTL cleanup

**Deliverable:** Can store/retrieve files alongside documents ✅

---

## Phase 4: Query Layer ✅
**Goal:** Layer 2 & 3 query APIs

- [x] **Single field queries** ([nDB-spec §Layer 2](./nDB-spec.md#layer-2-single-field-queries-the-9))
  - `find(field, value)` - linear scan over HashMap
  - `find_where(field, predicate)`
  - Iterator-based (lazy)

- [x] **Opt-in indexing** ([nDB-spec §Opt-In Indexing](./nDB-spec.md#opt-in-indexing))
  - `create_index(field)` → HashMap
  - `find()` uses index if available
  - `drop_index()` to free memory

- [x] **JSON AST query evaluator** ([nDB-spec §Layer 3](./nDB-spec.md#layer-3-json-ast-queries-the-1))
  - `QueryNode` enum for AST representation
  - Recursive evaluator over `iter()`
  - Operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`
  - Combinators: `$and`, `$or`, `$not`
  - `query_with(ast, opts)` with limit/sort/offset

**Deliverable:** Complex queries working with optional indexes via JSON AST ✅

---

## Phase 5: N-API Bindings ✅
**Goal:** Node.js integration via direct napi-rs

- [x] **Setup napi-rs** (following nVDB's `napi/` pattern)
  - Add `napi` and `napi-derive` dependencies
  - Workspace Cargo.toml with `napi/` sub-crate
  - Setup build.rs and package.json linkage

- [x] **JS API surface** ([nDB-spec §Node.js / Electron Usage](./nDB-spec.md#nodejs--electron-usage))
  - `Database` class constructor in `napi/src/lib.rs`
  - `insert()`, `get()`, `delete()`, `update()` methods
  - `query(ast)` — accepts raw JSON object, passes as AST

- [x] **File API**
  - `bucket(name)` accessor
  - `store()`, `get()` methods
  - Buffer handling

- [x] **Package build**
  - napi-rs build config
  - Prebuild binaries
  - Vanilla JS module exports
  - `.d.ts` definitions generated for LLM/editor context only

**Deliverable:** `npm install` and `require('@ngdb/ndb')` works ✅

---

## Phase 6: Production Polish 🔄
**Goal:** Performance and reliability

- [x] **Persistence guarantees**
  - fsync options (already implemented in Phase 2, stress test here)
  - Corruption detection on load
  - Crash recovery scenarios

- [x] **Benchmarks**
  - Insert throughput (in-memory, lazy, immediate, bulk)
  - Query latency (Layer 1 get, Layer 2 find, Layer 3 JSON AST)
  - Indexed vs non-indexed query comparison
  - Compaction performance
  - Update and delete throughput
  - Iteration over large datasets

- [x] **Edge cases**
  - Empty database operations
  - Very large documents (1MB+)
  - Deeply nested documents (50 levels)
  - Documents with many fields (1000+)
  - Unicode values
  - Null and special JSON values
  - Concurrent read stress test (multi-threaded)
  - Concurrent queries during inserts
  - Power-loss simulation (partial writes, truncated lines)
  - Compaction under load
  - Full lifecycle persist/reopen

**Deliverable:** Benchmarked, production-ready package

---

## Dependencies

| Phase | Blocked By |
|-------|------------|
| 1 | - |
| 2 | Phase 1 |
| 3 | Phase 1 |
| 4 | Phase 2 |
| 5 | Phase 4 (core API stable) |
| 6 | Phase 5 |

---

## Reference: nVDB Patterns to Follow

When implementing nDB, follow the patterns established in nVDB (the reference implementation):

| Pattern | nVDB Implementation | nDB Equivalent |
|---------|--------------------|----------------|
| Error handling | `src/error.rs` — structured error enum with `Error::Corruption`, `Error::Io`, etc. | Same pattern for nDB errors |
| Workspace layout | `Cargo.toml` (workspace root) + `napi/Cargo.toml` (bindings) | Same workspace structure |
| N-API bindings | `napi/src/lib.rs` — napi-rs structs with `#[napi]` attributes | Same napi-rs approach |
| Manifest | `src/manifest.rs` — JSON manifest for collection metadata | Config/metadata for database |
| Compaction | `src/compaction.rs` — atomic file-swap, temp file cleanup | Same atomic swap strategy |
| Testing | Inline `#[cfg(test)]` modules + `tests/` directory | Same testing approach |
| Benchmarks | `benches/` with criterion | Same benchmark structure |