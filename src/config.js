// src/config.js — Environment-driven configuration
// No config files, no YAML. Pure process.env.

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',
  ndbDataDir: process.env.NDB_DATA_DIR || './data/ndb',
  nvdbDataDir: process.env.NVDB_DATA_DIR || './data/nvdb',

  // Auth: comma-separated API keys. If empty, auth is disabled (local-only recommended).
  // Example: API_KEYS=key1,key2,key3
  apiKeys: process.env.API_KEYS ? process.env.API_KEYS.split(',').map(k => k.trim()).filter(Boolean) : [],

  // Local network bypass: when API_KEYS is set, requests from private IPs skip auth.
  // Disable with LOCAL_AUTH_BYPASS=false if you want auth everywhere.
  localAuthBypass: process.env.LOCAL_AUTH_BYPASS !== 'false',

  // Multi-tenancy: header name for tenant identification.
  // If set, each tenant gets isolated data paths under the data dirs.
  // Example: TENANT_HEADER=x-tenant-id
  tenantHeader: process.env.TENANT_HEADER || '',
};

module.exports = config;
