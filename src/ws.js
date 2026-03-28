// src/ws.js — WebSocket server, subscription management, message routing
// Uses the transport-agnostic handlers from handlers/db.js
// Reuses the same handler functions as the HTTP transport.

const { handshakeKey, writeHandshake, Connection } = require('./transports/ws');
const { handlers: dbHandlers, instances: dbInstances } = require('./handlers/db');
const { handlers: vdbHandlers, instances: vdbInstances } = require('./handlers/vdb');
const { checkAuth } = require('./middleware/auth');
const { extractTenant } = require('./middleware/tenancy');

// Active connections: connId -> Connection
const connections = new Map();

// Subscriptions: subId -> { connId, backend, collection, filter }
const subscriptions = new Map();

// Index: collection -> Set of subIds (for fast broadcast lookup)
const collectionSubs = new Map();

// ─── Upgrade Handler ───────────────────────────────────────────────
// Attach to the HTTP server's 'upgrade' event.

function handleUpgrade(req, socket, head) {
  // Auth check before accepting WebSocket connection
  const auth = checkAuth(req);
  if (!auth.ok) {
    // Reject the upgrade with HTTP 401/403
    const body = JSON.stringify({ error: auth.message });
    const response = [
      `HTTP/1.1 ${auth.status} ${auth.status === 401 ? 'Unauthorized' : 'Forbidden'}`,
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(body)}`,
      '',
      body,
    ].join('\r\n');
    socket.write(response);
    socket.destroy();
    return;
  }

  const key = handshakeKey(req);
  writeHandshake(socket, key);

  const tenantId = extractTenant(req);
  const conn = new Connection(socket, req);
  conn.tenantId = tenantId;
  connections.set(conn.id, conn);

  conn._onMessage = (c, text) => onMessage(c, text);
  conn._onClose = (c) => onDisconnect(c);
}

// ─── Message Router ────────────────────────────────────────────────
// Protocol: JSON messages with { action, ...params }
// Special actions: subscribe, unsubscribe, ping
// Everything else dispatched to db handlers.

function onMessage(conn, text) {
  const msg = JSON.parse(text);
  const action = msg.action;
  const backend = msg.backend || 'db';

  // Built-in WS actions
  if (action === 'subscribe') return handleSubscribe(conn, msg);
  if (action === 'unsubscribe') return handleUnsubscribe(conn, msg);
  if (action === 'ping') return conn.send({ action: 'pong' });

  // Select handler registry based on backend
  const handlers = backend === 'vdb' ? vdbHandlers : dbHandlers;
  const handler = handlers[action];
  if (!handler) {
    conn.send({ error: `unknown action: ${action}`, requestId: msg.requestId });
    return;
  }

  const result = handler(msg, { tenantId: conn.tenantId });
  conn.send({ action, backend, result, requestId: msg.requestId });

  // Broadcast to subscribers if this was a mutation
  if (isMutation(action)) {
    broadcastMutation(conn, action, msg, result);
  }
}

// ─── Subscription Management ───────────────────────────────────────

function handleSubscribe(conn, msg) {
  const subId = msg.subId || `${conn.id}::${Date.now()}`;
  const backend = msg.backend || 'db';
  const collection = msg.collection;
  const filter = msg.filter || null;

  const sub = { subId, connId: conn.id, backend, collection, filter };
  subscriptions.set(subId, sub);

  if (!collectionSubs.has(collection)) {
    collectionSubs.set(collection, new Set());
  }
  collectionSubs.get(collection).add(subId);

  conn.send({ action: 'subscribed', subId, requestId: msg.requestId });
}

function handleUnsubscribe(conn, msg) {
  const subId = msg.subId;
  const sub = subscriptions.get(subId);
  if (!sub) {
    conn.send({ action: 'unsubscribed', subId, requestId: msg.requestId });
    return;
  }

  subscriptions.delete(subId);
  const subs = collectionSubs.get(sub.collection);
  if (subs) {
    subs.delete(subId);
    if (subs.size === 0) collectionSubs.delete(sub.collection);
  }

  conn.send({ action: 'unsubscribed', subId, requestId: msg.requestId });
}

function onDisconnect(conn) {
  connections.delete(conn.id);

  // Remove all subscriptions for this connection
  for (const [subId, sub] of subscriptions) {
    if (sub.connId === conn.id) {
      subscriptions.delete(subId);
      const subs = collectionSubs.get(sub.collection);
      if (subs) {
        subs.delete(subId);
        if (subs.size === 0) collectionSubs.delete(sub.collection);
      }
    }
  }
}

// ─── Broadcast ─────────────────────────────────────────────────────

const MUTATION_ACTIONS = new Set(['insert', 'update', 'delete', 'storeFile', 'deleteFile']);

function isMutation(action) {
  return MUTATION_ACTIONS.has(action);
}

function broadcastMutation(sourceConn, action, msg, result) {
  // Determine collection from the handle — we don't have explicit collection
  // in the nDB API, so we broadcast to all subscribers.
  // The filter matching happens client-side or via the filter field.
  const update = {
    action: 'update',
    backend: 'db',
    type: action,
    data: result,
  };

  for (const [subId, sub] of subscriptions) {
    if (sub.connId === sourceConn.id) continue; // don't echo to sender
    const targetConn = connections.get(sub.connId);
    if (!targetConn || !targetConn.alive) continue;

    // Tenant isolation: only broadcast within same tenant
    if (sourceConn.tenantId !== targetConn.tenantId) continue;

    // Apply filter if present
    if (sub.filter && result.doc) {
      if (!matchesFilter(result.doc, sub.filter)) continue;
    }

    targetConn.send(update);
  }
}

function matchesFilter(doc, filter) {
  for (const [key, value] of Object.entries(filter)) {
    if (doc[key] !== value) return false;
  }
  return true;
}

// ─── Stats ─────────────────────────────────────────────────────────

function stats() {
  return {
    connections: connections.size,
    subscriptions: subscriptions.size,
    collections: [...collectionSubs.keys()],
  };
}

module.exports = { handleUpgrade, stats, connections, subscriptions };
