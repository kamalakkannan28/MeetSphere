// Language YOU speak (Web Speech API locale codes)
export const SPEECH_LANGS = [
  ['en-US', 'English (US)'], ['en-IN', 'English (India)'], ['en-GB', 'English (UK)'],
  ['ta-IN', 'தமிழ் (Tamil)'], ['hi-IN', 'हिन्दी (Hindi)'], ['te-IN', 'తెలుగు (Telugu)'],
  ['ml-IN', 'മലയാളം (Malayalam)'], ['kn-IN', 'ಕನ್ನಡ (Kannada)'], ['bn-IN', 'বাংলা (Bengali)'],
  ['mr-IN', 'मराठी (Marathi)'], ['gu-IN', 'ગુજરાતી (Gujarati)'], ['ur-PK', 'اردو (Urdu)'],
  ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['pt-BR', 'Português'],
  ['it-IT', 'Italiano'], ['ru-RU', 'Русский'], ['ar-SA', 'العربية'], ['zh-CN', '中文'], ['ja-JP', '日本語'], ['ko-KR', '한국어'],
];

// Language you want to READ captions in (codes match the server's LANGUAGES map)
export const TRANSLATE_LANGS = [
  ['en', 'English'], ['ta', 'தமிழ் (Tamil)'], ['hi', 'हिन्दी (Hindi)'], ['te', 'తెలుగు (Telugu)'],
  ['ml', 'മലയാളം (Malayalam)'], ['kn', 'ಕನ್ನಡ (Kannada)'], ['bn', 'বাংলা (Bengali)'], ['mr', 'मराठी (Marathi)'],
  ['gu', 'ગુજરાતી (Gujarati)'], ['pa', 'ਪੰਜਾਬੀ (Punjabi)'], ['ur', 'اردو (Urdu)'], ['es', 'Español'], ['fr', 'Français'],
  ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['ru', 'Русский'], ['ar', 'العربية'],
  ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'],
];

const KEY = 'meetsphere.captionPrefs';
export function loadCaptionPrefs() {
  try { return { lang: '', showOriginal: true, size: 'm', on: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { lang: '', showOriginal: true, size: 'm', on: true }; }
}
export function saveCaptionPrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode */ } }
