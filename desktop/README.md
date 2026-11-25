# MeetSphere Desktop (Electron)

Windows / macOS / Linux app that opens your MeetSphere server in its own window.

```bash
npm install          # once
npm start            # run now
npm run dist         # build an installer for THIS operating system into dist/
```

* Server address: `app.config.json` (baked in at build time) or **MeetSphere > Server settings...** (per user).
  `MEETSPHERE_URL=https://... npm start` overrides both.
* `meetsphere://join/abc-defg-hij` links open the meeting in the app.
* Screen sharing shows a native picker (screens and windows).
* No built-in speech recogniser in Electron, so your captions use the server's cloud transcription (needs `GROQ_API_KEY`).
* Sign in with email/password (Google may block embedded windows).
* Icon: `build/icon.png` (512x512). Replace it with your own before building.
