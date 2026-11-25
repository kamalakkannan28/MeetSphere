import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { config } from './config.js';
import { signToken, verifyToken, requireAuth } from './auth.js';
import { HttpError, asyncHandler, clamp, isValidCode } from './utils.js';
import { hashPassword } from './security.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const invitationHash = (token) => createHash('sha256').update(token).digest('hex');

/**
 * Builds the Express app. Dependencies are injected so the same code runs against
 * real Firebase/Groq in production and against fakes in the automated tests.
 */
export function createApp({ verifyIdToken, store, ai, rooms, mailer, staticDir }) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({
    // allows the React app (served from this server in "app mode") to talk to Firebase and open Google sign-in
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://apis.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'https://*.googleapis.com', 'https://*.firebaseio.com', 'https://*.firebaseapp.com'],
        frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com'],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // needed for Google sign-in popup
  }));
  app.use(cors({ origin: config.clientUrls }));
  app.use(express.json({ limit: '100kb' }));

  const limiter = (limit, keyGenerator) =>
    rateLimit({ windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false, ...(keyGenerator && { keyGenerator }) });
  const byUser = (req) => req.user.uid;

  /** Live context first (freshest), Firestore as fallback. */
  const loadContext = async (code) => {
    const live = rooms.getContext(code);
    return live.length ? live : store.getContext(code);
  };

  /** Loads meeting and checks the caller took part in it. */
  const getMeetingFor = async (code, user) => {
    if (!isValidCode(code)) throw new HttpError(400, 'Invalid meeting code');
    const meeting = await store.getMeeting(code);
    if (!meeting) throw new HttpError(404, 'Meeting not found');
    if (user.guest) {
      const invite = user.roomCode === code ? await store.getInvitationByHash?.(user.invitationHash) : null;
      if (!invite || invite.code !== code || invite.revoked || invite.expiresAt <= Date.now()) throw new HttpError(403, 'Invitation is no longer valid');
    } else if (!meeting.participants?.includes(user.uid)) throw new HttpError(403, 'You did not take part in this meeting');
    return meeting;
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, ai: !!config.groqApiKey }));

  // ---------------------------------------------------------------- auth
  // Firebase ID token  ->  MeetSphere JWT (used for REST + Socket.IO)
  app.post('/api/auth/session', limiter(config.authRateLimit), asyncHandler(async (req, res) => {
    const { idToken } = req.body || {};
    if (typeof idToken !== 'string' || !idToken) throw new HttpError(400, 'idToken is required');
    let decoded;
    try {
      decoded = await verifyIdToken(idToken);
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[a-zA-Z0-9_/-]{1,80}$/.test(error.code)
        ? error.code
        : 'unknown';
      console.warn(`[auth] Firebase ID token verification failed (${code})`);
      throw new HttpError(401, 'Invalid Firebase token');
    }
    const user = {
      uid: decoded.uid,
      name: clamp(decoded.name || (decoded.email ? decoded.email.split('@')[0] : 'Guest'), 60),
      email: decoded.email || '',
      picture: decoded.picture || '',
      emailVerified: decoded.email_verified === true,
    };
    res.json({ token: signToken(user), user });
  }));

  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

  const loadInvitation = async (token) => {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) throw new HttpError(404, 'Invitation not found or expired');
    const hash = invitationHash(token);
    // Codes are intentionally not embedded in links. Store token -> meeting lookup under a hash.
    const invite = await store.getInvitationByHash?.(hash);
    if (!invite || invite.revoked || invite.expiresAt <= Date.now()) throw new HttpError(404, 'Invitation not found or expired');
    const meeting = await store.getMeeting(invite.code);
    if (!meeting || meeting.status !== 'active') throw new HttpError(404, 'Invitation not found or expired');
    return { invite, meeting, hash };
  };

  app.get('/api/invitations/:token', limiter(60), asyncHandler(async (req, res) => {
    const { invite, meeting } = await loadInvitation(req.params.token);
    res.json({ code: meeting.code, title: meeting.title, hostName: meeting.hostName, status: meeting.status,
      hasPassword: !!meeting.hasPassword, waitingRoom: !!meeting.waitingRoom, scheduledFor: meeting.scheduledFor ?? null,
      needsPassword: !!meeting.hasPassword, locked: rooms.isLocked(meeting.code),
      live: rooms.count(meeting.code), max: Math.min(6, config.maxParticipants), expiresAt: invite.expiresAt });
  }));

  app.post('/api/invitations/:token/session', limiter(30), asyncHandler(async (req, res) => {
    const { meeting, hash } = await loadInvitation(req.params.token);
    const name = clamp(req.body?.name, 60);
    if (name.length < 1) throw new HttpError(400, 'Enter a display name');
    const user = { uid: `guest:${randomUUID()}`, name, email: '', picture: '', emailVerified: false };
    const token = signToken(user, { guest: true, roomCode: meeting.code, invitationHash: hash });
    res.json({ token, user: { ...user, guest: true }, meeting: { code: meeting.code, title: meeting.title,
      hostName: meeting.hostName, status: meeting.status, hasPassword: !!meeting.hasPassword, waitingRoom: !!meeting.waitingRoom,
      needsPassword: !!meeting.hasPassword, locked: rooms.isLocked(meeting.code), scheduledFor: meeting.scheduledFor ?? null,
      live: rooms.count(meeting.code), max: Math.min(6, config.maxParticipants) } });
  }));

  // ------------------------------------------------------------ meetings
  app.use('/api/meetings', requireAuth, limiter(60, byUser));

  const createInvitation = async (code, requesterUid, hostOnly = true) => {
    if (!isValidCode(code)) throw new HttpError(400, 'Invalid meeting code');
    const meeting = await store.getMeeting(code);
    if (!meeting) throw new HttpError(404, 'Meeting not found');
    if (meeting.hostUid !== requesterUid && (hostOnly || !meeting.participants?.includes(requesterUid))) throw new HttpError(403, 'Only meeting participants can create invitations');
    if (meeting.status !== 'active') throw new HttpError(409, 'Meeting is not active');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = invitationHash(token);
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    await store.createInvitation(code, { code, tokenHash, createdBy: hostUid, createdAt: Date.now(), expiresAt, revoked: false });
    return { token, expiresAt, link: `${config.clientUrls[0]}/invite/${token}` };
  };

  app.post('/api/meetings/:code/invitation', asyncHandler(async (req, res) => {
    const invitation = await createInvitation(req.params.code, req.user.uid, false);
    res.status(201).json(invitation);
  }));

  app.post('/api/meetings', asyncHandler(async (req, res) => {
    if (config.requireVerifiedEmail && !req.user.emailVerified) throw new HttpError(403, 'Verify your email address before creating meetings.');
    const title = clamp(req.body?.title, 80) || `${req.user.name}'s meeting`;
    const password = clamp(req.body?.password, 64);
    if (password && password.length < 4) throw new HttpError(400, 'Password must be at least 4 characters');
    let scheduledFor = null;
    if (req.body?.scheduledFor != null && req.body.scheduledFor !== '') {
      scheduledFor = Number(req.body.scheduledFor);
      if (!Number.isFinite(scheduledFor) || scheduledFor < Date.now() - 3_600_000 || scheduledFor > Date.now() + 366 * 86_400_000) {
        throw new HttpError(400, 'Scheduled time must be within the next year');
      }
    }
    const m = await store.createMeeting({
      title, hostUid: req.user.uid, hostName: req.user.name,
      waitingRoom: !!req.body?.waitingRoom,
      passwordHash: password ? await hashPassword(password) : null,
      scheduledFor,
    });
    res.status(201).json({ code: m.code, title: m.title });
  }));

  app.get('/api/meetings/:code', asyncHandler(async (req, res) => {
    if (!isValidCode(req.params.code)) throw new HttpError(400, 'Invalid meeting code');
    const m = await store.getMeeting(req.params.code);
    if (!m) throw new HttpError(404, 'Meeting not found');
    const isHost = m.hostUid === req.user.uid;
    res.json({
      code: m.code, title: m.title, status: m.status, hostName: m.hostName, isHost,
      hasPassword: !!m.hasPassword, waitingRoom: !!m.waitingRoom, scheduledFor: m.scheduledFor ?? null,
      locked: rooms.isLocked(m.code),
      needsPassword: !!m.hasPassword && !isHost && !m.participants?.includes(req.user.uid),
      live: rooms.count(m.code), max: Math.min(6, config.maxParticipants),
      emailEnabled: !!mailer?.configured,
    });
  }));

  // Host reopens an ended meeting (same code, same history); ending it again regenerates the summary.
  app.post('/api/meetings/:code/reopen', asyncHandler(async (req, res) => {
    const { code } = req.params;
    if (!isValidCode(code)) throw new HttpError(400, 'Invalid meeting code');
    const m = await store.getMeeting(code);
    if (!m) throw new HttpError(404, 'Meeting not found');
    if (m.hostUid !== req.user.uid) throw new HttpError(403, 'Only the host can reopen the meeting');
    if (m.status !== 'ended') throw new HttpError(409, 'Meeting is not ended');
    await store.reopenMeeting(code);
    res.json({ status: 'active' });
  }));

  // Host emails invitations (needs SMTP_* env; the client falls back to a mailto: link otherwise)
  app.post('/api/meetings/:code/invite', limiter(5, byUser), asyncHandler(async (req, res) => {
    const { code } = req.params;
    if (!isValidCode(code)) throw new HttpError(400, 'Invalid meeting code');
    const m = await store.getMeeting(code);
    if (!m) throw new HttpError(404, 'Meeting not found');
    if (m.hostUid !== req.user.uid) throw new HttpError(403, 'Only the host can send invitations');
    const raw = Array.isArray(req.body?.emails) ? req.body.emails : [];
    const emails = [...new Set(raw.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e) && e.length <= 254))].slice(0, 20);
    if (!emails.length) throw new HttpError(400, 'Enter at least one valid email address');
    const invitation = await createInvitation(code, req.user.uid);
    const link = invitation.link;
    const when = m.scheduledFor ? `\nWhen: ${new Date(m.scheduledFor).toUTCString()}` : '';
    const pw = m.hasPassword ? '\nThis meeting is password protected. The host will share the password separately.' : '';
    const text = `${req.user.name} invited you to "${m.title}" on MeetSphere.${when}\nJoin: ${link}${pw}`;
    const html = `<p><b>${esc(req.user.name)}</b> invited you to <b>${esc(m.title)}</b> on MeetSphere.</p>${m.scheduledFor ? `<p>When: ${esc(new Date(m.scheduledFor).toUTCString())}</p>` : ''}<p><a href="${esc(link)}">Join the meeting</a></p>${m.hasPassword ? '<p>This meeting is password protected. The host will share the password separately.</p>' : ''}`;
    for (const to of emails) await mailer.sendInvite({ to, subject: `${req.user.name} invited you to "${m.title}"`, text, html });
    res.json({ sent: emails.length });
  }));

  // Host ends the meeting for everyone; the AI summary is generated in the background.
  app.post('/api/meetings/:code/end', asyncHandler(async (req, res) => {
    const { code } = req.params;
    if (!isValidCode(code)) throw new HttpError(400, 'Invalid meeting code');
    const m = await store.getMeeting(code);
    if (!m) throw new HttpError(404, 'Meeting not found');
    if (m.hostUid !== req.user.uid) throw new HttpError(403, 'Only the host can end the meeting');
    if (m.status === 'ended') return res.json({ status: 'ended' });

    const context = await loadContext(code); // capture before the room is torn down
    await store.endMeeting(code);
    req.app.get('io')?.to(code).emit('room:ended', { by: req.user.name });
    req.app.get('io')?.in(code).disconnectSockets(true);
    rooms.close(code);
    res.json({ status: 'ended' });

    // fire-and-forget: summary appears on the meeting document when ready
    (async () => {
      if (!context.length) return store.saveSummary(code, null, 'empty');
      try {
        const summary = await ai.summarize({ context, title: m.title });
        await store.saveSummary(code, summary, summary ? 'ready' : 'empty');
      } catch (e) {
        console.error('[summary]', e.message);
        await store.saveSummary(code, null, 'failed');
      }
    })().catch((e) => console.error('[summary]', e));
  }));

  // ------------------------------------------------------------------ AI
  const requireAiAuth = asyncHandler(async (req, _res, next) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Missing token');
    try { req.user = verifyToken(header.slice(7)); } catch { throw new HttpError(401, 'Invalid or expired token'); }
    if (req.user.guest) {
      const invite = await store.getInvitationByHash?.(req.user.invitationHash);
      if (!invite || invite.code !== req.user.roomCode || invite.revoked || invite.expiresAt <= Date.now()) throw new HttpError(401, 'Invitation is no longer valid');
    }
    next();
  });
  app.use('/api/ai', requireAiAuth);
  const aiLimit = limiter(20, byUser);

  app.post('/api/ai/chat', aiLimit, asyncHandler(async (req, res) => {
    const { code, message, history } = req.body || {};
    const question = clamp(message, 1500);
    if (!question) throw new HttpError(400, 'message is required');
    const meeting = await getMeetingFor(code, req.user);
    const reply = await ai.chat({
      question,
      history: Array.isArray(history) ? history : [],
      context: await loadContext(code),
      title: meeting.title,
      userName: req.user.name,
    });
    res.json({ reply });
  }));

  app.post('/api/ai/summarize', aiLimit, asyncHandler(async (req, res) => {
    const { code } = req.body || {};
    const meeting = await getMeetingFor(code, req.user);
    const summary = await ai.summarize({ context: await loadContext(code), title: meeting.title });
    if (!summary) throw new HttpError(422, 'Nothing has been said yet, so there is nothing to summarise.');
    if (meeting.status === 'ended') await store.saveSummary(code, summary, 'ready'); // lets users retry a failed summary
    res.json({ summary });
  }));

  // ------------------------------------------- serve the built React app (installable web app)
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  // Cloud speech-to-text fallback: the client posts a short audio clip (a few seconds) and gets text back.
  app.post('/api/ai/transcribe', limiter(40, byUser), express.raw({ type: ['audio/*', 'video/webm', 'application/octet-stream'], limit: '2mb' }), asyncHandler(async (req, res) => {
    const code = String(req.query.code || '');
    await getMeetingFor(code, req.user);
    if (!Buffer.isBuffer(req.body) || req.body.length < 500) throw new HttpError(400, 'Send an audio clip as the request body');
    const text = await ai.transcribe({ audio: req.body, mime: String(req.headers['content-type'] || 'audio/webm').split(';')[0], lang: String(req.query.lang || '') });
    res.json({ text });
  }));

  // ------------------------------------------------------------- errors
  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (!(err instanceof HttpError)) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
  });

  return app;
}
