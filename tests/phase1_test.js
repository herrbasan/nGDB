// tests/phase1_test.js — Integration tests against live nGDB HTTP server
// Uses Node.js built-in http module. No test frameworks.

const http = require('http');
const { rmSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const TEST_PORT = 9876;
const TEST_HOST = '127.0.0.1';
const TEST_DATA_DIR = join(__dirname, '..', '.test-data');

// Set env before requiring server
process.env.PORT = String(TEST_PORT);
process.env.HOST = TEST_HOST;
process.env.NDB_DATA_DIR = join(TEST_DATA_DIR, 'ndb');

let server;
let passed = 0;
let failed = 0;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const options = {
      hostname: TEST_HOST,
      port: TEST_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        const parsed = raw ? JSON.parse(raw) : {};
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

async function run() {
  console.log('Phase 1: Foundation Tests\n');

  // Setup test data dir
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });

  // Start server
  console.log('Starting server...');
  server = require('../src/server');

  // Wait for server to be ready
  await new Promise((resolve) => {
    server.on('listening', resolve);
    if (server.listening) resolve();
  });
  console.log('');

  // ─── Test 1: Health Check ─────────────────────────────────────
  console.log('Test 1: Health check');
  {
    const res = await request('GET', '/health');
    assert(res.status === 200, 'GET /health returns 200');
    assert(res.body.status === 'healthy', 'status is healthy');
    assert(res.body.backends.ndb === 'available', 'ndb backend is available');
  }
  console.log('');

  // ─── Test 2: Open Database ────────────────────────────────────
  console.log('Test 2: Open database');
  let handle;
  {
    const res = await request('POST', '/db/open', {
      path: join(TEST_DATA_DIR, 'ndb', 'test-db'),
    });
    assert(res.status === 200, 'POST /db/open returns 200');
    assert(typeof res.body.handle === 'string', 'returns a handle string');
    assert(res.body.handle.length > 0, 'handle is not empty');
    handle = res.body.handle;
  }
  console.log('');

  // ─── Test 3: Insert Document ──────────────────────────────────
  console.log('Test 3: Insert document');
  let docId;
  {
    const res = await request('POST', '/db/insert', {
      handle,
      doc: { name: 'Alice', email: 'alice@example.com', status: 'active' },
    });
    assert(res.status === 200, 'POST /db/insert returns 200');
    assert(typeof res.body.id === 'string', 'returns an id string');
    assert(res.body.id.length > 0, 'id is not empty');
    docId = res.body.id;
  }
  console.log('');

  // ─── Test 4: Get Document ─────────────────────────────────────
  console.log('Test 4: Get document');
  {
    const res = await request('POST', '/db/get', { handle, id: docId });
    assert(res.status === 200, 'POST /db/get returns 200');
    assert(res.body.doc.name === 'Alice', 'doc.name is Alice');
    assert(res.body.doc.email === 'alice@example.com', 'doc.email matches');
    assert(res.body.doc._id === docId, 'doc._id matches inserted id');
  }
  console.log('');

  // ─── Test 5: Update Document ──────────────────────────────────
  console.log('Test 5: Update document');
  {
    const res = await request('POST', '/db/update', {
      handle,
      id: docId,
      doc: { name: 'Alice Updated', email: 'alice@new.com', status: 'active' },
    });
    assert(res.status === 200, 'POST /db/update returns 200');
    assert(res.body.ok === true, 'returns ok: true');

    const getRes = await request('POST', '/db/get', { handle, id: docId });
    assert(getRes.body.doc.name === 'Alice Updated', 'name updated');
  }
  console.log('');

  // ─── Test 6: Delete Document ──────────────────────────────────
  console.log('Test 6: Delete document');
  {
    const res = await request('POST', '/db/delete', { handle, id: docId });
    assert(res.status === 200, 'POST /db/delete returns 200');
    assert(res.body.ok === true, 'returns ok: true');
  }
  console.log('');

  // ─── Test 7: Close Database ───────────────────────────────────
  console.log('Test 7: Close database');
  {
    const res = await request('POST', '/db/close', { handle });
    assert(res.status === 200, 'POST /db/close returns 200');
    assert(res.body.ok === true, 'returns ok: true');
  }
  console.log('');

  // ─── Test 8: 404 for unknown route ────────────────────────────
  console.log('Test 8: Unknown route returns 404');
  {
    const res = await request('GET', '/nonexistent');
    assert(res.status === 404, 'GET /nonexistent returns 404');
  }
  console.log('');

  // ─── Test 9: 404 for unknown action ───────────────────────────
  console.log('Test 9: Unknown action returns 404');
  {
    const res = await request('POST', '/db/nonexistent', {});
    assert(res.status === 404, 'POST /db/nonexistent returns 404');
  }
  console.log('');

  // ─── Cleanup ──────────────────────────────────────────────────
  server.close();
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true });
  }

  // ─── Summary ──────────────────────────────────────────────────
  console.log('─────────────────────────────');
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  if (server) server.close();
  process.exit(1);
});
