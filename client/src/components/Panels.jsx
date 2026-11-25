import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Download, Share2, Crown, Hand, MicOff, VideoOff, ListChecks, Paperclip, FileText as FileIcon, Lock, LockOpen, UserX, Check, X, VolumeX } from 'lucide-react';
import { api } from '../lib/api.js';

const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

import { SPEECH_LANGS } from '../lib/languages.js';
export const LANGS = SPEECH_LANGS;

function useAutoScroll(dep) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [dep]);
  return ref;
}

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function ChatPanel({ messages, files = [], selfUid, onSend, onSendFile }) {
  const [text, setText] = useState('');
  const [fileMsg, setFileMsg] = useState('');
  const [sending, setSending] = useState(false);
  const picker = useRef(null);
  const items = [...messages, ...files].sort((x, y) => x.ts - y.ts);
  const list = useAutoScroll(items.length);
  const submit = (e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(''); } };
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setSending(true); setFileMsg('');
    const r = await onSendFile(f);
    setSending(false);
    if (!r.ok) setFileMsg(r.error || 'Could not share the file.');
  };
  return (
    <>
      <div className="panel-scroll" ref={list}>
        {items.length === 0 && <p className="muted pad">No messages yet. Say hello.</p>}
        {items.map((m) => (
          <div key={m.id} className={`msg ${m.uid === selfUid ? 'mine' : ''}`}>
            <div className="msg-meta"><b>{m.uid === selfUid ? 'You' : m.name}</b><span>{timeOf(m.ts)}</span></div>
            {m.isFile ? (
              <a className="msg-body file" href={m.url} download={m.fileName}><FileIcon size={18} /><span className="grow"><b>{m.fileName}</b><small>{fmtSize(m.size)} · tap to download</small></span><Download size={16} /></a>
            ) : <div className="msg-body">{m.text}</div>}
          </div>
        ))}
      </div>
      {fileMsg && <p className="notice" role="alert">{fileMsg}</p>}
      <form className="composer" onSubmit={submit}>
        <input ref={picker} type="file" hidden onChange={pick} />
        <button type="button" className="icon-btn" onClick={() => picker.current?.click()} disabled={sending} aria-label="Share a file" title="Share a file (shared live, not saved)"><Paperclip size={18} /></button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message everyone" maxLength={2000} aria-label="Chat message" />
        <button className="icon-btn primary" aria-label="Send"><Send size={18} /></button>
      </form>
    </>
  );
}

export function SummaryView({ s }) {
  if (!s) return null;
  const List = ({ title, items }) => items?.length ? (<><h4>{title}</h4><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></>) : null;
  return (
    <div className="summary">
      {s.summary && <p>{s.summary}</p>}
      <List title="Topics" items={s.topics} />
      <List title="Key highlights" items={s.highlights} />
      <List title="Decisions" items={s.decisions} />
      {s.actionItems?.length > 0 && (<><h4>Action items</h4><ul className="actions">{s.actionItems.map((a, i) => <li key={i}><ListChecks size={14} /> {a.task} <em>{a.owner}</em></li>)}</ul></>)}
    </div>
  );
}

const QUICK = [
  ['Catch me up', 'Catch me up: what has been discussed so far? Keep it brief.'],
  ['Action items', 'List the action items and who owns them, based on the discussion so far.'],
  ['Key points', 'What are the key points and decisions so far?'],
];

