// Quick diagnostic script for admin interface
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/admin',
  method: 'GET'
};

console.log('Testing admin interface...');
console.log('Request:', options.method, options.path);

const req = http.request(options, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('\nBody (first 500 chars):');
    console.log(data.substring(0, 500));
    
    if (data.includes('error')) {
      console.log('\n❌ FAILED - Got error response');
    } else if (data.includes('<!DOCTYPE html>') || data.includes('<html')) {
      console.log('\n✅ SUCCESS - Got HTML page');
    } else {
      console.log('\n⚠️ UNKNOWN response');
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Connection failed:', e.message);
  console.log('Is the server running? Try: npm start');
});

req.end();
