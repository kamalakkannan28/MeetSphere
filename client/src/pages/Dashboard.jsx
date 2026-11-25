import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Video, LogIn, LogOut, Sparkles, Download, CalendarClock, MailWarning, UserCircle, Lock } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall.js';
import { db } from '../lib/firebase.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import InviteModal from '../components/InviteModal.jsx';

const CODE_RE = /[a-z]{3}-[a-z]{4}-[a-z]{3}/i;
const STATUS = { ready: 'AI summary ready', pending: 'Summary generating…', failed: 'Summary failed', empty: 'No speech recorded', none: '' };

export default function Dashboard() {
  const { user, logout, resendVerification, refreshUser } = useAuth();
  const nav = useNavigate();
  const pwa = usePwaInstall();
  const [title, setTitle] = useState('');
  const [join, setJoin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);
  const [histErr, setHistErr] = useState('');
  const [opts, setOpts] = useState({ password: '', waitingRoom: false, when: '' });
  const [created, setCreated] = useState(null); // a scheduled meeting that was just created
  const [invite, setInvite] = useState(null);
  const [verifyMsg, setVerifyMsg] = useState('');

  useEffect(() => {
    getDocs(query(collection(db, 'meetings'), where('participants', 'array-contains', user.uid)))
      .then((s) => setHistory(s.docs.map((d) => d.data()).sort((a, b) => b.createdAt - a.createdAt)))
      .catch((e) => { setHistErr(e.code === 'permission-denied' ? 'Firestore rules are not published yet (see README step 3).' : e.message); setHistory([]); });
  }, [user.uid]);

  const create = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const scheduledFor = opts.when ? new Date(opts.when).getTime() : null;
      const m = await api('/api/meetings', { method: 'POST', body: { title, password: opts.password, waitingRoom: opts.waitingRoom, scheduledFor } });
      if (scheduledFor) {
        setCreated({ code: m.code, title: m.title, scheduledFor, hasPassword: !!opts.password });
        setTitle(''); setOpts({ password: '', waitingRoom: false, when: '' }); setBusy(false);
      } else nav(`/meeting/${m.code}`);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  const joinMeeting = (e) => {
    e.preventDefault();
    const m = join.match(CODE_RE);
    if (!m) return setErr('Enter a meeting code like abc-defg-hij or paste the invite link.');
    nav(`/meeting/${m[0].toLowerCase()}`);
  };

  return (
    <div className="dash">
      <header className="dash-top">
        <div className="brand"><span className="logo" /> MeetSphere</div>
        <div className="who">{pwa.canInstall && <button className="chip install" onClick={pwa.install}><Download size={14} /> Install app</button>}<Link to="/profile" className="who-link" title="Your profile"><UserCircle size={18} /> {user.name}</Link><button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button></div>
      </header>

      {!user.emailVerified && (
        <div className="verify-bar" role="status">
          <MailWarning size={16} />
          <span>Please verify your email address{verifyMsg ? `. ${verifyMsg}` : ': we sent you a link.'}</span>
          <button className="chip" onClick={() => resendVerification().then(() => setVerifyMsg('Email sent again.')).catch((e) => setVerifyMsg(e.message))}>Resend</button>
          <button className="chip strong" onClick={() => refreshUser().then(() => setVerifyMsg('')).catch((e) => setVerifyMsg(e.message))}>I verified, refresh</button>
        </div>
      )}
      <main className="dash-main">
        <section className="hello">
          <h1>Hello, {user.name.split(' ')[0]}.</h1>
          <p className="muted">Start an instant meeting or join one with a code.</p>
          <div className="actions">
            <form onSubmit={create} className="card">
              <h3><Video size={18} /> New meeting</h3>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title (optional)" maxLength={80} aria-label="Meeting title" />
              <details className="more-opts">
                <summary>Options: password, waiting room, schedule</summary>
                <label className="field">Meeting password (optional)
                  <input type="password" value={opts.password} onChange={(e) => setOpts({ ...opts, password: e.target.value })} minLength={4} maxLength={64} autoComplete="new-password" placeholder="At least 4 characters" />
                </label>
                <label className="switch"><input type="checkbox" checked={opts.waitingRoom} onChange={(e) => setOpts({ ...opts, waitingRoom: e.target.checked })} /> Waiting room: I admit each person</label>
                <label className="field">Schedule for later (optional)
                  <input type="datetime-local" value={opts.when} onChange={(e) => setOpts({ ...opts, when: e.target.value })} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} />
                </label>
              </details>
              <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : opts.when ? 'Schedule meeting' : 'Start meeting'}</button>
            </form>
            <form onSubmit={joinMeeting} className="card">
              <h3><LogIn size={18} /> Join with code</h3>
              <input value={join} onChange={(e) => setJoin(e.target.value)} placeholder="abc-defg-hij or invite link" aria-label="Meeting code" />
              <button className="btn">Join</button>
            </form>
          </div>
          {err && <p className="error" role="alert">{err}</p>}
          {created && (
            <div className="ok created" role="status">
              <span>Scheduled <b>{created.title}</b> for {new Date(created.scheduledFor).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}. Code: <b>{created.code}</b></span>
              <span className="row"><button className="chip strong" onClick={() => setInvite(created)}>Invite / add to calendar</button><Link className="chip" to={`/meeting/${created.code}`}>Open lobby</Link></span>
            </div>
          )}
        </section>

        <section>
          <h2>Your meetings</h2>
          {histErr && <p className="notice">{histErr}</p>}
          {history === null && <p className="muted">Loading…</p>}
          {history?.length === 0 && !histErr && <p className="muted">Meetings you join will show up here with their transcript and AI recap.</p>}
          <ul className="history">
            {history?.map((m) => (
              <li key={m.code}>
                <Link to={m.status === 'active' ? `/meeting/${m.code}` : `/history/${m.code}`}>
                  <div><b>{m.title}</b><span className="muted">{new Date(m.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {m.hostName}</span></div>
                  <div className="tags">
                    {m.hasPassword && <span className="pill"><Lock size={12} /></span>}
                    {m.status === 'active' && m.scheduledFor && m.scheduledFor > Date.now() ? <span className="pill"><CalendarClock size={12} /> {new Date(m.scheduledFor).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span> : m.status === 'active' ? <span className="pill live">Live · rejoin</span> : STATUS[m.summaryStatus] && <span className="pill"><Sparkles size={12} /> {STATUS[m.summaryStatus]}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>
      {invite && <InviteModal code={invite.code} title={invite.title} scheduledFor={invite.scheduledFor} hasPassword={invite.hasPassword} isHost emailEnabled onClose={() => setInvite(null)} />}
    </div>
  );
}
