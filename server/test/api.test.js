import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';

process.env.JWT_SECRET = 'test-secret-test-secret-123';
process.env.AUTH_RATE_LIMIT = '10000';
const { createApp } = await import('../src/app.js');
const { attachSocket } = await import('../src/socket.js');
const { createRoomStore } = await import('../src/services/roomStore.js');
const { createAI, formatContext } = await import('../src/services/ai.js');
const { generateCode } = await import('../src/utils.js');

// ---- fakes -------------------------------------------------------------
const db = new Map();
const secrets = new Map();
const invitations = new Map();
const sent = [];
const mailer = { configured: true, sendInvite: async (m) => { sent.push(m); } };
const store = {
  async createMeeting({ title, hostUid, hostName, waitingRoom = false, passwordHash = null, scheduledFor = null }) {
    const code = generateCode();
    const m = { code, title, hostUid, hostName, status: 'active', waitingRoom, hasPassword: !!passwordHash, scheduledFor, participants: [hostUid], summary: null, summaryStatus: 'none' };
    db.set(code, m); if (passwordHash) secrets.set(code, { passwordHash }); return m;
  },
  async getSecret(c) { return secrets.get(c) ?? null; },
  async createInvitation(code, invite) { invitations.set(invite.tokenHash, invite); },
  async getInvitationByHash(hash) { return invitations.get(hash) ?? null; },
  async reopenMeeting(c) { db.get(c).status = 'active'; },
  async getMeeting(c) { return db.get(c) ?? null; },
  async addParticipant(c, uid) { const m = db.get(c); if (!m.participants.includes(uid)) m.participants.push(uid); },
  async endMeeting(c) { Object.assign(db.get(c), { status: 'ended', summaryStatus: 'pending' }); },
  async saveSummary(c, summary, status = 'ready') { Object.assign(db.get(c), { summary, summaryStatus: status }); },
  async getContext() { return []; },
};
const ai = {
  transcribe: async ({ audio, mime, lang }) => `heard ${audio.length}b ${mime} ${lang}`,
  chat: async ({ question, context }) => `echo:${question}|ctx=${context.length}`,
  translate: async ({ text, to }) => `[${to}] ${text}`,
  summarize: async ({ context }) => (context.length ? { summary: 'S', highlights: [], decisions: [], actionItems: [], topics: [] } : null),
};
const verifyIdToken = async (t) => {
  if (!t.startsWith('fb-')) throw new Error('bad');
  return { uid: t.slice(3), name: t.slice(3).toUpperCase(), email: `${t.slice(3)}@x.com`, email_verified: !t.endsWith('-unv') };
};

