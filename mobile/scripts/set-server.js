// Usage: npm run set-server -- https://meet.example.com
const fs = require('node:fs');
const path = require('node:path');

const input = process.argv[2];
let u;
try { u = new URL(input); } catch { u = null; }
if (!u || !['http:', 'https:'].includes(u.protocol)) {
  console.error('Usage: npm run set-server -- https://your-meetsphere-server');
  process.exit(1);
}
if (u.protocol === 'http:') console.warn('Warning: camera and microphone only work over HTTPS in the mobile app. Use an https:// address for real calls.');
fs.writeFileSync(path.join(__dirname, '..', 'server-url.txt'), `${u.origin}\n`);
console.log(`Server set to ${u.origin}. Now run: npm run sync`);
