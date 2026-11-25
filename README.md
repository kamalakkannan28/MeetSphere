# MeetSphere - AI-Powered Video Meetings with Live Transcription

Final-year CSE project (Jerusalem College of Engineering). A web-based video conferencing platform with
real-time captions, an in-meeting AI assistant and automatic post-meeting summaries, built to make meetings
accessible and easier to follow.

## Features (all implemented, mapped to the review PPT)

| PPT feature | Where it lives |
|---|---|
| Secure sign-up / login (Firebase Auth, email + Google) | `client/src/context/AuthContext.jsx`, `pages/AuthPage.jsx` |
| JWT-secured backend (Firebase token -> JWT, REST + Socket.IO auth) | `server/src/auth.js`, `app.js`, `socket.js` |
| Create / join meetings with shareable code + invite link | `server/src/app.js`, `pages/Dashboard.jsx` |
| WebRTC audio/video, peer-to-peer, Socket.IO signalling | `client/src/lib/PeerManager.js`, `server/src/socket.js` |
| Pre-join lobby (camera/mic preview, language choice) | `pages/Meeting.jsx` |
| Mute / camera / screen share / raise hand / reactions | `components/Room.jsx` |
| Real-time transcription (Web Speech API, in the browser) | `hooks/useSpeechRecognition.js` |
| Live captions overlay + live transcript panel (+ .txt download) | `components/Room.jsx`, `Panels.jsx` |
| In-meeting chat | `ChatPanel`, `server/src/socket.js` |
| AI chat assistant (Groq) that knows the live transcript | `AIPanel`, `server/src/services/ai.js` |
| AI summary, key highlights, decisions, action items | `ai.js` -> `summarize()` |
| Transcripts and chat saved to Firestore | `client/src/lib/firebase.js` (`persist`) |
| Meeting history + post-meeting recap page | `pages/Dashboard.jsx`, `pages/MeetingDetails.jsx` |
| **Live captions like Google Meet / Zoom** (per-speaker names, size S/M/L, on/off, language you speak) | `Room.jsx` caption overlay + settings menu, `useSpeechRecognition.js` |
| **Caption translation** (each person picks the language they read, 21 languages; original text optional) | `server/src/socket.js` (`translateSegment`), `ai.translate()`, `Room.jsx` |
| **Installable app** (own window + icon on Windows / Mac / Linux / Android, offline app shell) | `client/public/manifest.webmanifest`, `sw.js`, `usePwaInstall.js` |
| **Desktop app** for Windows / macOS / Linux (installer, own window, `meetsphere://` links, native screen-share picker) | `desktop/` (Electron) |
| **Mobile app** for Android (APK) and iOS (on a Mac) | `mobile/` (Capacitor) |
| **Cloud captions** for the apps and for browsers without speech recognition (Groq Whisper) | `hooks/useCloudRecognition.js`, `server/src/services/ai.js` (`transcribe`) |
| Host controls: end for everyone, **mute / mute all / remove**, **lock meeting**, **reopen an ended meeting** | `socket.js` (`host:*`), `app.js` (`/end`, `/reopen`), `Panels.jsx` (`PeoplePanel`) |
| **Meeting password** (salted scrypt hash, kept in a private collection) | `server/src/security.js`, `meetingStore.js` (`meetingSecrets`) |
| **Waiting room** (host admits / denies each person, live list) | `socket.js` (`waiting:list`, `host:admit`), `PeoplePanel` |
| **Scheduled meetings** + Google Calendar link + `.ics` download | `pages/Dashboard.jsx`, `client/src/lib/calendar.js` |
| **Email invitations** (SMTP from the server, or `mailto:` fallback) | `server/src/services/mailer.js`, `components/InviteModal.jsx` |
| **Local recording** (host; video grid + mixed audio, saved as .webm on the host's computer; everyone sees a banner) | `client/src/lib/recorder.js` |
| **Shared whiteboard** (pen, eraser, colours, undo, host clear, save PNG; late joiners get the board) | `components/Whiteboard.jsx`, `socket.js` (`wb:*`) |
| **File sharing** in chat (up to 5 MB, relayed live, never stored) | `ChatPanel`, `socket.js` (`file:share`) |
| **Background blur** (in-browser person segmentation, MediaPipe) | `client/src/lib/blur.js` |
| **Active-speaker highlight** (Web Audio level detection) | `hooks/useActiveSpeaker.js` |
| **Email verification + profile page** (change name, resend link, password reset; optional enforcement) | `pages/Profile.jsx`, `AuthContext.jsx` |
| Security (helmet, CORS, rate limits, Firestore rules, participant-only AI access) | `server/src/app.js`, `firestore.rules` |

## Architecture

```
Browser (React + Vite)                         Node.js / Express server
 ├ Firebase Auth  ── ID token ──HTTPS──▶  POST /api/auth/session ─▶ verifies with Firebase Admin ─▶ issues JWT
 ├ Meeting room  ◀── Socket.IO (JWT) ──▶  signalling, chat, captions, roster, reactions
 ├ WebRTC mesh   ◀────── audio/video peer-to-peer ──────▶ other browsers
 ├ Web Speech API → captions → Socket.IO (+ saved to Firestore by the speaker)
 ├ Chat/AI panel ──HTTPS + JWT──▶  /api/ai/chat, /api/ai/summarize ─▶ Groq API (Llama 3.3)
 └ Firestore (client SDK) ◀── meetings/{code}/messages, /transcripts  (protected by firestore.rules)
```

Workflow: login -> create/join -> WebRTC streams -> browser speech-to-text -> chat/AI via Groq -> transcripts and chat
stored in Firestore -> host ends meeting -> AI summary saved -> recap page.

## Folder structure

```
meetsphere/
├── package.json            root scripts (install:all, dev, test, build)
├── firestore.rules         Firestore security rules   (publish these!)
├── firebase.json
├── README.md
├── server/                 Node.js + Express + Socket.IO
│   ├── .env.example
│   ├── package.json
│   ├── src/
│   │   ├── index.js        entry point (wires Firebase, Groq, HTTP + sockets)
│   │   ├── app.js          REST API: auth, meetings, AI (+ helmet / CORS / rate limits)
│   │   ├── socket.js       signalling + chat + captions + roster
│   │   ├── auth.js         JWT sign / verify / middleware
│   │   ├── firebase.js     Firebase Admin init
│   │   ├── config.js, utils.js
│   │   └── services/
│   │       ├── ai.js           Groq client, prompts, summary JSON
│   │       ├── meetingStore.js Firestore persistence
│   │       └── roomStore.js    live room state + transcript buffer
│   └── test/api.test.js    automated tests (auth, rooms, signalling, chat, AI, summary)
└── client/                 React + Vite
    ├── .env.example
    ├── index.html, vite.config.js, package.json
    └── src/
        ├── main.jsx, App.jsx, styles.css
        ├── context/AuthContext.jsx
        ├── lib/            firebase.js, api.js, PeerManager.js (WebRTC)
        ├── hooks/          useMeetingRoom.js, useSpeechRecognition.js
        ├── components/     Room.jsx, VideoTile.jsx, Panels.jsx (chat / AI / transcript / people)
        └── pages/          AuthPage, Dashboard, Meeting (lobby), MeetingDetails (recap)
```

## Setup (about 15 minutes)

**Requirements:** Node.js 18+ (20/22 recommended), Chrome or Edge (best Web Speech API support), a Google account.

### 1. Firebase project
1. https://console.firebase.google.com -> **Add project**.
2. **Build > Authentication > Get started > Sign-in method**: enable **Email/Password** and **Google**.
3. **Build > Firestore Database > Create database** (production mode). Then open the **Rules** tab, paste the contents of
   `firestore.rules` and **Publish**. (Or: `npm i -g firebase-tools && firebase login && firebase deploy --only firestore:rules`.)
4. **Project settings > General > Your apps > Web (`</>`)**: register an app and copy the config values.
5. **Project settings > Service accounts > Generate new private key**: save the JSON as `server/serviceAccountKey.json`.

### 2. Groq API key
Create a free key at https://console.groq.com/keys. (Default model `llama-3.3-70b-versatile`; change `GROQ_MODEL`
in `server/.env` if Groq retires it. See console.groq.com/docs/models.)