let server, base, rooms, sockets = [];
before(async () => {
  rooms = createRoomStore();
  const app = createApp({ verifyIdToken, store, ai, rooms, mailer });
  server = http.createServer(app);
  app.set('io', attachSocket(server, { store, rooms, ai }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { sockets.forEach((s) => s.close()); server.close(); });

const api = async (path, { token, method = 'GET', body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};
const login = async (name) => (await api('/api/auth/session', { method: 'POST', body: { idToken: `fb-${name}` } })).data.token;
const sock = (token) => new Promise((res, rej) => {
  const s = connect(base, { auth: { token }, transports: ['websocket'] });
  sockets.push(s); s.on('connect', () => res(s)); s.on('connect_error', rej);
});
const emit = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));
const once = (s, ev) => new Promise((r, j) => { const t = setTimeout(() => j(new Error(`timeout waiting for ${ev}`)), 3000); s.once(ev, (x) => { clearTimeout(t); r(x); }); });

test('auth: rejects bad Firebase token, accepts good one, protects routes', async () => {
  assert.equal((await api('/api/auth/session', { method: 'POST', body: { idToken: 'nope' } })).status, 401);
  const t = await login('alice');
  assert.equal((await api('/api/auth/me', { token: t })).data.user.name, 'ALICE');
  assert.equal((await api('/api/meetings', { method: 'POST', body: {} })).status, 401);
  await assert.rejects(sock('garbage'));
});

test('full meeting flow: join, signalling, chat, captions, AI, end + summary', async () => {
  const ta = await login('alice'), tb = await login('bob'), tc = await login('carol');
  const { data: m } = await api('/api/meetings', { token: ta, method: 'POST', body: { title: 'Demo' } });
  assert.match(m.code, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);

  const a = await sock(ta), b = await sock(tb);
  const ra = await emit(a, 'room:join', { code: m.code });
  assert.ok(ra.ok && ra.peers.length === 0 && ra.meeting.isHost);
  const joined = once(a, 'room:peer-joined');
  const rb = await emit(b, 'room:join', { code: m.code });
  assert.ok(rb.ok && rb.peers.length === 1 && rb.peers[0].name === 'ALICE');
  assert.equal((await joined).name, 'BOB');

  // signalling relay
  const sig = once(a, 'signal');
  b.emit('signal', { to: ra.selfId, data: { description: { type: 'offer', sdp: 'x' } } });
  const got = await sig;
  assert.equal(got.from, rb.selfId);

  // chat
  const chat = once(a, 'chat:message');
  const ack = await emit(b, 'chat:message', { text: 'hello team' });
  assert.equal((await chat).text, 'hello team'); assert.ok(ack.message.id);

  // captions: interim relayed, final buffered
  const cap = once(a, 'caption');
  await emit(b, 'transcript:segment', { text: 'we ship friday', final: true, lang: 'en-US' });
  assert.equal((await cap).text, 'we ship friday');
  assert.equal(rooms.getContext(m.code).length, 2);

  // AI uses live context; non-participants are refused
  const r = await api('/api/ai/chat', { token: tb, method: 'POST', body: { code: m.code, message: 'what now?' } });
  assert.equal(r.data.reply, 'echo:what now?|ctx=2');
  assert.equal((await api('/api/ai/chat', { token: tc, method: 'POST', body: { code: m.code, message: 'hi' } })).status, 403);
  assert.equal((await api('/api/ai/summarize', { token: ta, method: 'POST', body: { code: m.code } })).data.summary.summary, 'S');

  // only host ends; everyone is notified; summary saved
  assert.equal((await api(`/api/meetings/${m.code}/end`, { token: tb, method: 'POST' })).status, 403);
  const ended = once(b, 'room:ended');
  assert.equal((await api(`/api/meetings/${m.code}/end`, { token: ta, method: 'POST' })).status, 200);
  await ended;
  await new Promise((r2) => setTimeout(r2, 50));
  assert.equal(db.get(m.code).summaryStatus, 'ready');
  const late = await sock(tc);
  assert.equal((await emit(late, 'room:join', { code: m.code })).error, 'This meeting has ended');
});

test('capacity limit and unknown rooms', async () => {
  const t = await login('dave');
  const { data: m } = await api('/api/meetings', { token: t, method: 'POST', body: {} });
  const s = await sock(t);
  assert.equal((await emit(s, 'room:join', { code: 'abc-defg-hij' })).error, 'Meeting not found');
  for (let i = 0; i < 6; i += 1) assert.ok((await emit(await sock(await login(`u${i}`)), 'room:join', { code: m.code })).ok);
  assert.match((await emit(s, 'room:join', { code: m.code })).error, /full/);
});

test('AI service: prompt building, JSON parsing, missing key, rate-limit mapping', async () => {
  let sent;
  const fetchImpl = async (_u, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"summary":"ok","actionItems":[{"task":"Ship","owner":"Bob"}],"highlights":["a"]}' } }] }) }; };
  const svc = createAI({ apiKey: 'k', model: 'm', baseUrl: 'http://x', fetchImpl });
  const ctx = [{ ts: 0, who: 'Bob', type: 'speech', text: 'ship friday' }];
  const s = await svc.summarize({ context: ctx, title: 'T' });
  assert.equal(s.actionItems[0].owner, 'Bob'); assert.equal(sent.response_format.type, 'json_object');
  await svc.chat({ question: 'q', context: ctx, history: [{ role: 'user', content: 'h' }] });
  assert.match(sent.messages[0].content, /Bob \(said\): ship friday/);
  assert.equal(await svc.summarize({ context: [] }), null);
  await assert.rejects(createAI({ apiKey: '', model: 'm', baseUrl: 'x' }).chat({ question: 'q' }), { status: 503 });
  const limited = createAI({ apiKey: 'k', model: 'm', baseUrl: 'x', fetchImpl: async () => ({ ok: false, status: 429, text: async () => '' }) });
  await assert.rejects(limited.chat({ question: 'q' }), { status: 429 });
  assert.equal(formatContext([{ ts: 0, who: 'A', type: 'chat', text: 'x'.repeat(50) }], 20).includes('omitted'), true);
});

test('caption translation: only viewers who chose a language get translated captions', async () => {
  const ta = await login('tr_a'), tb = await login('tr_b'), tc = await login('tr_c');
  const { data: m } = await api('/api/meetings', { token: ta, method: 'POST', body: {} });
  const a = await sock(ta), b = await sock(tb), c = await sock(tc);
  await emit(a, 'room:join', { code: m.code });
  const rb = await emit(b, 'room:join', { code: m.code, captionLang: 'ta' });
  assert.equal(rb.translationAvailable, false); // test env has no GROQ key; flag reflects config
  await emit(c, 'room:join', { code: m.code });
  assert.deepEqual(await emit(c, 'caption:lang', { lang: 'xx' }), { ok: true, lang: '', available: false }); // unsupported -> off

  let cGot = false;
  c.on('caption:translated', () => { cGot = true; });
  const got = once(b, 'caption:translated');
  const speakerId = (await emit(a, 'transcript:segment', { text: 'hello everyone', final: true, lang: 'en-US' })).segment.id;
  const t = await got;
  assert.equal(t.text, '[ta] hello everyone'); assert.equal(t.segId, speakerId); assert.equal(t.final, true); assert.equal(t.lang, 'ta');

  // same-language viewer: no translation; viewer switching to Hindi gets Hindi
  await emit(b, 'caption:lang', { lang: 'en' });
  let bGot = false; b.on('caption:translated', () => { bGot = true; });
  await emit(a, 'transcript:segment', { text: 'again', final: true, lang: 'en-US' });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(bGot, false); assert.equal(cGot, false);
  await emit(b, 'caption:lang', { lang: 'hi' });
  const hi = once(b, 'caption:translated');
  await emit(a, 'transcript:segment', { text: 'third', final: true, lang: 'en-US' });
  assert.equal((await hi).text, '[hi] third');
});

test('AI translate: prompt, cache, unsupported language', async () => {
  let calls = 0, sent;
  const svc = createAI({ apiKey: 'k', model: 'm', baseUrl: 'http://x', fetchImpl: async (_u, o) => { calls += 1; sent = JSON.parse(o.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'vanakkam' } }] }) }; } });
  assert.equal(await svc.translate({ text: 'hello', to: 'ta', from: 'en' }), 'vanakkam');
  assert.match(sent.messages[0].content, /into Tamil/); assert.equal(sent.temperature, 0);
  await svc.translate({ text: 'hello', to: 'ta', from: 'en' });
  assert.equal(calls, 1); // second call served from cache
  await assert.rejects(svc.translate({ text: 'x', to: 'xx' }), { status: 400 });
});

