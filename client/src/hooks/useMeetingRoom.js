import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, getToken } from '../lib/api.js';
import { PeerManager } from '../lib/PeerManager.js';
import { persist } from '../lib/firebase.js';

/**
 * One hook owns the live meeting: Socket.IO connection, roster, WebRTC mesh,
 * chat, live captions and transcript. Chat/final transcript lines are persisted to Firestore.
 */
export function useMeetingRoom({ code, localStream, initial, guestToken, onEnded, onHostMute }) {
  const [status, setStatus] = useState('connecting'); // connecting | waiting | joined | reconnecting | error
  const [error, setError] = useState('');
  const [meta, setMeta] = useState(null);
  const [selfId, setSelfId] = useState(null);
  const [roster, setRoster] = useState({}); // id -> peer info
  const [streams, setStreams] = useState({}); // id -> MediaStream
  const [chat, setChat] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [captions, setCaptions] = useState({}); // peerId -> { name, text, ts }
  const [reactions, setReactions] = useState([]);
  const [captionLang, setCaptionLangState] = useState(initial.captionLang || '');
  const [translations, setTranslations] = useState({}); // transcript line id -> translated text
  const [translationAvailable, setTranslationAvailable] = useState(true);
  const captionLangRef = useRef(initial.captionLang || '');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [locked, setLocked] = useState(false);
  const [waitingList, setWaitingList] = useState([]); // host only: people waiting to be admitted
  const [strokes, setStrokes] = useState([]); // whiteboard
  const [files, setFiles] = useState([]); // files shared in chat (relayed, not stored)
  const [maxFileBytes, setMaxFileBytes] = useState(5 * 1024 * 1024);
  const fatalRef = useRef(false);
  const fileUrls = useRef([]);
  const hostMuteRef = useRef(onHostMute);
  hostMuteRef.current = onHostMute;

  const socketRef = useRef(null);
  const pmRef = useRef(null);
  const streamRef = useRef(localStream);
  const videoTrackRef = useRef(localStream?.getVideoTracks()[0] || null);
  streamRef.current = localStream;

  useEffect(() => {
    const socket = io(API_URL || undefined, { auth: (cb) => cb({ token: guestToken || getToken() }), transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    let alive = true;
    const addUnique = (setter) => (item) => setter((l) => (l.some((x) => x.id === item.id) ? l : [...l, item].sort((a, b) => a.ts - b.ts)));
    const addChat = addUnique(setChat);
    const addLine = addUnique(setTranscript);

    const join = () => {
      socket.emit('room:join', { code, audio: initial.audio, video: initial.video, captionLang: captionLangRef.current, password: initial.password || '' }, async (res) => {
        if (!alive) return;
        if (!res?.ok) { setError(res?.error || 'Could not join'); setNeedsPassword(!!res?.needsPassword); fatalRef.current = true; setStatus('error'); return; }
        if (res.waiting) { setStatus('waiting'); return; } // the host must admit us; 'room:admitted' re-runs join()
        pmRef.current?.closeAll();
        const pm = new PeerManager({
          socket,
          iceServers: res.iceServers,
          getLocalStream: () => streamRef.current,
          getVideoTrack: () => videoTrackRef.current,
          onStream: (id, s) => setStreams((m) => ({ ...m, [id]: s })),
          onRemoved: (id) => setStreams(({ [id]: _gone, ...rest }) => rest),
        });
        pmRef.current = pm;
        setSelfId(res.selfId);
        setMeta(res.meeting);
        setRoster(Object.fromEntries(res.peers.map((p) => [p.id, p])));
        setChat(res.history.chat);
        setTranscript(res.history.transcript);
        setTranslationAvailable(!!res.translationAvailable);
        setLocked(!!res.locked);
        setWaitingList(res.waitingList || []);
        setStrokes(res.whiteboard || []);
        if (res.maxFileBytes) setMaxFileBytes(res.maxFileBytes);
        setStatus('joined');
        for (const p of res.peers) await pm.connectTo(p.id); // newcomer offers to everyone already present
      });
    };

    socket.on('connect', join);
    socket.on('connect_error', (e) => { setError(e.message === 'unauthorized' ? 'Session expired - please sign in again.' : 'Cannot reach the MeetSphere server.'); setStatus('error'); });
    socket.on('disconnect', () => { pmRef.current?.closeAll(); setRoster({}); if (!fatalRef.current) setStatus('reconnecting'); });

    socket.on('room:peer-joined', (p) => setRoster((r) => ({ ...r, [p.id]: p })));
    socket.on('room:peer-left', ({ id }) => {
      pmRef.current?.remove(id);
      setRoster(({ [id]: _gone, ...rest }) => rest);
      setCaptions(({ [id]: _c, ...rest }) => rest);
    });
    socket.on('peer:state', ({ id, ...patch }) => setRoster((r) => (r[id] ? { ...r, [id]: { ...r[id], ...patch } } : r)));
    socket.on('signal', ({ from, data }) => pmRef.current?.handleSignal(from, data));
    socket.on('chat:message', addChat);
    socket.on('caption', (seg) => {
      setCaptions((c) => ({ ...c, [seg.peerId]: { name: seg.name, text: seg.text, segId: seg.id, ts: Date.now() } }));
      if (seg.final) addLine(seg);
    });
    // translated caption for the language THIS user chose (server only sends it to those viewers)
    socket.on('caption:translated', ({ segId, peerId, text, final }) => {
      setCaptions((c) => (c[peerId]?.segId === segId ? { ...c, [peerId]: { ...c[peerId], translated: text, ts: Date.now() } } : c));
      if (final) setTranslations((t) => ({ ...t, [segId]: text }));
    });
    socket.on('reaction', (r) => {
      const item = { ...r, key: `${r.id}-${Date.now()}-${Math.random()}` };
      setReactions((l) => [...l, item]);
      setTimeout(() => setReactions((l) => l.filter((x) => x.key !== item.key)), 3000);
    });
    socket.on('room:ended', () => { fatalRef.current = true; onEnded?.(); });

    // ---- access control and host controls
    socket.on('room:admitted', () => join());
    socket.on('room:denied', () => { fatalRef.current = true; setError('The host did not let you into this meeting.'); setStatus('error'); });
    socket.on('room:removed', () => { fatalRef.current = true; setError('You were removed from this meeting by the host.'); setStatus('error'); });
    socket.on('room:locked', ({ locked: l }) => setLocked(!!l));
    socket.on('waiting:list', setWaitingList);
    socket.on('host:mute', () => hostMuteRef.current?.());

    // ---- whiteboard
    socket.on('wb:stroke', (st) => setStrokes((l) => (l.some((x) => x.id === st.id) ? l : [...l, st])));
    socket.on('wb:remove', ({ id }) => setStrokes((l) => l.filter((x) => x.id !== id)));
    socket.on('wb:clear', () => setStrokes([]));

    // ---- shared files (arrive as binary; turned into a downloadable blob URL)
    socket.on('file:shared', (f) => {
      const url = URL.createObjectURL(new Blob([f.data], { type: f.type }));
      fileUrls.current.push(url);
      setFiles((l) => [...l, { id: f.id, uid: f.uid, name: f.name, fileName: f.fileName, size: f.size, ts: f.ts, url, isFile: true }]);
    });

    const sweep = setInterval(() => setCaptions((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => Date.now() - v.ts < 6000))), 1000);

    return () => {
      alive = false;
      clearInterval(sweep);
      socket.emit('room:leave');
      pmRef.current?.closeAll();
      socket.close();
      fileUrls.current.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, guestToken]);

  const emit = (ev, payload, cb) => socketRef.current?.emit(ev, payload, cb);

  const sendChat = useCallback((text) => {
    emit('chat:message', { text }, (res) => res?.ok && persist(code, 'messages', res.message));
  }, [code]);

  /** Called with each speech result from the Web Speech API. */
  const sendSpeech = useCallback(({ text, final }, lang) => {
    const me = Date.now();
    setCaptions((c) => ({ ...c, self: { name: 'You', text, ts: me } }));
    emit('transcript:segment', { text, final, lang }, (res) => {
      if (res?.ok && final) {
        setTranscript((l) => (l.some((x) => x.id === res.segment.id) ? l : [...l, res.segment].sort((a, b) => a.ts - b.ts)));
        persist(code, 'transcripts', res.segment);
      }
    });
  }, [code]);

  const setCaptionLang = useCallback((lang) => {
    captionLangRef.current = lang;
    setCaptionLangState(lang);
    setCaptions((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v, translated: undefined }])));
    emit('caption:lang', { lang }, (res) => res && setTranslationAvailable(!!res.available));
  }, []);

  const setMediaState = useCallback((s) => emit('media:state', s), []);
  const toggleHand = useCallback((raised) => emit('hand:toggle', { raised }), []);
  const react = useCallback((emoji) => emit('reaction', { emoji }), []);

  // ---- host controls (the server ignores these unless you are the host)
  const admit = useCallback((id) => emit('host:admit', { id }), []);
  const deny = useCallback((id) => emit('host:deny', { id }), []);
  const muteUser = useCallback((id) => emit('host:mute', { id }), []);
  const muteAll = useCallback(() => emit('host:mute-all'), []);
  const removeUser = useCallback((id) => emit('host:remove', { id }), []);
  const setLock = useCallback((l) => emit('host:lock', { locked: l }), []);

  // ---- whiteboard
  const sendStroke = useCallback((st) => {
    setStrokes((l) => [...l, st]); // draw immediately; the server relays it to everyone else
    emit('wb:stroke', { stroke: st });
  }, []);
  const undoStroke = useCallback(() => emit('wb:undo'), []);
  const clearBoard = useCallback(() => emit('wb:clear'), []);

  /** Share a file with everyone in the meeting (relayed through the server, never stored). Resolves to { ok, error }. */
  const sendFile = useCallback(async (file) => {
    if (file.size > maxFileBytes) return { ok: false, error: `Files must be under ${Math.round(maxFileBytes / 1048576)} MB.` };
    const data = await file.arrayBuffer();
    return new Promise((resolve) => emit('file:share', { name: file.name, type: file.type, data }, (res) => resolve(res || { ok: false, error: 'No response' })));
  }, [maxFileBytes]);

  /** Switch the outgoing video between camera and screen without renegotiating. */
  const setOutgoingVideo = useCallback((track) => {
    videoTrackRef.current = track;
    pmRef.current?.replaceVideoTrack(track);
  }, []);

  return { status, error, meta, selfId, roster, streams, chat, transcript, captions, reactions, captionLang, setCaptionLang, translations, translationAvailable, needsPassword, locked, waitingList, strokes, files, maxFileBytes, admit, deny, muteUser, muteAll, removeUser, setLock, sendStroke, undoStroke, clearBoard, sendFile, sendChat, sendSpeech, setMediaState, toggleHand, react, setOutgoingVideo };
}
