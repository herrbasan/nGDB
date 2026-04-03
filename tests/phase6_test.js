// tests/phase6_test.js — nGDB integration tests: Phase 6 (Ecosystem - Javascript SDK)
// Tests the vanilla JavaScript client SDK (sdk/ngdb-client.js) against a live server.

const { rmSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');
const NGDBClient = require('../sdk/ngdb-client.js');

const TEST_PORT = 9886;
const TEST_HOST = '127.0.0.1';
const TEST_DATA_DIR = join(__dirname, '..', '.test-data-phase6');

// Environment Setup
process.env.PORT = String(TEST_PORT);
process.env.HOST = TEST_HOST;
process.env.NDB_DATA_DIR = join(TEST_DATA_DIR, 'ndb');
process.env.API_KEYS = 'test-key-123';
process.env.TENANT_HEADER = 'x-tenant-id';

let server;
let passed = 0;
let failed = 0;

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
  console.log('Phase 6: SDK Client Tests\n');

  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });

  console.log('Starting server...');
  server = require('../src/server');

  await new Promise((resolve) => {
    server.on('listening', resolve);
    if (server.listening) resolve();
  });
  console.log('');

  const client = new NGDBClient({
    url: `http://${TEST_HOST}:${TEST_PORT}`,
    apiKey: 'test-key-123',
    tenantId: 'tenant-test'
  });

  // ─── Test 1: Health ──────────────────────────────────────────────────────────
  console.log('Test 1: Health HTTP route');
  try {
    const health = await client.health();
    assert(health.status === 'healthy', 'client.health() passes');
  } catch (err) {
    assert(false, `client.health() threw: ${err.message}`);
  }
  console.log('');

  // ─── Test 2: HTTP Document DB Proxy ──────────────────────────────────────────
  console.log('Test 2: Document DB HTTP routes via client SDK');
  let dbHandle;
  let docId;
  try {
    const path = join(TEST_DATA_DIR, 'sdk-db');
    const db = await client.dbOpen(path);
    assert(typeof db.insert === 'function', 'db proxy object constructed');

    const insertRes = await db.insert({ sdk: true, version: 1 });
    assert(typeof insertRes.id === 'string', 'db.insert() works');
    docId = insertRes.id;

    const getRes = await db.get(docId);
    assert(getRes.doc.sdk === true, 'db.get() works');

    await db.close();
    assert(true, 'db.close() works');
  } catch (err) {
    assert(false, `SDK DB threw: ${err.message}`);
  }
  console.log('');

  // ─── Test 3: Test WebSocket Stream ───────────────────────────────────────────
  console.log('Test 3: WebSocket Real-Time connection via client SDK');
  try {
    client.reconnectDelay = 100;
    
    // Connect WS and await connection confirmation
    await new Promise((resolve) => {
        client.onConnect = resolve;
        client.connectWs();
    });
    assert(client.ws !== null && client.ws.readyState === 1, 'connectWs() opened successfully');

    // Subscribe
    const subRes = await client.subscribe('sdk-collection', null, 'db');
    assert(subRes.action === 'subscribed', 'subscribed returned over websocket');
    
    // Let's create an event listener
    const broadcastPromise = new Promise((resolve) => {
        client.onEvent = (data) => resolve(data);
    });

    // We'll write to the DB using HTTP to trigger a WS broadcast
    const path = join(TEST_DATA_DIR, 'sdk-ws-db');
    const writerClient = new NGDBClient({
      url: `http://${TEST_HOST}:${TEST_PORT}`,
      apiKey: 'test-key-123',
      tenantId: 'tenant-test'
    });
    const writeDb = await writerClient.dbOpen(path);
    await writeDb.insert({ broadcast: 'yes' });

    // Wait for WS
    const wsEvent = await Promise.race([
        broadcastPromise,
        new Promise((_, r) => setTimeout(() => r(new Error('wait timeout')), 2000))
    ]);

    assert(wsEvent.action === 'update' && wsEvent.type === 'insert', 'caught websocket broadcast mutation');

    client.disconnectWs();
    assert(client.ws === null, 'disconnectWs() drops connection safely');
    await writeDb.close();

  } catch (err) {
    assert(false, `SDK WS threw: ${err.message}`);
  }
  console.log('');

  // ─── Finish ────────────────────────────────────────────────────────────────
  console.log('Summary:');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
