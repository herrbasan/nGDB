# nDB & nVDB CLI Specification

> Unified Command Line Interface and Snapshot Tooling for the nGDB ecosystem.

## Overview

The `ndb` and `nvdb` databases act as embedded engines within Node.js / Rust applications. However, administration, snapshotting, and raw maintenance operations are best handled out-of-band by native, compiled binaries. 

This specification defines the native Rust CLIs for both `nDB` (Document DB) and `nVDB` (Vector DB), ensuring completely aligned behavior, syntax, and snapshot mechanics across both projects.

## Core Philosophy

- **Native Rust Binaries & Zero Dependencies:** Distributed as zero-dependency compiled executables. No Node.js runtime is required to manage the databases. We explicitly reject adding CLI parsing libraries (no `clap`). Argument parsing is done simply via `std::env::args()`. Simple code > Abstraction.
- **Safety via Read-Only Mode & Cross-Process Realities:** The CLI runs as a completely separate OS process from the active Node.js/Rust application. It cannot see the application's in-memory `RwLock` or `Mutex`. Therefore:
  - **Live / Fuzzy Reads:** Because the databases use append-only files (`db.jsonl` and `wal.log`), the CLI *can* safely read them while the live app is writing. It inherently discards partial JSON lines or truncated WAL records. Commands like `dump`, `info`, or `export` can run concurrently with a live database, producing a "crash-consistent" output.
  - **Point-in-Time Consistency:** For a guaranteed, stable point-in-time snapshot without tearing, the application must toggle **Read-Only Mode** (`db.set_read_only(true)`), which drops a `.readonly` marker. 
  - **Mutations are Offline/Read-Only strictly:** Commands that mutate architecture (`compact`, `rebuild-index`, `config set`) look for an advisory `.lock` file (created by the live process). If `.lock` exists and `.readonly` does NOT exist, mutating commands immediately **fail-fast (Exit Code 3)** to prevent split-brain state or corruption. Note: `config set` is strictly offline-only, since changing `meta.json` while Node.js caches it in memory is unsafe.
- **Snapshot over Tarballs:** A snapshot is simply a 100% clean, fully compacted, and valid database folder with an added `snapshot.json` marker. We do not enforce custom opaque archive formats. Snapshots must contain a matching schema/engine `version` field; importing across breaking versions fails gracefully.
- **Fail Fast & Expose Exit Codes:** Every command provides strict Unix exit codes: `0` (Success), `1` (General Error/Invalid Arg), `2` (Corruption Detected), `3` (Database Active/Lock Acquisition Failed).
- **Progress Visibility:** Long-running operations (`compact`, `recover`, `merge`, `rebuild-index`) emit standard human-readable text to `stderr` by default. We do not add complex JSON event emitters for progress; "Dumb = Fast".

---

## 1. Snapshot Format Specification

A **Snapshot** is a pristine, read-only representation of a database at a point in time, free of trash, Write-Ahead Logs (WAL), and fragmentation.

Every snapshot directory must contain a `snapshot.json` file at its root to be considered a valid import target:

```json
{
  "type": "ndb",          // "ndb" or "nvdb"
  "version": 1,           // Snapshot schema version
  "timestamp": 1743235200000, // Epoch milliseconds of creation
  "original_path": "/var/data/countries" // For logging/provenance
}
```

### 1.1 nDB Snapshot Structure
- `snapshot.json` (Marker)
- `meta.json` (Configuration and buckets)
- `db.jsonl` (Pure active documents, 0 tombstones)
- `buckets/` (Only active files, absolutely NO `_trash/` folders)
- *(Note: `trash.jsonl` is explicitly omitted)*

### 1.2 nVDB Snapshot Structure
- `snapshot.json` (Marker)
- `meta.json` (Configuration and metadata, formally `MANIFEST`)
- `segments/1743235200000.nvdb` (A **single**, unified, fully compacted binary segment)
- `index.hnsw` (A freshly compiled CSR graph covering the single segment)
- *(Note: `wal.log` is explicitly omitted)*

---

## 2. Shared CLI Commands

Both executables (`ndb` and `nvdb`) expose an identical CLI surface parsed manually via `std::env::args`. No external parsers are used.

