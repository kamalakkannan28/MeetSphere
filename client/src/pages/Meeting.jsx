import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mic, MicOff, Video, VideoOff, UserPlus, Lock, CalendarClock, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import Room from '../components/Room.jsx';
import VideoTile from '../components/VideoTile.jsx';
import InviteModal from '../components/InviteModal.jsx';
import { LANGS } from '../components/Panels.jsx';

async function getMedia() {
  const tries = [{ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } }, { audio: true }, { video: true }];
  for (const c of tries) {
    try { return await navigator.mediaDevices.getUserMedia(c); } catch { /* try next */ }
  }
  return null; // join as a listener
}

export default function Meeting() {
  const { code } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [stream, setStream] = useState(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [lang, setLang] = useState(navigator.language?.startsWith('ta') ? 'ta-IN' : 'en-IN');
  const [joined, setJoined] = useState(false);
  const [password, setPassword] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const streamRef = useRef(null);

  const refresh = () => api(`/api/meetings/${code}`).then(setInfo).catch((e) => setErr(e.message));
  const reopen = async () => {
    setReopening(true);
    try { await api(`/api/meetings/${code}/reopen`, { method: 'POST' }); await refresh(); } catch (e) { setErr(e.message); }
    setReopening(false);
  };

  useEffect(() => {
    let cancelled = false;
    refresh();
    getMedia().then((s) => {
      if (cancelled) { s?.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = s; setStream(s); setMediaReady(true);
    });
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, [code]);

  const hasAudio = !!stream?.getAudioTracks().length;
  const hasVideo = !!stream?.getVideoTracks().length;
  const apply = (kind, on) => stream?.[kind === 'audio' ? 'getAudioTracks' : 'getVideoTracks']().forEach((t) => { t.enabled = on; });

  if (err) return <div className="center-screen"><div className="card"><h2>Meeting unavailable</h2><p>{err}</p><button className="btn primary" onClick={() => nav('/')}>Back to home</button></div></div>;
  if (!info || !mediaReady) return <div className="center-screen"><p className="muted">Getting your camera and microphone ready…</p></div>;
  if (info.status === 'ended') {
    return (
      <div className="center-screen"><div className="card">
        <h2>This meeting has ended</h2>
        <p className="muted">You can review the transcript and AI summary if you took part.{info.isHost ? ' As the host you can also reopen it: the same code and history continue, and the AI summary is refreshed when you end it again.' : ''}</p>
        <div className="row">
          <button className="btn" onClick={() => nav('/')}>Home</button>
          <button className="btn primary" onClick={() => nav(`/history/${code}`)}>View recap</button>
          {info.isHost && <button className="btn" onClick={reopen} disabled={reopening}>{reopening ? 'Reopening…' : 'Reopen meeting'}</button>}
        </div>
      </div></div>
    );
  }

  if (joined) {
    return (
      <Room code={code} user={user} stream={stream}
        initial={{ audio: mic && hasAudio, video: cam && hasVideo, lang, password }} info={info}
        onBack={() => setJoined(false)} onLeave={() => nav('/')} onEnded={() => nav(`/history/${code}`)} />
    );
  }

  return (
    <div className="lobby">
      <div className="lobby-preview">
        <VideoTile local stream={stream} name={user.name} audio={mic && hasAudio} video={cam && hasVideo} />
        <div className="lobby-ctrls">
          <button className={`ctrl ${mic && hasAudio ? '' : 'off'}`} disabled={!hasAudio} onClick={() => { apply('audio', !mic); setMic(!mic); }} aria-label="Toggle microphone">{mic && hasAudio ? <Mic size={20} /> : <MicOff size={20} />}</button>
          <button className={`ctrl ${cam && hasVideo ? '' : 'off'}`} disabled={!hasVideo} onClick={() => { apply('video', !cam); setCam(!cam); }} aria-label="Toggle camera">{cam && hasVideo ? <Video size={20} /> : <VideoOff size={20} />}</button>
        </div>
        {!stream && <p className="notice">Camera and microphone are blocked. You can still join and watch, listen and chat. Allow access in your browser's address bar and reload to be seen and heard.</p>}
      </div>
      <div className="lobby-side">
        <h1>{info.title}</h1>
        <p className="muted">Hosted by {info.hostName} · {info.live} in the call now · code {info.code}</p>
        <div className="tags">
          {info.scheduledFor && <span className="pill"><CalendarClock size={12} /> {new Date(info.scheduledFor).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>}
          {info.hasPassword && <span className="pill"><Lock size={12} /> Password protected</span>}
          {info.waitingRoom && <span className="pill"><ShieldCheck size={12} /> Waiting room</span>}
          {info.locked && <span className="pill warn"><Lock size={12} /> Locked by host</span>}
        </div>
        {info.needsPassword && (
          <label className="field">Meeting password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder="Ask the host for the password" />
          </label>
        )}
        {info.waitingRoom && !info.isHost && <p className="muted">The host will let you in after you press Join.</p>}
        <label className="field">Language you will speak (for live transcription)
          <select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <button className="btn primary big" onClick={() => setJoined(true)} disabled={info.live >= info.max || (info.needsPassword && !password)}>{info.live >= info.max ? 'Meeting is full' : 'Join now'}</button>
        <button className="btn" onClick={() => setInviteOpen(true)}><UserPlus size={16} /> Invite or add to calendar</button>
        <button className="btn" onClick={() => nav('/')}>Cancel</button>
        {inviteOpen && <InviteModal code={code} title={info.title} scheduledFor={info.scheduledFor} hasPassword={info.hasPassword} isHost={info.isHost} emailEnabled={info.emailEnabled} onClose={() => setInviteOpen(false)} />}
      </div>
    </div>
  );
}
