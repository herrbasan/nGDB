#!/usr/bin/env node
// seed.js — Import countries dataset into nDB via nGDB HTTP API
// Usage: node scripts/seed.js [options]
//   --url=http://localhost:3000   nGDB server URL
//   --path=./data/countries.json  Path to countries JSON file
//   --db=./data/ngdb-countries    Database path on server
//   --drop                        Close & reopen (fresh database)

const http = require('http');
const fs = require('fs');
const path = require('path');

// --- Config from args ---
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, ...val] = arg.replace(/^--?/, '').split('=');
  acc[key] = val.length ? val.join('=') : true;
  return acc;
}, {});

const BASE_URL = new URL(args.url || 'http://localhost:3000');
const DATA_PATH = path.resolve(args.path || './data/countries.json');
const DB_PATH = args.db || './data/ngdb-countries';
const DROP = args.drop || false;

// --- HTTP helper ---
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: BASE_URL.hostname,
      port: BASE_URL.port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} ${method} ${urlPath}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// --- Main ---
async function main() {
  console.log('nGDB Seed Script');
  console.log('================');
  console.log(`Server:  ${BASE_URL.href}`);
  console.log(`Data:    ${DATA_PATH}`);
  console.log(`DB path: ${DB_PATH}`);
  console.log('');

  // Check server health
  try {
    const health = await request('GET', '/health');
    console.log(`Server health: ${JSON.stringify(health)}`);
  } catch (e) {
    console.error(`Server not reachable: ${e.message}`);
    process.exit(1);
  }

  // Load countries data
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Data file not found: ${DATA_PATH}`);
    console.error('Download it with:');
    console.error('  powershell -Command "Invoke-WebRequest -Uri https://raw.githubusercontent.com/mledoze/countries/master/countries.json -OutFile data/countries.json"');
    process.exit(1);
  }
  const countries = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  console.log(`Loaded ${countries.length} countries from dataset\n`);

  // Drop existing database if requested
  if (DROP) {
    try {
      // List existing instances to find our handle
      const list = await request('GET', '/db/list');
      const instances = list.instances || list;
      for (const inst of instances) {
        if (inst.path === DB_PATH) {
          console.log(`Closing existing database: ${inst.handle}`);
          await request('POST', '/db/close', { handle: inst.handle });
        }
      }
    } catch (e) {
      // Ignore — may not exist
    }
  }

  // Open database
  console.log(`Opening database: ${DB_PATH}`);
  const openResult = await request('POST', '/db/open', { path: DB_PATH });
  const handle = openResult.handle;
  console.log(`Database handle: ${handle}\n`);

  // Insert countries
  let inserted = 0;
  let errors = 0;
  const batchSize = 10;

  for (let i = 0; i < countries.length; i += batchSize) {
    const batch = countries.slice(i, i + batchSize);
    const promises = batch.map(country => {
      // Use CCA2 code as document ID for easy lookup
      const id = country.cca2 || country.cioc || `country_${i}`;
      return request('POST', '/db/insert', {
        handle,
        doc: { _id: id, ...country }
      }).then(() => {
        inserted++;
        if (inserted % 50 === 0) {
          process.stdout.write(`  ${inserted}/${countries.length}...\n`);
        }
      }).catch(e => {
        // Duplicate ID — try update instead
        if (e.message.includes('already exists') || e.message.includes('duplicate')) {
          return request('POST', '/db/update', {
            handle,
            doc: { _id: id, ...country }
          }).then(() => { inserted++; })
            .catch(() => { errors++; });
        }
        errors++;
        if (errors <= 5) console.error(`  Error inserting ${id}: ${e.message}`);
      });
    });
    await Promise.all(promises);
  }

  console.log(`\nInserted: ${inserted}`);
  console.log(`Errors:   ${errors}`);

  // Create useful indexes
  console.log('\nCreating indexes...');
  const indexes = [
    { field: 'region', name: 'idx_region' },
    { field: 'subregion', name: 'idx_subregion' },
    { field: 'name.common', name: 'idx_name_common' },
    { field: 'cca2', name: 'idx_cca2' },
    { field: 'cca3', name: 'idx_cca3' },
    { field: 'population', name: 'idx_population' },
  ];

  for (const idx of indexes) {
    try {
      await request('POST', '/db/createIndex', { handle, field: idx.field, name: idx.name });
      console.log(`  Created index: ${idx.name} on ${idx.field}`);
    } catch (e) {
      console.log(`  Index ${idx.name}: ${e.message} (may already exist)`);
    }
  }

  // Flush to disk
  console.log('\nFlushing to disk...');
  await request('POST', '/db/flush', { handle });

  // Verify
  const count = await request('POST', '/db/len', { handle });
  console.log(`\nTotal documents in database: ${count.count || count}`);

  // Sample query — countries in Europe
  try {
    const eu = await request('POST', '/db/find', { handle, field: 'region', value: 'Europe' });
    const euCount = Array.isArray(eu) ? eu.length : (eu.docs ? eu.docs.length : '?');
    console.log(`Countries in Europe: ${euCount}`);
  } catch (e) {
    console.log(`Sample query error: ${e.message}`);
  }

  console.log('\nSeed complete! Database is ready.');
  console.log(`Handle: ${handle}`);
  console.log(`Admin:  ${BASE_URL.href}admin/`);
}

main().catch(e => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
