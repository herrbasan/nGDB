// tests/phase3_test.js — nGDB integration tests: Phase 3 (Real-Time WebSocket)
// Tests the nGDB WebSocket layer: WS connection, DB proxy over WS, subscriptions, broadcast, ping/pong.
// These tests belong to the nGDB project — NOT the nDB submodule.
// Uses raw TCP + WebSocket protocol. No external dependencies.

const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { rmSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const TEST_PORT = 9878;
const TEST_HOST = '127.0.0.1';
const TEST_DATA_DIR = join(__dirname, '..', '.test-data-phase3');

// Set env before requiring server
process.env.PORT = String(TEST_PORT);
process.env.HOST = TEST_HOST;
process.env.NDB_DATA_DIR = join(TEST_DATA_DIR, 'ndb');

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

// ─── HTTP helper ───────────────────────────────────────────────────
function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(
      {
        hostname: TEST_HOST,
        port: TEST_PORT,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          const parsed = raw ? JSON.parse(raw) : {};
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

// ─── Raw WebSocket Client ──────────────────────────────────────────
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB5DC11B5A0';

function wsConnect(path) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const acceptExpected = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');

    const socket = net.createConnection({ host: TEST_HOST, port: TEST_PORT }, () => {
      const req = [
        `GET ${path} HTTP/1.1`,
        `Host: ${TEST_HOST}:${TEST_PORT}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n');
      socket.write(req);
    });

    let handshakeDone = false;
    let recvBuf = Buffer.alloc(0);
    const messageQueue = [];
    let resolveMessage = null;

    socket.on('data', (chunk) => {
      if (!handshakeDone) {
        // Parse HTTP upgrade response
        recvBuf = Buffer.concat([recvBuf, chunk]);
        const headerEnd = recvBuf.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const headerStr = recvBuf.subarray(0, headerEnd).toString('utf-8');
        if (!headerStr.includes('101')) {
          reject(new Error('WebSocket handshake failed: ' + headerStr));
          return;
        }

        handshakeDone = true;
        recvBuf = recvBuf.subarray(headerEnd + 4);
        resolve({
          socket,
          send(obj) {
            const mask = crypto.randomBytes(4);
            const payload = Buffer.from(JSON.stringify(obj), 'utf-8');
            const header = [];

            header.push(0x81); // FIN + text

            if (payload.length < 126) {
              header.push(0x80 | payload.length);
            } else if (payload.length < 65536) {
              header.push(0x80 | 126);
              header.push((payload.length >> 8) & 0xff, payload.length & 0xff);
            } else {
              header.push(0x80 | 127);
              for (let i = 7; i >= 0; i--) header.push((payload.length >> (i * 8)) & 0xff);
            }

            const masked = Buffer.alloc(payload.length);
            for (let i = 0; i < payload.length; i++) {
              masked[i] = payload[i] ^ mask[i & 3];
            }

            socket.write(Buffer.concat([Buffer.from(header), mask, masked]));
          },
          nextMessage(timeout) {
            return new Promise((res, rej) => {
              if (messageQueue.length > 0) {
                res(messageQueue.shift());
                return;
              }
              const timer = setTimeout(() => rej(new Error('WS message timeout')), timeout || 3000);
              resolveMessage = (msg) => {
                clearTimeout(timer);
                res(msg);
              };
            });
          },
          close() {
            socket.destroy();
          },
        });

        // Process any remaining data after handshake
        if (recvBuf.length > 0) processFrames();
        return;
      }

      recvBuf = Buffer.concat([recvBuf, chunk]);
      processFrames();
    });

    function processFrames() {
      while (recvBuf.length > 0) {
        const frame = parseFrame(recvBuf);
        if (!frame) break;

        recvBuf = recvBuf.subarray(frame.totalBytes);

        if (frame.opcode === 0x01) {
          // Text frame
          const msg = JSON.parse(frame.payload.toString('utf-8'));
          if (resolveMessage) {
            const r = resolveMessage;
            resolveMessage = null;
            r(msg);
          } else {
            messageQueue.push(msg);
          }
        } else if (frame.opcode === 0x08) {
          // Close
          socket.destroy();
        }
      }
    }

    socket.on('error', (err) => {
      if (!handshakeDone) reject(err);
    });

    setTimeout(() => {
      if (!handshakeDone) {
        socket.destroy();
        reject(new Error('WebSocket connection timeout'));
      }
    }, 5000);
  });
}

function parseFrame(buf) {
  if (buf.length < 2) return null;

  const b1 = buf[1];
  const masked = (b1 & 0x80) !== 0;
  let payloadLen = b1 & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = 0;
    for (let i = 0; i < 8; i++) {
      payloadLen = payloadLen * 256 + buf[offset + i];
    }
    offset = 10;
  }

  if (masked) offset += 4;
  if (buf.length < offset + payloadLen) return null;

  let payload = buf.subarray(offset, offset + payloadLen);

  if (masked) {
    const maskStart = offset - 4;
    const mask = [buf[maskStart], buf[maskStart + 1], buf[maskStart + 2], buf[maskStart + 3]];
    const unmasked = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      unmasked[i] = payload[i] ^ mask[i & 3];
    }
    payload = unmasked;
  }

  return { opcode: buf[0] & 0x0f, payload, totalBytes: offset + payloadLen };
}

// ─── Tests ─────────────────────────────────────────────────────────

async function run() {
  console.log('Phase 3: Real-Time WebSocket Tests\n');

  // Setup test data dir
  if (existsSync(TEST_DATA_DIR)) {
    rmSync(TEST_DATA_DIR, { recursive: true });
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });

  // Start server
  console.log('Starting server...');
  server = require('../src/server');

  await new Promise((resolve) => {
    server.on('listening', resolve);
    if (server.listening) resolve();
  });
  console.log('');

  // ─── Test 1: WebSocket Connection ──────────────────────────────
  console.log('Test 1: WebSocket connection');
  {
    const ws = await wsConnect('/ws');
    assert(ws !== null, 'WebSocket connects successfully');

    // Send ping, expect pong
    ws.send({ action: 'ping' });
    const pong = await ws.nextMessage();
    assert(pong.action === 'pong', 'ping/pong works');

    ws.close();
  }
  console.log('');

  // ─── Test 2: DB Proxy over WebSocket ───────────────────────────
  console.log('Test 2: DB proxy over WebSocket');
  {
    const ws = await wsConnect('/ws');

    // Open database
    ws.send({ action: 'open', path: join(TEST_DATA_DIR, 'ndb', 'ws-test-db'), requestId: 'r1' });
    const openRes = await ws.nextMessage();
    assert(openRes.action === 'open', 'open action echoed');
    assert(typeof openRes.result.handle === 'string', 'returns handle');
    const handle = openRes.result.handle;

    // Insert document
    ws.send({ action: 'insert', handle, doc: { name: 'WS-Test', status: 'active' }, requestId: 'r2' });
    const insertRes = await ws.nextMessage();
    assert(insertRes.action === 'insert', 'insert action echoed');
    assert(typeof insertRes.result.id === 'string', 'returns id');
    const docId = insertRes.result.id;

    // Get document
    ws.send({ action: 'get', handle, id: docId, requestId: 'r3' });
    const getRes = await ws.nextMessage();
    assert(getRes.result.doc.name === 'WS-Test', 'get returns correct doc');
    assert(getRes.result.doc._id === docId, 'doc._id matches');

    // Close database
    ws.send({ action: 'close', handle, requestId: 'r4' });
    const closeRes = await ws.nextMessage();
    assert(closeRes.result.ok === true, 'close returns ok');

    ws.close();
  }
  console.log('');

  // ─── Test 3: Unknown action returns error ──────────────────────
  console.log('Test 3: Unknown WS action returns error');
  {
    const ws = await wsConnect('/ws');
    ws.send({ action: 'nonexistent', requestId: 'err1' });
    const errRes = await ws.nextMessage();
    assert(errRes.error !== undefined, 'returns error field');
    assert(errRes.requestId === 'err1', 'requestId echoed back');

    ws.close();
  }
  console.log('');

  // ─── Test 4: Subscribe and Unsubscribe ─────────────────────────
  console.log('Test 4: Subscribe and unsubscribe');
  {
    const ws = await wsConnect('/ws');

    // Subscribe
    ws.send({ action: 'subscribe', backend: 'db', collection: 'users', requestId: 'sub1' });
    const subRes = await ws.nextMessage();
    assert(subRes.action === 'subscribed', 'subscribe confirmed');
    assert(typeof subRes.subId === 'string', 'returns subId');
    const subId = subRes.subId;

    // Unsubscribe
    ws.send({ action: 'unsubscribe', subId, requestId: 'unsub1' });
    const unsubRes = await ws.nextMessage();
    assert(unsubRes.action === 'unsubscribed', 'unsubscribe confirmed');
    assert(unsubRes.subId === subId, 'subId echoed');

    ws.close();
  }
  console.log('');

  // ─── Test 5: Broadcast on mutation ─────────────────────────────
  console.log('Test 5: Broadcast on mutation');
  {
    // Open DB via HTTP for the writer
    const openRes = await httpRequest('POST', '/db/open', {
      path: join(TEST_DATA_DIR, 'ndb', 'broadcast-db'),
    });
    const handle = openRes.body.handle;

    // Subscriber connects via WS
    const subWs = await wsConnect('/ws');
    subWs.send({ action: 'subscribe', backend: 'db', collection: 'test', requestId: 'bsub1' });
    const subConfirm = await subWs.nextMessage();
    assert(subConfirm.action === 'subscribed', 'subscriber confirmed');

    // Writer connects via WS and inserts
    const writerWs = await wsConnect('/ws');
    writerWs.send({ action: 'insert', handle, doc: { name: 'Broadcast-Test', status: 'active' }, requestId: 'w1' });
    const insertRes = await writerWs.nextMessage();
    assert(insertRes.result.id !== undefined, 'writer insert succeeded');

    // Subscriber should receive broadcast
    const broadcast = await subWs.nextMessage(2000);
    assert(broadcast.action === 'update', 'subscriber receives update');
    assert(broadcast.type === 'insert', 'update type is insert');
    assert(broadcast.backend === 'db', 'backend is db');

    writerWs.close();
    subWs.close();

    // Cleanup
    await httpRequest('POST', '/db/close', { handle });
  }
  console.log('');

  // ─── Test 6: Filter-based subscription ─────────────────────────
  console.log('Test 6: Filter-based subscription');
  {
    const openRes = await httpRequest('POST', '/db/open', {
      path: join(TEST_DATA_DIR, 'ndb', 'filter-db'),
    });
    const handle = openRes.body.handle;

    // Subscriber with filter: only status=active
    const subWs = await wsConnect('/ws');
    subWs.send({
      action: 'subscribe',
      backend: 'db',
      collection: 'test',
      filter: { status: 'active' },
      requestId: 'fsub1',
    });
    const subConfirm = await subWs.nextMessage();
    assert(subConfirm.action === 'subscribed', 'filter subscriber confirmed');

    // Writer inserts matching doc
    const writerWs = await wsConnect('/ws');
    writerWs.send({ action: 'insert', handle, doc: { name: 'Match', status: 'active' }, requestId: 'fw1' });
    const ins1 = await writerWs.nextMessage();
    assert(ins1.result.id !== undefined, 'matching insert succeeded');

    // Subscriber should get the broadcast (doc matches filter)
    const bcast1 = await subWs.nextMessage(2000);
    assert(bcast1.action === 'update', 'subscriber receives matching update');

    writerWs.close();
    subWs.close();

    await httpRequest('POST', '/db/close', { handle });
  }
  console.log('');

  // ─── Test 7: Multiple subscribers ──────────────────────────────
  console.log('Test 7: Multiple subscribers');
  {
    const openRes = await httpRequest('POST', '/db/open', {
      path: join(TEST_DATA_DIR, 'ndb', 'multi-db'),
    });
    const handle = openRes.body.handle;

    // Three subscribers
    const subs = [];
    for (let i = 0; i < 3; i++) {
      const ws = await wsConnect('/ws');
      ws.send({ action: 'subscribe', backend: 'db', collection: 'test', requestId: `msub${i}` });
      const conf = await ws.nextMessage();
      assert(conf.action === 'subscribed', `subscriber ${i} confirmed`);
      subs.push(ws);
    }

    // Writer inserts
    const writerWs = await wsConnect('/ws');
    writerWs.send({ action: 'insert', handle, doc: { name: 'Multi-Test' }, requestId: 'mw1' });
    const ins = await writerWs.nextMessage();
    assert(ins.result.id !== undefined, 'multi-writer insert succeeded');

    // All subscribers should receive broadcast
    for (let i = 0; i < 3; i++) {
      const bcast = await subs[i].nextMessage(2000);
      assert(bcast.action === 'update', `subscriber ${i} receives broadcast`);
    }

    writerWs.close();
    for (const ws of subs) ws.close();

    await httpRequest('POST', '/db/close', { handle });
  }
  console.log('');

  // ─── Test 8: HTTP still works alongside WS ─────────────────────
  console.log('Test 8: HTTP still works alongside WebSocket');
  {
    const ws = await wsConnect('/ws');
    const healthRes = await httpRequest('GET', '/health');
    assert(healthRes.status === 200, 'HTTP /health still works');
    assert(healthRes.body.status === 'healthy', 'health check passes');

    const openRes = await httpRequest('POST', '/db/open', {
      path: join(TEST_DATA_DIR, 'ndb', 'http-ws-db'),
    });
    assert(openRes.body.handle !== undefined, 'HTTP /db/open works while WS connected');

    await httpRequest('POST', '/db/close', { handle: openRes.body.handle });
    ws.close();
  }
  console.log('');

  // ─── Test 9: Non-WS upgrade path rejected ──────────────────────
  console.log('Test 9: Non-WS upgrade path rejected');
  {
    try {
      const ws = await wsConnect('/invalid-ws-path');
      // If we get here, the connection was established but shouldn't have been
      ws.close();
      assert(false, 'non-/ws upgrade should be rejected');
    } catch (err) {
      assert(true, 'non-/ws upgrade path rejected');
    }
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
