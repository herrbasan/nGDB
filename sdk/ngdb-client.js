// sdk/ngdb-client.js
// nGDB Client SDK - Vanilla JavaScript for Node.js (18+) and Browser environments.
// Provides both HTTP (CRUD) and WebSocket (Real-Time) bindings.
// Zero dependencies.

class NGDBClient {
  /**
   * Initialize a new nGDB client.
   * @param {Object} options
   * @param {string} options.url - The base URL of the nGDB server (e.g. 'http://localhost:3000').
   * @param {string} [options.apiKey] - Optional API key for authentication.
   * @param {string} [options.tenantId] - Optional Tenant ID for multi-tenancy.
   * @param {boolean} [options.autoReconnect=true] - Whether to automatically reconnect the WebSocket if disconnected.
   * @param {number} [options.reconnectDelay=1000] - Delay in milliseconds before attempting to reconnect.
   * @param {Function} [options.onEvent] - Callback for incoming real-time events.
   * @param {Function} [options.onConnect] - Callback triggered when the WebSocket connects.
   * @param {Function} [options.onDisconnect] - Callback triggered when the WebSocket disconnects.
   */
  constructor(options = {}) {
    this.url = (options.url || 'http://localhost:3000').replace(/\/+$/, '');
    this.wsUrl = this.url.replace(/^http/, 'ws');
    this.apiKey = options.apiKey || '';
    this.tenantId = options.tenantId || '';

    // WebSocket state
    this.ws = null;
    this.wsMessageId = 1;
    this.pendingCallbacks = new Map();
    this.subscriptions = new Set(); // Stores { backend, collection, filter }
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.onEvent = options.onEvent || (() => {});
    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});
  }

  // ─── HTTP Core ──────────────────────────────────────────────────────────

  /**
   * Internal method to dispatch an HTTP request.
   */
  async request(backend, action, payload = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    if (this.tenantId) headers['x-tenant-id'] = this.tenantId;

    const endpoint = action ? `${this.url}/${backend}/${action}` : `${this.url}/${backend}`;

    const res = await globalThis.fetch(endpoint, {
      method: action ? 'POST' : 'GET', // /health uses GET, actions use POST
      headers,
      body: action ? JSON.stringify(payload) : undefined,
    });

    let resBody;
    const isJson = res.headers.get('content-type')?.includes('application/json');
    if (isJson) {
      resBody = await res.json();
    } else {
      resBody = await res.text();
    }

    if (!res.ok) {
      throw new Error(
        `nGDB API Error: [${res.status}] ${typeof resBody === 'object' ? resBody.error || JSON.stringify(resBody) : resBody}`
      );
    }

    return resBody;
  }

  /**
   * Check the health of the connected nGDB node.
   * @returns {Promise<Object>} Server status object.
   */
  health() {
    return this.request('health', null);
  }

  // ─── nDB Client (Document Store) ────────────────────────────────────────

  /**
   * Returns a binding to interact with an open nDB instance.
   * @param {string} handle - The database handle.
   */
  db(handle) {
    const proxy = (action, payload = {}) => {
      payload.handle = handle;
      return this.request('db', action, payload);
    };

    return {
      close: () => proxy('close'),
      insert: (doc) => proxy('insert', { doc }),
      get: (id) => proxy('get', { id }),
      update: (id, updates) => proxy('update', { id, updates }),
      delete: (id) => proxy('delete', { id }),
      query: (filter) => proxy('query', { filter }),
      queryWith: (filter, sort, limit, offset) => proxy('queryWith', { filter, sort, limit, offset }),
      find: (field, value) => proxy('find', { field, value }),
      findRange: (field, min, max) => proxy('findRange', { field, min, max }),
      iter: () => proxy('iter'),
      len: () => proxy('len'),
      contains: (id) => proxy('contains', { id }),
      insertWithPrefix: (prefix, doc) => proxy('insertWithPrefix', { prefix, doc }),
      restore: (id) => proxy('restore', { id }),
      deletedIds: () => proxy('deletedIds'),
      isEmpty: () => proxy('isEmpty'),
      compact: () => proxy('compact'),
      flush: () => proxy('flush'),

      // Indexes
      createIndex: (field) => proxy('createIndex', { field }),
      createBTreeIndex: (field) => proxy('createBTreeIndex', { field }),
      dropIndex: (field) => proxy('dropIndex', { field }),
      hasIndex: (field) => proxy('hasIndex', { field }),

      // Bucket Operations
      storeFile: (path, b64Data) => proxy('bucket/storeFile', { path, data: b64Data }),
      getFile: (path) => proxy('bucket/getFile', { path }),
      deleteFile: (path) => proxy('bucket/deleteFile', { path }),
      listFiles: (prefix) => proxy('bucket/listFiles', { prefix }),
    };
  }

  /**
   * Opens an nDB database on disk.
   * @param {string} path - Path to the database.
   */
  async dbOpen(path) {
    const res = await this.request('db', 'open', { path });
    return this.db(res.handle);
  }

  /**
   * Opens an in-memory nDB database.
   * @param {string} name - The name for the in-memory database.
   */
  async dbOpenInMemory(name) {
    const res = await this.request('db', 'openInMemory', { name });
    return this.db(res.handle);
  }

  // ─── nVDB Client (Vector Store) ─────────────────────────────────────────

  /**
   * Returns a binding to interact with an open nVDB instance.
   * @param {string} handle - The database handle.
   */
  vdb(handle) {
    const proxy = (action, payload = {}) => {
      payload.handle = handle;
      return this.request('vdb', action, payload);
    };

    return {
      close: () => proxy('close'),
      createCollection: (name, dimension) => proxy('createCollection', { name, dimension }),
      getCollection: (name) => proxy('getCollection', { name }),
      listCollections: () => proxy('listCollections'),
      insert: (collection, id, vector, metadata) => proxy('insert', { collection, id, vector, metadata }),
      insertBatch: (collection, ids, vectors, metadatas) => proxy('insertBatch', { collection, ids, vectors, metadatas }),
      get: (collection, id) => proxy('get', { collection, id }),
      search: (collection, vector, topK, filter) => proxy('search', { collection, vector, topK, filter }),
      delete: (collection, id) => proxy('delete', { collection, id }),
      flush: () => proxy('flush'),
      sync: () => proxy('sync'),
      compact: (collection) => proxy('compact', { collection }),
      rebuildIndex: (collection) => proxy('rebuildIndex', { collection }),
      deleteIndex: (collection) => proxy('deleteIndex', { collection }),
      hasIndex: (collection) => proxy('hasIndex', { collection }),
    };
  }

  /**
   * Opens an nVDB database on disk.
   * @param {string} path - Path to the vector database.
   */
  async vdbOpen(path) {
    const res = await this.request('vdb', 'open', { path });
    return this.vdb(res.handle);
  }

  // ─── WebSocket Core (Real-Time) ─────────────────────────────────────────

  /**
   * Connect the WebSocket for real-time events.
   */
  connectWs() {
    if (this.ws) return;

    let endpoint = this.wsUrl + '/ws'; // The WS server listens at /ws
    
    const WS = globalThis.WebSocket || require('ws'); // Support node.js environments using 'ws' package if needed
    
    // Add auth headers when available
    // Node.js 'ws' supports headers directly, Browser 'WebSocket' does not (requires subprotocols or query strings).
    // nGDB checks both Headers and Query parameters for api keys/tenant contexts.
    
    const queryParams = new URLSearchParams();
    if (this.apiKey) queryParams.append('apiKey', this.apiKey);
    if (this.tenantId) queryParams.append('tenantId', this.tenantId);
    
    if (queryParams.toString()) {
      endpoint += '?' + queryParams.toString();
    }

    this.ws = new WS(endpoint, [], {
      headers: {
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
        ...(this.tenantId && { 'x-tenant-id': this.tenantId })
      }
    });

    this.ws.onopen = () => {
      this.onConnect();
      // Re-initialize active subscriptions
      this.subscriptions.forEach((sub) => {
        this._wsSend(sub.backend, 'subscribe', {
          collection: sub.collection,
          filter: sub.filter,
        });
      });
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.onDisconnect();

      // Reject all pending requests
      for (const [id, { reject }] of this.pendingCallbacks) {
        reject(new Error('WebSocket disconnected'));
      }
      this.pendingCallbacks.clear();

      if (this.autoReconnect) {
        setTimeout(() => this.connectWs(), this.reconnectDelay);
      }
    };

    this.ws.onerror = (err) => {
      console.error('nGDB WebSocket Error:', err.message || err);
    };

    this.ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      // Handle expected synchronous responses mapped by requestId
      if (data.requestId && this.pendingCallbacks.has(data.requestId)) {
        const { resolve, reject } = this.pendingCallbacks.get(data.requestId);
        this.pendingCallbacks.delete(data.requestId);
        if (data.error) {
          reject(new Error(data.error));
        } else {
          // Actions like 'subscribe' respond with an action name rather than just resolving the data
          if (data.action === 'subscribed' || data.action === 'unsubscribed') {
            resolve(data);
          } else {
            resolve(data.result || data);
          }
        }
      } 
      // Handle broadcasts and raw events
      else if (data.action === 'update' || data.type === 'update') {
        this.onEvent(data);
      }
    };
  }

  /**
   * Disconnects the WebSocket stream.
   */
  disconnectWs() {
    this.autoReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Internal mechanism to dispatch generic requests through the open WS connection.
   */
  _wsSend(backend, action, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
        return reject(new Error('WebSocket is not connected'));
      }

      const requestId =
        typeof payload.requestId !== 'undefined'
          ? payload.requestId
          : `req_${this.wsMessageId++}`;

      const msg = { ...payload, action, backend, requestId };

      this.pendingCallbacks.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }

  /**
   * Subscribe to real-time events for a specified collection map.
   * @param {string} collection - The collection handle (or global topic) to listen to.
   * @param {Object} [filter] - Optional document filter constraints.
   * @param {string} [backend='db'] - 'db' or 'vdb'.
   * @returns {Promise<Object>} An object containing the generated subId.
   */
  async subscribe(collection, filter = null, backend = 'db') {
    this.subscriptions.add({ backend, collection, filter });
    return this._wsSend(backend, 'subscribe', { collection, filter });
  }

  /**
   * Unsubscribe from a previously opened real-time stream.
   * @param {string} subId - The ID returned upon subscription.
   */
  async unsubscribe(subId) {
    // Optionally remove the tracked definition
    // (In reality we only have the tracked {backend, collection, filter}) 
    // This allows it to stop auto-reconnecting on disconnect
    for (let sub of this.subscriptions) {
      if (sub.subId === subId) {
         this.subscriptions.delete(sub);
      }
    }
    return this._wsSend('db', 'unsubscribe', { subId });
  }

  /**
   * Run any CRUD operation through the WebSocket transport instead of HTTP.
   */
  wsRequest(backend, action, payload = {}) {
    return this._wsSend(backend, action, payload);
  }
}

// UMD / CommonJS environment export wrapper
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NGDBClient;
}
if (typeof window !== 'undefined') {
  window.NGDBClient = NGDBClient;
}
