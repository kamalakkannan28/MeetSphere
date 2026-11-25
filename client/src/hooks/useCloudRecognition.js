import { useEffect, useRef, useState } from 'react';
import { apiBinary } from '../lib/api.js';

const CHUNK_MS = 5000;   // length of each clip sent for transcription
const MIN_LEVEL = 0.015; // clips quieter than this are skipped (saves API calls, avoids Whisper hallucinations)

/**
 * Cloud speech-to-text for environments without the Web Speech API (desktop app, mobile app, Firefox).
 * Records the microphone in short clips, skips silence, uploads each clip to the MeetSphere server
 * (which calls Groq Whisper) and reports the text as a final result. Captions lag by a few seconds.
 */
export function useCloudRecognition({ enabled, lang, stream, code, onResult }) {
  const cb = useRef(onResult);
  cb.current = onResult;
  const [error, setError] = useState('');

  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!enabled || !track || !window.MediaRecorder) return undefined;

    const audio = new MediaStream([track]);
    let stopped = false;
    let rec = null;
    let cutTimer = null;
    let level = 0;
    let queue = Promise.resolve(); // keeps results in speaking order

    // very small voice-activity detector
    let ctx = null;
    let poll = null;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(audio).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      poll = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) { const v = buf[i] / 128 - 1; sum += v * v; }
        level = Math.max(level, Math.sqrt(sum / buf.length));
      }, 100);
    } catch { level = 1; /* no analyser: send everything */ }

    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';

    const upload = (blob) => {
      queue = queue.then(async () => {
        try {
          const { text } = await apiBinary(`/api/ai/transcribe?code=${encodeURIComponent(code)}&lang=${encodeURIComponent(lang)}`, blob);
          setError('');
          if (!stopped && text) cb.current({ text, final: true });
        } catch (e) { setError(e.message); }
      });
    };

    const cycle = () => {
      if (stopped) return;
      const chunks = [];
      level = 0;
      rec = new MediaRecorder(audio, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const loud = level > MIN_LEVEL;
        const blob = new Blob(chunks, { type: (rec.mimeType || mime || 'audio/webm').split(';')[0] });
        if (!stopped) cycle(); // start the next clip straight away so no speech is lost
        if (loud && blob.size > 1500) upload(blob);
      };
      rec.start();
      cutTimer = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, CHUNK_MS);
    };
    cycle();

    return () => {
      stopped = true;
      clearTimeout(cutTimer);
      clearInterval(poll);
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* noop */ }
      ctx?.close().catch(() => {});
    };
  }, [enabled, lang, stream, code]);

  return { supported: !!window.MediaRecorder, error };
}