### 3. Configure
```bash
cp server/.env.example server/.env      # set JWT_SECRET, GROQ_API_KEY; verify FIREBASE_PROJECT_ID matches the service account
cp client/.env.example client/.env      # paste the Firebase web config values
```
Generate a JWT secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

For Render, set `FIREBASE_PROJECT_ID` to `meetsphere-cce1a`. It must match both
`VITE_FIREBASE_PROJECT_ID` in the Vercel build environment and the service account's `project_id`.
If using `FIREBASE_PRIVATE_KEY` instead of a service-account file, also set `FIREBASE_CLIENT_EMAIL`;
do not paste or commit the private key into source control.

### 4. Install and run
```bash
npm run install:all
npm run dev            # server on :5000, client on :5173
```
Open http://localhost:5173, create an account, click **Start meeting**.

### 5. Try it with two participants
Open the invite link in a second browser window (use a different browser/profile or an incognito window and a second
account). Allow camera/mic, speak, and check: captions, transcript panel, chat, AI panel (ask "Catch me up"), raise hand,
screen share. As host press the red **phone** button to end the meeting: you land on the recap page and the AI summary
appears within a few seconds.

### Install MeetSphere as an app (like Meet / Zoom / Teams)

There are three ways, from quickest to most "real app". All of them connect to the same MeetSphere server.

