// MeetSphere mobile shell. The app is a thin native wrapper that opens your deployed MeetSphere server (HTTPS).
// Set the address once with:  npm run set-server -- https://meet.example.com   (then: npm run sync)
const fs = require('node:fs');
const path = require('node:path');

let fromFile = '';
try { fromFile = fs.readFileSync(path.join(__dirname, 'server-url.txt'), 'utf8').trim(); } catch { /* not set yet */ }
const url = process.env.MEETSPHERE_URL || fromFile;

module.exports = {
  appId: 'com.meetsphere.app',
  appName: 'MeetSphere',
  webDir: 'www',
  ...(url ? { server: { url, cleartext: url.startsWith('http://') } } : {}),
  // Lets the web app know it runs inside the mobile app (it then uses cloud transcription: WebViews have no speech recogniser).
  android: { appendUserAgent: 'MeetSphereApp', allowMixedContent: false },
  ios: { appendUserAgent: 'MeetSphereApp', contentInset: 'always' },
};
