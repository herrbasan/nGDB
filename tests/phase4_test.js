// tests/phase4_test.js — Integration tests for Phase 4: Auth + Multi-tenancy
// Uses Node.js built-in http module. No test frameworks.

const http = require('http');
const { rmSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const TEST_PORT = 9877;
const TEST_HOST = '127.0.0.1';
const TEST_DATA_DIR = join(__dirname, '..', '.test-data-phase4');

// Set env before requiring server — configure API keys for auth testing
process.env.PORT = String(TEST_PORT);
process.env.HOST = TEST_HOST;
process.env.NDB_DATA_DIR = join(TEST_DATA_DIR, 'ndb');
process.env.API_KEYS = 'test-key-1,test-key-2';
process.env.LOCAL_AUTH_BYPASS = 'true'; // loopback (127.0.0.1) should bypass
process.env.TENANT_HEADER = 'x-tenant-id';

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
  console.log('Phase 4: Auth + Multi-Tenancy Tests\n');

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

  // ─── Test 1: Health check always accessible ──────────────────────
  console.log('Test 1: Health check (no auth needed)');
  {
    const res = await request('GET', '/health');
    assert(res.status === 200, 'GET /health returns 200 without auth');
    assert(res.body.status === 'healthy', 'status is healthy');
  }
  console.log('');

  // ─── Test 2: Local network bypass (loopback) ─────────────────────
  console.log('Test 2: Local network bypass (loopback = 127.0.0.1)');
  {
    // From 127.0.0.1, requests should pass without API key
    const res = await request('POST', '/db/open', {
      path: 'bypass-test',
    });
    assert(res.status === 200, 'POST /db/open works without API key from loopback');
    assert(typeof res.body.handle === 'string', 'returns a handle');
  }
  console.log('');

  // ─── Test 3: Valid API key via Bearer header ─────────────────────
  console.log('Test 3: Valid API key via Authorization header');
  {
    const res = await request('POST', '/db/open', {
      path: 'auth-test',
    }, {
      'Authorization': 'Bearer test-key-1',
    });
    assert(res.status === 200, 'POST /db/open works with valid Bearer token');
    assert(typeof res.body.handle === 'string', 'returns a handle');
  }
  console.log('');

  // ─── Test 4: Valid API key via query param ───────────────────────
  console.log('Test 4: Valid API key via query param');
  {
    const res = await request('POST', '/db/open?apiKey=test-key-2', {
      path: 'query-auth-test',
    });
    assert(res.status === 200, 'POST /db/open works with valid apiKey query param');
    assert(typeof res.body.handle === 'string', 'returns a handle');
  }
  console.log('');

  // ─── Test 5: Invalid API key rejected ────────────────────────────
  // Note: Since we're on loopback with localAuthBypass=true, the bypass
  // takes priority. We need to test the auth logic directly.
  console.log('Test 5: Auth middleware unit tests');
  {
    const { checkAuth, isPrivateIP } = require('../src/middleware/auth');

    // Test isPrivateIP
    assert(isPrivateIP('127.0.0.1') === true, '127.0.0.1 is private');
    assert(isPrivateIP('10.0.0.1') === true, '10.0.0.1 is private');
    assert(isPrivateIP('172.16.0.1') === true, '172.16.0.1 is private');
    assert(isPrivateIP('192.168.1.1') === true, '192.168.1.1 is private');
    assert(isPrivateIP('8.8.8.8') === false, '8.8.8.8 is not private');
    assert(isPrivateIP('::1') === true, '::1 is private');
    assert(isPrivateIP('[::1]') === true, '[::1] is private');

    // Test checkAuth with no keys configured (auth disabled)
    const origKeys = require('../src/config').apiKeys;
    require('../src/config').apiKeys = [];
    const noKeyReq = { headers: {}, url: '/', socket: { remoteAddress: '8.8.8.8' } };
    const noKeyResult = checkAuth(noKeyReq);
    assert(noKeyResult.ok === true, 'no keys configured = auth disabled');
    require('../src/config').apiKeys = origKeys;

    // Test checkAuth with keys, external IP, no bypass
    const origBypass = require('../src/config').localAuthBypass;
    require('../src/config').localAuthBypass = false;

    const badKeyReq = {
      headers: { authorization: 'Bearer wrong-key', host: 'localhost:3000' },
      url: '/db/insert',
      socket: { remoteAddress: '8.8.8.8' },
    };
    const badKeyResult = checkAuth(badKeyReq);
    assert(badKeyResult.ok === false, 'wrong API key rejected');
    assert(badKeyResult.status === 403, 'wrong key returns 403');

    const noKeyReq2 = {
      headers: { host: 'localhost:3000' },
      url: '/db/insert',
      socket: { remoteAddress: '8.8.8.8' },
    };
    const noKeyResult2 = checkAuth(noKeyReq2);
    assert(noKeyResult2.ok === false, 'missing API key rejected');
    assert(noKeyResult2.status === 401, 'missing key returns 401');

    const goodKeyReq = {
      headers: { authorization: 'Bearer test-key-1', host: 'localhost:3000' },
      url: '/db/insert',
      socket: { remoteAddress: '8.8.8.8' },
    };
    const goodKeyResult = checkAuth(goodKeyReq);
    assert(goodKeyResult.ok === true, 'valid API key accepted');

    // Restore bypass
    require('../src/config').localAuthBypass = origBypass;
  }
  console.log('');

  // ─── Test 6: Multi-tenancy — tenant header extraction ────────────
  console.log('Test 6: Multi-tenancy — tenant header extraction');
  {
    const { extractTenant, ndbDataDir } = require('../src/middleware/tenancy');

    const reqWithTenant = { headers: { 'x-tenant-id': 'acme-corp' } };
    const reqNoTenant = { headers: {} };
    const reqBadTenant = { headers: { 'x-tenant-id': '../evil' } };

    assert(extractTenant(reqWithTenant) === 'acme-corp', 'extracts valid tenant ID');
    assert(extractTenant(reqNoTenant) === null, 'returns null when no header');
    assert(extractTenant(reqBadTenant) === null, 'rejects path traversal in tenant ID');

    const defaultDir = ndbDataDir(null);
    const tenantDir = ndbDataDir('acme-corp');
    assert(defaultDir === require('../src/config').ndbDataDir, 'null tenant uses base dir');
    assert(tenantDir === join(require('../src/config').ndbDataDir, 'tenants', 'acme-corp'), 'tenant gets isolated subdirectory');
  }
  console.log('');

  // ─── Test 7: Multi-tenancy — isolated data paths via HTTP ────────
  console.log('Test 7: Multi-tenancy — isolated databases via HTTP');
  {
    // Open DB for tenant A
    const resA = await request('POST', '/db/open', {
      path: 'tenant-a-db',
    }, {
      'x-tenant-id': 'tenant-a',
    });
    assert(resA.status === 200, 'open DB for tenant-a');
    const handleA = resA.body.handle;

    // Open DB for tenant B
    const resB = await request('POST', '/db/open', {
      path: 'tenant-b-db',
    }, {
      'x-tenant-id': 'tenant-b',
    });
    assert(resB.status === 200, 'open DB for tenant-b');
    const handleB = resB.body.handle;

    // Insert into tenant A
    const insA = await request('POST', '/db/insert', {
      handle: handleA,
      doc: { name: 'doc-in-a' },
    }, {
      'x-tenant-id': 'tenant-a',
    });
    assert(insA.status === 200, 'insert into tenant-a');

    // Insert into tenant B
    const insB = await request('POST', '/db/insert', {
      handle: handleB,
      doc: { name: 'doc-in-b' },
    }, {
      'x-tenant-id': 'tenant-b',
    });
    assert(insB.status === 200, 'insert into tenant-b');

    // Verify tenant A can only see its data
    const iterA = await request('POST', '/db/iter', {
      handle: handleA,
    }, {
      'x-tenant-id': 'tenant-a',
    });
    assert(iterA.status === 200, 'iter tenant-a');
    assert(iterA.body.docs.length === 1, 'tenant-a sees only its own doc');
    assert(iterA.body.docs[0].name === 'doc-in-a', 'tenant-a doc has correct name');

    // Verify tenant B can only see its data
    const iterB = await request('POST', '/db/iter', {
      handle: handleB,
    }, {
      'x-tenant-id': 'tenant-b',
    });
    assert(iterB.status === 200, 'iter tenant-b');
    assert(iterB.body.docs.length === 1, 'tenant-b sees only its own doc');
    assert(iterB.body.docs[0].name === 'doc-in-b', 'tenant-b doc has correct name');

    // Cleanup
    await request('POST', '/db/close', { handle: handleA }, { 'x-tenant-id': 'tenant-a' });
    await request('POST', '/db/close', { handle: handleB }, { 'x-tenant-id': 'tenant-b' });
  }
  console.log('');

  // ─── Test 8: No tenant header uses default data dir ──────────────
  console.log('Test 8: No tenant header = default data dir');
  {
    const res = await request('POST', '/db/open', {
      path: 'default-db',
    });
    assert(res.status === 200, 'open DB without tenant header');
    const handle = res.body.handle;

    const ins = await request('POST', '/db/insert', {
      handle,
      doc: { name: 'default-tenant-doc' },
    });
    assert(ins.status === 200, 'insert without tenant header');

    const iter = await request('POST', '/db/iter', { handle });
    assert(iter.status === 200, 'iter without tenant header');
    assert(iter.body.docs.length === 1, 'default tenant sees its doc');

    await request('POST', '/db/close', { handle });
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
