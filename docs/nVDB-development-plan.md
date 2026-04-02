# nVDB Development Plan

> Embedded vector database development roadmap

**Reference:** [nVDB Specification](./nVDB-spec.md)

---

## Core Development Maxims
- **Priorities:** Reliability > Performance > Everything else.
- **Hardware Agnostic SIMD:** Vector distances should operate at near wire-speed from CPU cache utilizing AVX-512 level instructions inherently where possible, paying attention to struct alignment rather than manual intrinsics where appropriate.
- **Vanilla JS:** No TypeScript anywhere. `.d.ts` used purely for context tooling. 
- **Zero Dependencies:** Raw standard libraries in Node, minimal proven crates in Rust (`serde`, `parking_lot`, `fastrand`). Avoid deeply nested un-auditable graph network libraries.
- **Fail Fast, Always:** No defensive coding. No mock data, no fallback defaults, and no silencing `try/catch` blocks. The goal is to write perfect, deterministic software. When it breaks, let it crash and fix the root cause.

---

## Completed Phases

- **Phase 1: Storage Core** ✅ In-memory vector store, memtable, structural scaffolding.
- **Phase 2: Segment Layer** ✅ Immutable read-only structural binary files using memory-mapping (`mmap`). SIMD structural alignment.
- **Phase 3: Write-Ahead Log (WAL)** ✅ Durability, append-only logs, and recovery routines.
- **Phase 4: HNSW Graph Indexing** ✅ Approximate Nearest Neighbor sub-linear graph building and querying implementation (CSR based).
- **Phase 5: Concurrency Model** ✅ `MutEx` wrapping single-writer processes, `ArcSwap` based lock-free concurrent multi-reading.
- **Phase 6: N-API Bindings** ✅ Node.js layer implementations via `napi-rs` enabling `insert`, `search` and `compact` directly from JS.

---

## Phase 7: Folder Structure Alignment
**Goal:** Align nVDB metadata files conceptually with nDB to standardize the tooling and ecosystem logic across both repositories.

- [x] **Rename `MANIFEST` to `meta.json`**
  - Update `nvdb/src/manifest.rs` constant and structs.
  - Implement backwards compatibility (silently swap `MANIFEST` to `meta.json` when booting legacy DBs over the same directory).
  - Update all test and benchmark references to the old file name.

---

## Phase 8: CLI & Snapshot Tooling
**Goal:** Provide a native Rust CLI to operate nVDB outside of Node.js constraints, allowing direct administration and data transportability via the unified Snapshots format.

**Reference:** [CLI & Snapshot Specification](./cli-spec.md)

- [ ] **CLI Infrastructure**
  - **No dependencies:** Do NOT use `clap`. We stick to the maxims. The CLI must be fully parsed natively using `std::env::args()`. Simple > Abstraction.
  - Create `src/bin/nvdb.rs` as a standalone executable. Do not share a workspace or create a common CLI crate with nDB. LLMs read standalone files best.
- [ ] **Database Inspection (`nvdb info`)**
  - Read `meta.json`.
  - Compile vectors counts internally vs Segment size logic.
  - Extrapolate WAL usage statistics.
- [ ] **Offline Compaction (`nvdb compact`)**
  - CLI command to trigger an in-place snapshot/merge of segments.
  - Allows manual HNSW topology rebuilding out-of-band.
- [ ] **Snapshot System (`nvdb export` / `ndb import`)**
  - Core API `export_snapshot(target_dir)` inside `Collection`: Performs a compaction merge, but writes the output strictly into `<target_dir>`, placing an `index.hnsw` and `snapshot.json` metadata flag alongside the un-fragmented active dataset. No WAL log file included by design.
  - CLI command `nvdb export <db-path> <export-dir>` passing target constraints.
  - CLI command `nvdb import <snapshot-dir> <target-db-path>` validating snapshot format and executing a clean file-copy of the elements towards runtime.