// ------------------------------------------------------------------ new features
const mk = async (token, body = {}) => (await api('/api/meetings', { token, method: 'POST', body })).data;

test('meeting password: hashed, required for newcomers, not for the host', async () => {
  const th = await login('hostp'), tg = await login('guestp');
  const m = await mk(th, { title: 'Secret', password: 'open-sesame' });
  assert.ok(secrets.get(m.code).passwordHash.includes(':') && !secrets.get(m.code).passwordHash.includes('open'));
  assert.equal((await api(`/api/meetings/${m.code}`, { token: tg })).data.needsPassword, true);
  const g = await sock(tg);
  assert.equal((await emit(g, 'room:join', { code: m.code })).needsPassword, true);
  assert.equal((await emit(g, 'room:join', { code: m.code, password: 'wrong' })).error, 'Incorrect meeting password.');
  assert.ok((await emit(g, 'room:join', { code: m.code, password: 'open-sesame' })).ok);
  assert.ok((await emit(await sock(th), 'room:join', { code: m.code })).ok); // host needs no password
  assert.equal((await api('/api/meetings', { token: th, method: 'POST', body: { password: 'ab' } })).status, 400);
});

test('waiting room: admit / deny, host list updates', async () => {
  const th = await login('hostw'), t1 = await login('w1'), t2 = await login('w2');
  const m = await mk(th, { waitingRoom: true });
  const h = await sock(th); await emit(h, 'room:join', { code: m.code });
  const listP = once(h, 'waiting:list');
  const w1 = await sock(t1);
  assert.equal((await emit(w1, 'room:join', { code: m.code })).waiting, true);
  const list = await listP; assert.equal(list[0].name, 'W1');
  const admitted = once(w1, 'room:admitted'); h.emit('host:admit', { id: list[0].id }); await admitted;
  const res = await emit(w1, 'room:join', { code: m.code }); assert.ok(res.ok && !res.waiting);
  const w2 = await sock(t2); const l2 = once(h, 'waiting:list');
  await emit(w2, 'room:join', { code: m.code }); const [q] = await l2;
  const denied = once(w2, 'room:denied'); h.emit('host:deny', { id: q.id }); await denied;
});

