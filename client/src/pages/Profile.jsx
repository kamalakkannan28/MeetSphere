import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, MailWarning, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Profile() {
  const { user, logout, updateName, resendVerification, refreshUser, resetPassword, hasPassword } = useAuth();
  const [name, setName] = useState(user.name);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState(false);

  const run = async (fn, okText) => {
    setBusy(true); setMsg({ type: '', text: '' });
    try { await fn(); if (okText) setMsg({ type: 'ok', text: okText }); }
    catch (e) { setMsg({ type: 'error', text: e.code === 'auth/too-many-requests' ? 'Too many requests. Try again in a few minutes.' : e.message }); }
    setBusy(false);
  };
  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="details profile">
      <Link to="/" className="back"><ArrowLeft size={16} /> Back</Link>
      <div className="profile-head">
        <span className="big-avatar" aria-hidden="true">{initials}</span>
        <div><h1>{user.name}</h1><p className="muted">{user.email}</p></div>
      </div>

      <div className="card wide">
        <h3>Display name</h3>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim() && name.trim() !== user.name) run(() => updateName(name.trim()), 'Name updated.'); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Display name" style={{ maxWidth: 320 }} />
          <button className="btn primary" disabled={busy || !name.trim() || name.trim() === user.name}>Save</button>
        </form>
        <p className="muted">This is the name other people see in meetings, chat and transcripts.</p>
      </div>

      <div className="card wide">
        <h3>Email</h3>
        {user.emailVerified ? (
          <p className="ok"><BadgeCheck size={16} style={{ verticalAlign: '-3px' }} /> {user.email} is verified.</p>
        ) : (
          <>
            <p className="notice"><MailWarning size={16} style={{ verticalAlign: '-3px' }} /> Your email address is not verified yet. Check your inbox (and spam) for the link.</p>
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => run(resendVerification, 'Verification email sent.')}>Resend email</button>
              <button className="btn primary" disabled={busy} onClick={() => run(refreshUser, 'Status refreshed.')}>I have verified, refresh</button>
            </div>
          </>
        )}
      </div>

      <div className="card wide">
        <h3>Security</h3>
        {hasPassword()
          ? <div className="row"><button className="btn" disabled={busy} onClick={() => run(() => resetPassword(user.email), `Password reset link sent to ${user.email}.`)}>Send password reset email</button></div>
          : <p className="muted">You sign in with Google, so your password is managed by your Google account.</p>}
        <div className="row"><button className="btn" onClick={logout}><LogOut size={16} /> Sign out</button></div>
      </div>
      {msg.text && <p className={msg.type === 'ok' ? 'ok' : 'error'} role="status">{msg.text}</p>}
    </div>
  );
}
