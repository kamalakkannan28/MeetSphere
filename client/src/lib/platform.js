/** Where is MeetSphere running? The desktop (Electron) and mobile (Capacitor) apps have no built-in speech recogniser. */
export const isDesktopApp = typeof window !== 'undefined' && !!window.meetsphereDesktop;
export const isNativeApp = typeof window !== 'undefined' && (!!window.Capacitor?.isNativePlatform?.() || /MeetSphereApp/.test(navigator.userAgent));
export const isInstalledShell = isDesktopApp || isNativeApp;
export const hasBrowserSpeech = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export const canRecordAudio = typeof window !== 'undefined' && !!window.MediaRecorder;
export const canShareScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
