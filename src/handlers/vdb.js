// src/handlers/vdb.js — Transport-agnostic nVDB proxy handlers
// Each handler is a plain function: (params, context) -> result
// No HTTP knowledge. Pure proxy to nVDB native API.

const { Database } = require('nvdb');
const { randomUUID } = require('crypto');
const path = require('path');
const { nvdbDataDir } = require('../middleware/tenancy');

// Open database instances by handle ID
const instances = new Map();

// Collection cache: "handle::collectionName" -> Collection object
// nVDB collections are locked when opened; caching avoids re-locking.
const collectionCache = new Map();

function getCollectionObj(dbHandle, db, name) {
  const key = `${dbHandle}::${name}`;
  if (collectionCache.has(key)) return collectionCache.get(key);
  const collection = db.getCollection(name);
  collectionCache.set(key, collection);
  return collection;
}

// ─── Database Lifecycle ────────────────────────────────────────────

function open(params, ctx) {
  const tenantId = ctx && ctx.tenantId;
  const baseDir = nvdbDataDir(tenantId);
  const dbPath = path.isAbsolute(params.path) ? params.path : path.join(baseDir, params.path);
  const db = new Database(dbPath);
  const handle = randomUUID();
  instances.set(handle, db);
  return { handle };
}

function close(params, ctx) {
  const handle = params.handle;
  // Drop all cached collections for this handle
  for (const key of collectionCache.keys()) {
    if (key.startsWith(`${handle}::`)) collectionCache.delete(key);
  }
  instances.delete(handle);
  return { ok: true };
}

// ─── Collection Management ─────────────────────────────────────────

function createCollection(params, ctx) {
  const db = instances.get(params.handle);
  const collection = db.createCollection(params.name, params.dimension, params.options);
  // Cache the collection to avoid re-locking on subsequent access
  collectionCache.set(`${params.handle}::${params.name}`, collection);
  return { name: collection.name };
}

function getCollection(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.name);
  const config = collection.config;
  const stats = collection.stats;
  return {
    name: collection.name,
    config: { dim: config.dim, durability: config.durability },
    stats: { memtableDocs: stats.memtableDocs, segmentCount: stats.segmentCount, totalSegmentDocs: stats.totalSegmentDocs },
  };
}

function listCollections(params, ctx) {
  const db = instances.get(params.handle);
  const names = db.listCollections();
  return { names };
}

// ─── Document Operations ───────────────────────────────────────────

function insert(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  collection.insert(params.id, params.vector, params.payload);
  return { ok: true };
}

function insertBatch(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  collection.insertBatch(params.docs);
  return { ok: true };
}

function get(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  const doc = collection.get(params.id);
  if (!doc) return { doc: null };
  return { doc: { id: doc.id, vector: doc.vector, payload: doc.payload } };
}

function delete_(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  const existed = collection.delete(params.id);
  return { existed };
}

// ─── Search ────────────────────────────────────────────────────────

function search(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  const raw = collection.search({
    vector: params.vector,
    topK: params.topK,
    distance: params.distance,
    approximate: params.approximate,
    ef: params.ef,
    filter: params.filter,
  });
  const results = raw.map((m) => ({ id: m.id, score: m.score, payload: m.payload }));
  return { results };
}

// ─── Collection Maintenance ────────────────────────────────────────

function flush(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  collection.flush();
  return { ok: true };
}

function sync(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  collection.sync();
  return { ok: true };
}

function compact(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  const r = collection.compact();
  return { result: { docsBefore: r.docsBefore, docsAfter: r.docsAfter, segmentsMerged: r.segmentsMerged, indexRebuilt: r.indexRebuilt } };
}

function rebuildIndex(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  collection.rebuildIndex();
  return { ok: true };
}

function deleteIndex(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  collection.deleteIndex();
  return { ok: true };
}

function hasIndex(params, ctx) {
  const db = instances.get(params.handle);
  const collection = getCollectionObj(params.handle, db, params.collection);
  const exists = collection.hasIndex();
  return { exists };
}

// Handler registry — action name -> handler function
const handlers = {
  open,
  close,
  createCollection,
  getCollection,
  listCollections,
  insert,
  insertBatch,
  get,
  delete: delete_,
  search,
  flush,
  sync,
  compact,
  rebuildIndex,
  deleteIndex,
  hasIndex,
};

module.exports = { handlers, instances, collectionCache };