export function AIPanel({ code, onShare }) {
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: 'Hi, I\'m MeetSphere AI. I can see the live transcript and chat, so ask me about the meeting, or anything else, without leaving the call.' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useAutoScroll(msgs.length + (busy ? 1 : 0));

  const ask = async (question) => {
    if (!question || busy) return;
    const history = msgs.filter((m) => m.content && !m.summary).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: question }]);
    setBusy(true);
    try {
      const { reply } = await api('/api/ai/chat', { method: 'POST', body: { code, message: question, history } });
      setMsgs((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: e.message, error: true }]);
    }
    setBusy(false);
  };

  const summarize = async () => {
    if (busy) return;
    setMsgs((m) => [...m, { role: 'user', content: 'Summarize the meeting so far' }]);
    setBusy(true);
    try {
      const { summary } = await api('/api/ai/summarize', { method: 'POST', body: { code } });
      setMsgs((m) => [...m, { role: 'assistant', summary, content: '' }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: e.message, error: true }]);
    }
    setBusy(false);
  };

  return (
    <>
      <div className="chips">
        <button className="chip strong" onClick={summarize} disabled={busy}><Sparkles size={14} /> Summarize</button>
        {QUICK.map(([label, q]) => <button key={label} className="chip" onClick={() => ask(q)} disabled={busy}>{label}</button>)}
      </div>
      <div className="panel-scroll" ref={list}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'mine' : 'ai'} ${m.error ? 'err' : ''}`}>
            {m.summary ? <SummaryView s={m.summary} /> : <div className="msg-body pre">{m.content}</div>}
            {m.role === 'assistant' && i > 0 && !m.error && m.content && (
              <button className="link-btn" onClick={() => onShare(`🤖 MeetSphere AI: ${m.content}`)}><Share2 size={13} /> Share to meeting chat</button>
            )}
          </div>
        ))}
        {busy && <div className="msg ai"><div className="msg-body typing">Thinking…</div></div>}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); const q = text.trim(); setText(''); ask(q); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the AI assistant" maxLength={1500} aria-label="Ask AI" />
        <button className="icon-btn primary" aria-label="Ask" disabled={busy}><Send size={18} /></button>
      </form>
    </>
  );
}

export function TranscriptPanel({ lines, selfUid, lang, onLang, supported, engine, error, micOn, translations = {}, translating }) {
  const list = useAutoScroll(lines.length);
  const download = () => {
    const body = lines.map((l) => `[${timeOf(l.ts)}] ${l.name}: ${l.text}`).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    a.download = 'transcript.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <div className="panel-tools">
        <label className="muted">Your speaking language
          <select value={lang} onChange={(e) => onLang(e.target.value)}>{LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <button className="chip" onClick={download} disabled={!lines.length}><Download size={14} /> Save .txt</button>
      </div>
      {!supported && <p className="notice">Live transcription is not available on this device. You can still read everyone else's transcript.</p>}
      {supported && engine === 'cloud' && <p className="notice">Captions for your voice use cloud transcription, so they appear a few seconds after you speak.</p>}
      {error && <p className="notice">{error}</p>}
      {supported && !micOn && <p className="notice">Your microphone is muted, so your speech is not being transcribed.</p>}
      <div className="panel-scroll" ref={list}>
        {lines.length === 0 && <p className="muted pad">Transcript lines appear here as people speak.</p>}
        {lines.map((l) => (
          <div key={l.id} className="line"><span className="muted">{timeOf(l.ts)}</span> <b>{l.uid === selfUid ? 'You' : l.name}</b> {translating && translations[l.id] ? translations[l.id] : l.text}
            {translating && translations[l.id] && <small className="orig">{l.text}</small>}</div>
        ))}
      </div>
    </>
  );
}

export function PeoplePanel({ me, roster, isHost, locked, waitingList = [], onAdmit, onDeny, onMute, onMuteAll, onRemove, onLock }) {
  const others = Object.values(roster);
  const rows = [{ id: 'me', name: `${me.name} (You)`, isHost: me.isHost, self: true, ...me.state }, ...others];
  return (
    <div className="panel-scroll">
      {isHost && waitingList.length > 0 && (
        <div className="waiting">
          <h4>Waiting to join ({waitingList.length})</h4>
          {waitingList.map((w) => (
            <div key={w.id} className="person">
              <span className="dot-avatar">{w.name[0]?.toUpperCase()}</span>
              <span className="grow">{w.name}</span>
              <button className="chip strong" onClick={() => onAdmit(w.id)}><Check size={14} /> Admit</button>
              <button className="chip" onClick={() => onDeny(w.id)} aria-label={`Deny ${w.name}`}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      {isHost && (
        <div className="host-tools">
          <button className={`chip ${locked ? 'strong' : ''}`} onClick={() => onLock(!locked)}>{locked ? <Lock size={14} /> : <LockOpen size={14} />} {locked ? 'Meeting locked' : 'Lock meeting'}</button>
          <button className="chip" onClick={onMuteAll} disabled={!others.length}><VolumeX size={14} /> Mute all</button>
        </div>
      )}
      {!isHost && locked && <p className="notice">The host has locked this meeting. No one new can join.</p>}
      {rows.map((p) => (
        <div key={p.id} className="person">
          <span className="dot-avatar">{p.name[0]?.toUpperCase()}</span>
          <span className="grow">{p.name}</span>
          {p.isHost && <Crown size={15} title="Host" />}
          {p.hand && <Hand size={15} />}
          {!p.audio && <MicOff size={15} />}
          {!p.video && <VideoOff size={15} />}
          {isHost && !p.self && (
            <>
              <button className="icon-btn sm" onClick={() => onMute(p.id)} disabled={!p.audio} aria-label={`Mute ${p.name}`} title="Mute"><MicOff size={15} /></button>
              <button className="icon-btn sm danger-ico" onClick={() => onRemove(p.id)} aria-label={`Remove ${p.name}`} title="Remove from meeting"><UserX size={15} /></button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
