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

## Completed Phases
- **Phase 1: Storage Core** ✅ Basic JSON Lines storage, NanoID, single-writer Mutex.
- **Phase 2: Advanced Core** ✅ Updates, iteration, compaction, and trash handling.
- **Phase 3: File Buckets** ✅ Binary storage, hashing, deduplication.
- **Phase 4: Query Layer** ✅ JSON AST query evaluator, opt-in indexing.
- **Phase 5: N-API Bindings** ✅ Node.js integration via napi-rs.
- **Phase 6: Production Polish** ✅ Benchmarks, crash recovery, edge-case hardening.

---

## Phase 7: CLI & Snapshot Tooling (Current)
**Goal:** Provide a native Rust CLI for maintaining databases and exporting portable snapshots. 

**Reference:** [CLI & Snapshot Specification](./cli-spec.md)

- [x] **CLI Infrastructure**
  - **No dependencies:** Do NOT use `clap`. We stick to the maxims. The CLI must be fully parsed natively using `std::env::args()`. Simple > Abstraction.
  - Create `src/bin/ndb.rs` as the database management executable. We actively reject building a `shared-cli-crate`, since having self-contained, independent scripts maps much better to an LLM context window than deeply nested DRY abstractions.
- [x] **Database Inspection (`ndb info`)**
  - Read `meta.json`.
  - Calculate document counts, active size vs. trash size, and fragmentation ratio.
  - Output human-readable statistics to terminal.
- [x] **Offline Compaction (`ndb compact`)**
  - CLI command to trigger an in-place compaction out-of-band from the Node process.
- [x] **Snapshot System (`ndb export` / `ndb import`)**
  - Core API `export_snapshot(target_dir)`: streams active data directly into a pristine, zero-trash directory with `snapshot.json`.
  - CLI command `ndb export <db-path> <export-dir>` wrapping the API.
  - CLI command `ndb import <snapshot-dir> <dest-path>` for validating a snapshot and positioning it for the application.

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