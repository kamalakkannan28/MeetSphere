import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, updateProfile, signOut, sendPasswordResetEmail, sendEmailVerification,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase.js';
import { exchangeFirebaseToken, setSession, setRefresher } from '../lib/api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const signingUp = useRef(false);

  /** Firebase ID token -> backend verifies it -> returns our JWT (used for REST + Socket.IO). */
  const establish = useCallback(async (fbUser, force = false) => {
    const idToken = await fbUser.getIdToken(force);
    const s = await exchangeFirebaseToken(idToken);
    setSession(s);
    setUser({ ...s.user, photoURL: fbUser.photoURL });
  }, []);

  useEffect(() => {
    setRefresher(() => (auth.currentUser ? establish(auth.currentUser, true) : Promise.reject(new Error('signed out'))));
    return onAuthStateChanged(auth, async (fbUser) => {
      if (signingUp.current) return;
      if (!fbUser) { setSession(null); setUser(null); setLoading(false); return; }
      try {
        setSessionError('');
        await establish(fbUser);
      } catch (e) {
        setSessionError(`Signed in, but the MeetSphere server rejected the session: ${e.message}. Is the backend running?`);
        setUser(null);
      }
      setLoading(false);
    });
  }, [establish]);

  const signUp = async (name, email, password) => {
    signingUp.current = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await sendEmailVerification(cred.user).catch(() => {}); // verification link by email
      await establish(cred.user, true); // refresh so the token carries the display name
    } finally {
      signingUp.current = false;
    }
  };

  const value = {
    user, loading, sessionError,
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signInWithGoogle: () => signInWithPopup(auth, googleProvider),
    resetPassword: (email) => sendPasswordResetEmail(auth, email),
    signUp,
    resendVerification: () => sendEmailVerification(auth.currentUser),
    /** After clicking the email link: reload the Firebase user and fetch a fresh session. */
    refreshUser: async () => { await auth.currentUser.reload(); await establish(auth.currentUser, true); },
    updateName: async (name) => { await updateProfile(auth.currentUser, { displayName: name }); await establish(auth.currentUser, true); },
    hasPassword: () => !!auth.currentUser?.providerData.some((p) => p.providerId === 'password'),
    logout: () => signOut(auth),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
