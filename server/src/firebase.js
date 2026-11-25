import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export function initFirebase() {
  if (!getApps().length) {
    const configuredProjectId = process.env.FIREBASE_PROJECT_ID
      || process.env.GOOGLE_CLOUD_PROJECT
      || process.env.GCLOUD_PROJECT;
    let credential;
    let credentialProjectId;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const serviceAccount = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
      credentialProjectId = serviceAccount.project_id;
      credential = cert(serviceAccount);

      if (configuredProjectId && credentialProjectId && configuredProjectId !== credentialProjectId) {
        throw new Error('FIREBASE_PROJECT_ID does not match the Firebase service account project_id.');
      }
    } else if (process.env.FIREBASE_PRIVATE_KEY) {
      if (!configuredProjectId) {
        throw new Error('FIREBASE_PROJECT_ID is required when using FIREBASE_PRIVATE_KEY.');
      }
      credentialProjectId = configuredProjectId;
      credential = cert({
        projectId: configuredProjectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else {
      credential = applicationDefault();
    }

    const projectId = configuredProjectId || credentialProjectId;
    if (!projectId) {
      throw new Error('FIREBASE_PROJECT_ID is required when the Firebase service account project cannot be inferred.');
    }

    initializeApp({ credential, projectId });
    console.info(`[firebase] Admin SDK initialized for project ${projectId}`);
  }
  return {
    verifyIdToken: (token) => getAuth().verifyIdToken(token),
    db: getFirestore(),
    FieldValue,
  };
}
