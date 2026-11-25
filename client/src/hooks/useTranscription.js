import { useSpeechRecognition } from './useSpeechRecognition.js';
import { useCloudRecognition } from './useCloudRecognition.js';
import { hasBrowserSpeech, isInstalledShell, canRecordAudio } from '../lib/platform.js';

/**
 * Picks the speech-to-text engine:
 *  - "browser": Web Speech API (Chrome / Edge / Safari). Free, instant, interim words.
 *  - "cloud":   server-side Whisper. Used in the desktop and mobile apps (no Web Speech there) and in browsers without it.
 */
export function useTranscription({ enabled, lang, stream, code, authToken, onResult }) {
  const engine = hasBrowserSpeech && !isInstalledShell ? 'browser' : 'cloud';
  const browser = useSpeechRecognition({ enabled: enabled && engine === 'browser', lang, onResult });
  const cloud = useCloudRecognition({ enabled: enabled && engine === 'cloud', lang, stream, code, authToken, onResult });
  const active = engine === 'browser' ? browser : cloud;
  return { engine, supported: engine === 'browser' ? browser.supported : canRecordAudio, error: active.error };
}
