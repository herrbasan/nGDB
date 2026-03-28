// src/middleware/tenancy.js — Tenant isolation
// Extracts tenant ID from request headers and provides isolated data paths.
// When tenancy is disabled (no TENANT_HEADER configured), all requests use the base data dirs.

const config = require('../config');
const path = require('path');

// Extract tenant ID from request. Returns null if tenancy is not configured.
function extractTenant(req) {
  if (!config.tenantHeader) return null;

  const headerKey = config.tenantHeader.toLowerCase();
  // req.headers are already lowercased by Node.js
  const tenantId = req.headers[headerKey];

  if (!tenantId) return null;

  // Sanitize: only allow alphanumeric, dash, underscore
  if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) return null;

  return tenantId;
}

// Get the nDB data directory for a given tenant (or the default if no tenant).
function ndbDataDir(tenantId) {
  if (!tenantId) return config.ndbDataDir;
  return path.join(config.ndbDataDir, 'tenants', tenantId);
}

// Get the nVDB data directory for a given tenant (or the default if no tenant).
function nvdbDataDir(tenantId) {
  if (!tenantId) return config.nvdbDataDir;
  return path.join(config.nvdbDataDir, 'tenants', tenantId);
}

module.exports = { extractTenant, ndbDataDir, nvdbDataDir };