| Option | Platforms | Effort | Live captions |
|---|---|---|---|
| **A. Install from the browser (PWA)** | Windows, macOS, Linux, Android (Chrome / Edge) | 1 click | browser speech (instant) |
| **B. Desktop app** (installer: `.exe` / `.dmg` / `.AppImage` / `.deb`) | Windows, macOS, Linux | build once | cloud transcription (a few seconds delay) |
| **C. Mobile app** (`.apk`; iOS via Xcode) | Android, iOS | build once | cloud transcription |

**First, run the server so the apps have something to connect to** (it also serves the web app):
```bash
npm run app            # builds the client, then the server serves everything on http://localhost:5000
```
For other people's computers and phones, deploy the server over **HTTPS** (Render, Railway, a VPS, or a quick tunnel such as
`ngrok http 5000` or `cloudflared tunnel --url http://localhost:5000`). Browsers and phones only allow camera/microphone on
HTTPS or `localhost`. Set `CLIENT_URL` in `server/.env` to that address.

#### A. Browser install (PWA)
Open **http://localhost:5000** (or your HTTPS address) in **Chrome or Edge** and click **Install app** in the top bar (or the
install icon in the address bar). On Android: Chrome menu > **Install app**. On iPhone/iPad: Safari > Share > **Add to Home Screen**
(live captions are not available in iOS home-screen web apps).

#### B. Desktop app (Electron)
```bash
npm run desktop:install      # once: downloads Electron (about 150 MB)
npm run desktop              # run it right now in a window
```
It opens the server at `http://localhost:5000` by default. To point it at your deployed server, either edit
`desktop/app.config.json` **before building**, or use **MeetSphere > Server settings...** inside the app (saved per user).
To create an installer **on the same operating system you want to ship for**:
```bash
npm run desktop:dist         # Windows: desktop/dist/MeetSphere Setup 1.0.0.exe
                             # macOS:   desktop/dist/MeetSphere-1.0.0.dmg
                             # Linux:   desktop/dist/MeetSphere-1.0.0.AppImage and .deb
```
Features: own window and icon, remembers its size, one window only, opens `meetsphere://join/abc-defg-hij` links, native
screen/window picker for screen sharing, camera/microphone permission handled for you (macOS asks once).
Sign in with **email and password**. Google sign-in is attempted but Google may refuse embedded windows.

#### C. Mobile app (Capacitor)
The Android project is already generated in `mobile/android` with camera/microphone permissions.
```bash
npm run mobile:install                                   # once
cd mobile
npm run set-server -- https://your-server.example.com    # must be HTTPS
npm run sync
npx cap open android                                     # opens Android Studio: Build > Build APK(s), or press Run on a phone
```
Needs **Android Studio** (it installs the Android SDK). On a **Mac** with Xcode: `npx cap add ios`, add the camera and microphone
usage descriptions to `Info.plist`, then `npx cap open ios`. The mobile app signs in with email/password (Google blocks WebViews)
and has no screen-sharing button (not supported on phones).