### `init`
Initializes a new, empty database structure at the specified path.
```bash
# nDB requires knowing which buckets to configure upfront (optional)
$ ndb init ./data/countries --buckets attachments,thumbnails

# nVDB requires the vector dimension size
$ nvdb init ./data/embeddings --dim 768
```
**Behavior:** 
Creates the folder structure and an initial `meta.json` with the required parameters. Refuses to run if the directory is not empty.

### `destroy` (or `drop`)
Safely deletes a database folder.
```bash
$ ndb destroy ./data/countries --force
```
**Behavior:** 
Validates that the target is an actual nDB/nVDB database (by checking for `meta.json`) before recursively deleting the directory. The `--force` flag is required to prevent accidental execution.

### `info`
Reads the folder state and metadata without modifying anything.
```bash
$ ndb info ./data/countries
```
**Output:**
- **Status:** Valid / Invalid (Missing meta.json, etc.)
- **Active Documents:** Exact count of active rows.
- **Disk Usage:** Total bytes on disk.
- **Fragmentation / Trash:** Bytes locked in `trash.jsonl` (nDB) or `wal.log` and segment tombstones (nVDB).
- **Buckets (nDB only):** List of buckets and their individual sizes.

### `compact`
Triggers a blocking, in-place compaction routine. Perfect for cron jobs.
```bash
$ ndb compact ./data/countries
```
**Behavior:**
- **Locking:** Explicitly requests an exclusive lock. If the database is actively mounted and writing in a live Node.js process, the CLI process will block or fail and exit code `3`.
- **nDB:** Merges `db.jsonl`, removing deleted docs. Flushes older trash beyond TTL. Cleans bucket `_trash/`.
- **nVDB:** Flushes the WAL. Merges all `segments/*.nvdb` into a single file. Rebuilds `index.hnsw`. Rewrites `meta.json`.
- **Progress:** Outputs `[1/4] Scanning blocks... [2/4] Merging segments...` to `stderr`.

### `export` (Create Snapshot)
Generates a pristine snapshot directory.
```bash
$ ndb export ./data/countries /backups/countries-snap --consistent
```
**Behavior:**
- Executes the exact same core algorithm as `compact`, except it writes its output directly into the target directory rather than swapping `meta.json` at the source. This ensures zero code duplication in the engine internals.
- Drops a valid `snapshot.json` at the root of the output directory containing the engine `version`.
- **Locking:** By default, it ignores the `.lock` file and streams a "crash-consistent" (fuzzy) snapshot from the append-only logs. If `--consistent` is provided, it explicitly requires a `.readonly` advisory lock to exist before exporting, guaranteeing point-in-time exactness.

### `import` (Restore Snapshot)
Validates a snapshot and hydrates it into a new, live database location.
```bash
$ ndb import /backups/countries-snap ./data/countries-restored --force
```
**Behavior:**
- Asserts the presence and validity of `snapshot.json`, checking if `"type"` and `"version"` match the CLI tool (fails cleanly if importing v2 snapshot into v1 engine).
- Copies the `meta.json`, `db.jsonl`/`segments`, etc. to the new target directory. 
- **Strictly non-destructive by default:** Refuses to run if the target directory exists and is not empty. If replacing a live database is required implicitly, passing `--force` explicitly invokes `rm -rf` logic on the target before validating the new state. 
- Ensures the final folder is ready to be instantly opened by the active Node.js binding.

### `merge` (Combine Databases or Snapshots)
Takes a live database (or snapshot) and merges it with another, outputting the result into a completely new, third database folder.
```bash
$ ndb merge ./data/countries-part1 ./data/countries-part2 --output ./data/countries-unified
```
**Behavior:**
- **Locking:** Seeks shared read locks on both source folders. If writes are actively appending to either, it will wait for the writer mutex release before snapping a point-in-time read handle.
- **nDB:** Reads documents from both sources. If a NanoID collision occurs (the exact same document exists in both), the document with the highest `_modified` timestamp wins. Because file buckets are hash-named (`a3f5c2d1.png`), merging binaries deduplicates automatically and natively with zero extra effort.
- **nVDB:** Takes the binary `segments` (and `wal.log` if active) from both databases and feeds them into the standard compaction routine, funneling the output into a brand new database. The HNSW graph is rebuilt from scratch over the combined segment. If string IDs collide, the tool can default to "Source 2 overwrites Source 1".
- **Strictly non-destructive:** Neither Source 1 nor Source 2 are modified. The output is a pristine new database.
- **Progress Output:** Emits merge telemetry (e.g., `[Part 1] 50% scanned...`) to `stderr`.

