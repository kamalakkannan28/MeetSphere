import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { isNativeApp } from '../lib/platform.js';

const MESSAGES = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/user-not-found': 'No account with that email.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
  'auth/network-request-failed': 'Network error. Check your connection.',
};

export default function AuthPage() {
  const { signIn, signUp, signInWithGoogle, resetPassword, sessionError } = useAuth();
  const [mode, setMode] = useState('signin');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const run = async (fn) => {
    setErr(''); setInfo(''); setBusy(true);
    try { await fn(); } catch (e) { setErr(MESSAGES[e.code] || e.message); }
    setBusy(false);
  };
  const submit = (e) => {
    e.preventDefault();
    run(() => (mode === 'signin' ? signIn(f.email, f.password) : signUp(f.name.trim() || f.email.split('@')[0], f.email, f.password)));
  };
  const forgot = () => f.email
    ? run(async () => { await resetPassword(f.email); setInfo('Password reset email sent.'); })
    : setErr('Enter your email first.');

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="brand"><span className="logo" /> MeetSphere</div>
        <h1>Meetings that <em>listen</em>,<br />so everyone can follow.</h1>
        <p>HD video rooms with live captions, an AI assistant that has read the transcript, and a recap with action items the moment you hang up.</p>
        <div className="demo" aria-hidden="true">
          <p className="demo-cap"><b>Priya:</b> Let's lock the demo for Friday and Arun owns the slides<span className="caret" /></p>
          <p className="demo-ai"><b>AI</b> Decision: demo on Friday. Action: Arun to finish slides.</p>
        </div>
      </section>

      <section className="auth-form">
        <form onSubmit={submit} className="card">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Create account</button>
          </div>
          {mode === 'signup' && <label className="field">Full name<input required value={f.name} onChange={set('name')} autoComplete="name" /></label>}
          <label className="field">Email<input required type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
          <label className="field">Password<input required type="password" minLength={6} value={f.password} onChange={set('password')} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
          {(err || sessionError) && <p className="error" role="alert">{err || sessionError}</p>}
          {info && <p className="ok">{info}</p>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
          {!isNativeApp && <button type="button" className="btn big" disabled={busy} onClick={() => run(signInWithGoogle)}>Continue with Google</button>}
          {mode === 'signin' && <button type="button" className="link-btn" onClick={forgot}>Forgot password?</button>}
        </form>
      </section>
    </div>
  );
}
