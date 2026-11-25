import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, collection, getDocs, orderBy, query } from 'firebase/firestore';
import { ArrowLeft, Download, Sparkles, RefreshCw } from 'lucide-react';
import { db } from '../lib/firebase.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { SummaryView } from '../components/Panels.jsx';

const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function save(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function MeetingDetails() {
  const { code } = useParams();
  const { user } = useAuth();
  const [m, setM] = useState(undefined);
  const [lines, setLines] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [tab, setTab] = useState('summary');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // live meeting document: the AI summary appears here as soon as the server saves it
  useEffect(() => onSnapshot(doc(db, 'meetings', code), (s) => setM(s.exists() ? s.data() : null), (e) => { setErr(e.message); setM(null); }), [code]);

  useEffect(() => {
    const load = async () => {
      try {
        const [t, c] = await Promise.all(['transcripts', 'messages'].map((n) => getDocs(query(collection(db, 'meetings', code, n), orderBy('ts')))));
        setLines(t.docs.map((d) => d.data()));
        setMsgs(c.docs.map((d) => d.data()));
      } catch (e) { setErr(e.message); }
    };
    load();
  }, [code, m?.summaryStatus]);

  const nav = useNavigate();
  const reopen = async () => {
    setBusy(true); setErr('');
    try { await api(`/api/meetings/${code}/reopen`, { method: 'POST' }); nav(`/meeting/${code}`); } catch (e) { setErr(e.message); setBusy(false); }
  };
  const regenerate = async () => {
    setBusy(true); setErr('');
    try { await api('/api/ai/summarize', { method: 'POST', body: { code } }); } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (m === undefined) return <div className="center-screen"><p className="muted">Loading…</p></div>;
  if (m === null) return <div className="center-screen"><div className="card"><h2>Recap not available</h2><p>{err || 'This meeting does not exist or you did not take part in it.'}</p><Link className="btn primary" to="/">Home</Link></div></div>;

  const s = m.summary;
  const summaryText = s ? [`${m.title}`, '', s.summary, '', 'Highlights:', ...(s.highlights || []).map((x) => `- ${x}`), '', 'Decisions:', ...(s.decisions || []).map((x) => `- ${x}`), '', 'Action items:', ...(s.actionItems || []).map((a) => `- ${a.task} (${a.owner})`)].join('\n') : '';
  const transcriptText = lines.map((l) => `[${hhmm(l.ts)}] ${l.name}: ${l.text}`).join('\n');

  return (
    <div className="details">
      <Link to="/" className="back"><ArrowLeft size={16} /> All meetings</Link>
      <h1>{m.title}</h1>
      <p className="muted">{new Date(m.createdAt).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })} · hosted by {m.hostName} · {m.participants?.length} participant{m.participants?.length === 1 ? '' : 's'} · {m.status === 'active' ? 'still live' : 'ended'}</p>
      {m.status === 'active' && <Link className="btn primary" to={`/meeting/${code}`}>Rejoin meeting</Link>}
      {m.status === 'ended' && m.hostUid === user.uid && <button className="btn" onClick={reopen} disabled={busy}>Reopen meeting</button>}

      <div className="tabs" role="tablist">
        {[['summary', 'AI summary'], ['transcript', `Transcript (${lines.length})`], ['chat', `Chat (${msgs.length})`]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}

      {tab === 'summary' && (
        <div className="card wide">
          {s ? <SummaryView s={s} /> : (
            <p className="muted">
              {m.summaryStatus === 'pending' && 'MeetSphere AI is writing the summary… this page updates automatically.'}
              {m.summaryStatus === 'empty' && 'No speech or chat was recorded in this meeting, so there is nothing to summarise.'}
              {m.summaryStatus === 'failed' && 'The summary could not be generated.'}
              {m.summaryStatus === 'none' && (m.status === 'active' ? 'The summary is created when the host ends the meeting.' : 'No summary yet.')}
            </p>
          )}
          <div className="row">
            {s && <button className="btn" onClick={() => save(`${code}-summary.txt`, summaryText)}><Download size={16} /> Download summary</button>}
            {m.status === 'ended' && m.summaryStatus !== 'pending' && (lines.length > 0 || msgs.length > 0) && (
              <button className="btn" onClick={regenerate} disabled={busy}>{s ? <RefreshCw size={16} /> : <Sparkles size={16} />} {busy ? 'Working…' : s ? 'Regenerate' : 'Generate summary'}</button>
            )}
          </div>
        </div>
      )}

      {tab === 'transcript' && (
        <div className="card wide">
          {lines.length === 0 ? <p className="muted">No speech was transcribed.</p> : lines.map((l) => <div className="line" key={l.id}><span className="muted">{hhmm(l.ts)}</span> <b>{l.uid === user.uid ? 'You' : l.name}</b> {l.text}</div>)}
          {lines.length > 0 && <div className="row"><button className="btn" onClick={() => save(`${code}-transcript.txt`, transcriptText)}><Download size={16} /> Download transcript</button></div>}
        </div>
      )}

      {tab === 'chat' && (
        <div className="card wide">
          {msgs.length === 0 ? <p className="muted">No chat messages.</p> : msgs.map((c) => <div className="line" key={c.id}><span className="muted">{hhmm(c.ts)}</span> <b>{c.uid === user.uid ? 'You' : c.name}</b> {c.text}</div>)}
        </div>
      )}
    </div>
  );
}
