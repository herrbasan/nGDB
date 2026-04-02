// src/handlers/admin.js — Admin API handlers
// Aggregates data from nGDB service layer for the admin UI.
// All routes require the same authentication as the main API.

const { instances: dbInstances, handlers: dbHandlers } = require('./db');
const { instances: vdbInstances, collectionCache } = require('./vdb');
const { stats: wsStats } = require('../ws');
const config = require('../config');
const packageJson = require('../../package.json');
const fs = require('fs');
const path = require('path');
const { ndbDataDir } = require('../middleware/tenancy');

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

function ndbOpen(params, ctx) {
	return dbHandlers.open(params, ctx);
}

function ndbClose(params, ctx) {
	return dbHandlers.close({ handle: params.handle }, ctx);
}

function ndbInstances(params, ctx) {
	console.log('[admin] ndbInstances called, dbInstances size:', dbInstances.size);
	const tenantId = ctx && ctx.tenantId;
	const baseDir = ndbDataDir(tenantId);

	// Build a map of loaded databases by their resolved path
	const loadedByPath = new Map();
	for (const [handle, entry] of dbInstances) {
		loadedByPath.set(entry.path, { handle, entry });
	}

	// Discover all databases on disk
	const discovered = dbHandlers.listAvailable({}, ctx).databases || [];

	// Merge: for each discovered DB, check if it's loaded
	const databases = discovered.map(db => {
		const loaded = loadedByPath.get(db.path);
		const dbDir = path.dirname(db.path);
		const meta = getDbMeta(dbDir);
				const trash = getTrashMeta(dbDir);
		if (loaded) {
			let docCount = 0;
			try { docCount = loaded.entry.db.len(); } catch {}
			return {
				name: db.name,
				path: db.path,
				size: db.size,
				modified: db.modified,
				loaded: true,
				handle: loaded.handle,
				docCount,
				trash,
				meta,
			};
		}
		return {
			name: db.name,
			path: db.path,
			size: db.size,
			modified: db.modified,
			loaded: false,
			handle: null,
			docCount: 0,
			trash,
			meta,
		};
	});

	// Also include any loaded databases that weren't discovered (e.g., in-memory, custom paths)
	for (const [handle, entry] of dbInstances) {
		if (!loadedByPath.has(entry.path)) {
			// Already processed above via discovered, skip
			// Actually loadedByPath was built from all instances, so this won't happen
			// unless a DB was opened with a path not in the data dir
			const alreadyIncluded = databases.some(d => d.path === entry.path);
			if (!alreadyIncluded) {
				let docCount = 0;
				try { docCount = entry.db.len(); } catch {}
				const dbDir = path.dirname(entry.path);
				const meta = getDbMeta(dbDir);
								const trash = getTrashMeta(dbDir);
				databases.push({
					name: path.basename(entry.path, '.jsonl'),
					path: entry.path,
					size: 0,
					modified: null,
					loaded: true,
					handle,
					docCount,
					trash,
					meta,
				});
			}
		}
	}

	return { databases };
}

function ndbAvailable(params, ctx) {
	// Return only unloaded/available databases
	const all = ndbInstances(params, ctx);
	const available = all.databases.filter(db => !db.loaded);
	return { databases: available };
}

function ndbLoad(params, ctx) {
	// Load a discovered database by its file path
	const tenantId = ctx && ctx.tenantId;
	const baseDir = ndbDataDir(tenantId);
	const dbPath = path.isAbsolute(params.path) ? params.path : path.join(baseDir, params.path);
	
	// Check if already loaded
	for (const [handle, entry] of dbInstances) {
		if (entry.path === dbPath) {
			return { handle, alreadyLoaded: true };
		}
	}
	
	return dbHandlers.open({ path: dbPath, options: params.options }, ctx);
}

function ndbUnload(params, ctx) {
	// Unload a loaded database (flush + close)
	return dbHandlers.close({ handle: params.handle }, ctx);
}