---

## 3. Extended CLI Commands (Maintenance & Observability)

These commands provide advanced capabilities inspired by industry-standard embedded databases (like SQLite, LMDB, and RocksDB).

### `verify` (or `check`)
Validates the structural integrity of the entire database block-by-block.
```bash
$ nvdb verify ./data/embeddings
```
**Behavior:**
- **nDB:** Scans `db.jsonl` and `trash.jsonl` to ensure every line is valid JSON. Checks that every file hash referenced in the JSON exists physically in the corresponding bucket.
- **nVDB:** Validates CRC32 checksums within `wal.log`. Verifies 64-byte structural alignment inside `.nvdb` segment files. Optionally checks the `index.hnsw` graph links.
- Emits a non-zero exit code if corruption is detected.

### `recover`
Attempts to salvage data from a corrupted database directory. **Strictly non-destructive**; it will never modify the broken source directory.
```bash
$ ndb recover ./data/countries --output ./data/countries-recovered
```
**Behavior:**
- Always opens the source database in a strict read-only mode to prevent further mangling.
- Outputs a pristine, newly constructed database (essentially a snapshot) to the `--output` directory.
- **nDB:** Reads `db.jsonl` line-by-line. If a line is corrupted or truncated (e.g., power loss), it logs the error, skips the bad row, and streams the remaining healthy rows to the output directory's `db.jsonl`.
- **nVDB:** Replays `wal.log`, stopping exactly at the byte where CRC32 verification fails. Merges these surviving WAL entries with the healthy `.nvdb` segments and emits a salvaged snapshot to the output directory.
- Crucial for IoT and edge deployments where power loss might cause partial file writes.

### `dump` (Export as Text)
Streams the live database into a single standard output as human-readable JSON Lines.
```bash
$ nvdb dump ./data/embeddings > backup.jsonl
```
**Behavior:**
- **nDB:** Streams `db.jsonl` directly to stdout, filtering out any tombstones (soft-deleted items).
- **nVDB:** This is **critical** for nVDB. Since segments are dense binary (`mmap`), `dump` demultiplexes the internal SoA arrays and vectors, emitting standard NDJSON objects (`{"id": "...", "vector": [...], "payload": {...}}`). This guarantees "Visible = Trustworthy" for binary data.

### `config`
Programmatically gets or sets metadata values without risking manual JSON typos.
```bash
$ ndb config get display.title
$ ndb config set buckets attachments,thumbnails,audio
```
**Behavior:**
- Directly mutates `meta.json`.
- Safely validates new configurations (e.g., preventing you from removing a bucket that already has files in it).

### `query` (nDB only)
Executes a quick JSON AST query against the database directly from the terminal. Note: Because of linear parsing overhead on massive structures, this is primarily intended for admin/dev-scale probing, rather than production sub-millisecond retrieval.
```bash
$ ndb query ./data/countries '{"status": {"$eq": "active"}}'
```
**Behavior:**
- **Locking:** Shared read lock.
- Compiles the AST and runs it against the live `db.jsonl`.
- Pretty-prints the matched documents to stdout.
- Useful for quick administration without booting a Node.js REPL.

### `search` (nVDB only)
Executes an exact or approximate vector search from the terminal.
```bash
$ nvdb search ./data/embeddings '[0.1, 0.4, -0.2, ...]' --k 5
```
**Behavior:**
- Bypasses normal networking. Directly maps the segments and runs a query.
- Outputs the top `K` matched IDs and their distances.

### `rebuild-index` (nVDB only)
Forces a complete rebuild of the `index.hnsw` file without doing a full compaction.
```bash
$ nvdb rebuild-index ./data/embeddings
```
**Behavior:**
- **Locking:** Seeks an exclusive lock. Rebuilding the graph deletes the old one completely and blocks searches until finished.
- Discards the existing HNSW graph and compiles a fresh one by scanning the current memtable and segments.
- Useful if the graph file itself gets corrupted or if tuning parameters for the HNSW build change in the future.
- **Progress:** Outputs `[1/1] Rebuilding HNSW... 12% inserted` to terminal `stderr`.