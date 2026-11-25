import { useEffect, useRef, useState } from 'react';

const THRESHOLD = 0.035; // RMS level that counts as "speaking"
const HOLD_MS = 450;     // keep the highlight briefly so it doesn't flicker

/** Detects who is talking by measuring each audio track with the Web Audio API. Returns a Set of tile keys ('me' or peer id). */
export function useActiveSpeaker({ localStream, micOn, streams }) {
  const [speaking, setSpeaking] = useState(() => new Set());
  const ctxRef = useRef(null);
  const nodes = useRef(new Map()); // trackId -> { key, src, analyser, buf, lastLoud }
  const micRef = useRef(micOn);
  micRef.current = micOn;

  useEffect(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctxRef.current ||= new AC();
    const ctx = ctxRef.current;
    ctx.resume?.();

    const wanted = new Map();
    localStream?.getAudioTracks().forEach((t) => wanted.set(t.id, { key: 'me', track: t }));
    Object.entries(streams).forEach(([id, s]) => s.getAudioTracks().forEach((t) => wanted.set(t.id, { key: id, track: t })));

    for (const [tid, n] of nodes.current) {
      if (!wanted.has(tid)) { n.src.disconnect(); nodes.current.delete(tid); }
    }
    for (const [tid, { key, track }] of wanted) {
      if (nodes.current.has(tid)) continue;
      try {
        const src = ctx.createMediaStreamSource(new MediaStream([track]));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser); // analysis only, never connected to speakers
        nodes.current.set(tid, { key, src, analyser, buf: new Uint8Array(analyser.fftSize), lastLoud: 0 });
      } catch { /* unusable track */ }
    }
  }, [localStream, streams]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const next = new Set();
      for (const n of nodes.current.values()) {
        n.analyser.getByteTimeDomainData(n.buf);
        let sum = 0;
        for (let i = 0; i < n.buf.length; i += 1) { const v = n.buf[i] / 128 - 1; sum += v * v; }
        if (Math.sqrt(sum / n.buf.length) > THRESHOLD && (n.key !== 'me' || micRef.current)) n.lastLoud = now;
        if (now - n.lastLoud < HOLD_MS) next.add(n.key);
      }
      setSpeaking((prev) => (prev.size === next.size && [...next].every((k) => prev.has(k)) ? prev : next));
    }, 150);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => { ctxRef.current?.close().catch(() => {}); }, []);
  return speaking;
}