function ndbInstanceDocs(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	
	const allDocs = entry.db.iter(); // parsed automatically by napi Wrapper
	const total = allDocs.length;
	
	// Pagination support
	const limit = params.limit ? parseInt(params.limit, 10) : undefined;
	const offset = params.offset ? parseInt(params.offset, 10) : 0;
	
	let docs = allDocs;
	if (offset > 0) {
		docs = docs.slice(offset);
	}
	if (limit !== undefined && limit > 0) {
		docs = docs.slice(0, limit);
	}
	
	return { docs, count: docs.length, total, offset: offset || 0 };
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
	
	// nDB doesn't expose a listIndexes API directly
	// We need to infer from the database - for now return empty
	// TODO: Add listIndexes to nDB N-API bindings
	const indexes = [];
	
	// Try to detect indexes by checking common patterns or stored metadata
	// This is a workaround until nDB exposes the index list
	try {
		// Check if we can get index info from the database path
		const dbDir = path.dirname(entry.path);
		const indexMarkerFile = path.join(dbDir, '.ndb_indexes');
		if (fs.existsSync(indexMarkerFile)) {
			const indexData = JSON.parse(fs.readFileSync(indexMarkerFile, 'utf8'));
			if (Array.isArray(indexData.indexes)) {
				return { indexes: indexData.indexes };
			}
		}
	} catch {
		// Ignore errors, return empty list
	}
	
	return { indexes };
}

function ndbInstanceBuckets(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	
	// List buckets by scanning the _files directory
	const buckets = [];
	try {
		const dbDir = path.dirname(entry.path);
		const filesDir = path.join(dbDir, '_files');
		
		if (fs.existsSync(filesDir)) {
			const entries = fs.readdirSync(filesDir, { withFileTypes: true });
			for (const dirent of entries) {
				if (dirent.isDirectory() && !dirent.name.startsWith('_')) {
					// Count active files and trash files
					const bucketDir = path.join(filesDir, dirent.name);
					const trashDir = path.join(bucketDir, '_trash');
					let fileCount = 0;
					let trashCount = 0;
					let totalSize = 0;

					try {
						const bucketEntries = fs.readdirSync(bucketDir, { withFileTypes: true });
						for (const be of bucketEntries) {
							if (be.isFile()) {
								fileCount++;
								try { totalSize += fs.statSync(path.join(bucketDir, be.name)).size; } catch {}
							}
						}
					} catch {}

					try {
						if (fs.existsSync(trashDir)) {
							const trashEntries = fs.readdirSync(trashDir, { withFileTypes: true });
							for (const te of trashEntries) {
								if (te.isFile() && !te.name.endsWith('.meta.json')) {
									trashCount++;
								}
							}
						}
					} catch {}

					buckets.push({
						name: dirent.name,
						fileCount,
						trashCount,
						totalSize,
					});
				}
			}
		}
	} catch {
		// Ignore errors, return empty list
	}
	
	return { buckets };
}

function ndbInstanceBucketFiles(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	const files = entry.db.listFiles(params.bucket);
	return { files };
}

function ndbInstanceStoreFile(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	const meta = entry.db.storeFile(params.bucket, params.name, Buffer.from(params.data, 'base64'), params.mimeType);
	return { meta };
}

function ndbInstanceDeleteFile(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	entry.db.deleteFile(params.bucket, params.hash, params.ext);
	return { ok: true };
}

// ─── Bucket File Trash ───────────────────────────────────────────

/**
 * GET /ndb/:handle/buckets/:bucket/trash — List trashed files in a bucket
 * Reads _trash/ directory and parses .meta.json sidecars
 */
function ndbInstanceBucketTrash(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);

	const dbDir = path.dirname(entry.path);
	const trashDir = path.join(dbDir, '_files', params.bucket, '_trash');

	if (!fs.existsSync(trashDir)) {
		return { files: [], count: 0 };
	}

	const files = [];
	try {
		const entries = fs.readdirSync(trashDir, { withFileTypes: true });
		for (const dirent of entries) {
			if (!dirent.isFile() || dirent.name.endsWith('.meta.json')) continue;

			const fileName = dirent.name;
			const metaPath = path.join(trashDir, fileName + '.meta.json');
			const filePath = path.join(trashDir, fileName);

			// Parse hash.ext from filename
			const lastDot = fileName.lastIndexOf('.');
			const hash = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
			const ext = lastDot > 0 ? fileName.substring(lastDot + 1) : '';

			let meta = { hash, ext, originalName: fileName, mimeType: 'application/octet-stream', size: 0, deletedAt: null };
			try {
				if (fs.existsSync(metaPath)) {
					meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, 'utf-8')) };
				}
			} catch {}

			// Get actual file size
			try {
				meta.size = fs.statSync(filePath).size;
			} catch {}

			files.push(meta);
		}
	} catch {}

	return { files, count: files.length };
}

/**
 * POST /ndb/:handle/buckets/:bucket/trash/:hash/:ext/restore — Restore a trashed file
 * Moves file back from _trash/ and deletes the sidecar
 */