**Why the apps use cloud captions:** the Chrome/Edge browsers include a built-in speech recogniser, but the engine inside
Electron and Android/iOS WebViews does not. In the apps your voice is recorded in short clips (silence is skipped), sent to the
MeetSphere server and transcribed by Groq Whisper (`whisper-large-v3-turbo`, set with `GROQ_STT_MODEL`). It needs `GROQ_API_KEY`,
and captions appear a few seconds after you speak instead of word by word. Everything else (translation, saved transcript,
AI summary) works the same.

### Meeting controls and extras: how to use them
* **Start a meeting with options:** on the dashboard open *Options* under *New meeting* to add a **password**, turn on the
  **waiting room**, or pick a date/time to **schedule** it. Scheduled meetings show an *Invite / add to calendar* button.
* **Invite:** the *Invite* button in a meeting (or the lobby) copies the link, opens Google Calendar, downloads an `.ics`
  file, or emails invitations. Email sending uses your SMTP settings (`SMTP_*` in `server/.env`); without them the button
  opens your own mail app instead. The password is never put in the link or the email.
* **Host tools** (People panel): admit/deny people in the waiting room, mute one person or everyone, remove someone
  (they cannot rejoin), lock the meeting so no new person can join. Participants can unmute themselves again.
* **Record (host):** the red circle button records the whole call locally and downloads a `.webm` when you stop. Everyone
  sees a "recording" banner. Nothing is uploaded. Keep the MeetSphere tab visible while recording (browsers slow hidden tabs).
* **Whiteboard:** pen icon in the control bar. Everyone can draw; the host can clear it for all.
* **Files:** paperclip in Chat, up to `MAX_FILE_MB` (default 5). Files are relayed live, only people in the call at that moment receive them, and they are not saved.
* **Blur my background:** the face icon in the control bar. The first use downloads a small model (about 1 MB plus WASM) from Google/jsDelivr, so it needs internet.
* **Reopen:** a host can reopen an ended meeting from the recap page; ending it again refreshes the AI summary.
* **Email verification:** new email/password accounts get a verification link. Set `REQUIRE_VERIFIED_EMAIL=true` on the server
  to block creating/joining meetings until the address is verified (Google accounts count as verified).

### How caption translation works
Everyone speaks in their own language (pick it in the lobby or Transcript panel). Click the **CC** button, choose
**Translate captions into...** and you read everyone else's speech in your language, with the original shown smaller
underneath (optional). The server translates each phrase with Groq once per target language, so a meeting with 5 people
who want Tamil costs one translation, not five. Interim words are translated at most every ~0.8 s; finished sentences always.
Translation needs `GROQ_API_KEY`. The transcript saved to Firestore keeps the original wording.

### Run the automated backend tests
```bash
npm test      # 15 tests: auth, signalling, chat, captions, caption translation, AI context, host-only end, summary, capacity,
              # password, waiting room, host controls, whiteboard, file sharing, recording flag, schedule/reopen/invites, email verification, cloud transcription (Whisper)
```
These use in-memory fakes, so no Firebase or Groq account is needed.

## Using it with other devices / deploying
* Browsers only allow camera and microphone on **HTTPS or localhost**. To test from a phone, deploy or use a tunnel
  (e.g. `ngrok http 5173` and `ngrok http 5000`, then set `VITE_API_URL` and `CLIENT_URL` accordingly).
* Add your deployed front-end domain under **Firebase > Authentication > Settings > Authorized domains**.
* **TURN server:** STUN alone fails for users behind strict NATs. For real-world use set `TURN_URL`, `TURN_USERNAME`,
  `TURN_CREDENTIAL` in `server/.env` (e.g. a free/trial TURN service or your own coturn).
* Suggested hosting: front-end on Vercel/Netlify/Firebase Hosting (`npm run build`, publish `client/dist`), back-end on
  Render/Railway/a VPS (needs WebSocket support). Set `CLIENT_URL` on the server to the front-end origin.
