// src/handlers/db.js — Transport-agnostic nDB proxy handlers
// Each handler is a plain function: (params, context) -> result
// No HTTP knowledge. Pure proxy to nDB native API.

const { Database } = require('ndb');
const { randomUUID } = require('crypto');
const path = require('path');
const { ndbDataDir } = require('../middleware/tenancy');

// Open database instances by handle ID
const instances = new Map();

function open(params, ctx) {
  const tenantId = ctx && ctx.tenantId;
  const baseDir = ndbDataDir(tenantId);
  const dbPath = path.isAbsolute(params.path) ? params.path : path.join(baseDir, params.path);
  const options = params.options;
  const db = options ? Database.open(dbPath, options) : Database.open(dbPath);
  const handle = randomUUID();
  instances.set(handle, db);
  return { handle };
}

function close(params, ctx) {
  const handle = params.handle;
  const db = instances.get(handle);
  db.flush();
  instances.delete(handle);
  return { ok: true };
}

function insert(params, ctx) {
  const db = instances.get(params.handle);
  const id = db.insert(params.doc);
  return { id };
}

function get(params, ctx) {
  const db = instances.get(params.handle);
  const doc = db.get(params.id);
  return { doc };
}

function update(params, ctx) {
  const db = instances.get(params.handle);
  db.update(params.id, params.doc);
  return { ok: true };
}

function delete_(params, ctx) {
  const db = instances.get(params.handle);
  db.delete(params.id);
  return { ok: true };
}

function query(params, ctx) {
  const db = instances.get(params.handle);
  const results = db.query(params.ast);
  return { results };
}

function queryWith(params, ctx) {
  const db = instances.get(params.handle);
  const results = db.queryWith(params.ast, params.options);
  return { results };
}

function find(params, ctx) {
  const db = instances.get(params.handle);
  const results = db.find(params.field, params.value);
  return { results };
}

function findRange(params, ctx) {
  const db = instances.get(params.handle);
  const results = db.findRange(params.field, params.min, params.max);
  return { results };
}

function iter(params, ctx) {
  const db = instances.get(params.handle);
  const docs = db.iter();
  return { docs };
}

function len(params, ctx) {
  const db = instances.get(params.handle);
  const count = db.len();
  return { count };
}

function contains(params, ctx) {
  const db = instances.get(params.handle);
  const exists = db.contains(params.id);
  return { exists };
}

function createIndex(params, ctx) {
  const db = instances.get(params.handle);
  db.createIndex(params.field);
  return { ok: true };
}

function dropIndex(params, ctx) {
  const db = instances.get(params.handle);
  db.dropIndex(params.field);
  return { ok: true };
}

function flush(params, ctx) {
  const db = instances.get(params.handle);
  db.flush();
  return { ok: true };
}

function insertWithPrefix(params, ctx) {
  const db = instances.get(params.handle);
  const id = db.insertWithPrefix(params.prefix, params.doc);
  return { id };
}

function openInMemory(params, ctx) {
  const db = Database.openInMemory();
  const handle = randomUUID();
  instances.set(handle, db);
  return { handle };
}

function isEmpty(params, ctx) {
  const db = instances.get(params.handle);
  const empty = db.isEmpty();
  return { empty };
}

function createBTreeIndex(params, ctx) {
  const db = instances.get(params.handle);
  db.createBTreeIndex(params.field);
  return { ok: true };
}

function hasIndex(params, ctx) {
  const db = instances.get(params.handle);
  const exists = db.hasIndex(params.field);
  return { exists };
}

function compact(params, ctx) {
  const db = instances.get(params.handle);
  db.compact();
  return { ok: true };
}

function restore(params, ctx) {
  const db = instances.get(params.handle);
  db.restore(params.id);
  return { ok: true };
}

function deletedIds(params, ctx) {
  const db = instances.get(params.handle);
  const ids = db.deletedIds();
  return { ids };
}

// ─── File Bucket Handlers ──────────────────────────────────────────

function storeFile(params, ctx) {
  const db = instances.get(params.handle);
  const meta = db.storeFile(params.bucket, params.name, Buffer.from(params.data, 'base64'), params.mimeType);
  return { meta };
}

function getFile(params, ctx) {
  const db = instances.get(params.handle);
  const data = db.getFile(params.bucket, params.hash, params.ext);
  return { data: data.toString('base64') };
}

function deleteFile(params, ctx) {
  const db = instances.get(params.handle);
  db.deleteFile(params.bucket, params.hash, params.ext);
  return { ok: true };
}

function listFiles(params, ctx) {
  const db = instances.get(params.handle);
  const files = db.listFiles(params.bucket);
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
  // Bucket operations
  storeFile,
  getFile,
  deleteFile,
  listFiles,
};

module.exports = { handlers, instances };
