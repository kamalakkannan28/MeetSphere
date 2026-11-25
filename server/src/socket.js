import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { config } from './config.js';
import { verifyToken } from './auth.js';
import { verifyPassword } from './security.js';
import { clamp, isValidCode } from './utils.js';
import { LANGUAGES } from './services/ai.js';

const REACTIONS = new Set(['👍', '👏', '😂', '🎉', '❤️', '😮']);
const baseLang = (l) => String(l || '').split('-')[0].toLowerCase();
const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

/**
 * Real-time layer:
 *  - WebRTC signalling relay (offer / answer / ICE candidates)
 *  - room access control: password, waiting room, lock, removal
 *  - host controls (admit / deny / mute / mute all / remove / lock)
 *  - roster, media state, raised hands, reactions, recording indicator
 *  - chat, live-caption fan-out (+ rolling buffer for AI context)
 *  - per-viewer live caption translation (server pushes 'caption:translated' to viewers who chose a language)
 *  - shared whiteboard and small file sharing (relayed, never stored)
 * Every socket must present a valid MeetSphere JWT in the handshake.
 */
export function attachSocket(httpServer, { store, rooms, ai }) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientUrls },
    maxHttpBufferSize: config.maxFileBytes + 200_000,
  });

  io.use((socket, next) => {
    try {
      socket.data.user = verifyToken(socket.handshake.auth?.token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const pushWaiting = (c) => {
    const list = rooms.listWaiting(c);
    for (const id of rooms.hostIds(c)) io.to(id).emit('waiting:list', list);
  };

  io.on('connection', (socket) => {
    const { user } = socket.data;
    const ack = (cb, payload) => typeof cb === 'function' && cb(payload);
    const code = () => socket.data.code;
    const isHost = () => !!code() && !!rooms.getPeer(code(), socket.id)?.isHost;

    socket.on('room:join', async (payload, cb) => {
      let reserved = false;
      try {
        const roomCode = payload?.code;
        if (!isValidCode(roomCode)) return ack(cb, { ok: false, error: 'Invalid meeting code' });
        if (code()) return ack(cb, { ok: false, error: 'Already in a meeting' });
        if (!user.guest && config.requireVerifiedEmail && !user.emailVerified) return ack(cb, { ok: false, error: 'Verify your email address (Profile page) to join meetings.' });
        const meeting = await store.getMeeting(roomCode);
        if (!meeting) return ack(cb, { ok: false, error: 'Meeting not found' });
        if (meeting.status === 'ended') return ack(cb, { ok: false, error: 'This meeting has ended' });
        if (user.guest) {
          if (user.roomCode !== roomCode) return ack(cb, { ok: false, error: 'This invitation is for a different meeting.' });
          const invitation = await store.getInvitationByHash?.(user.invitationHash);
          if (!invitation || invitation.code !== roomCode || invitation.revoked || invitation.expiresAt <= Date.now()) return ack(cb, { ok: false, error: 'Invitation not found or expired' });
        }
        if (rooms.isBanned(roomCode, user.uid)) return ack(cb, { ok: false, error: 'You were removed from this meeting by the host.' });

        socket.data.captionLang = LANGUAGES[payload.captionLang] ? payload.captionLang : '';
        const host = meeting.hostUid === user.uid;
        const known = host || rooms.isAdmitted(roomCode, user.uid) || (!user.guest && meeting.participants?.includes(user.uid));
        if (!known) {
          if (rooms.isLocked(roomCode)) return ack(cb, { ok: false, error: 'This meeting is locked by the host.' });
          if (meeting.hasPassword) {
            socket.data.pwTries = (socket.data.pwTries || 0) + 1;
            if (socket.data.pwTries > 8) { ack(cb, { ok: false, error: 'Too many password attempts.' }); return socket.disconnect(true); }
            const secret = await store.getSecret(roomCode);
            const given = clamp(payload.password, 64);
            if (!given || !(await verifyPassword(given, secret?.passwordHash))) {
              return ack(cb, { ok: false, needsPassword: true, error: given ? 'Incorrect meeting password.' : 'This meeting needs a password.' });
            }
          }
          if (meeting.waitingRoom) {
            rooms.addWaiting(roomCode, socket.id, { uid: user.uid, name: user.name });
            socket.data.waitingCode = roomCode;
            pushWaiting(roomCode);
            return ack(cb, { ok: true, waiting: true });
          }
        }
        const participantLimit = Math.min(6, config.maxParticipants);
        if (!rooms.reserveJoin(roomCode, participantLimit, host)) return ack(cb, { ok: false, error: `Meeting is full (max ${participantLimit})` });
        reserved = true;
        // registers the user as a participant so Firestore rules let them read/write this meeting's data
        if (!user.guest) await store.addParticipant(roomCode, user.uid);
        if (socket.disconnected) { rooms.releaseJoin(roomCode); reserved = false; return; }

        const peer = {
          uid: user.uid, name: user.name, picture: user.picture, isHost: host, isGuest: !!user.guest,
          audio: payload.audio !== false, video: payload.video !== false, screen: false, hand: false, recording: false,
        };
        const existing = rooms.join(roomCode, socket.id, peer); // synchronous: no join/offer races
        reserved = false; // join consumes the reserved capacity slot
        socket.data.code = roomCode;
        socket.data.waitingCode = null;
        rooms.removeWaiting(roomCode, socket.id);
        socket.join(roomCode);
        socket.to(roomCode).emit('room:peer-joined', { id: socket.id, ...peer });
        ack(cb, {
          ok: true,
          selfId: socket.id,
          peers: existing,
          iceServers: config.iceServers,
          translationAvailable: !!config.groqApiKey,
          maxFileBytes: config.maxFileBytes,
          meeting: { code: roomCode, title: meeting.title, hostName: meeting.hostName, isHost: host },
          locked: rooms.isLocked(roomCode),
          waitingList: host ? rooms.listWaiting(roomCode) : [],
          whiteboard: rooms.getStrokes(roomCode),
          history: rooms.recent(roomCode),
        });
      } catch (e) {
        if (reserved) rooms.releaseJoin(payload?.code);
        console.error('[room:join]', e);
        ack(cb, { ok: false, error: 'Could not join the meeting' });
      }
    });

    // ------------------------------------------------------------ host controls
    socket.on('host:admit', ({ id } = {}) => {
      if (!isHost()) return;
      const w = rooms.getWaiting(code(), id);
      if (!w) return;
      rooms.admit(code(), w.uid);
      rooms.removeWaiting(code(), id);
      const target = io.sockets.sockets.get(id);
      if (target) target.data.waitingCode = null;
      io.to(id).emit('room:admitted');
      pushWaiting(code());
    });

    socket.on('host:deny', ({ id } = {}) => {
      if (!isHost() || !rooms.getWaiting(code(), id)) return;
      rooms.removeWaiting(code(), id);
      io.to(id).emit('room:denied');
      pushWaiting(code());
    });

    socket.on('host:mute', ({ id } = {}) => {
      if (!isHost() || !rooms.hasPeer(code(), id) || id === socket.id) return;
      io.to(id).emit('host:mute');
    });

    socket.on('host:mute-all', () => {
      if (!isHost()) return;
      for (const id of rooms.peerIds(code())) if (id !== socket.id) io.to(id).emit('host:mute');
    });

    socket.on('host:remove', ({ id } = {}) => {
      if (!isHost() || id === socket.id) return;
      const p = rooms.getPeer(code(), id);
      if (!p) return;
      rooms.ban(code(), p.uid);
      io.to(id).emit('room:removed');
      io.sockets.sockets.get(id)?.disconnect(true);
    });

    socket.on('host:lock', ({ locked } = {}) => {
      if (!isHost()) return;
      rooms.setLocked(code(), !!locked);
      io.to(code()).emit('room:locked', { locked: !!locked });
    });

    // ---------------------------------------------------------------- signalling
    socket.on('signal', ({ to, data } = {}) => {
      if (!code() || !rooms.hasPeer(code(), to) || !data) return;
      io.to(to).emit('signal', { from: socket.id, data });
    });

    socket.on('media:state', (s = {}) => {
      if (!code()) return;
      const patch = {};
      for (const k of ['audio', 'video', 'screen']) if (typeof s[k] === 'boolean') patch[k] = s[k];
      if (typeof s.recording === 'boolean' && isHost()) patch.recording = s.recording; // only the host may record
      rooms.updatePeer(code(), socket.id, patch);
      socket.to(code()).emit('peer:state', { id: socket.id, ...patch });
    });

    socket.on('hand:toggle', ({ raised } = {}) => {
      if (!code()) return;
      rooms.updatePeer(code(), socket.id, { hand: !!raised });
      socket.to(code()).emit('peer:state', { id: socket.id, hand: !!raised });
    });

    socket.on('reaction', ({ emoji } = {}) => {
      if (!code() || !REACTIONS.has(emoji)) return;
      io.to(code()).emit('reaction', { id: socket.id, name: user.name, emoji });
    });

    // ---------------------------------------------------------------- chat + captions
    socket.on('caption:lang', ({ lang } = {}, cb) => {
      socket.data.captionLang = LANGUAGES[lang] ? lang : '';
      ack(cb, { ok: true, lang: socket.data.captionLang, available: !!config.groqApiKey });
    });

    /** Translate a caption once per target language and push it to the viewers who asked for that language. */
    async function translateCaption(segment) {
      const from = baseLang(segment.lang);
      const byLang = new Map();
      for (const id of rooms.peerIds(code())) {
        if (id === socket.id) continue;
        const lang = io.sockets.sockets.get(id)?.data.captionLang;
        if (!lang || lang === from) continue;
        if (!byLang.has(lang)) byLang.set(lang, []);
        byLang.get(lang).push(id);
      }
      await Promise.all([...byLang].map(async ([lang, ids]) => {
        if (!segment.final) { // throttle interim captions to keep API usage low
          const now = Date.now();
          socket.data.translateAt ||= {};
          if (now - (socket.data.translateAt[lang] || 0) < 800) return;
          socket.data.translateAt[lang] = now;
        }
        try {
          const text = await ai.translate({ text: segment.text, to: lang, from });
          for (const id of ids) io.to(id).emit('caption:translated', { segId: segment.id, peerId: socket.id, text, final: segment.final, lang });
        } catch (e) {
          if (e.status !== 503) console.warn('[translate]', e.message);
        }
      }));
    }

    socket.on('chat:message', ({ text } = {}, cb) => {
      const body = clamp(text, 2000);
      if (!code() || !body) return ack(cb, { ok: false });
      const message = { id: randomUUID(), uid: user.uid, name: user.name, text: body, ts: Date.now() };
      rooms.pushChat(code(), message);
      io.to(code()).emit('chat:message', message);
      ack(cb, { ok: true, message });
    });

    // Live captions: interim text is relayed only; final segments are buffered and acked for persistence
    socket.on('transcript:segment', ({ text, final, lang } = {}, cb) => {
      const body = clamp(text, 1000);
      if (!code() || !body) return ack(cb, { ok: false });
      const segment = { id: randomUUID(), uid: user.uid, name: user.name, text: body, final: !!final, lang: clamp(lang, 12), ts: Date.now() };
      socket.to(code()).emit('caption', { ...segment, peerId: socket.id });
      if (segment.final) rooms.pushSpeech(code(), segment);
      ack(cb, { ok: true, segment });
      translateCaption(segment).catch(() => {});
    });

    // ---------------------------------------------------------------- whiteboard
    socket.on('wb:stroke', ({ stroke } = {}) => {
      if (!code() || !stroke || !Array.isArray(stroke.points)) return;
      const points = stroke.points.slice(0, 800).filter((p) => Array.isArray(p) && p.length === 2).map(([x, y]) => [clamp01(x), clamp01(y)]);
      if (!points.length) return;
      const s = {
        id: typeof stroke.id === 'string' && stroke.id.length <= 40 ? stroke.id : randomUUID(),
        uid: user.uid,
        tool: stroke.tool === 'eraser' ? 'eraser' : 'pen',
        color: /^#[0-9a-f]{6}$/i.test(stroke.color) ? stroke.color : '#111111',
        size: Math.min(40, Math.max(1, Number(stroke.size) || 3)),
        points,
      };
      rooms.pushStroke(code(), s);
      socket.to(code()).emit('wb:stroke', s);
    });

    socket.on('wb:undo', () => {
      if (!code()) return;
      const id = rooms.undoStroke(code(), user.uid);
      if (id) io.to(code()).emit('wb:remove', { id });
    });

    socket.on('wb:clear', () => {
      if (!isHost()) return;
      rooms.clearStrokes(code());
      io.to(code()).emit('wb:clear');
    });

    // ---------------------------------------------------------------- file sharing (relay only)
    socket.on('file:share', ({ name, type, data } = {}, cb) => {
      if (!code() || !data) return ack(cb, { ok: false, error: 'Not in a meeting' });
      const buf = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : null;
      if (!buf || buf.length === 0) return ack(cb, { ok: false, error: 'Invalid file' });
      if (buf.length > config.maxFileBytes) return ack(cb, { ok: false, error: `File is larger than ${Math.round(config.maxFileBytes / 1048576)} MB` });
      const file = {
        id: randomUUID(), uid: user.uid, name: user.name, ts: Date.now(),
        fileName: clamp(String(name || 'file').replace(/[\\/]/g, '_'), 120) || 'file',
        type: clamp(type, 100) || 'application/octet-stream',
        size: buf.length, data: buf,
      };
      io.to(code()).emit('file:shared', file);
      ack(cb, { ok: true });
    });

    socket.on('room:leave', () => leave());
    socket.on('disconnect', () => {
      if (socket.data.waitingCode) {
        const c = socket.data.waitingCode;
        socket.data.waitingCode = null;
        rooms.removeWaiting(c, socket.id);
        pushWaiting(c);
      }
      leave();
    });

    function leave() {
      const c = code();
      if (!c) return;
      socket.data.code = null;
      socket.leave(c);
      rooms.leave(c, socket.id);
      socket.to(c).emit('room:peer-left', { id: socket.id });
    }
  });

  return io;
}