function ndbInstanceBucketTrashRestore(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);

	const dbDir = path.dirname(entry.path);
	const bucketDir = path.join(dbDir, '_files', params.bucket);
	const trashDir = path.join(bucketDir, '_trash');
	const fileName = `${params.hash}.${params.ext}`;
	const trashFilePath = path.join(trashDir, fileName);
	const metaFilePath = trashFilePath + '.meta.json';
	const restoreFilePath = path.join(bucketDir, fileName);

	if (!fs.existsSync(trashFilePath)) {
		throw new Error(`Trashed file not found: ${fileName}`);
	}

	if (fs.existsSync(restoreFilePath)) {
		throw new Error(`File ${fileName} already exists in bucket. Delete it first.`);
	}

	// Move file back
	fs.renameSync(trashFilePath, restoreFilePath);

	// Delete sidecar
	if (fs.existsSync(metaFilePath)) {
		fs.unlinkSync(metaFilePath);
	}

	// Clean up empty _trash directory
	try {
		const remaining = fs.readdirSync(trashDir);
		if (remaining.length === 0) {
			fs.rmdirSync(trashDir);
		}
	} catch {}

	return { ok: true, restoredFile: fileName };
}

/**
 * DELETE /ndb/:handle/buckets/:bucket/trash/:hash/:ext — Permanently delete a trashed file
 */
function ndbInstanceBucketTrashDelete(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);

	const dbDir = path.dirname(entry.path);
	const trashDir = path.join(dbDir, '_files', params.bucket, '_trash');
	const fileName = `${params.hash}.${params.ext}`;
	const trashFilePath = path.join(trashDir, fileName);
	const metaFilePath = trashFilePath + '.meta.json';

	if (!fs.existsSync(trashFilePath)) {
		throw new Error(`Trashed file not found: ${fileName}`);
	}

	// Delete file and sidecar
	fs.unlinkSync(trashFilePath);
	if (fs.existsSync(metaFilePath)) {
		fs.unlinkSync(metaFilePath);
	}

	// Clean up empty _trash directory
	try {
		const remaining = fs.readdirSync(trashDir);
		if (remaining.length === 0) {
			fs.rmdirSync(trashDir);
		}
	} catch {}

	return { ok: true, deletedFile: fileName };
}

/**
 * DELETE /ndb/:handle/buckets/:bucket/trash — Purge all trash in a bucket
 */
function ndbInstanceBucketTrashPurge(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);

	const dbDir = path.dirname(entry.path);
	const trashDir = path.join(dbDir, '_files', params.bucket, '_trash');

	if (!fs.existsSync(trashDir)) {
		return { ok: true, purged: 0 };
	}

	// Count files (excluding .meta.json sidecars)
	let count = 0;
	try {
		const entries = fs.readdirSync(trashDir, { withFileTypes: true });
		for (const dirent of entries) {
			if (dirent.isFile() && !dirent.name.endsWith('.meta.json')) {
				count++;
			}
		}
	} catch {}

	// Delete entire _trash directory recursively
	fs.rmSync(trashDir, { recursive: true, force: true });

	return { ok: true, purged: count };
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

// ─── Document Trash ──────────────────────────────────────────────

/**
 * Get trash metadata for a database (exists, size, count)
 * Reads trash.jsonl without parsing every line for performance
 */
function getDbMeta(dbDir) {
  const metaPath = require('path').join(dbDir, 'meta.json');
  if(fs.existsSync(metaPath)) { try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return null; } }
  return null;
}

function getTrashMeta(dbDir) {
	const trashPath = path.join(dbDir, 'trash.jsonl');
	if (!fs.existsSync(trashPath)) {
		return { exists: false, size: 0, count: 0 };
	}
	try {
		const stat = fs.statSync(trashPath);
		// Count lines to get document count
		const content = fs.readFileSync(trashPath, 'utf-8');
		const lines = content.split('\n').filter(l => l.trim().length > 0);
		return {
			exists: true,
			size: stat.size,
			count: lines.length,
		};
	} catch {
		return { exists: false, size: 0, count: 0 };
	}
}

/**
 * GET /ndb/:handle/trash — List all trashed documents
 * Auto-compacts first so trash.jsonl is always complete
 */
function ndbInstanceTrash(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);

	// Auto-compact to flush in-memory tombstones into trash.jsonl
	entry.db.compact();

	const dbDir = path.dirname(entry.path);
	const trashPath = path.join(dbDir, 'trash.jsonl');

	if (!fs.existsSync(trashPath)) {
		return { documents: [], count: 0, totalSize: 0 };
	}

	const content = fs.readFileSync(trashPath, 'utf-8');
	const lines = content.split('\n').filter(l => l.trim().length > 0);
	const documents = [];

	for (const line of lines) {
		try {
			const doc = JSON.parse(line);
			documents.push(doc);
		} catch {
			// Skip malformed lines
		}
	}

	const totalSize = Buffer.byteLength(content, 'utf-8');

	return { documents, count: documents.length, totalSize };
}