* For a split Vercel/Render deployment, set Vercel's `VITE_API_URL` to the Render service origin (without a trailing slash)
  and set its `VITE_FIREBASE_*` values from the Firebase web app. On Render, set `CLIENT_URL` to the Vercel origin and
  `FIREBASE_PROJECT_ID` to `meetsphere-cce1a`; configure Firebase Admin credentials using a secure service-account file
  or `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`. Redeploy the frontend after changing Vite environment variables.

## Design notes and known limits (good material for your viva)
* **Topology:** full-mesh WebRTC, so each participant uploads to every other one. Capped at `MAX_PARTICIPANTS` (default 6).
  Scaling further needs an SFU (LiveKit, mediasoup). Listed as future work.
* **Caption translation:** LLM-based (Groq), so quality is good for common languages but is not a certified interpreter. Cost is bounded by caching, throttling and a per-language fan-out.
* **Transcription:** Web Speech API runs in the user's browser (zero server cost, many languages including Tamil and Hindi),
  but works only in Chrome/Edge/Safari and needs internet. Each browser transcribes its own speaker, then shares the text.
* **Privacy:** the server never records or stores audio/video. The only recording is the host's optional local one (saved on their own computer, with a banner shown to everyone). Only text (chat + final transcript lines) is saved to Firestore, readable
  only by participants of that meeting (see `firestore.rules`). Meeting passwords are stored only as salted hashes in a collection the browser cannot read.
* **Speaker names:** every transcript line is labelled with the speaker because each browser transcribes its own user. Separating several people who share one microphone (diarization) is not possible with the Web Speech API.
* **Apps:** the desktop app was launched and verified under a virtual display (page load, preload bridge, unreachable-server screen, Linux packaging). The Windows/macOS installers and the Android APK have to be built on those systems, so they are untested here. Real calls from the apps need a deployed HTTPS server.
* **Untested in a real browser:** recording, background blur, whiteboard drawing and active-speaker detection are browser features that need a manual two-window test; the server side of every feature is covered by automated tests.
* **Files and whiteboard:** relayed through the server in memory only (whiteboard strokes are kept while the room is alive, files are not kept at all).
* **AI safety:** transcript text is treated as untrusted data in the prompts; AI endpoints are participant-only and rate-limited.
* **Scalability:** room state is in memory (single server instance). For multiple instances use the Socket.IO Redis adapter.
* **Waterfall model (slide 12):** requirements -> design (architecture + workflow diagrams) -> implementation (this repo) ->
  testing (`server/test`) -> deployment/maintenance.

## Troubleshooting
| Symptom | Fix |
|---|---|
| "server rejected the session" after login | Check `VITE_API_URL`, then confirm Render `FIREBASE_PROJECT_ID` matches Vercel `VITE_FIREBASE_PROJECT_ID` and the Firebase Admin service account's `project_id`; inspect Render logs for the safe Firebase auth error code |
| Dashboard says Firestore rules not published | Do step 1.3 (publish `firestore.rules`) |
| Translated captions never appear | Set `GROQ_API_KEY`, restart the server, and pick a language in the CC menu (it must differ from the speaker's) |
| No captions | Use Chrome/Edge, allow the mic, unmute, and pick your speaking language in the Transcript panel |
| Captions in the desktop/mobile app say transcription is not configured | Set `GROQ_API_KEY` in `server/.env` (the apps use Groq Whisper for your voice) and restart the server |
| Desktop app shows "Connect to MeetSphere" | The server is not reachable: start it (`npm run app`) or change the address under MeetSphere > Server settings |
| Mobile app shows "no server address yet" | Run `npm run set-server -- https://your-server` then `npm run sync`, and rebuild |
| Camera/mic blocked in the app | Use `localhost` (desktop) or an `https://` address; allow the permission in system settings |
| AI says it is not configured | Set `GROQ_API_KEY` in `server/.env` and restart the server |
| Video works on localhost but not between networks | Add a TURN server (see above) |
| `auth/unauthorized-domain` | Add the domain to Firebase Authorized domains |
