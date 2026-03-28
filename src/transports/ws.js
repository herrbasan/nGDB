// src/transports/ws.js — WebSocket transport adapter
// Zero-dependency RFC 6455 WebSocket frame handling.
// Provides Connection class used by the WS server layer.

const { randomUUID } = require('crypto');
const { createHash, createHmac } = require('crypto');

// ─── Frame Constants ───────────────────────────────────────────────
const OP_TEXT = 0x01;
const OP_CLOSE = 0x08;
const OP_PING = 0x09;
const OP_PONG = 0x0A;

// ─── Handshake ─────────────────────────────────────────────────────
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB5DC11B5A0';

function handshakeKey(req) {
  const key = req.headers['sec-websocket-key'];
  return createHash('sha1').update(key + WS_MAGIC).digest('base64');
}

function writeHandshake(socket, acceptKey) {
  const head = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
    '',
  ].join('\r\n');
  socket.write(head);
}

// ─── Frame Writer ──────────────────────────────────────────────────
function writeFrame(socket, opcode, payload) {
  const mask = false; // server→client frames are unmasked
  const len = payload.length;
  const header = [];

  header.push(0x80 | opcode); // FIN=1

  if (len < 126) {
    header.push(mask ? 0x80 | len : len);
  } else if (len < 65536) {
    header.push(mask ? 0x80 | 126 : 126);
    header.push((len >> 8) & 0xff, len & 0xff);
  } else {
    header.push(mask ? 0x80 | 127 : 127);
    for (let i = 7; i >= 0; i--) header.push((len >> (i * 8)) & 0xff);
  }

  socket.write(Buffer.concat([Buffer.from(header), payload]));
}

function sendText(socket, str) {
  writeFrame(socket, OP_TEXT, Buffer.from(str, 'utf-8'));
}

function sendClose(socket, code, reason) {
  const buf = Buffer.alloc(2 + Buffer.byteLength(reason));
  buf.writeUInt16BE(code, 0);
  buf.write(reason, 2, 'utf-8');
  writeFrame(socket, OP_CLOSE, buf);
}

function sendPong(socket, payload) {
  writeFrame(socket, OP_PONG, payload);
}

// ─── Frame Reader ──────────────────────────────────────────────────
// Returns { opcode, payload } or null if incomplete.
// `buf` is the current receive buffer; may be partial.
// Calls `consume(n)` to advance the buffer after processing.

function tryParseFrame(buf) {
  if (buf.length < 2) return null;

  const b0 = buf[0];
  const b1 = buf[1];
  const opcode = b0 & 0x0f;
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

  if (masked) {
    if (buf.length < offset + 4) return null;
    offset += 4; // skip mask bytes position
  }

  if (buf.length < offset + payloadLen) return null;

  // Extract payload
  let payload = buf.subarray(offset, offset + payloadLen);

  // Unmask if needed
  if (masked) {
    const maskStart = offset - 4;
    const mask = [buf[maskStart], buf[maskStart + 1], buf[maskStart + 2], buf[maskStart + 3]];
    const unmasked = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) {
      unmasked[i] = payload[i] ^ mask[i & 3];
    }
    payload = unmasked;
  }

  return { opcode, payload, totalBytes: offset + payloadLen };
}

// ─── Connection ────────────────────────────────────────────────────
// Wraps a single WebSocket connection with frame-level protocol handling.

class Connection {
  constructor(socket, req) {
    this.id = randomUUID();
    this.socket = socket;
    this.req = req;
    this.alive = true;
    this._recvBuf = Buffer.alloc(0);
    this._onMessage = null; // set by consumer: (conn, msg) => void
    this._onClose = null;   // set by consumer: (conn) => void

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._onSocketClose());
    socket.on('error', () => this._onSocketClose());
  }

  _onData(chunk) {
    this._recvBuf = Buffer.concat([this._recvBuf, chunk]);

    while (this._recvBuf.length > 0) {
      const frame = tryParseFrame(this._recvBuf);
      if (!frame) break;

      this._recvBuf = this._recvBuf.subarray(frame.totalBytes);

      if (frame.opcode === OP_TEXT) {
        const text = frame.payload.toString('utf-8');
        if (this._onMessage) this._onMessage(this, text);
      } else if (frame.opcode === OP_PING) {
        sendPong(this.socket, frame.payload);
      } else if (frame.opcode === OP_CLOSE) {
        this.close();
        return;
      }
    }
  }

  _onSocketClose() {
    if (!this.alive) return;
    this.alive = false;
    if (this._onClose) this._onClose(this);
  }

  send(obj) {
    if (!this.alive) return;
    sendText(this.socket, JSON.stringify(obj));
  }

  close(code, reason) {
    if (!this.alive) return;
    sendClose(this.socket, code || 1000, reason || '');
    this.socket.destroy();
    this._onSocketClose();
  }
}

module.exports = {
  handshakeKey,
  writeHandshake,
  Connection,
  sendText,
  writeFrame,
  OP_TEXT,
  OP_CLOSE,
  OP_PING,
  OP_PONG,
};