/**
 * POST /ndb/:handle/trash/:id/restore — Restore a trashed document
 * Re-inserts the document from trash.jsonl into the live DB,
 * then removes it from trash.jsonl
 */
function ndbInstanceTrashRestore(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);

	const dbDir = path.dirname(entry.path);
	const trashPath = path.join(dbDir, 'trash.jsonl');

	if (!fs.existsSync(trashPath)) {
		throw new Error('No trash found for this database');
	}

	const content = fs.readFileSync(trashPath, 'utf-8');
	const lines = content.split('\n').filter(l => l.trim().length > 0);

	let foundDoc = null;
	let foundIndex = -1;

	for (let i = 0; i < lines.length; i++) {
		try {
			const doc = JSON.parse(lines[i]);
			if (doc._id === params.id) {
				foundDoc = doc;
				foundIndex = i;
				break;
			}
		} catch {
			// Skip malformed lines
		}
	}

	if (!foundDoc) {
		throw new Error(`Document ${params.id} not found in trash`);
	}

	// Check if a document with the same _id already exists in the live DB
	try {
		const existing = entry.db.get(params.id);
		if (existing) {
			throw new Error(`Document with _id "${params.id}" already exists. Delete or rename it first.`);
		}
	} catch (err) {
		// If the error is our custom one, re-throw it
		if (err.message.includes('already exists')) throw err;
		// Otherwise, document doesn't exist (get() throws for missing docs) — that's fine
	}

	// Remove _deleted field and re-insert
	delete foundDoc._deleted;
	entry.db.insert(foundDoc);

	// Remove the restored document from trash.jsonl
	lines.splice(foundIndex, 1);
	if (lines.length === 0) {
		fs.unlinkSync(trashPath);
	} else {
		fs.writeFileSync(trashPath, lines.join('\n') + '\n', 'utf-8');
	}

	return { ok: true, restoredId: params.id };
}

/**
 * DELETE /ndb/:handle/trash/:id — Permanently delete a trashed document
 * Removes the entry from trash.jsonl
 */
function ndbInstanceTrashDelete(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);

	const dbDir = path.dirname(entry.path);
	const trashPath = path.join(dbDir, 'trash.jsonl');

	if (!fs.existsSync(trashPath)) {
		throw new Error('No trash found for this database');
	}

	const content = fs.readFileSync(trashPath, 'utf-8');
	const lines = content.split('\n').filter(l => l.trim().length > 0);

	let foundIndex = -1;

	for (let i = 0; i < lines.length; i++) {
		try {
			const doc = JSON.parse(lines[i]);
			if (doc._id === params.id) {
				foundIndex = i;
				break;
			}
		} catch {
			// Skip malformed lines
		}
	}

	if (foundIndex === -1) {
		throw new Error(`Document ${params.id} not found in trash`);
	}

	// Remove the document from trash.jsonl
	lines.splice(foundIndex, 1);
	if (lines.length === 0) {
		fs.unlinkSync(trashPath);
	} else {
		fs.writeFileSync(trashPath, lines.join('\n') + '\n', 'utf-8');
	}

	return { ok: true, deletedId: params.id };
}

/**
 * DELETE /ndb/:handle/trash — Purge all trash
 * Deletes the entire trash.jsonl file
 */
function ndbInstanceTrashPurge(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);

	const dbDir = path.dirname(entry.path);
	const trashPath = path.join(dbDir, 'trash.jsonl');

	if (!fs.existsSync(trashPath)) {
		return { ok: true, purged: 0 };
	}

	// Count before deleting
	const content = fs.readFileSync(trashPath, 'utf-8');
	const count = content.split('\n').filter(l => l.trim().length > 0).length;

	fs.unlinkSync(trashPath);

	return { ok: true, purged: count };
}

function ndbInstanceQuery(params, ctx) {
	const entry = dbInstances.get(params.handle);
	if (!entry) throw new Error(`nDB instance not found: ${params.handle}`);
	const raw = entry.db.queryWith(params.ast, params.options || {}); // N-API returns JSON string
	const results = JSON.parse(raw);
	return { results };
}

// ─── nVDB Instance Management ─────────────────────────────────────

function nvdbOpen(params, ctx) {
	const { handlers: vdbHandlers } = require('./vdb');
	return vdbHandlers.open(params, ctx);
}

function nvdbClose(params, ctx) {
	const { handlers: vdbHandlers } = require('./vdb');
	return vdbHandlers.close({ handle: params.handle }, ctx);
}

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

