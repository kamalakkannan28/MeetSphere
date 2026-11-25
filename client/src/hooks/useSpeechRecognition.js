import { useEffect, useRef, useState } from 'react';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/**
 * Browser-side speech-to-text (Web Speech API) - runs on the user's device, no server cost.
 * Auto-restarts because Chrome ends sessions after silence. Supported in Chrome / Edge / Safari.
 */
export function useSpeechRecognition({ enabled, lang, onResult }) {
  const cb = useRef(onResult);
  cb.current = onResult;
  const [error, setError] = useState('');

  useEffect(() => {
    if (!SR || !enabled) return undefined;
    let stopped = false;
    let rec;
    let timer;

    const start = () => {
      rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = lang;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const text = e.results[i][0].transcript.trim();
          if (text) cb.current({ text, final: e.results[i].isFinal });
        }
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          stopped = true;
          setError('Speech recognition was blocked. Allow microphone access and reload.');
        } else if (e.error === 'network') setError('Speech recognition needs an internet connection.');
      };
      rec.onend = () => { if (!stopped) timer = setTimeout(start, 250); };
      try { rec.start(); setError(''); } catch { /* already started */ }
    };

    start();
    return () => { stopped = true; clearTimeout(timer); try { rec?.stop(); } catch { /* noop */ } };
  }, [enabled, lang]);

  return { supported: !!SR, error };
}
