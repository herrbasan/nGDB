// tests/phase2_test.js — nGDB integration tests: Phase 2 (Document API)
// Tests the nGDB /db/* proxy surface: CRUD, query, file buckets.
// These tests belong to the nGDB project — NOT the nDB submodule.
// Uses Node.js built-in http module. No test frameworks.

const http = require('http');
const { rmSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const TEST_PORT = 9877;
const TEST_HOST = '127.0.0.1';
const TEST_DATA_DIR = join(__dirname, '..', '.test-data-phase2');

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
  console.log('Phase 2: Document API Tests\n');

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

  let handle;

  // ─── Test 1: Open Database ─────────────────────────────────────
  console.log('Test 1: Open database');
  {
    const res = await request('POST', '/db/open', {
      path: join(TEST_DATA_DIR, 'ndb', 'phase2-db'),
    });
    assert(res.status === 200, 'POST /db/open returns 200');
    assert(typeof res.body.handle === 'string', 'returns a handle string');
    handle = res.body.handle;
  }
  console.log('');

  // ─── Test 2: Insert with Prefix ────────────────────────────────
  console.log('Test 2: Insert with prefix');
  {
    const res = await request('POST', '/db/insertWithPrefix', {
      handle,
      prefix: 'user',
      doc: { name: 'Bob', role: 'admin' },
    });
    assert(res.status === 200, 'POST /db/insertWithPrefix returns 200');
    assert(res.body.id.startsWith('user_'), 'id has user_ prefix');
  }
  console.log('');

  // ─── Test 3: Insert Multiple Documents ─────────────────────────
  console.log('Test 3: Insert multiple documents');
  let docId1, docId2, docId3;
  {
    const res1 = await request('POST', '/db/insert', {
      handle,
      doc: { name: 'Alice', status: 'active', score: 95 },
    });
    assert(res1.status === 200, 'insert doc1 returns 200');
    docId1 = res1.body.id;

    const res2 = await request('POST', '/db/insert', {
      handle,
      doc: { name: 'Charlie', status: 'inactive', score: 42 },
    });
    assert(res2.status === 200, 'insert doc2 returns 200');
    docId2 = res2.body.id;

    const res3 = await request('POST', '/db/insert', {
      handle,
      doc: { name: 'Diana', status: 'active', score: 88 },
    });
    assert(res3.status === 200, 'insert doc3 returns 200');
    docId3 = res3.body.id;
  }
  console.log('');

  // ─── Test 4: Update Document ───────────────────────────────────
  console.log('Test 4: Update document');
  {
    const res = await request('POST', '/db/update', {
      handle,
      id: docId1,
      doc: { name: 'Alice Updated', status: 'active', score: 100 },
    });
    assert(res.status === 200, 'POST /db/update returns 200');
    assert(res.body.ok === true, 'returns ok: true');

    const getRes = await request('POST', '/db/get', { handle, id: docId1 });
    assert(getRes.body.doc.name === 'Alice Updated', 'name updated');
    assert(getRes.body.doc.score === 100, 'score updated');
  }
  console.log('');

  // ─── Test 5: Delete and Restore ────────────────────────────────
  console.log('Test 5: Delete and restore');
  {
    const delRes = await request('POST', '/db/delete', { handle, id: docId2 });
    assert(delRes.status === 200, 'POST /db/delete returns 200');
    assert(delRes.body.ok === true, 'returns ok: true');

    const idsRes = await request('POST', '/db/deletedIds', { handle });
    assert(idsRes.status === 200, 'POST /db/deletedIds returns 200');
    assert(Array.isArray(idsRes.body.ids), 'returns ids array');
    assert(idsRes.body.ids.includes(docId2), 'deleted id in list');

    const restoreRes = await request('POST', '/db/restore', { handle, id: docId2 });
    assert(restoreRes.status === 200, 'POST /db/restore returns 200');
    assert(restoreRes.body.ok === true, 'returns ok: true');

    const getRes = await request('POST', '/db/get', { handle, id: docId2 });
    assert(getRes.body.doc.name === 'Charlie', 'restored doc intact');
  }
  console.log('');

  // ─── Test 6: Query with AST ────────────────────────────────────
  console.log('Test 6: Query with AST');
  {
    const res = await request('POST', '/db/query', {
      handle,
      ast: { status: 'active' },
    });
    assert(res.status === 200, 'POST /db/query returns 200');
    assert(Array.isArray(res.body.results), 'returns results array');
    assert(res.body.results.length >= 1, 'at least 1 active doc');
  }
  console.log('');

  // ─── Test 7: Query with Options ────────────────────────────────
  console.log('Test 7: Query with options');
  {
    const res = await request('POST', '/db/queryWith', {
      handle,
      ast: { status: 'active' },
      options: { limit: 1, sortBy: 'score', sortDir: 'desc' },
    });
    assert(res.status === 200, 'POST /db/queryWith returns 200');
    assert(Array.isArray(res.body.results), 'returns results array');
    assert(res.body.results.length <= 1, 'limited to at most 1 result');
  }
  console.log('');

  // ─── Test 8: Find by Field ─────────────────────────────────────
  console.log('Test 8: Find by field');
  {
    const res = await request('POST', '/db/find', {
      handle,
      field: 'name',
      value: 'Diana',
    });
    assert(res.status === 200, 'POST /db/find returns 200');
    assert(Array.isArray(res.body.results), 'returns results array');
    assert(res.body.results.length === 1, 'found 1 doc');
    assert(res.body.results[0].name === 'Diana', 'correct doc found');
  }
  console.log('');

  // ─── Test 9: Find Range ────────────────────────────────────────
  console.log('Test 9: Find range');
  {
    const res = await request('POST', '/db/findRange', {
      handle,
      field: 'score',
      min: 80,
      max: 100,
    });
    assert(res.status === 200, 'POST /db/findRange returns 200');
    assert(Array.isArray(res.body.results), 'returns results array');
    assert(res.body.results.length >= 2, 'at least 2 docs in range');
  }
  console.log('');

  // ─── Test 10: Index Operations ─────────────────────────────────
  console.log('Test 10: Index operations');
  {
    const createRes = await request('POST', '/db/createIndex', {
      handle,
      field: 'status',
    });
    assert(createRes.status === 200, 'POST /db/createIndex returns 200');
    assert(createRes.body.ok === true, 'returns ok: true');

    const hasRes = await request('POST', '/db/hasIndex', {
      handle,
      field: 'status',
    });
    assert(hasRes.status === 200, 'POST /db/hasIndex returns 200');
    assert(hasRes.body.exists === true, 'index exists');

    const btreeRes = await request('POST', '/db/createBTreeIndex', {
      handle,
      field: 'score',
    });
    assert(btreeRes.status === 200, 'POST /db/createBTreeIndex returns 200');
    assert(btreeRes.body.ok === true, 'returns ok: true');

    const dropRes = await request('POST', '/db/dropIndex', {
      handle,
      field: 'status',
    });
    assert(dropRes.status === 200, 'POST /db/dropIndex returns 200');
    assert(dropRes.body.ok === true, 'returns ok: true');
  }
  console.log('');

  // ─── Test 11: Iter, Len, Contains, IsEmpty ─────────────────────
  console.log('Test 11: Utility operations');
  {
    const iterRes = await request('POST', '/db/iter', { handle });
    assert(iterRes.status === 200, 'POST /db/iter returns 200');
    assert(Array.isArray(iterRes.body.docs), 'returns docs array');

    const lenRes = await request('POST', '/db/len', { handle });
    assert(lenRes.status === 200, 'POST /db/len returns 200');
    assert(typeof lenRes.body.count === 'number', 'returns count number');
    assert(lenRes.body.count >= 3, 'at least 3 docs');

    const containsRes = await request('POST', '/db/contains', { handle, id: docId1 });
    assert(containsRes.status === 200, 'POST /db/contains returns 200');
    assert(containsRes.body.exists === true, 'doc exists');

    const emptyRes = await request('POST', '/db/isEmpty', { handle });
    assert(emptyRes.status === 200, 'POST /db/isEmpty returns 200');
    assert(emptyRes.body.empty === false, 'db is not empty');
  }
  console.log('');

  // ─── Test 12: File Bucket - Store ──────────────────────────────
  console.log('Test 12: File bucket - store');
  let fileMeta;
  {
    const fileContent = Buffer.from('Hello, nGDB file storage!').toString('base64');
    const res = await request('POST', '/db/bucket/storeFile', {
      handle,
      bucket: 'test-bucket',
      name: 'hello.txt',
      data: fileContent,
      mimeType: 'text/plain',
    });
    assert(res.status === 200, 'POST /db/bucket/storeFile returns 200');
    assert(res.body.meta != null, 'returns file metadata');
    fileMeta = res.body.meta;
  }
  console.log('');

  // ─── Test 13: File Bucket - List ───────────────────────────────
  console.log('Test 13: File bucket - list');
  {
    const res = await request('POST', '/db/bucket/listFiles', {
      handle,
      bucket: 'test-bucket',
    });
    assert(res.status === 200, 'POST /db/bucket/listFiles returns 200');
    assert(Array.isArray(res.body.files), 'returns files array');
    assert(res.body.files.length >= 1, 'at least 1 file in bucket');
  }
  console.log('');

  // ─── Test 14: File Bucket - Get ────────────────────────────────
  console.log('Test 14: File bucket - get');
  {
    const res = await request('POST', '/db/bucket/getFile', {
      handle,
      bucket: 'test-bucket',
      hash: fileMeta._file.id,
      ext: fileMeta._file.ext,
    });
    assert(res.status === 200, 'POST /db/bucket/getFile returns 200');
    assert(typeof res.body.data === 'string', 'returns base64 data string');
    const decoded = Buffer.from(res.body.data, 'base64').toString('utf-8');
    assert(decoded === 'Hello, nGDB file storage!', 'file content matches');
  }
  console.log('');

  // ─── Test 15: File Bucket - Delete ─────────────────────────────
  console.log('Test 15: File bucket - delete');
  {
    const res = await request('POST', '/db/bucket/deleteFile', {
      handle,
      bucket: 'test-bucket',
      hash: fileMeta._file.id,
      ext: fileMeta._file.ext,
    });
    assert(res.status === 200, 'POST /db/bucket/deleteFile returns 200');
    assert(res.body.ok === true, 'returns ok: true');

    const listRes = await request('POST', '/db/bucket/listFiles', {
      handle,
      bucket: 'test-bucket',
    });
    assert(listRes.body.files.length === 0, 'bucket is empty after delete');
  }
  console.log('');

  // ─── Test 16: Compact and Flush ────────────────────────────────
  console.log('Test 16: Compact and flush');
  {
    const flushRes = await request('POST', '/db/flush', { handle });
    assert(flushRes.status === 200, 'POST /db/flush returns 200');
    assert(flushRes.body.ok === true, 'returns ok: true');

    const compactRes = await request('POST', '/db/compact', { handle });
    assert(compactRes.status === 200, 'POST /db/compact returns 200');
    assert(compactRes.body.ok === true, 'returns ok: true');
  }
  console.log('');

  // ─── Test 17: Open In-Memory Database ──────────────────────────
  console.log('Test 17: Open in-memory database');
  {
    const res = await request('POST', '/db/openInMemory', {});
    assert(res.status === 200, 'POST /db/openInMemory returns 200');
    assert(typeof res.body.handle === 'string', 'returns a handle string');

    // Verify it works
    const insRes = await request('POST', '/db/insert', {
      handle: res.body.handle,
      doc: { temp: true },
    });
    assert(insRes.status === 200, 'insert into in-memory db works');

    const closeRes = await request('POST', '/db/close', { handle: res.body.handle });
    assert(closeRes.body.ok === true, 'close in-memory db works');
  }
  console.log('');

  // ─── Test 18: Close Database ───────────────────────────────────
  console.log('Test 18: Close database');
  {
    const res = await request('POST', '/db/close', { handle });
    assert(res.status === 200, 'POST /db/close returns 200');
    assert(res.body.ok === true, 'returns ok: true');
  }
  console.log('');

  // ─── Test 19: Unknown bucket action ────────────────────────────
  console.log('Test 19: Unknown bucket action returns 404');
  {
    const res = await request('POST', '/db/bucket/nonexistent', {});
    assert(res.status === 404, 'POST /db/bucket/nonexistent returns 404');
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
