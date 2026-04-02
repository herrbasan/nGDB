// src/transports/http.js — HTTP request/response adapter
// Parses HTTP requests, dispatches to handlers, returns JSON responses.
// This is the only layer that knows about HTTP.

const fs = require('fs');
const pathModule = require('path');
const { handlers: dbHandlers, instances: dbInstances } = require('../handlers/db');
const { handlers: vdbHandlers, instances: vdbInstances, collectionCache } = require('../handlers/vdb');
const { adminApiHandlers } = require('../handlers/admin');
const { checkAuth } = require('../middleware/auth');
const { extractTenant } = require('../middleware/tenancy');
const config = require('../config');

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve({});
        return;
      }
      resolve(JSON.parse(raw));
    });
    req.on('error', reject);
  });
}

function health() {
  return {
    status: 'healthy',
    backends: {
      ndb: 'available',
      nvdb: 'available',
    },
  };
}

// ─── MIME Types ───────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function mimeType(filePath) {
  const ext = pathModule.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// ─── Admin Static File Serving ────────────────────────────────────

function serveAdminStatic(req, res, urlPath) {
  if (!config.adminEnabled) {
    json(res, 404, { error: 'admin interface disabled' });
    return;
  }

  // Serve index.html for /admin/ and /admin
  let filePath = urlPath;
  if (filePath === '/admin' || filePath === '/admin/') {
    filePath = '/admin/index.html';
  }

  // Prevent path traversal
  const relativePath = filePath.replace(/^\/admin\//, '');
  const resolvedPath = pathModule.resolve(config.adminPath, relativePath);
  if (!resolvedPath.startsWith(pathModule.resolve(config.adminPath))) {
    json(res, 403, { error: 'forbidden' });
    return;
  }

  // Check file exists and serve
  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA fallback: only for extensionless routes (page navigation), not static assets
        const ext = pathModule.extname(resolvedPath);
        if (!ext) {
          const indexPath = pathModule.resolve(config.adminPath, 'index.html');
          fs.readFile(indexPath, (indexErr, indexData) => {
            if (indexErr) {
              json(res, 404, { error: 'not found' });
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': indexData.length });
            res.end(indexData);
          });
          return;
        }
        json(res, 404, { error: 'not found' });
        return;
      }
      json(res, 500, { error: err.message });
      return;
    }
    const type = mimeType(resolvedPath);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length });
    res.end(data);
  });
}

// ─── Admin API Routes ─────────────────────────────────────────────
// New API design per admin-development-plan.md

