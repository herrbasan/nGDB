// src/handlers/db.js — Transport-agnostic nDB proxy handlers
// Each handler is a plain function: (params, context) -> result
// No HTTP knowledge. Pure proxy to nDB native API.

const { Database } = require('ndb');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const { ndbDataDir } = require('../middleware/tenancy');

// Open database instances by handle ID
// Map stores { db, path } objects so admin UI can retrieve the path
const instances = new Map();

// Auto-discover and open all databases on disk
async function autoOpenDatabases() {
  const baseDir = ndbDataDir();
  let count = 0;
  
  function scanAndOpen(dir, depth = 0) {
    if (depth > 2) return;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.startsWith('_') || entry.startsWith('.')) continue;
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && entry.endsWith('.jsonl')) {
          try {
            // Check if already open
            const alreadyOpen = Array.from(instances.values()).some(inst => inst.path === fullPath);
            if (!alreadyOpen) {
              const db = Database.open(fullPath);
              const handle = randomUUID();
              instances.set(handle, { db, path: fullPath });
              console.log('[db] Auto-opened:', fullPath, 'handle:', handle.substring(0, 8));
              count++;
            }
          } catch (e) {
            console.error('[db] Failed to auto-open:', fullPath, e.message);
          }
        } else if (stat.isDirectory()) {
          scanAndOpen(fullPath, depth + 1);
        }
      }
    } catch (e) {}
  }
  
  scanAndOpen(baseDir);
  return count;
}

// Recursively scan for database files
function scanForDatabases(dir, baseDir, depth = 0) {
  const databases = [];
  
  if (depth > 3) return databases; // Limit recursion depth
  
  try {
    const entries = fs.readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      
      // Skip hidden and system directories/files
      if (entry.startsWith('_') || entry.startsWith('.')) continue;
      
      if (stat.isFile() && entry.endsWith('.jsonl')) {
        // Found a database file - use the parent directory name as the database name
        // e.g., data/ngdb-countries/db.jsonl -> name: ngdb-countries
        const parentDir = path.basename(dir);
        const name = parentDir !== path.basename(baseDir) ? parentDir : entry.slice(0, -7);
        
        // Skip trash files
        if (entry === 'trash.jsonl') continue;
        
        databases.push({
          name,
          path: fullPath,
          size: stat.size,
          modified: stat.mtime.toISOString()
        });
      } else if (stat.isDirectory()) {
        // Recurse into subdirectory
        databases.push(...scanForDatabases(fullPath, baseDir, depth + 1));
      }
    }
  } catch (err) {
    // Ignore errors (permission denied, etc)
  }
  
  return databases;
}

// List available databases in the data directory
function listAvailable(params, ctx) {
  const tenantId = ctx && ctx.tenantId;
  const baseDir = ndbDataDir(tenantId);
  
  console.log('[db] Scanning for databases in:', baseDir);
  
  let databases = [];
  
  try {
    // Ensure directory exists
    if (!fs.existsSync(baseDir)) {
      console.log('[db] Data directory does not exist:', baseDir);
      return { databases };
    }
    
    databases = scanForDatabases(baseDir, baseDir);
    
  } catch (err) {
    console.error('[db] Error scanning for databases:', err.message);
  }
  
  console.log('[db] Found databases:', databases);
  return { databases };
}

function open(params, ctx) {
  const tenantId = ctx && ctx.tenantId;
  const baseDir = ndbDataDir(tenantId);
  const dbPath = path.isAbsolute(params.path) ? params.path : path.join(baseDir, params.path);
  console.log('[db] Opening database:', dbPath, 'tenant:', tenantId);
  const options = params.options;
  const db = options ? Database.open(dbPath, options) : Database.open(dbPath);
  const handle = randomUUID();
  instances.set(handle, { db, path: dbPath });
  console.log('[db] Database opened, handle:', handle, 'total instances:', instances.size);
  return { handle };
}

function close(params, ctx) {
  const handle = params.handle;
  const entry = instances.get(handle);
  if (!entry) throw new Error(`nDB instance not found: ${handle}`);
  entry.db.flush();
  if (typeof entry.db.close === 'function') {
    entry.db.close();
  }
  instances.delete(handle);
  return { ok: true };
}

function insert(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const id = entry.db.insert(params.doc);
  return { id };
}

function get(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const doc = entry.db.get(params.id);
  return { doc };
}

function update(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  entry.db.update(params.id, params.doc);
  return { ok: true };
}

function delete_(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  entry.db.delete(params.id);
  return { ok: true };
}

async function query(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);      
  const results = await entry.db.query(params.ast);
  return { results };
}

async function queryWith(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);      
  const results = await entry.db.queryWith(params.ast, params.options);
  return { results };
}

function find(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const results = entry.db.find(params.field, params.value);
  return { results };
}

function findRange(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const results = entry.db.findRange(params.field, params.min, params.max);
  return { results };
}

function iter(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const docs = entry.db.iter();
  return { docs };
}

function len(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const count = entry.db.len();
  return { count };
}

function contains(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const exists = entry.db.contains(params.id);
  return { exists };
}

function createIndex(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  entry.db.createIndex(params.field);
  return { ok: true };
}

function dropIndex(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  entry.db.dropIndex(params.field);
  return { ok: true };
}

function flush(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  entry.db.flush();
  return { ok: true };
}

function insertWithPrefix(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const id = entry.db.insertWithPrefix(params.prefix, params.doc);
  return { id };
}

function openInMemory(params, ctx) {
  const db = Database.openInMemory();
  const handle = randomUUID();
  instances.set(handle, { db, path: ':memory:' });
  return { handle };
}

function isEmpty(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const empty = entry.db.isEmpty();
  return { empty };
}

function createBTreeIndex(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  entry.db.createBTreeIndex(params.field);
  return { ok: true };
}

function hasIndex(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const exists = entry.db.hasIndex(params.field);
  return { exists };
}

async function compact(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);      
  await entry.db.compact();
  return { ok: true };
}

function restore(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  entry.db.restore(params.id);
  return { ok: true };
}

function deletedIds(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const ids = entry.db.deletedIds();
  return { ids };
}

// ─── File Bucket Handlers ──────────────────────────────────────────

function storeFile(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const meta = entry.db.storeFile(params.bucket, params.name, Buffer.from(params.data, 'base64'), params.mimeType);
  return { meta };
}

function getFile(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const data = entry.db.getFile(params.bucket, params.hash, params.ext);
  return { data: data.toString('base64') };
}

function deleteFile(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  entry.db.deleteFile(params.bucket, params.hash, params.ext);
  return { ok: true };
}

function listFiles(params, ctx) {
  const entry = instances.get(params.handle);
  if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
  const files = entry.db.listFiles(params.bucket);
  return { files };
}

// Handler registry — action name -> handler function
const handlers = {
  open,
  close,
  insert,
  get,
  update,
  delete: delete_,
  query,
  queryWith,
  find,
  findRange,
  iter,
  len,
  contains,
  createIndex,
  createBTreeIndex,
  dropIndex,
  hasIndex,
  flush,
  compact,
  insertWithPrefix,
  openInMemory,
  isEmpty,
  restore,
  deletedIds,
  listAvailable,
  // Bucket operations
  storeFile,
  getFile,
  deleteFile,
  listFiles,
};

module.exports = { handlers, instances, autoOpenDatabases };
