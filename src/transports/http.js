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

async function routeAdminApi(req, res, urlPath) {
  if (!config.adminEnabled) {
    json(res, 404, { error: 'admin interface disabled' });
    return;
  }

  // Auth check
  const auth = checkAuth(req);
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

    // ─── nDB Instances ───────────────────────────────────────────
    if (apiPath === '/ndb/instances' && req.method === 'GET') {
      json(res, 200, adminApiHandlers['GET /ndb/instances']({}, { tenantId }));
      return;
    }

    // POST /ndb/instances — open database
    if (apiPath === '/ndb/instances' && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, dbHandlers.open(params, { tenantId }));
      return;
    }

    // DELETE /ndb/instances/:handle — close database
    const ndbInstanceMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)$/);
    if (ndbInstanceMatch && req.method === 'DELETE') {
      json(res, 200, dbHandlers.close({ handle: ndbInstanceMatch[1] }, { tenantId }));
      return;
    }

    // ─── nDB Documents ───────────────────────────────────────────
    // GET /ndb/instances/:handle/docs — list all docs
    const ndbDocsMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)\/docs$/);
    if (ndbDocsMatch && req.method === 'GET') {
      json(res, 200, adminApiHandlers['GET /ndb/instances/:handle/docs']({ handle: ndbDocsMatch[1] }, { tenantId }));
      return;
    }

    // POST /ndb/instances/:handle/docs — insert document
    if (ndbDocsMatch && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, dbHandlers.insert({ handle: ndbDocsMatch[1], doc: params.doc }, { tenantId }));
      return;
    }

    // GET/PUT/DELETE /ndb/instances/:handle/docs/:id
    const ndbDocMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)\/docs\/([^/]+)$/);
    if (ndbDocMatch) {
      const handle = ndbDocMatch[1];
      const id = ndbDocMatch[2];
      if (req.method === 'GET') {
        json(res, 200, adminApiHandlers['GET /ndb/instances/:handle/docs/:id']({ handle, id }, { tenantId }));
        return;
      }
      if (req.method === 'PUT') {
        const params = await parseBody(req);
        json(res, 200, dbHandlers.update({ handle, id, doc: params.doc }, { tenantId }));
        return;
      }
      if (req.method === 'DELETE') {
        json(res, 200, dbHandlers.delete({ handle, id }, { tenantId }));
        return;
      }
    }

    // ─── nDB Indexes ─────────────────────────────────────────────
    const ndbIndexesMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)\/indexes$/);
    if (ndbIndexesMatch && req.method === 'GET') {
      json(res, 200, { indexes: [] });
      return;
    }

    // ─── nDB Buckets ─────────────────────────────────────────────
    const ndbBucketsMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)\/buckets$/);
    if (ndbBucketsMatch && req.method === 'GET') {
      json(res, 200, { buckets: [] });
      return;
    }

    const ndbBucketFilesMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)\/buckets\/([^/]+)\/files$/);
    if (ndbBucketFilesMatch && req.method === 'GET') {
      json(res, 200, dbHandlers.listFiles({ handle: ndbBucketFilesMatch[1], bucket: ndbBucketFilesMatch[2] }, { tenantId }));
      return;
    }

    // ─── nVDB Instances ──────────────────────────────────────────
    if (apiPath === '/nvdb/instances' && req.method === 'GET') {
      json(res, 200, adminApiHandlers['GET /nvdb/instances']({}, { tenantId }));
      return;
    }

    // POST /nvdb/instances — open vector database
    if (apiPath === '/nvdb/instances' && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, vdbHandlers.open(params, { tenantId }));
      return;
    }

    // DELETE /nvdb/instances/:handle — close vector database
    const nvdbInstanceMatch = apiPath.match(/^\/nvdb\/instances\/([^/]+)$/);
    if (nvdbInstanceMatch && req.method === 'DELETE') {
      json(res, 200, vdbHandlers.close({ handle: nvdbInstanceMatch[1] }, { tenantId }));
      return;
    }

    // ─── nVDB Collections ────────────────────────────────────────
    // GET /nvdb/instances/:handle/collections
    const nvdbColsMatch = apiPath.match(/^\/nvdb\/instances\/([^/]+)\/collections$/);
    if (nvdbColsMatch && req.method === 'GET') {
      json(res, 200, adminApiHandlers['GET /nvdb/instances/:handle/collections']({ handle: nvdbColsMatch[1] }, { tenantId }));
      return;
    }

    // POST /nvdb/instances/:handle/collections — create collection
    if (nvdbColsMatch && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, vdbHandlers.createCollection({ handle: nvdbColsMatch[1], ...params }, { tenantId }));
      return;
    }

    // GET /nvdb/instances/:handle/collections/:name — collection detail
    const nvdbColMatch = apiPath.match(/^\/nvdb\/instances\/([^/]+)\/collections\/([^/]+)$/);
    if (nvdbColMatch && req.method === 'GET') {
      json(res, 200, vdbHandlers.getCollection({ handle: nvdbColMatch[1], name: nvdbColMatch[2] }, { tenantId }));
      return;
    }

    // POST /nvdb/instances/:handle/collections/:name/search — vector search
    const nvdbColSearchMatch = apiPath.match(/^\/nvdb\/instances\/([^/]+)\/collections\/([^/]+)\/search$/);
    if (nvdbColSearchMatch && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, vdbHandlers.search({
        handle: nvdbColSearchMatch[1],
        collection: nvdbColSearchMatch[2],
        ...params,
      }, { tenantId }));
      return;
    }

    // POST /nvdb/instances/:handle/collections/:name/docs — insert vector doc
    const nvdbColDocsMatch = apiPath.match(/^\/nvdb\/instances\/([^/]+)\/collections\/([^/]+)\/docs$/);
    if (nvdbColDocsMatch && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, vdbHandlers.insert({
        handle: nvdbColDocsMatch[1],
        collection: nvdbColDocsMatch[2],
        ...params,
      }, { tenantId }));
      return;
    }

    // ─── nDB Instance Actions ─────────────────────────────────────
    // POST /ndb/instances/:handle/flush
    const ndbActionMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)\/(flush|compact)$/);
    if (ndbActionMatch && req.method === 'POST') {
      const action = ndbActionMatch[2];
      json(res, 200, adminApiHandlers['POST /ndb/instances/:handle/' + action]({ handle: ndbActionMatch[1] }, { tenantId }));
      return;
    }

    // POST /ndb/instances/:handle/query — query with AST
    const ndbQueryMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)\/query$/);
    if (ndbQueryMatch && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, adminApiHandlers['POST /ndb/instances/:handle/query']({ handle: ndbQueryMatch[1], ...params }, { tenantId }));
      return;
    }

    // ─── nVDB Collection Actions ──────────────────────────────────
    // POST /nvdb/instances/:handle/collections/:name/flush
    const nvdbColActionMatch = apiPath.match(/^\/nvdb\/instances\/([^/]+)\/collections\/([^/]+)\/(flush|compact|rebuildIndex)$/);
    if (nvdbColActionMatch && req.method === 'POST') {
      const handle = nvdbColActionMatch[1];
      const collection = nvdbColActionMatch[2];
      const action = nvdbColActionMatch[3];
      const vdbActionMap = { flush: 'flush', compact: 'compact', rebuildIndex: 'rebuildIndex' };
      const handler = vdbHandlers[vdbActionMap[action]];
      if (handler) {
        json(res, 200, handler({ handle, collection }, { tenantId }));
      } else {
        json(res, 404, { error: `unknown action: ${action}` });
      }
      return;
    }

    // ─── nDB Bucket Actions ───────────────────────────────────────
    // POST /ndb/instances/:handle/buckets/:name/store — store file
    const ndbBucketStoreMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)\/buckets\/([^/]+)\/store$/);
    if (ndbBucketStoreMatch && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, dbHandlers.storeFile({
        handle: ndbBucketStoreMatch[1],
        bucket: ndbBucketStoreMatch[2],
        ...params,
      }, { tenantId }));
      return;
    }

    // POST /ndb/instances/:handle/buckets/:name/delete — delete file
    const ndbBucketDeleteMatch = apiPath.match(/^\/ndb\/instances\/([^/]+)\/buckets\/([^/]+)\/delete$/);
    if (ndbBucketDeleteMatch && req.method === 'POST') {
      const params = await parseBody(req);
      json(res, 200, dbHandlers.deleteFile({
        handle: ndbBucketDeleteMatch[1],
        bucket: ndbBucketDeleteMatch[2],
        ...params,
      }, { tenantId }));
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