async function routeAdminApi(req, res, urlPath) {
  if (!config.adminEnabled) {
    console.log('[http] Admin disabled');
    json(res, 404, { error: 'admin interface disabled' });
    return;
  }

  // Auth check
  console.log('[http] Checking auth...');
  const auth = checkAuth(req);
  console.log('[http] Auth result:', auth);
  if (!auth.ok) {
    json(res, auth.status, { error: auth.message });
    return;
  }

  const tenantId = extractTenant(req);
  const apiPath = urlPath.replace(/^\/admin\/api/, '');

  try {
    // ─── Status ──────────────────────────────────────────────────
    if (apiPath === '/status' && req.method === 'GET') {
      json(res, 200, adminApiHandlers['GET /status']({}, { tenantId }));
      return;
    }

    // ─── nDB API ─────────────────────────────────────────────────
    
    // GET /ndb — list all databases (loaded + unloaded)
    if (apiPath === '/ndb' && req.method === 'GET') {
      json(res, 200, adminApiHandlers['GET /ndb']({}, { tenantId }));
      return;
    }

    // GET /ndb/available — list only unloaded databases
    if (apiPath === '/ndb/available' && req.method === 'GET') {
      json(res, 200, adminApiHandlers['GET /ndb/available']({}, { tenantId }));
      return;
    }

    // POST /ndb/open — open database by path (manual)
    if (apiPath === '/ndb/open' && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, adminApiHandlers['POST /ndb/open'](params, { tenantId }));
      return;
    }

    // POST /ndb/load — load a discovered database by path
    if (apiPath === '/ndb/load' && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, adminApiHandlers['POST /ndb/load'](params, { tenantId }));
      return;
    }

    // DELETE /ndb/:handle — close database (legacy)
    const ndbHandleMatch = apiPath.match(/^\/ndb\/([^/]+)$/);
    if (ndbHandleMatch && req.method === 'DELETE') {
      const handle = ndbHandleMatch[1];
      json(res, 200, adminApiHandlers['DELETE /ndb/:handle']({ handle }, { tenantId }));
      return;
    }

    // POST /ndb/:handle/unload — unload a loaded database
    const ndbUnloadMatch = apiPath.match(/^\/ndb\/([^/]+)\/unload$/);
    if (ndbUnloadMatch && req.method === 'POST') {
      const handle = ndbUnloadMatch[1];
      json(res, 200, adminApiHandlers['POST /ndb/:handle/unload']({ handle }, { tenantId }));
      return;
    }

    // GET/POST /ndb/:handle/docs — list/insert documents
    const ndbDocsMatch = apiPath.match(/^\/ndb\/([^/]+)\/docs$/);
    if (ndbDocsMatch) {
      const handle = ndbDocsMatch[1];
      const url = new URL(req.url, `http://${req.headers.host}`);
      
      if (req.method === 'GET') {
        const limit = url.searchParams.get('limit');
        const offset = url.searchParams.get('offset');
        json(res, 200, adminApiHandlers['GET /ndb/:handle/docs']({ handle, limit, offset }, { tenantId }));
        return;
      }
      if (req.method === 'POST') {
        const params = await parseBody(req);
        json(res, 200, adminApiHandlers['POST /ndb/:handle/docs']({ handle, doc: params.doc }, { tenantId }));
        return;
      }
    }

    // GET/PUT/DELETE /ndb/:handle/docs/:id
    const ndbDocMatch = apiPath.match(/^\/ndb\/([^/]+)\/docs\/([^/]+)$/);
    if (ndbDocMatch) {
      const handle = ndbDocMatch[1];
      const id = ndbDocMatch[2];
      
      if (req.method === 'GET') {
        json(res, 200, adminApiHandlers['GET /ndb/:handle/docs/:id']({ handle, id }, { tenantId }));
        return;
      }
      if (req.method === 'PUT') {
        const params = await parseBody(req);
        json(res, 200, adminApiHandlers['PUT /ndb/:handle/docs/:id']({ handle, id, doc: params.doc }, { tenantId }));
        return;
      }
      if (req.method === 'DELETE') {
        json(res, 200, adminApiHandlers['DELETE /ndb/:handle/docs/:id']({ handle, id }, { tenantId }));
        return;
      }
    }

    // GET /ndb/:handle/trash — list trashed documents
    const ndbTrashMatch = apiPath.match(/^\/ndb\/([^/]+)\/trash$/);
    if (ndbTrashMatch && req.method === 'GET') {
      const handle = ndbTrashMatch[1];
      json(res, 200, adminApiHandlers['GET /ndb/:handle/trash']({ handle }, { tenantId }));
      return;
    }

    // POST /ndb/:handle/trash/:id/restore — restore trashed document
    const ndbTrashRestoreMatch = apiPath.match(/^\/ndb\/([^/]+)\/trash\/([^/]+)\/restore$/);
    if (ndbTrashRestoreMatch && req.method === 'POST') {
      const handle = ndbTrashRestoreMatch[1];
      const id = ndbTrashRestoreMatch[2];
      json(res, 200, adminApiHandlers['POST /ndb/:handle/trash/:id/restore']({ handle, id }, { tenantId }));
      return;
    }

    // DELETE /ndb/:handle/trash/:id — permanently delete trashed document
    const ndbTrashDeleteMatch = apiPath.match(/^\/ndb\/([^/]+)\/trash\/([^/]+)$/);
    if (ndbTrashDeleteMatch && req.method === 'DELETE') {
      const handle = ndbTrashDeleteMatch[1];
      const id = ndbTrashDeleteMatch[2];
      json(res, 200, adminApiHandlers['DELETE /ndb/:handle/trash/:id']({ handle, id }, { tenantId }));
      return;
    }

    // DELETE /ndb/:handle/trash — purge all trash
    const ndbTrashPurgeMatch = apiPath.match(/^\/ndb\/([^/]+)\/trash$/);
    if (ndbTrashPurgeMatch && req.method === 'DELETE') {
      const handle = ndbTrashPurgeMatch[1];
      json(res, 200, adminApiHandlers['DELETE /ndb/:handle/trash']({ handle }, { tenantId }));
      return;
    }

    // GET /ndb/:handle/indexes — list indexes
    const ndbIndexesMatch = apiPath.match(/^\/ndb\/([^/]+)\/indexes$/);
    if (ndbIndexesMatch && req.method === 'GET') {
      const handle = ndbIndexesMatch[1];
      json(res, 200, adminApiHandlers['GET /ndb/:handle/indexes']({ handle }, { tenantId }));
      return;
    }

    // GET /ndb/:handle/buckets — list buckets
    const ndbBucketsMatch = apiPath.match(/^\/ndb\/([^/]+)\/buckets$/);
    if (ndbBucketsMatch && req.method === 'GET') {
      const handle = ndbBucketsMatch[1];
      json(res, 200, adminApiHandlers['GET /ndb/:handle/buckets']({ handle }, { tenantId }));
      return;
    }

    // GET /ndb/:handle/buckets/:bucket/files — list files
    const ndbBucketFilesMatch = apiPath.match(/^\/ndb\/([^/]+)\/buckets\/([^/]+)\/files$/);
    if (ndbBucketFilesMatch && req.method === 'GET') {
      const handle = ndbBucketFilesMatch[1];
      const bucket = ndbBucketFilesMatch[2];
      json(res, 200, adminApiHandlers['GET /ndb/:handle/buckets/:bucket/files']({ handle, bucket }, { tenantId }));
      return;
    }

    // POST /ndb/:handle/buckets/:bucket — store file
    const ndbBucketStoreMatch = apiPath.match(/^\/ndb\/([^/]+)\/buckets\/([^/]+)$/);
    if (ndbBucketStoreMatch && req.method === 'POST') {
      const handle = ndbBucketStoreMatch[1];
      const bucket = ndbBucketStoreMatch[2];
      const params = await parseBody(req);
      json(res, 200, adminApiHandlers['POST /ndb/:handle/buckets/:bucket']({ handle, bucket, ...params }, { tenantId }));
      return;
    }

    // GET /ndb/:handle/buckets/:bucket/trash — list trashed files in bucket
    const ndbBucketTrashMatch = apiPath.match(/^\/ndb\/([^/]+)\/buckets\/([^/]+)\/trash$/);
    if (ndbBucketTrashMatch && req.method === 'GET') {
      const handle = ndbBucketTrashMatch[1];
      const bucket = ndbBucketTrashMatch[2];
      json(res, 200, adminApiHandlers['GET /ndb/:handle/buckets/:bucket/trash']({ handle, bucket }, { tenantId }));
      return;
    }

    // POST /ndb/:handle/buckets/:bucket/trash/:hash/:ext/restore — restore trashed file
    const ndbBucketTrashRestoreMatch = apiPath.match(/^\/ndb\/([^/]+)\/buckets\/([^/]+)\/trash\/([^/]+)\/([^/]+)\/restore$/);
    if (ndbBucketTrashRestoreMatch && req.method === 'POST') {
      const handle = ndbBucketTrashRestoreMatch[1];
      const bucket = ndbBucketTrashRestoreMatch[2];
      const hash = ndbBucketTrashRestoreMatch[3];
      const ext = ndbBucketTrashRestoreMatch[4];
      json(res, 200, adminApiHandlers['POST /ndb/:handle/buckets/:bucket/trash/:hash/:ext/restore']({ handle, bucket, hash, ext }, { tenantId }));
      return;
    }

    // DELETE /ndb/:handle/buckets/:bucket/trash/:hash/:ext — permanently delete trashed file
    const ndbBucketTrashDeleteMatch = apiPath.match(/^\/ndb\/([^/]+)\/buckets\/([^/]+)\/trash\/([^/]+)\/([^/]+)$/);
    if (ndbBucketTrashDeleteMatch && req.method === 'DELETE') {
      const handle = ndbBucketTrashDeleteMatch[1];
      const bucket = ndbBucketTrashDeleteMatch[2];
      const hash = ndbBucketTrashDeleteMatch[3];
      const ext = ndbBucketTrashDeleteMatch[4];
      json(res, 200, adminApiHandlers['DELETE /ndb/:handle/buckets/:bucket/trash/:hash/:ext']({ handle, bucket, hash, ext }, { tenantId }));
      return;
    }

    // DELETE /ndb/:handle/buckets/:bucket/trash — purge all bucket trash
    const ndbBucketTrashPurgeMatch = apiPath.match(/^\/ndb\/([^/]+)\/buckets\/([^/]+)\/trash$/);
    if (ndbBucketTrashPurgeMatch && req.method === 'DELETE') {
      const handle = ndbBucketTrashPurgeMatch[1];
      const bucket = ndbBucketTrashPurgeMatch[2];
      json(res, 200, adminApiHandlers['DELETE /ndb/:handle/buckets/:bucket/trash']({ handle, bucket }, { tenantId }));
      return;
    }

    // DELETE /ndb/:handle/buckets/:bucket/files/:hash/:ext — delete file
    const ndbFileDeleteMatch = apiPath.match(/^\/ndb\/([^/]+)\/buckets\/([^/]+)\/files\/([^/]+)\/([^/]+)$/);
    if (ndbFileDeleteMatch && req.method === 'DELETE') {
      const handle = ndbFileDeleteMatch[1];
      const bucket = ndbFileDeleteMatch[2];
      const hash = ndbFileDeleteMatch[3];
      const ext = ndbFileDeleteMatch[4];
      json(res, 200, adminApiHandlers['DELETE /ndb/:handle/buckets/:bucket/:hash']({ handle, bucket, hash, ext }, { tenantId }));
      return;
    }

    // POST /ndb/:handle/flush
    const ndbFlushMatch = apiPath.match(/^\/ndb\/([^/]+)\/flush$/);
    if (ndbFlushMatch && req.method === 'POST') {
      const handle = ndbFlushMatch[1];
      json(res, 200, adminApiHandlers['POST /ndb/:handle/flush']({ handle }, { tenantId }));
      return;
    }

    // POST /ndb/:handle/compact
    const ndbCompactMatch = apiPath.match(/^\/ndb\/([^/]+)\/compact$/);
    if (ndbCompactMatch && req.method === 'POST') {
      const handle = ndbCompactMatch[1];
      json(res, 200, adminApiHandlers['POST /ndb/:handle/compact']({ handle }, { tenantId }));
      return;
    }

    // POST /ndb/:handle/query
    const ndbQueryMatch = apiPath.match(/^\/ndb\/([^/]+)\/query$/);
    if (ndbQueryMatch && req.method === 'POST') {
      const handle = ndbQueryMatch[1];
      const params = await parseBody(req);
      json(res, 200, adminApiHandlers['POST /ndb/:handle/query']({ handle, ast: params.ast, options: params.options }, { tenantId }));
      return;
    }

    // ─── nVDB API ────────────────────────────────────────────────

    // GET /nvdb — list instances
    if (apiPath === '/nvdb' && req.method === 'GET') {
      json(res, 200, adminApiHandlers['GET /nvdb']({}, { tenantId }));
      return;
    }

    // POST /nvdb/open — open vector database
    if (apiPath === '/nvdb/open' && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, adminApiHandlers['POST /nvdb/open'](params, { tenantId }));
      return;
    }

    // DELETE /nvdb/:handle — close vector database
    const nvdbHandleMatch = apiPath.match(/^\/nvdb\/([^/]+)$/);
    if (nvdbHandleMatch && req.method === 'DELETE') {
      const handle = nvdbHandleMatch[1];
      json(res, 200, adminApiHandlers['DELETE /nvdb/:handle']({ handle }, { tenantId }));
      return;
    }

    // GET/POST /nvdb/:handle/collections — list/create collections
    const nvdbCollectionsMatch = apiPath.match(/^\/nvdb\/([^/]+)\/collections$/);
    if (nvdbCollectionsMatch) {
      const handle = nvdbCollectionsMatch[1];
      
      if (req.method === 'GET') {
        json(res, 200, adminApiHandlers['GET /nvdb/:handle/collections']({ handle }, { tenantId }));
        return;
      }
      if (req.method === 'POST') {
        const params = await parseBody(req);
        json(res, 200, adminApiHandlers['POST /nvdb/:handle/collections']({ handle, ...params }, { tenantId }));
        return;
      }
    }

    // GET /nvdb/:handle/collections/:name — collection details
    const nvdbCollectionMatch = apiPath.match(/^\/nvdb\/([^/]+)\/collections\/([^/]+)$/);
    if (nvdbCollectionMatch && req.method === 'GET') {
      const handle = nvdbCollectionMatch[1];
      const name = nvdbCollectionMatch[2];
      json(res, 200, adminApiHandlers['GET /nvdb/:handle/collections/:name']({ handle, name }, { tenantId }));
      return;
    }

    // POST /nvdb/:handle/collections/:name/search — vector search
    const nvdbSearchMatch = apiPath.match(/^\/nvdb\/([^/]+)\/collections\/([^/]+)\/search$/);
    if (nvdbSearchMatch && req.method === 'POST') {
      const handle = nvdbSearchMatch[1];
      const name = nvdbSearchMatch[2];
      const params = await parseBody(req);
      json(res, 200, adminApiHandlers['POST /nvdb/:handle/collections/:name/search']({ handle, name, ...params }, { tenantId }));
      return;
    }

    // POST /nvdb/:handle/collections/:name/flush
    const nvdbFlushMatch = apiPath.match(/^\/nvdb\/([^/]+)\/collections\/([^/]+)\/flush$/);
    if (nvdbFlushMatch && req.method === 'POST') {
      const handle = nvdbFlushMatch[1];
      const name = nvdbFlushMatch[2];
      json(res, 200, adminApiHandlers['POST /nvdb/:handle/collections/:name/flush']({ handle, name }, { tenantId }));
      return;
    }

    // POST /nvdb/:handle/collections/:name/compact
    const nvdbCompactMatch = apiPath.match(/^\/nvdb\/([^/]+)\/collections\/([^/]+)\/compact$/);
    if (nvdbCompactMatch && req.method === 'POST') {
      const handle = nvdbCompactMatch[1];
      const name = nvdbCompactMatch[2];
      json(res, 200, adminApiHandlers['POST /nvdb/:handle/collections/:name/compact']({ handle, name }, { tenantId }));
      return;
    }

    // ─── Legacy Routes (for backward compatibility) ─────────────────
    
    // Old: GET /ndb/instances -> redirect to new
    if (apiPath === '/ndb/instances' && req.method === 'GET') {
      json(res, 200, adminApiHandlers['GET /ndb']({}, { tenantId }));
      return;
    }

    // Old: POST /ndb/instances -> open database
    if (apiPath === '/ndb/instances' && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, adminApiHandlers['POST /ndb/open'](params, { tenantId }));
      return;
    }

    // Old: DELETE /ndb/instances/:handle -> close database
    const oldNdbInstanceMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)$/);
    if (oldNdbInstanceMatch && req.method === 'DELETE') {
      const handle = oldNdbInstanceMatch[1];
      json(res, 200, adminApiHandlers['DELETE /ndb/:handle']({ handle }, { tenantId }));
      return;
    }

    // Old: GET /nvdb/instances
    if (apiPath === '/nvdb/instances' && req.method === 'GET') {
      json(res, 200, adminApiHandlers['GET /nvdb']({}, { tenantId }));
      return;
    }

    // Old: POST /nvdb/instances
    if (apiPath === '/nvdb/instances' && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, adminApiHandlers['POST /nvdb/open'](params, { tenantId }));
      return;
    }

    // Old: DELETE /nvdb/instances/:handle
    const oldNvdbInstanceMatch = apiPath.match(/^\/nvdb\/instances\/([^/]+)$/);
    if (oldNvdbInstanceMatch && req.method === 'DELETE') {
      const handle = oldNvdbInstanceMatch[1];
      json(res, 200, adminApiHandlers['DELETE /nvdb/:handle']({ handle }, { tenantId }));
      return;
    }

    json(res, 404, { error: 'admin api route not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
}

// ─── Main Router ──────────────────────────────────────────────────

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const urlPath = url.pathname;

  // GET /health — always accessible, no auth required
  if (urlPath === '/health' && req.method === 'GET') {
    json(res, 200, health());
    return;
  }

  // Admin API routes
  if (urlPath.startsWith('/admin/api')) {
    await routeAdminApi(req, res, urlPath);
    return;
  }

  // Admin static files
  if (urlPath === '/admin' || urlPath === '/admin/' || urlPath.startsWith('/admin/')) {
    serveAdminStatic(req, res, urlPath);
    return;
  }

  // Auth check for everything else
  const auth = checkAuth(req);
  if (!auth.ok) {
    json(res, auth.status, { error: auth.message });
    return;
  }

  // Extract tenant context (null if tenancy not configured)
  const tenantId = extractTenant(req);

  // POST /db/:action — standard nDB proxy routes
  const dbMatch = urlPath.match(/^\/db\/([a-zA-Z]+)$/);
  if (dbMatch && req.method === 'POST') {
    const action = dbMatch[1];
    const handler = dbHandlers[action];
    if (!handler) {
      json(res, 404, { error: `unknown action: ${action}` });
      return;
    }
    const params = await parseBody(req);
    const result = handler(params, { tenantId });
    json(res, 200, result);
    return;
  }

  // POST /db/bucket/:action — file bucket proxy routes
  const bucketMatch = urlPath.match(/^\/db\/bucket\/([a-zA-Z]+)$/);
  if (bucketMatch && req.method === 'POST') {
    const action = bucketMatch[1];
    const handler = dbHandlers[action];
    if (!handler) {
      json(res, 404, { error: `unknown bucket action: ${action}` });
      return;
    }
    const params = await parseBody(req);
    const result = handler(params, { tenantId });
    json(res, 200, result);
    return;
  }

  // POST /vdb/:action — nVDB proxy routes
  const vdbMatch = urlPath.match(/^\/vdb\/([a-zA-Z]+)$/);
  if (vdbMatch && req.method === 'POST') {
    const action = vdbMatch[1];
    const handler = vdbHandlers[action];
    if (!handler) {
      json(res, 404, { error: `unknown vdb action: ${action}` });
      return;
    }
    const params = await parseBody(req);
    const result = handler(params, { tenantId });
    json(res, 200, result);
    return;
  }

  // Nothing matched
  json(res, 404, { error: 'not found' });
}

module.exports = { route, json, parseBody };