test('host controls: mute, mute all, lock, remove (+ ban); guests cannot', async () => {
  const th = await login('hostc'), ta = await login('ca'), tb = await login('cb'), tl = await login('cl');
  const m = await mk(th);
  const h = await sock(th), a = await sock(ta), b = await sock(tb);
  await emit(h, 'room:join', { code: m.code });
  const ra = await emit(a, 'room:join', { code: m.code }); await emit(b, 'room:join', { code: m.code });
  const muted = once(a, 'host:mute'); h.emit('host:mute', { id: ra.selfId }); await muted;
  let guestMuted = false; a.once('host:mute', () => { guestMuted = true; });
  b.emit('host:mute', { id: ra.selfId }); await new Promise((r) => setTimeout(r, 80)); assert.equal(guestMuted, false);
  const all = once(b, 'host:mute'); h.emit('host:mute-all'); await all;
  const locked = once(a, 'room:locked'); h.emit('host:lock', { locked: true }); assert.equal((await locked).locked, true);
  assert.match((await emit(await sock(tl), 'room:join', { code: m.code })).error, /locked/);
  const removed = once(a, 'room:removed'); h.emit('host:remove', { id: ra.selfId }); await removed;
  assert.match((await emit(await sock(ta), 'room:join', { code: m.code })).error, /removed/);
});

test('whiteboard strokes sync, undo, host-only clear; late joiners get the board', async () => {
  const th = await login('hostb'), ta = await login('wa');
  const m = await mk(th); const h = await sock(th), a = await sock(ta);
  await emit(h, 'room:join', { code: m.code });
  const got = once(h, 'wb:stroke');
  await emit(a, 'room:join', { code: m.code });
  a.emit('wb:stroke', { stroke: { id: 's1', color: '#ff0000', size: 4, points: [[0.1, 0.2], [2, -1]] } });
  const st = await got; assert.deepEqual(st.points[1], [1, 0]);
  const late = await emit(await sock(await login('wl')), 'room:join', { code: m.code }); assert.equal(late.whiteboard.length, 1);
  const rm = once(h, 'wb:remove'); a.emit('wb:undo'); assert.equal((await rm).id, 's1');
  a.emit('wb:stroke', { stroke: { points: [[0, 0]] } }); await new Promise((r) => setTimeout(r, 60));
  let cleared = false; h.once('wb:clear', () => { cleared = true; });
  a.emit('wb:clear'); await new Promise((r) => setTimeout(r, 80)); assert.equal(cleared, false);
  const c = once(a, 'wb:clear'); h.emit('wb:clear'); await c;
});

test('file sharing relays small files and rejects oversized ones', async () => {
  const th = await login('hostf'), ta = await login('fa');
  const m = await mk(th); const h = await sock(th), a = await sock(ta);
  await emit(h, 'room:join', { code: m.code }); await emit(a, 'room:join', { code: m.code });
  const rec = once(h, 'file:shared');
  assert.ok((await emit(a, 'file:share', { name: '../x/notes.txt', type: 'text/plain', data: Buffer.from('hello') })).ok);
  const f = await rec; assert.equal(f.fileName, '.._x_notes.txt'); assert.equal(Buffer.from(f.data).toString(), 'hello');
  assert.match((await emit(a, 'file:share', { name: 'big.bin', data: Buffer.alloc(5 * 1024 * 1024 + 1) })).error, /larger/);
});

test('recording indicator is host-only', async () => {
  const th = await login('hostr'), ta = await login('ra');
  const m = await mk(th); const h = await sock(th), a = await sock(ta);
  await emit(h, 'room:join', { code: m.code }); const ra = await emit(a, 'room:join', { code: m.code });
  const st = once(a, 'peer:state'); h.emit('media:state', { recording: true }); assert.equal((await st).recording, true);
  const peerState = []; h.on('peer:state', (p) => peerState.push(p));
  a.emit('media:state', { recording: true, audio: false }); await new Promise((r) => setTimeout(r, 80));
  assert.equal(peerState[0].recording, undefined); assert.equal(peerState[0].audio, false);
});

