import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { initFirebase } from './firebase.js';
import { createFirestoreStore } from './services/meetingStore.js';
import { createRoomStore } from './services/roomStore.js';
import { createAI } from './services/ai.js';
import { createMailer } from './services/mailer.js';
import { createApp } from './app.js';
import { attachSocket } from './socket.js';

if (config.jwtSecret.length < 16) {
  console.error('JWT_SECRET is missing or too short (min 16 chars). Copy .env.example to .env and set it.');
  process.exit(1);
}
if (!config.groqApiKey) console.warn('[warn] GROQ_API_KEY not set - AI chat and summaries will be disabled.');

const { verifyIdToken, db, FieldValue } = initFirebase();
const store = createFirestoreStore(db, FieldValue);
const rooms = createRoomStore();
const ai = createAI({ apiKey: config.groqApiKey, model: config.groqModel, sttModel: config.groqSttModel, baseUrl: config.groqBaseUrl });

const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const mailer = createMailer(config.smtp);
const app = createApp({ verifyIdToken, store, ai, rooms, mailer, staticDir });
const server = http.createServer(app);
app.set('io', attachSocket(server, { store, rooms, ai }));

server.listen(config.port, () => console.log(`MeetSphere listening on http://localhost:${config.port}`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
