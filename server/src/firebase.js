import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export function initFirebase() {
  if (!getApps().length) {
    let credential;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      credential = cert(JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')));
    } else if (process.env.FIREBASE_PRIVATE_KEY) {
      credential = cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else {
      credential = applicationDefault();
    }
    initializeApp({ credential });
  }
  return {
    verifyIdToken: (token) => getAuth().verifyIdToken(token),
    db: getFirestore(),
    FieldValue,
  };
}
