import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, MonitorOff, Captions, Hand, Smile, MessageSquare,
  Sparkles, FileText, Users, PhoneOff, X, LogOut, UserPlus, Circle, ScanFace, PenTool, Lock,
} from 'lucide-react';
import VideoTile from './VideoTile.jsx';
import { ChatPanel, AIPanel, TranscriptPanel, PeoplePanel } from './Panels.jsx';
import { useMeetingRoom } from '../hooks/useMeetingRoom.js';
import Whiteboard from './Whiteboard.jsx';
import InviteModal from './InviteModal.jsx';
import { useTranscription } from '../hooks/useTranscription.js';
import { useActiveSpeaker } from '../hooks/useActiveSpeaker.js';
import { createRecorder, saveBlob, recordingSupported } from '../lib/recorder.js';
import { startBlur, blurSupported } from '../lib/blur.js';
import { canShareScreen } from '../lib/platform.js';
import { api } from '../lib/api.js';
import { TRANSLATE_LANGS, loadCaptionPrefs, saveCaptionPrefs } from '../lib/languages.js';

const EMOJI = ['👍', '👏', '😂', '🎉', '❤️', '😮'];
const PANELS = { chat: 'Chat', ai: 'AI assistant', transcript: 'Live transcript', people: 'People' };

export default function Room({ code, user, stream, initial, info, onLeave, onBack, onEnded }) {
  const [prefs, setPrefs] = useState(loadCaptionPrefs);
  const muteRef = useRef(() => {});
  const room = useMeetingRoom({ code, localStream: stream, initial: { ...initial, captionLang: prefs.lang }, onEnded, onHostMute: () => muteRef.current() });
  const [micOn, setMicOn] = useState(initial.audio && !!stream?.getAudioTracks().length);
  const [camOn, setCamOn] = useState(initial.video && !!stream?.getVideoTracks().length);
  const [ccMenu, setCcMenu] = useState(false);
  const [handUp, setHandUp] = useState(false);
  const [panel, setPanel] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [lang, setLang] = useState(initial.lang);
  const [screen, setScreen] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [wbOpen, setWbOpen] = useState(false);
  const [recorder, setRecorder] = useState(null);
  const [blur, setBlur] = useState(null);
  const [blurBusy, setBlurBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const recorderRef = useRef(null);
  const blurRef = useRef(null);
  const streamsRef = useRef({});
  recorderRef.current = recorder;
  blurRef.current = blur;
  streamsRef.current = room.streams;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busyEnd, setBusyEnd] = useState(false);
  const screenRef = useRef(null);
  const lastInterim = useRef(0);
  const cameraTrack = stream?.getVideoTracks()[0] || null;
  const hasMic = !!stream?.getAudioTracks().length;

  const speech = useTranscription({
    enabled: room.status === 'joined' && micOn && hasMic,
    lang,
    stream,
    code,
    onResult: (r) => {
      if (!r.final) { // throttle interim updates
        const now = Date.now();
        if (now - lastInterim.current < 250) return;
        lastInterim.current = now;
      }
      room.sendSpeech(r, lang);
    },
  });

  const toggleMic = () => {
    const on = !micOn;
    stream?.getAudioTracks().forEach((t) => { t.enabled = on; });
    setMicOn(on);
    room.setMediaState({ audio: on });
  };
  muteRef.current = () => {
    stream?.getAudioTracks().forEach((t) => { t.enabled = false; });
    setMicOn(false);
    room.setMediaState({ audio: false });
    setNotice('The host muted you. Unmute when you are ready to speak.');
  };
  const speaking = useActiveSpeaker({ localStream: stream, micOn, streams: room.streams });

  const toggleCam = () => {
    const on = !camOn;
    stream?.getVideoTracks().forEach((t) => { t.enabled = on; });
    setCamOn(on);
    room.setMediaState({ video: on || !!screenRef.current });
  };

  const stopShare = () => {
    screenRef.current?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    screenRef.current = null;
    setScreen(null);
    room.setOutgoingVideo(blurRef.current?.track || cameraTrack);
    room.setMediaState({ screen: false, video: camOn });
  };
  const startShare = async () => {
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = ds.getVideoTracks()[0];
      track.onended = stopShare;
      screenRef.current = ds;
      setScreen(ds);
      room.setOutgoingVideo(track);
      room.setMediaState({ screen: true, video: true });
    } catch { /* user cancelled the picker */ }
  };
  useEffect(() => () => screenRef.current?.getTracks().forEach((t) => t.stop()), []);

  const updatePrefs = (patch) => { const next = { ...prefs, ...patch }; setPrefs(next); saveCaptionPrefs(next); };
  const pickCaptionLang = (lang) => { updatePrefs({ lang }); room.setCaptionLang(lang); };
  // ---- background blur (camera only; paused while sharing the screen)
  const toggleBlur = async () => {
    if (blur) { blur.stop(); setBlur(null); if (!screenRef.current) room.setOutgoingVideo(cameraTrack); return; }
    if (!cameraTrack) return;
    setBlurBusy(true); setNotice('');
    try {
      const b = await startBlur(cameraTrack);
      setBlur(b);
      if (!screenRef.current) room.setOutgoingVideo(b.track);
    } catch (e) { setNotice(`Background blur is unavailable: ${e.message}`); }
    setBlurBusy(false);
  };
  useEffect(() => () => blurRef.current?.stop(), []);
  const blurStream = useMemo(() => (blur ? new MediaStream([blur.track]) : null), [blur]);

  // ---- recording (host only): saved to this computer, everyone sees a recording banner
  const startRec = () => {
    try {
      const rec = createRecorder({
        getTiles: () => [...document.querySelectorAll('.stage .tile')].map((el) => ({ video: el.querySelector('video'), name: el.dataset.name, off: el.dataset.off === '1' })),
        getAudioTracks: () => [...(stream?.getAudioTracks() || []), ...Object.values(streamsRef.current).flatMap((st) => st.getAudioTracks())],
        onStop: (blob) => saveBlob(blob, `meetsphere-${code}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`),
      });
      setRecorder(rec);
      room.setMediaState({ recording: true });
    } catch (e) { setNotice(`Recording failed to start: ${e.message}`); }
  };
  const stopRec = () => { recorderRef.current?.stop(); setRecorder(null); room.setMediaState({ recording: false }); };
  useEffect(() => () => recorderRef.current?.stop(), []);
  const leave = () => { recorderRef.current?.stop(); onLeave(); };

  const toggleHand = () => { const v = !handUp; setHandUp(v); room.toggleHand(v); };
  const endForAll = async () => {
    recorderRef.current?.stop();
    setBusyEnd(true);
    try { await api(`/api/meetings/${code}/end`, { method: 'POST' }); onEnded(); } catch { setBusyEnd(false); }
  };

  const remote = useMemo(() => Object.values(room.roster).map((p) => ({ ...p })), [room.roster]);
  const isHost = !!room.meta?.isHost;
  const presenter = screen ? 'me' : remote.find((p) => p.screen)?.id;
  const captionList = Object.entries(room.captions).slice(-3);
  const recordingBy = recorder ? 'You' : remote.find((p) => p.recording)?.name;
  const waitingCount = room.waitingList.length;
  useEffect(() => { if (isHost && waitingCount > 0) setPanel('people'); }, [isHost, waitingCount]); // surface new join requests

  if (room.status === 'error') {
    return (
      <div className="center-screen"><div className="card">
        <h2>{room.needsPassword ? 'Password needed' : 'Can\'t join this meeting'}</h2><p>{room.error}</p>
        <button className="btn primary" onClick={() => (room.needsPassword && onBack ? onBack() : onLeave())}>{room.needsPassword ? 'Enter password' : 'Back to home'}</button>
      </div></div>
    );
  }
  if (room.status === 'waiting') {
    return (
      <div className="center-screen"><div className="card">
        <h2>Waiting for the host</h2><p className="muted">You will join as soon as the host lets you in. Keep this page open.</p>
        <button className="btn" onClick={() => onLeave()}>Cancel</button>
      </div></div>
    );
  }

  const meTile = (
    <VideoTile key="me" local speaking={speaking.has('me')} stream={screen || blurStream || stream} name={user.name} audio={micOn} video={screen ? true : camOn} screen={!!screen} hand={handUp} spotlight={presenter === 'me'} />
  );
  const tiles = [meTile, ...remote.map((p) => (
    <VideoTile key={p.id} speaking={speaking.has(p.id)} stream={room.streams[p.id]} name={p.name} audio={p.audio} video={p.video || p.screen} screen={p.screen} hand={p.hand} spotlight={presenter === p.id} />
  ))];
  const count = remote.length + 1;

  const CtrlBtn = ({ on = true, danger, label, onClick, children, badge }) => (
    <button className={`ctrl ${on ? '' : 'off'} ${danger ? 'danger' : ''}`} onClick={onClick} aria-label={label} title={label} aria-pressed={!on}>
      {children}{badge ? <span className="badge">{badge}</span> : null}
    </button>
  );

  return (
    <div className="room">
      <header className="room-top">
        <div className="room-title"><b>{room.meta?.title || 'Meeting'}</b><span className="muted">{code}</span></div>
        <div className="room-top-right">
          {room.status === 'reconnecting' && <span className="pill warn">Reconnecting…</span>}
          {room.status === 'connecting' && <span className="pill">Connecting…</span>}
          {room.locked && <span className="pill"><Lock size={12} /> Locked</span>}
          <button className="chip" onClick={() => setInviteOpen(true)}><UserPlus size={14} /> Invite</button>
        </div>
      </header>

      {recordingBy && <div className="rec-banner" role="status"><Circle size={10} fill="currentColor" /> {recordingBy === 'You' ? 'You are recording this meeting' : `${recordingBy} is recording this meeting`}. By staying you consent to being recorded.</div>}
      {notice && <div className="notice-bar" role="status">{notice}<button className="icon-btn sm" onClick={() => setNotice('')} aria-label="Dismiss"><X size={14} /></button></div>}

      <div className="room-body">
        <main className={`stage ${presenter ? 'has-spot' : ''} n${Math.min(count, 6)}`}>
          {tiles}
          {prefs.on && captionList.length > 0 && (
            <div className={`captions size-${prefs.size}`} aria-live="polite">
              {captionList.map(([id, c]) => {
                const tr = room.captionLang && c.translated;
                return (
                  <p key={id}>
                    <b>{c.name}</b> {tr ? c.translated : c.text}
                    {tr && prefs.showOriginal && <small className="orig">{c.text}</small>}
                  </p>
                );
              })}
            </div>
          )}
          {wbOpen && (
            <div className="wb-overlay">
              <Whiteboard strokes={room.strokes} selfUid={user.uid} isHost={isHost} onStroke={room.sendStroke} onUndo={room.undoStroke} onClear={room.clearBoard} onClose={() => setWbOpen(false)} />
            </div>
          )}
          <div className="reactions">{room.reactions.map((r) => <span key={r.key} title={r.name}>{r.emoji}</span>)}</div>
        </main>

        {panel && (
          <aside className="side" aria-label={PANELS[panel]}>
            <div className="side-head"><h3>{PANELS[panel]}</h3><button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close panel"><X size={18} /></button></div>
            {panel === 'chat' && <ChatPanel messages={room.chat} files={room.files} selfUid={user.uid} onSend={room.sendChat} onSendFile={room.sendFile} />}
            {panel === 'ai' && <AIPanel code={code} onShare={room.sendChat} />}
            {panel === 'transcript' && <TranscriptPanel lines={room.transcript} selfUid={user.uid} lang={lang} onLang={setLang} supported={speech.supported} engine={speech.engine} error={speech.error} micOn={micOn} translations={room.translations} translating={!!room.captionLang} />}
            {panel === 'people' && <PeoplePanel me={{ name: user.name, isHost, state: { audio: micOn, video: camOn, hand: handUp } }} roster={room.roster} isHost={isHost} locked={room.locked} waitingList={room.waitingList} onAdmit={room.admit} onDeny={room.deny} onMute={room.muteUser} onMuteAll={room.muteAll} onRemove={(id) => window.confirm('Remove this person from the meeting? They will not be able to rejoin.') && room.removeUser(id)} onLock={room.setLock} />}
          </aside>
        )}
      </div>

      <footer className="controls">
        <div className="ctrl-group">
          <CtrlBtn on={micOn} label={micOn ? 'Mute' : 'Unmute'} onClick={toggleMic}>{micOn ? <Mic size={20} /> : <MicOff size={20} />}</CtrlBtn>
          <CtrlBtn on={camOn} label={camOn ? 'Turn camera off' : 'Turn camera on'} onClick={toggleCam}>{camOn ? <Video size={20} /> : <VideoOff size={20} />}</CtrlBtn>
          {canShareScreen && <CtrlBtn on={!screen} label={screen ? 'Stop sharing' : 'Share screen'} onClick={screen ? stopShare : startShare}>{screen ? <MonitorOff size={20} /> : <MonitorUp size={20} />}</CtrlBtn>}
          <CtrlBtn on={!wbOpen} label={wbOpen ? 'Back to video' : 'Whiteboard'} onClick={() => setWbOpen(!wbOpen)}><PenTool size={20} /></CtrlBtn>
          {!!cameraTrack && blurSupported() && <CtrlBtn on={!blur} label={blur ? 'Turn off background blur' : 'Blur my background'} onClick={toggleBlur}>{blurBusy ? <span className="spin" aria-hidden="true" /> : <ScanFace size={20} />}</CtrlBtn>}
          {isHost && recordingSupported() && <CtrlBtn on={!recorder} danger={!!recorder} label={recorder ? 'Stop recording' : 'Record meeting (saved to this computer)'} onClick={recorder ? stopRec : startRec}><Circle size={20} fill={recorder ? 'currentColor' : 'none'} /></CtrlBtn>}
          <div className="emoji-wrap">
            <CtrlBtn on={prefs.on && !ccMenu} label="Captions and translation" onClick={() => setCcMenu(!ccMenu)}><Captions size={20} /></CtrlBtn>
            {ccMenu && (
              <div className="cc-menu" role="dialog" aria-label="Caption settings">
                <label className="switch"><input type="checkbox" checked={prefs.on} onChange={(e) => updatePrefs({ on: e.target.checked })} /> Show live captions</label>
                <label className="field">Translate captions into
                  <select value={room.captionLang} onChange={(e) => pickCaptionLang(e.target.value)}>
                    <option value="">Original language (no translation)</option>
                    {TRANSLATE_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                {room.captionLang && !room.translationAvailable && <p className="notice">Translation is unavailable: the server has no GROQ_API_KEY.</p>}
                <label className="switch"><input type="checkbox" checked={prefs.showOriginal} onChange={(e) => updatePrefs({ showOriginal: e.target.checked })} disabled={!room.captionLang} /> Also show original text</label>
                <div className="sizes" role="group" aria-label="Caption size">
                  Size {[['s', 'A'], ['m', 'A'], ['l', 'A']].map(([k, l]) => <button key={k} className={`sz sz-${k} ${prefs.size === k ? 'on' : ''}`} onClick={() => updatePrefs({ size: k })} aria-label={`Size ${k}`}>{l}</button>)}
                </div>
                <p className="muted">Captions are transcribed in each speaker's own language, then translated for you.</p>
              </div>
            )}
          </div>
          <CtrlBtn on={!handUp} label={handUp ? 'Lower hand' : 'Raise hand'} onClick={toggleHand}><Hand size={20} /></CtrlBtn>
          <div className="emoji-wrap">
            <CtrlBtn label="Reactions" onClick={() => setEmojiOpen(!emojiOpen)}><Smile size={20} /></CtrlBtn>
            {emojiOpen && <div className="emoji-pop">{EMOJI.map((e) => <button key={e} onClick={() => { room.react(e); setEmojiOpen(false); }}>{e}</button>)}</div>}
          </div>
        </div>
        <div className="ctrl-group">
          <CtrlBtn on={panel !== 'chat'} label="Chat" onClick={() => setPanel(panel === 'chat' ? null : 'chat')}><MessageSquare size={20} /></CtrlBtn>
          <CtrlBtn on={panel !== 'ai'} label="AI assistant" onClick={() => setPanel(panel === 'ai' ? null : 'ai')}><Sparkles size={20} /></CtrlBtn>
          <CtrlBtn on={panel !== 'transcript'} label="Live transcript" onClick={() => setPanel(panel === 'transcript' ? null : 'transcript')}><FileText size={20} /></CtrlBtn>
          <CtrlBtn on={panel !== 'people'} label="People" onClick={() => setPanel(panel === 'people' ? null : 'people')} badge={isHost && waitingCount ? `+${waitingCount}` : count}><Users size={20} /></CtrlBtn>
        </div>
        <div className="ctrl-group">
          <CtrlBtn danger label="Leave meeting" onClick={leave}><LogOut size={20} /></CtrlBtn>
          {isHost && <CtrlBtn danger label="End meeting for everyone" onClick={() => setConfirmEnd(true)}><PhoneOff size={20} /></CtrlBtn>}
        </div>
      </footer>

      {inviteOpen && <InviteModal code={code} title={room.meta?.title || info?.title || 'Meeting'} scheduledFor={info?.scheduledFor} hasPassword={info?.hasPassword} isHost={isHost} emailEnabled={info?.emailEnabled} onClose={() => setInviteOpen(false)} />}

      {confirmEnd && (
        <div className="modal-bg" role="dialog" aria-modal="true">
          <div className="card">
            <h3>End meeting for everyone?</h3>
            <p className="muted">Everyone is disconnected and MeetSphere AI prepares the summary, highlights and action items from the transcript.</p>
            <div className="row">
              <button className="btn" onClick={() => setConfirmEnd(false)}>Cancel</button>
              <button className="btn danger" onClick={endForAll} disabled={busyEnd}>{busyEnd ? 'Ending…' : 'End for all'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