function nvdbCollectionCreate(params, ctx) {
	const db = vdbInstances.get(params.handle);
	if (!db) throw new Error(`nVDB instance not found: ${params.handle}`);
	const { handlers: vdbHandlers } = require('./vdb');
	return vdbHandlers.createCollection({
		handle: params.handle,
		name: params.name,
		dimension: params.dimension,
		options: params.options,
	}, ctx);
}

function nvdbCollectionDetail(params, ctx) {
	const db = vdbInstances.get(params.handle);
	if (!db) throw new Error(`nVDB instance not found: ${params.handle}`);
	const col = getCollectionObj(params.handle, db, params.name);
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
	const col = getCollectionObj(params.handle, db, params.name);
	const raw = col.search({
		vector: params.vector,
		topK: params.topK,
		distance: params.distance,
	});
	const results = raw.map(m => ({ id: m.id, score: m.score, payload: m.payload }));
	return { results };
}

function nvdbCollectionFlush(params, ctx) {
	const db = vdbInstances.get(params.handle);
	if (!db) throw new Error(`nVDB instance not found: ${params.handle}`);
	const col = getCollectionObj(params.handle, db, params.name);
	col.flush();
	return { ok: true };
}

function nvdbCollectionCompact(params, ctx) {
	const db = vdbInstances.get(params.handle);
	if (!db) throw new Error(`nVDB instance not found: ${params.handle}`);
	const col = getCollectionObj(params.handle, db, params.name);
	col.compact();
	return { ok: true };
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
	'GET /ndb': ndbInstances,
	'GET /ndb/available': ndbAvailable,
	'GET /nvdb': nvdbInstances,
	// GET routes with params
	'GET /ndb/:handle/docs': ndbInstanceDocs,
	'GET /ndb/:handle/docs/:id': ndbInstanceDoc,
	'GET /ndb/:handle/trash': ndbInstanceTrash,
	'GET /ndb/:handle/indexes': ndbInstanceIndexes,
	'GET /ndb/:handle/buckets': ndbInstanceBuckets,
	'GET /ndb/:handle/buckets/:bucket/files': ndbInstanceBucketFiles,
	'GET /ndb/:handle/buckets/:bucket/trash': ndbInstanceBucketTrash,
	'GET /nvdb/:handle/collections': nvdbCollections,
	'GET /nvdb/:handle/collections/:name': nvdbCollectionDetail,
	// POST routes
	'POST /ndb/open': ndbOpen,
	'POST /ndb/load': ndbLoad,
	'POST /ndb/:handle/unload': ndbUnload,
	'POST /ndb/:handle/docs': ndbInstanceInsertDoc,
	'POST /ndb/:handle/buckets/:bucket/files': ndbInstanceStoreFile,
	'POST /ndb/:handle/flush': ndbInstanceFlush,
	'POST /ndb/:handle/compact': ndbInstanceCompact,
	'POST /ndb/:handle/query': ndbInstanceQuery,
	'POST /nvdb/open': nvdbOpen,
	'POST /nvdb/:handle/collections': nvdbCollectionCreate,
	'POST /nvdb/:handle/collections/:name/search': nvdbCollectionSearch,
	'POST /nvdb/:handle/collections/:name/flush': nvdbCollectionFlush,
	'POST /nvdb/:handle/collections/:name/compact': nvdbCollectionCompact,
	// PUT routes
	'PUT /ndb/:handle/docs/:id': ndbInstanceUpdateDoc,
	// DELETE routes
	'DELETE /ndb/:handle': ndbClose,
	'DELETE /ndb/:handle/docs/:id': ndbInstanceDeleteDoc,
	'DELETE /ndb/:handle/trash': ndbInstanceTrashPurge,
	'DELETE /ndb/:handle/trash/:id': ndbInstanceTrashDelete,
	'DELETE /ndb/:handle/buckets/:bucket/files/:hash/:ext': ndbInstanceDeleteFile,
	'DELETE /ndb/:handle/buckets/:bucket/trash': ndbInstanceBucketTrashPurge,
	'DELETE /ndb/:handle/buckets/:bucket/trash/:hash/:ext': ndbInstanceBucketTrashDelete,
	'DELETE /nvdb/:handle': nvdbClose,
	// POST routes (trash restore)
	'POST /ndb/:handle/trash/:id/restore': ndbInstanceTrashRestore,
	'POST /ndb/:handle/buckets/:bucket/trash/:hash/:ext/restore': ndbInstanceBucketTrashRestore,
};

module.exports = { adminApiHandlers };
