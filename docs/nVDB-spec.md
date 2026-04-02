# nVDB Design Document

> Embedded Vector Database - High-performance, memory-mapped storage for real-time AI and LLM workflows.
> Standalone embeddable vector database for Node.js and Rust applications.

## Ecosystem Overview

nVDB is developed as part of the **nGDB workspace** alongside nDB (general document storage). It is published as a standalone npm package and cargo crate.

### Project Context

While nDB focuses on human-readable standard JSON documentation, **nVDB** serves as a specialized engine for dense vector embeddings, emphasizing maximum hardware utilization (SIMD, memory mapping) and low-latency nearest-neighbor search. 

Both projects share the same overarching philosophy:
- Embedded by default
- Zero-magic abstractions
- Standalone execution with direct N-API Node.js bindings

## Core Philosophy

- **Deterministic correctness**: Design failures away rather than handling them
- **Zero-cost abstractions**: Pay only for what you use (e.g., mmap reads)
- **Instant recovery**: Memory-mapped persistence means large datasets don't require heavy load phases into RAM
- **Read-heavy optimization**: Readers never block; writers use append-only mechanisms

## Runtime Architecture

```
┌──────────────────────────────────────────────────────────┐
│                       Application                         │
├──────────────┬───────────────────┬────────────────────────┤
│   Insert /   │   Exact Search    │   Approximate Search   │
│   Delete     │   (Brute-force)   │   (HNSW Index)         │
│   WAL + MT   │   SIMD Scan       │   Graph Traversal      │
├──────────────┴───────────────────┴────────────────────────┤
│                    Collection                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │  Memtable   │  │  Segments    │  │  HNSW Index      │ │
│  │  (HashMap)  │  │  (mmap)      │  │  (CSR Graph)     │ │
│  │  Read+Write │  │  Read-only   │  │  On-demand load  │ │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘ │
│         │                │                    │           │
├─────────┴────────────────┴────────────────────┴───────────┤
│                      WAL (Append-Only)                    │
│              Crash Recovery + Durability                  │
├───────────────────────────────────────────────────────────┤
│                    Filesystem                             │
│     MANIFEST │ wal.log │ segments/*.nvdb │ index.hnsw     │
└───────────────────────────────────────────────────────────┘
```

## Concurrency Model

nVDB employs a **Single-Writer, Multi-Reader** model using `RwLock` and `ArcSwap` for lock-free reading.

| Operation | Lock | Behavior |
|-----------|------|----------|
| `insert()` | WAL `Mutex` + memtable `RwLock` (write) | Exclusive write |
| `delete()` | WAL `Mutex` + memtable `RwLock` (write) | Exclusive write |
| `get()` | memtable `RwLock` (read) + `ArcSwap` segments | Concurrent lock-free reads |
| `search()` | memtable `RwLock` (read) + `ArcSwap` segments | Concurrent lock-free reads |
| `flush()` | memtable `RwLock` (write) + manifest `Mutex` | Blocks writes |
| `compact()` | Full synchronization | Blocks all operations |

By leveraging `ArcSwap`, when new segments are flushed or compacted, the atomic pointer is simply swapped, completely eliminating blocking for existing concurrent readers accessing the segments.

## Storage Storage Format (LSM-Lite)

Each collection acts as a pure, independent directory on disk. 

```
data/
  nvdb/
    embeddings/                     ← Collection folder
      MANIFEST                      ← Metadata, schema, and active segment state
      wal.log                       ← Append-only Write-Ahead Log
      index.hnsw                    ← (Optional) Compiled HNSW Graph
      segments/                     
        1743235200000.nvdb          ← Immutable read-only chunk of vectors
        1743235205500.nvdb
```

### Components

#### 1. MANIFEST
A JSON document atomically tracking collection state.
- Records Vector dimension scale (`dim: 768`, etc)
- Tracks list of active `.nvdb` segment files.
- Tracks `last_wal_seq` to identify recoverability point for system crashes.
- Updated strictly via `write-to-temp + fsync + rename` preventing corruption.

#### 2. WAL (Write-Ahead Log)
An append-only binary log: `wal.log`
- Recovers crash state: Un-flushed vectors are written here immediately.
- Flushes dynamically: Once `wal.log` hits a size limit (e.g. 64MB), the Memtable is flushed to an immutable segment, and the WAL resets.

#### 3. Segments (`segments/*.nvdb`)
Immutable binary files composed of densely packed structs mapped directly into RAM via `mmap`.

```text
┌───────────────────────────────────────────────┐
│ Header (64 bytes, aligned)                    │
├───────────────────────────────────────────────┤
│ Vector Data (64-byte aligned for AVX-512)     │
│ [dim × 4 bytes] vector[0]                     │
│ [dim × 4 bytes] vector[1]                     │
├───────────────────────────────────────────────┤
│ ID Mapping (u32 internal ↔ String external)   │
├───────────────────────────────────────────────┤
│ Payloads (Length-prefixed JSON)               │
└───────────────────────────────────────────────┘
```
- **Zero-Copy Access**: The OS handles paging vector bytes directly into CPU cache.
- **Hardware Agnostic SIMD**: Structures are 64-byte aligned allowing modern instructions (AVX-512, Neon) to process distances simultaneously without memory shifting over-head.

#### 4. Memtable
The high-speed transient layer storing all recently written vectors. Contains a `HashMap` mapping String IDs to Internal `u32` IDs, accelerating O(1) existence checks. It uses a Struct-of-Arrays (SoA) layout to allow identical SIMD traversal as typical file segments.

#### 5. HNSW Index (`index.hnsw`)
A compiled CSR (Compressed Sparse Row) graph structure representing a Hierarchical Navigable Small World algorithm. 
- Allows Sub-linear approximation searches across multimillion vector sets.
- Built transparently during compaction processes from segments.

## Document `id` & Mapping

nVDB abstracts String identifiers requested by application layers to Internal `u32` counterparts.

- **External `id`**: Standard Application unique IDs (Strings / NanoIDs etc). Used by API parameters.
- **Internal `u32`**: A continuously increasing integer utilized internally inside Memtables and Segments. Extremely dense layout preventing memory bloat inside Graph and Segment lookup structures.

All segment files append an `ID Mapping` block at their tail matching External Strings to their physical representation in the internal vector matrix.

## Compaction (LSM Background Merging)

Like nDB, nVDB must groom soft-deleted records and consolidate fragmented data over time.

1. Takes multiple fragmented `.nvdb` Segment files + the active Memtable.
2. Removes deleted elements.
3. Repacks them into a single, contiguous newly-created `.nvdb` Segment.
4. Generates an entirely new `index.hnsw` covering the consolidated footprint.
5. Atomically swaps the `MANIFEST` replacing the fragment list with the singular structure.

## Summary vs nDB Spec Differences

While nDB embraces visible, editable JSON lines (`db.jsonl`, `trash.jsonl`), **nVDB strictly relies on binary alignment (`.nvdb`, `wal`)** due to the sheer computational reality of distance-calculation iteration (requiring millions of floats matched per millisecond).

Where nDB has direct soft-deletes via a dedicated `trash.jsonl`, nVDB utilizes the `wal.log` and segments' tombstone logic directly; pruning and garbage collection is completely opaque to the user and resolved natively out-of-filesystem sight within the Segments.
