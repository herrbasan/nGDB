// src/transports/http.js — HTTP request/response adapter
// Parses HTTP requests, dispatches to handlers, returns JSON responses.
// This is the only layer that knows about HTTP.

const { handlers: dbHandlers, instances: dbInstances } = require('../handlers/db');
const { handlers: vdbHandlers, instances: vdbInstances } = require('../handlers/vdb');
const { checkAuth } = require('../middleware/auth');
const { extractTenant } = require('../middleware/tenancy');

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

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // GET /health — always accessible, no auth required
  if (path === '/health' && req.method === 'GET') {
    json(res, 200, health());
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
  const dbMatch = path.match(/^\/db\/([a-zA-Z]+)$/);
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
  const bucketMatch = path.match(/^\/db\/bucket\/([a-zA-Z]+)$/);
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
  const vdbMatch = path.match(/^\/vdb\/([a-zA-Z]+)$/);
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
