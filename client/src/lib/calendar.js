const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

export const inviteLink = (code) => `${window.location.origin}/meeting/${code}`;

/** Start/end for a calendar entry: the scheduled time, or "now" for instant meetings (1 hour). */
export function eventTimes(scheduledFor) {
  const start = new Date(scheduledFor || Date.now());
  return { start, end: new Date(start.getTime() + 3_600_000) };
}

export function googleCalendarUrl({ title, code, scheduledFor }) {
  const { start, end } = eventTimes(scheduledFor);
  const p = new URLSearchParams({
    action: 'TEMPLATE', text: title, dates: `${stamp(start)}/${stamp(end)}`,
    details: `Join the MeetSphere meeting: ${inviteLink(code)}`, location: inviteLink(code),
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

export function downloadIcs({ title, code, scheduledFor }) {
  const { start, end } = eventTimes(scheduledFor);
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MeetSphere//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${code}@meetsphere`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(`Join the MeetSphere meeting: ${inviteLink(code)}`)}`, `LOCATION:${esc(inviteLink(code))}`, `URL:${inviteLink(code)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `${code}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function mailtoInvite({ title, code, scheduledFor, hasPassword }) {
  const when = scheduledFor ? `\nWhen: ${new Date(scheduledFor).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}` : '';
  const pw = hasPassword ? '\n(This meeting is password protected. I will send the password separately.)' : '';
  const body = `Join my MeetSphere meeting "${title}".${when}\n${inviteLink(code)}${pw}`;
  return `mailto:?subject=${encodeURIComponent(`Invitation: ${title}`)}&body=${encodeURIComponent(body)}`;
}
