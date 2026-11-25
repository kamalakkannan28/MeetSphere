/**
 * Live, in-memory state for active meeting rooms: connected peers, waiting-room queue,
 * lock flag, removed users, whiteboard strokes, and a rolling buffer of chat + final transcript
 * lines used as context for the AI assistant.
 * (For multi-instance deployments swap this for Redis + the socket.io Redis adapter.)
 */
const MAX_BUFFER = 600;
const MAX_STROKES = 600;

export function createRoomStore() {
  const rooms = new Map();

  const ensure = (code) => {
    if (!rooms.has(code)) {
      rooms.set(code, {
        peers: new Map(), waiting: new Map(), admitted: new Set(), banned: new Set(),
        locked: false, chat: [], speech: [], strokes: [],
      });
    }
    return rooms.get(code);
  };
  const push = (arr, item, max = MAX_BUFFER) => {
    arr.push(item);
    if (arr.length > max) arr.splice(0, arr.length - max);
  };

  return {
    count: (code) => rooms.get(code)?.peers.size ?? 0,
    hasPeer: (code, id) => !!rooms.get(code)?.peers.has(id),
    getPeer: (code, id) => rooms.get(code)?.peers.get(id),
    hostIds: (code) => [...(rooms.get(code)?.peers.entries() ?? [])].filter(([, p]) => p.isHost).map(([id]) => id),
    peerIds: (code) => [...(rooms.get(code)?.peers.keys() ?? [])],

    join(code, id, peer) {
      const room = ensure(code);
      const existing = [...room.peers.entries()].map(([sid, p]) => ({ id: sid, ...p }));
      room.peers.set(id, peer);
      return existing;
    },

    leave(code, id) {
      const room = rooms.get(code);
      if (!room) return;
      room.peers.delete(id);
      // keep buffers briefly so a late "end meeting" summary still has context
      if (room.peers.size === 0) {
        setTimeout(() => {
          const r = rooms.get(code);
          if (r && r.peers.size === 0 && r.waiting.size === 0) rooms.delete(code);
        }, 60_000).unref();
      }
    },

    updatePeer(code, id, patch) {
      const p = rooms.get(code)?.peers.get(id);
      if (p) Object.assign(p, patch);
      return p;
    },

    close: (code) => rooms.delete(code),

    // ---- waiting room / lock / removal
    addWaiting: (code, id, user) => ensure(code).waiting.set(id, user),
    removeWaiting: (code, id) => rooms.get(code)?.waiting.delete(id),
    getWaiting: (code, id) => rooms.get(code)?.waiting.get(id),
    listWaiting: (code) => [...(rooms.get(code)?.waiting.entries() ?? [])].map(([id, u]) => ({ id, uid: u.uid, name: u.name })),
    admit: (code, uid) => ensure(code).admitted.add(uid),
    isAdmitted: (code, uid) => !!rooms.get(code)?.admitted.has(uid),
    ban: (code, uid) => ensure(code).banned.add(uid),
    isBanned: (code, uid) => !!rooms.get(code)?.banned.has(uid),
    setLocked: (code, locked) => { ensure(code).locked = !!locked; },
    isLocked: (code) => !!rooms.get(code)?.locked,

    // ---- whiteboard
    pushStroke: (code, s) => push(ensure(code).strokes, s, MAX_STROKES),
    getStrokes: (code) => rooms.get(code)?.strokes ?? [],
    clearStrokes: (code) => { const r = rooms.get(code); if (r) r.strokes = []; },
    undoStroke(code, uid) {
      const r = rooms.get(code);
      if (!r) return null;
      for (let i = r.strokes.length - 1; i >= 0; i -= 1) {
        if (r.strokes[i].uid === uid) return r.strokes.splice(i, 1)[0].id;
      }
      return null;
    },

    // ---- chat + transcript buffer
    pushChat: (code, msg) => push(ensure(code).chat, msg),
    pushSpeech: (code, seg) => push(ensure(code).speech, seg),
    recent(code, n = 100) {
      const r = rooms.get(code);
      return { chat: r ? r.chat.slice(-n) : [], transcript: r ? r.speech.slice(-n) : [] };
    },

    /** Normalised context entries for the AI service, oldest first. */
    getContext(code) {
      const r = rooms.get(code);
      if (!r) return [];
      return [
        ...r.chat.map((m) => ({ ts: m.ts, who: m.name, type: 'chat', text: m.text })),
        ...r.speech.map((s) => ({ ts: s.ts, who: s.name, type: 'speech', text: s.text })),
      ].sort((a, b) => a.ts - b.ts);
    },
  };
}
