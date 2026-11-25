# MeetSphere Mobile (Capacitor)

Thin Android/iOS wrapper that opens your deployed MeetSphere server (must be HTTPS for camera and microphone).

```bash
npm install
npm run set-server -- https://your-server.example.com
npm run sync
npx cap open android        # Android Studio > Build > Build APK(s)
```

* Android permissions (camera, microphone, audio settings) are already in `android/app/src/main/AndroidManifest.xml`.
* iOS (Mac + Xcode only): `npx cap add ios`, add `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` to `Info.plist`.
* The app tells the web app it is native (user-agent `MeetSphereApp`), so it uses cloud captions, hides screen share and hides Google sign-in.
* App name, id and icon: `capacitor.config.js` and Android Studio's Image Asset tool.
