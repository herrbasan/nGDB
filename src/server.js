// src/server.js — nGDB HTTP + WebSocket server entry point
// Vanilla Node.js HTTP server with WebSocket upgrade. No frameworks.

const http = require('http');
const config = require('./config');
const { route } = require('./transports/http');
const { handleUpgrade } = require('./ws');

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    const msg = err.message || 'internal server error';
    const data = JSON.stringify({ error: msg });
    res.writeHead(500, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
    res.end(data);
  });
});

// WebSocket upgrade on /ws
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/ws') {
    handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`nGDB listening on ${config.host}:${config.port}`);
});

module.exports = server;
