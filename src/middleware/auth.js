// src/middleware/auth.js — Simple API key authentication
// Local network (private IP) requests bypass auth when localAuthBypass is enabled.
// No JWT. No sessions. Just a static key check.

const config = require('../config');

const PRIVATE_IPV4_RE = [
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./,    // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^127\./,                         // loopback
  /^0\.0\.0\.0$/,                   // unspecified
];

const PRIVATE_IPV6_PREFIXES = [
  '::1',         // loopback
  'fc', 'fd',    // unique local
  'fe80',        // link-local
];

function isPrivateIP(ip) {
  if (!ip) return false;
  // IPv6 in bracket notation: [::1]
  let clean = ip.replace(/^\[|\]$/g, '');

  // Handle IPv4-mapped IPv6 addresses (::ffff:127.0.0.1, ::ffff:192.168.x.x, etc.)
  if (clean.startsWith('::ffff:')) {
    clean = clean.substring(7); // Extract IPv4 part
  }

  // IPv4 check
  if (PRIVATE_IPV4_RE.some(re => re.test(clean))) return true;

  // IPv6 check
  const lower = clean.toLowerCase();
  if (PRIVATE_IPV6_PREFIXES.some(prefix => lower.startsWith(prefix))) return true;
  if (lower === '::1') return true;

  return false;
}

// Extract API key from request.
// Supports: Authorization: Bearer <key>  OR  ?apiKey=<key>
function extractApiKey(req, url) {
  // Header: Authorization: Bearer <key>
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  // Query param: ?apiKey=<key>
  const key = url.searchParams.get('apiKey');
  if (key) return key;

  return null;
}

// Get client IP considering proxies
function getClientIP(req) {
  // Check X-Forwarded-For header (common with proxies)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For can be a comma-separated list, take the first one
    const firstIP = forwarded.split(',')[0].trim();
    return firstIP;
  }
  
  // Check X-Real-IP header (nginx proxy)
  const realIP = req.headers['x-real-ip'];
  if (realIP) return realIP;
  
  // Fall back to socket remote address
  return req.socket && req.socket.remoteAddress;
}

// Returns { ok: true } or { ok: false, status, message }
function checkAuth(req) {
  // No keys configured — auth disabled, everything passes
  if (config.apiKeys.length === 0) {
    return { ok: true };
  }

  const remoteIP = getClientIP(req);

  // Local network bypass
  if (config.localAuthBypass && isPrivateIP(remoteIP)) {
    return { ok: true };
  }

  // Validate API key
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = extractApiKey(req, url);

  if (!key) {
    return { ok: false, status: 401, message: 'missing api key' };
  }

  if (!config.apiKeys.includes(key)) {
    return { ok: false, status: 403, message: 'invalid api key' };
  }

  return { ok: true };
}

module.exports = { checkAuth, isPrivateIP, extractApiKey };
