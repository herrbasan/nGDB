// src/handlers/admin.js — Admin API handlers
// Aggregates data from nGDB service layer for the admin UI.
// All routes require the same authentication as the main API.

const { instances: dbInstances } = require('./db');
const { instances: vdbInstances, collectionCache } = require('./vdb');
const { stats: wsStats } = require('../ws');
const config = require('../config');
const packageJson = require('../../package.json');

// ─── Service Status ───────────────────────────────────────────────

function status(params, ctx) {
	const ws = wsStats();
	return {
		status: 'healthy',
		version: packageJson.version,
		uptime: process.uptime(),
		backends: {
			ndb: 'available',
			nvdb: 'available',
			ndbInstances: dbInstances.size,
			nvdbInstances: vdbInstances.size,
		},
		connections: ws.connections,
		subscriptions: ws.subscriptions,
		collections: ws.collections,
		config: {
			hasApiKeys: config.apiKeys.length > 0,
			localAuthBypass: config.localAuthBypass,
			tenantHeader: config.tenantHeader,
			adminEnabled: config.adminEnabled,
			ndbDataDir: config.ndbDataDir,
			nvdbDataDir: config.nvdbDataDir,
		},
	};
}

// ─── nDB Instance Management ──────────────────────────────────────

function ndbInstances(params, ctx) {
	const result = [];
	for (const [handle, entry] of dbInstances) {
		let docCount = 0;
		try { docCount = entry.db.len(); } catch {}
		result.push({ handle, docCount, path: entry.path });
	}
	return { instances: result };
}

function ndbInstanceDocs(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	const raw = entry.db.iter(); // N-API returns JSON string
	const docs = JSON.parse(raw);
	return { docs, count: docs.length };
}

function ndbInstanceDoc(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	const raw = entry.db.get(params.id); // N-API returns JSON string
	const doc = JSON.parse(raw);
	return { doc };
}

function ndbInstanceInsertDoc(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	const id = entry.db.insert(params.doc);
	return { id };
}

function ndbInstanceUpdateDoc(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	entry.db.update(params.id, params.doc);
	return { ok: true };
}

function ndbInstanceDeleteDoc(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	entry.db.delete(params.id);
	return { ok: true };
}

function ndbInstanceIndexes(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	// nDB doesn't have a "list indexes" API; return empty for now
	return { indexes: [] };
}

function ndbInstanceBuckets(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	// Bucket listing requires iterating the bucket directory; return empty for now
	return { buckets: [] };
}

function ndbInstanceBucketFiles(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	const files = entry.db.listFiles(params.bucket);
	return { files };
}

function ndbInstanceFlush(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	entry.db.flush();
	return { ok: true };
}

function ndbInstanceCompact(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	entry.db.compact();
	return { ok: true };
}

function ndbInstanceQuery(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	const raw = entry.db.queryWith(params.ast, params.options || {}); // N-API returns JSON string
	const results = JSON.parse(raw);
	return { results };
}

// ─── nVDB Instance Management ─────────────────────────────────────

function nvdbInstances(params, ctx) {
	const instances = [];
	for (const [handle, db] of vdbInstances) {
		instances.push({ handle });
	}
	return { instances };
}

function nvdbCollections(params, ctx) {
	const db = vdbInstances.get(params.handle);
	if (!db) throw new Error(`nVDB instance not found: ${params.handle}`);
	const names = db.listCollections();
	const collections = names.map(name => {
		let colConfig = {};
		let colStats = {};
		let hasIdx = false;
		try {
			const col = getCollectionObj(params.handle, db, name);
			colConfig = { dim: col.config.dim, durability: col.config.durability };
			colStats = {
				memtableDocs: col.stats.memtableDocs,
				segmentCount: col.stats.segmentCount,
				totalSegmentDocs: col.stats.totalSegmentDocs,
			};
			hasIdx = col.hasIndex();
		} catch {}
		return { name, config: colConfig, stats: colStats, hasIndex: hasIdx };
	});
	return { collections };
}

function nvdbCollectionDetail(params, ctx) {
	const db = vdbInstances.get(params.handle);
	if (!db) throw new Error(`nVDB instance not found: ${params.handle}`);
	const col = getCollectionObj(params.handle, db, params.collection);
	return {
		name: col.name,
		config: { dim: col.config.dim, durability: col.config.durability },
		stats: {
			memtableDocs: col.stats.memtableDocs,
			segmentCount: col.stats.segmentCount,
			totalSegmentDocs: col.stats.totalSegmentDocs,
		},
	};
}

function nvdbCollectionSearch(params, ctx) {
	const db = vdbInstances.get(params.handle);
	if (!db) throw new Error(`nVDB instance not found: ${params.handle}`);
	const col = getCollectionObj(params.handle, db, params.collection);
	const raw = col.search({
		vector: params.vector,
		topK: params.topK,
		distance: params.distance,
	});
	const results = raw.map(m => ({ id: m.id, score: m.score, payload: m.payload }));
	return { results };
}

function getCollectionObj(dbHandle, db, name) {
	const key = `${dbHandle}::${name}`;
	if (collectionCache.has(key)) return collectionCache.get(key);
	const collection = db.getCollection(name);
	collectionCache.set(key, collection);
	return collection;
}

// ─── Handler Registry ─────────────────────────────────────────────
// Admin API routes mapped by path pattern

const adminApiHandlers = {
	// GET routes
	'GET /status': status,
	'GET /ndb/instances': ndbInstances,
	'GET /nvdb/instances': nvdbInstances,
	// GET routes with params
	'GET /ndb/instances/:handle/docs': ndbInstanceDocs,
	'GET /ndb/instances/:handle/docs/:id': ndbInstanceDoc,
	'GET /ndb/instances/:handle/indexes': ndbInstanceIndexes,
	'GET /ndb/instances/:handle/buckets': ndbInstanceBuckets,
	'GET /ndb/instances/:handle/buckets/:name/files': ndbInstanceBucketFiles,
	'GET /nvdb/instances/:handle/collections': nvdbCollections,
	'GET /nvdb/instances/:handle/collections/:name': nvdbCollectionDetail,
	// POST routes
	'POST /nvdb/instances/:handle/collections/:name/search': nvdbCollectionSearch,
	'POST /ndb/instances/:handle/docs': ndbInstanceInsertDoc,
	'POST /ndb/instances/:handle/flush': ndbInstanceFlush,
	'POST /ndb/instances/:handle/compact': ndbInstanceCompact,
	'POST /ndb/instances/:handle/query': ndbInstanceQuery,
	// PUT routes
	'PUT /ndb/instances/:handle/docs/:id': ndbInstanceUpdateDoc,
	// DELETE routes
	'DELETE /ndb/instances/:handle/docs/:id': ndbInstanceDeleteDoc,
};

module.exports = { adminApiHandlers };
