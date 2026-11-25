import { useEffect, useState } from 'react';
import { X, Copy, Check, CalendarPlus, Download, Mail, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { inviteLink, googleCalendarUrl, downloadIcs, mailtoInvite } from '../lib/calendar.js';

/** Invite people: copy link, add to calendar (Google / .ics), email invitations. */
export default function InviteModal({ code, title, scheduledFor, hasPassword, isHost, canCreateLink = isHost, initialLink = '', emailEnabled, onClose }) {
  const [copied, setCopied] = useState(false);
  const [emails, setEmails] = useState('');
  const [status, setStatus] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [secureLink, setSecureLink] = useState(initialLink);
  const [linkError, setLinkError] = useState('');
  useEffect(() => {
    if (!canCreateLink || initialLink) return;
    let active = true;
    api(`/api/meetings/${code}/invitation`, { method: 'POST' }).then((r) => { if (active) setSecureLink(r.link); }).catch((e) => { if (active) setLinkError(e.message); });
    return () => { active = false; };
  }, [code, canCreateLink, initialLink]);
  const link = secureLink;
  const canShareLink = canCreateLink || !!initialLink;
  const ev = { title, code, scheduledFor };

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); } catch { /* clipboard blocked */ }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };
  const send = async (e) => {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).filter(Boolean);
    if (!list.length) return setStatus({ type: 'error', text: 'Enter at least one email address.' });
    setBusy(true); setStatus({ type: '', text: '' });
    try {
      const r = await api(`/api/meetings/${code}/invite`, { method: 'POST', body: { emails: list } });
      setStatus({ type: 'ok', text: `Invitation sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}.` });
      setEmails('');
    } catch (err) { setStatus({ type: 'error', text: err.message }); }
    setBusy(false);
  };

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Invite people" onClick={onClose}>
      <div className="card invite" onClick={(e) => e.stopPropagation()}>
        <div className="invite-head"><h3>Invite people</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <p className="muted">{title}{scheduledFor ? ` · ${new Date(scheduledFor).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</p>

        {canShareLink ? <div className="copy-row">
          <input readOnly value={link || (linkError ? 'Could not create an invitation' : 'Creating secure invitation…')} aria-label="Invite link" onFocus={(e) => e.target.select()} />
          <button className="btn" type="button" onClick={copy} disabled={!link}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}</button>
        </div> : <p className="notice">Ask the host to create a secure guest invitation link.</p>}
        {link && <p className="muted">This invitation expires in 24 hours.</p>}
        {hasPassword && <p className="notice">This meeting has a password. Share it separately; it is not included in the link.</p>}

        <h4>Add to calendar</h4>
        <div className="row">
          <a className="btn" href={link ? googleCalendarUrl({ ...ev, link }) : undefined} target="_blank" rel="noreferrer" aria-disabled={!link}><CalendarPlus size={16} /> Google Calendar</a>
          <button className="btn" type="button" onClick={() => downloadIcs({ ...ev, link })} disabled={!link}><Download size={16} /> Download .ics</button>
        </div>

        <h4>Email invitation</h4>
        {isHost && emailEnabled && (
          <form onSubmit={send} className="invite-form">
            <textarea value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@example.com, another@example.com" rows={2} aria-label="Email addresses" />
            <button className="btn primary" disabled={busy}><Send size={16} /> {busy ? 'Sending…' : 'Send from MeetSphere'}</button>
          </form>
        )}
        {canShareLink && <a className="btn" href={mailtoInvite({ ...ev, link, hasPassword })}><Mail size={16} /> Open in my email app</a>}
        {isHost && !emailEnabled && <p className="muted">Sending directly from MeetSphere needs SMTP settings on the server (see README).</p>}
        {status.text && <p className={status.type === 'ok' ? 'ok' : 'error'} role="status">{status.text}</p>}
      </div>
    </div>
  );
}
