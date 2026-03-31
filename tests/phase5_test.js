// tests/phase5_test.js — nGDB integration tests: Phase 5 (nVDB Proxy Routes)
// Tests the nGDB /vdb/* proxy surface for the nVDB vector database backend.
// These tests belong to the nGDB project — NOT the nDB or nVDB submodules.
// Uses Node.js built-in http module. No test frameworks.

const http = require('http');
const { rmSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const TEST_PORT = 9880;
const TEST_HOST = '127.0.0.1';
const TEST_DATA_DIR = join(__dirname, '..', '.test-data-phase5');

// Set env before requiring server
process.env.PORT = String(TEST_PORT);
process.env.HOST = TEST_HOST;
process.env.NDB_DATA_DIR = join(TEST_DATA_DIR, 'ndb');
process.env.NVDB_DATA_DIR = join(TEST_DATA_DIR, 'nvdb');
process.env.API_KEYS = '';
process.env.TENANT_HEADER = '';

let server;
let passed = 0;
let failed = 0;

function request(method, path, body, headers = {}) {
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
        ...headers,
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
  console.log('Phase 5: nVDB Proxy Routes Tests\n');

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

  // ─── Test 1: Health check includes nvdb ──────────────────────────
  console.log('Test 1: Health check includes nvdb backend');
  {
    const res = await request('GET', '/health');
    assert(res.status === 200, 'GET /health returns 200');
    assert(res.body.backends.ndb === 'available', 'ndb backend available');
    assert(res.body.backends.nvdb === 'available', 'nvdb backend available');
  }
  console.log('');

  // ─── Test 2: Open nVDB database ──────────────────────────────────
  console.log('Test 2: Open nVDB database');
  let vdbHandle;
  {
    const res = await request('POST', '/vdb/open', { path: 'test-vectors' });
    assert(res.status === 200, 'POST /vdb/open returns 200');
    assert(typeof res.body.handle === 'string', 'returns a handle');
    vdbHandle = res.body.handle;
  }
  console.log('');

  // ─── Test 3: Create collection ───────────────────────────────────
  console.log('Test 3: Create collection');
  {
    const res = await request('POST', '/vdb/createCollection', {
      handle: vdbHandle,
      name: 'test-items',
      dimension: 4,
    });
    assert(res.status === 200, 'POST /vdb/createCollection returns 200');
    assert(res.body.name === 'test-items', 'returns collection name');
  }
  console.log('');

  // ─── Test 4: List collections ────────────────────────────────────
  console.log('Test 4: List collections');
  {
    const res = await request('POST', '/vdb/listCollections', {
      handle: vdbHandle,
    });
    assert(res.status === 200, 'POST /vdb/listCollections returns 200');
    assert(Array.isArray(res.body.names), 'returns names array');
    assert(res.body.names.includes('test-items'), 'test-items collection listed');
  }
  console.log('');

  // ─── Test 5: Get collection ──────────────────────────────────────
  console.log('Test 5: Get collection');
  {
    const res = await request('POST', '/vdb/getCollection', {
      handle: vdbHandle,
      name: 'test-items',
    });
    assert(res.status === 200, 'POST /vdb/getCollection returns 200');
    assert(res.body.name === 'test-items', 'returns collection name');
    assert(res.body.config.dim === 4, 'config has correct dimension');
  }
  console.log('');

  // ─── Test 6: Insert vector ───────────────────────────────────────
  console.log('Test 6: Insert vector');
  {
    const res = await request('POST', '/vdb/insert', {
      handle: vdbHandle,
      collection: 'test-items',
      id: 'vec1',
      vector: [1.0, 0.0, 0.0, 0.0],
      payload: JSON.stringify({ label: 'x-axis' }),
    });
    assert(res.status === 200, 'POST /vdb/insert returns 200');
    assert(res.body.ok === true, 'insert succeeded');
  }
  console.log('');

  // ─── Test 7: Batch insert ────────────────────────────────────────
  console.log('Test 7: Batch insert');
  {
    const res = await request('POST', '/vdb/insertBatch', {
      handle: vdbHandle,
      collection: 'test-items',
      docs: [
        { id: 'vec2', vector: [0.0, 1.0, 0.0, 0.0], payload: JSON.stringify({ label: 'y-axis' }) },
        { id: 'vec3', vector: [0.0, 0.0, 1.0, 0.0], payload: JSON.stringify({ label: 'z-axis' }) },
        { id: 'vec4', vector: [0.9, 0.1, 0.0, 0.0], payload: JSON.stringify({ label: 'near-x' }) },
      ],
    });
    assert(res.status === 200, 'POST /vdb/insertBatch returns 200');
    assert(res.body.ok === true, 'batch insert succeeded');
  }
  console.log('');

  // ─── Test 8: Get vector by ID ────────────────────────────────────
  console.log('Test 8: Get vector by ID');
  {
    const res = await request('POST', '/vdb/get', {
      handle: vdbHandle,
      collection: 'test-items',
      id: 'vec1',
    });
    assert(res.status === 200, 'POST /vdb/get returns 200');
    assert(res.body.doc !== null, 'document found');
    assert(res.body.doc.id === 'vec1', 'correct ID');
    assert(Array.isArray(res.body.doc.vector), 'has vector array');
    assert(res.body.doc.vector.length === 4, 'vector has correct dimension');
  }
  console.log('');

  // ─── Test 9: Search (exact) ──────────────────────────────────────
  console.log('Test 9: Search (exact)');
  {
    const res = await request('POST', '/vdb/search', {
      handle: vdbHandle,
      collection: 'test-items',
      vector: [1.0, 0.0, 0.0, 0.0],
      topK: 3,
      distance: 'cosine',
      approximate: false,
    });
    assert(res.status === 200, 'POST /vdb/search returns 200');
    assert(Array.isArray(res.body.results), 'returns results array');
    assert(res.body.results.length > 0, 'has results');
    assert(res.body.results.length <= 3, 'respects topK limit');
    // vec1 [1,0,0,0] should be the closest match to [1,0,0,0]
    assert(res.body.results[0].id === 'vec1', 'best match is vec1');
    assert(typeof res.body.results[0].score === 'number', 'has score');
  }
  console.log('');

  // ─── Test 10: Delete vector ──────────────────────────────────────
  console.log('Test 10: Delete vector');
  {
    const res = await request('POST', '/vdb/delete', {
      handle: vdbHandle,
      collection: 'test-items',
      id: 'vec3',
    });
    assert(res.status === 200, 'POST /vdb/delete returns 200');
    assert(res.body.existed === true, 'document existed and was deleted');

    // Verify it's gone
    const getRes = await request('POST', '/vdb/get', {
      handle: vdbHandle,
      collection: 'test-items',
      id: 'vec3',
    });
    assert(getRes.body.doc === null, 'deleted doc returns null');
  }
  console.log('');

  // ─── Test 11: Flush and index operations ─────────────────────────
  console.log('Test 11: Flush and index operations');
  {
    const flushRes = await request('POST', '/vdb/flush', {
      handle: vdbHandle,
      collection: 'test-items',
    });
    assert(flushRes.status === 200, 'flush returns 200');
    assert(flushRes.body.ok === true, 'flush succeeded');

    const hasIdxRes = await request('POST', '/vdb/hasIndex', {
      handle: vdbHandle,
      collection: 'test-items',
    });
    assert(hasIdxRes.status === 200, 'hasIndex returns 200');

    const rebuildRes = await request('POST', '/vdb/rebuildIndex', {
      handle: vdbHandle,
      collection: 'test-items',
    });
    assert(rebuildRes.status === 200, 'rebuildIndex returns 200');
    assert(rebuildRes.body.ok === true, 'rebuildIndex succeeded');

    const hasIdxRes2 = await request('POST', '/vdb/hasIndex', {
      handle: vdbHandle,
      collection: 'test-items',
    });
    assert(hasIdxRes2.body.exists === true, 'index exists after rebuild');

    const deleteIdxRes = await request('POST', '/vdb/deleteIndex', {
      handle: vdbHandle,
      collection: 'test-items',
    });
    assert(deleteIdxRes.status === 200, 'deleteIndex returns 200');
    assert(deleteIdxRes.body.ok === true, 'deleteIndex succeeded');
  }
  console.log('');

  // ─── Test 12: Sync ───────────────────────────────────────────────
  console.log('Test 12: Sync');
  {
    const res = await request('POST', '/vdb/sync', {
      handle: vdbHandle,
      collection: 'test-items',
    });
    assert(res.status === 200, 'sync returns 200');
    assert(res.body.ok === true, 'sync succeeded');
  }
  console.log('');

  // ─── Test 13: Compact ────────────────────────────────────────────
  console.log('Test 13: Compact');
  {
    const res = await request('POST', '/vdb/compact', {
      handle: vdbHandle,
      collection: 'test-items',
    });
    assert(res.status === 200, 'compact returns 200');
    assert(res.body.result !== undefined, 'returns compaction result');
  }
  console.log('');

  // ─── Test 14: Close nVDB database ────────────────────────────────
  console.log('Test 14: Close nVDB database');
  {
    const res = await request('POST', '/vdb/close', { handle: vdbHandle });
    assert(res.status === 200, 'POST /vdb/close returns 200');
    assert(res.body.ok === true, 'close succeeded');
  }
  console.log('');

  // ─── Test 15: Unknown vdb action returns 404 ─────────────────────
  console.log('Test 15: Unknown vdb action returns 404');
  {
    const res = await request('POST', '/vdb/nonexistent', {});
    assert(res.status === 404, 'unknown action returns 404');
    assert(res.body.error.includes('unknown vdb action'), 'error message mentions vdb');
  }
  console.log('');

  // ─── Test 16: Multi-tenancy with nVDB ────────────────────────────
  console.log('Test 16: Multi-tenancy with nVDB');
  {
    // Configure tenancy
    const config = require('../src/config');
    config.tenantHeader = 'x-tenant-id';

    // Open VDB for tenant A
    const resA = await request('POST', '/vdb/open', {
      path: 'tenant-a-vdb',
    }, {
      'x-tenant-id': 'tenant-a',
    });
    assert(resA.status === 200, 'open VDB for tenant-a');
    const handleA = resA.body.handle;

    // Create collection and insert
    await request('POST', '/vdb/createCollection', {
      handle: handleA,
      name: 'embeddings',
      dimension: 3,
    }, { 'x-tenant-id': 'tenant-a' });

    const insA = await request('POST', '/vdb/insert', {
      handle: handleA,
      collection: 'embeddings',
      id: 'emb1',
      vector: [0.5, 0.5, 0.5],
    }, { 'x-tenant-id': 'tenant-a' });
    assert(insA.status === 200, 'insert into tenant-a collection');

    // Open VDB for tenant B
    const resB = await request('POST', '/vdb/open', {
      path: 'tenant-b-vdb',
    }, {
      'x-tenant-id': 'tenant-b',
    });
    assert(resB.status === 200, 'open VDB for tenant-b');
    const handleB = resB.body.handle;

    // Tenant B has no collections yet
    const listB = await request('POST', '/vdb/listCollections', {
      handle: handleB,
    }, { 'x-tenant-id': 'tenant-b' });
    assert(listB.status === 200, 'list collections for tenant-b');
    assert(listB.body.names.length === 0, 'tenant-b has no collections');

    // Cleanup
    await request('POST', '/vdb/close', { handle: handleA }, { 'x-tenant-id': 'tenant-a' });
    await request('POST', '/vdb/close', { handle: handleB }, { 'x-tenant-id': 'tenant-b' });

    // Reset tenancy
    config.tenantHeader = '';
  }
  console.log('');

  // ─── Cleanup ─────────────────────────────────────────────────────
  console.log('Cleaning up...');
  server.close();
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true });
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  if (server) server.close();
  process.exit(1);
});