test('schedule, reopen, invites', async () => {
  const th = await login('hosts'), tg = await login('gs');
  assert.equal((await api('/api/meetings', { token: th, method: 'POST', body: { scheduledFor: 1000 } })).status, 400);
  const when = Date.now() + 86_400_000;
  const m = await mk(th, { title: 'Later', scheduledFor: when });
  assert.equal((await api(`/api/meetings/${m.code}`, { token: th })).data.scheduledFor, when);

  // invites: host only, validated, de-duplicated
  assert.equal((await api(`/api/meetings/${m.code}/invite`, { token: tg, method: 'POST', body: { emails: ['a@b.co'] } })).status, 403);
  assert.equal((await api(`/api/meetings/${m.code}/invite`, { token: th, method: 'POST', body: { emails: ['nope'] } })).status, 400);
  const inv = await api(`/api/meetings/${m.code}/invite`, { token: th, method: 'POST', body: { emails: ['a@b.co', 'A@b.co', 'c@d.org'] } });
  assert.equal(inv.data.sent, 2); assert.match(sent.at(-1).text, new RegExp(m.code));

  // reopen an ended meeting (host only)
  assert.equal((await api(`/api/meetings/${m.code}/reopen`, { token: th, method: 'POST' })).status, 409);
  await api(`/api/meetings/${m.code}/end`, { token: th, method: 'POST' });
  assert.equal((await api(`/api/meetings/${m.code}/reopen`, { token: tg, method: 'POST' })).status, 403);
  assert.equal((await api(`/api/meetings/${m.code}/reopen`, { token: th, method: 'POST' })).status, 200);
  assert.ok((await emit(await sock(th), 'room:join', { code: m.code })).ok);
});

test('email verification flag travels in the JWT and can be enforced', async () => {
  const { config } = await import('../src/config.js');
  const unv = await login('zed-unv'); const ver = await login('zoe');
  assert.equal((await api('/api/auth/me', { token: unv })).data.user.emailVerified, false);
  assert.equal((await api('/api/auth/me', { token: ver })).data.user.emailVerified, true);
  config.requireVerifiedEmail = true;
  try {
    assert.equal((await api('/api/meetings', { token: unv, method: 'POST', body: {} })).status, 403);
    assert.equal((await api('/api/meetings', { token: ver, method: 'POST', body: {} })).status, 201);
    const m = await mk(ver);
    assert.match((await emit(await sock(unv), 'room:join', { code: m.code })).error, /Verify your email/);
  } finally { config.requireVerifiedEmail = false; }
});

test('cloud transcription endpoint: participants only, validates audio, Whisper request shape', async () => {
  const th = await login('hostt'), tg = await login('gt');
  const m = await mk(th);
  const post = (token, body, q = `code=${m.code}&lang=ta-IN`) => fetch(`${base}/api/ai/transcribe?${q}`, { method: 'POST', headers: { 'Content-Type': 'audio/webm;codecs=opus', Authorization: `Bearer ${token}` }, body });
  const ok = await post(th, Buffer.alloc(1200));
  assert.equal(ok.status, 200); assert.equal((await ok.json()).text, 'heard 1200b audio/webm ta-IN');
  assert.equal((await post(tg, Buffer.alloc(1200))).status, 403);
  assert.equal((await post(th, Buffer.alloc(10))).status, 400);

  let sent;
  const fetchImpl = async (url, opts) => { sent = { url, opts }; return { ok: true, json: async () => ({ text: ' नमस्ते ' }) }; };
  const svc = createAI({ apiKey: 'k', model: 'm', sttModel: 'whisper-large-v3-turbo', baseUrl: 'http://x', fetchImpl });
  assert.equal(await svc.transcribe({ audio: Buffer.alloc(900), mime: 'audio/webm', lang: 'hi-IN' }), 'नमस्ते');
  assert.equal(sent.url, 'http://x/audio/transcriptions');
  assert.equal(sent.opts.body.get('model'), 'whisper-large-v3-turbo'); assert.equal(sent.opts.body.get('language'), 'hi');
  assert.equal(sent.opts.body.get('file').name, 'chunk.webm');
  const hallu = createAI({ apiKey: 'k', model: 'm', baseUrl: 'x', fetchImpl: async () => ({ ok: true, json: async () => ({ text: 'Thank you.' }) }) });
  assert.equal(await hallu.transcribe({ audio: Buffer.alloc(900) }), '');
  await assert.rejects(createAI({ apiKey: '', model: 'm', baseUrl: 'x' }).transcribe({ audio: Buffer.alloc(900) }), { status: 503 });
});
