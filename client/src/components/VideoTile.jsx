import { useEffect, useRef } from 'react';
import { MicOff, Hand, MonitorUp } from 'lucide-react';

export default function VideoTile({ stream, name, local = false, audio = true, video = true, screen = false, hand = false, spotlight = false, speaking = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null;
  }, [stream]);

  const showVideo = !!stream && video;
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className={`tile ${spotlight ? 'tile-spot' : ''} ${speaking ? 'speaking' : ''}`} data-name={name} data-off={showVideo ? '0' : '1'}>
      <video ref={ref} autoPlay playsInline muted={local}
        className={`${local && !screen ? 'mirror' : ''} ${screen ? 'contain' : ''}`} style={{ opacity: showVideo ? 1 : 0 }} />
      {!showVideo && <div className="avatar" aria-hidden="true">{initials}</div>}
      <div className="tile-label">
        {!audio && <MicOff size={14} />}
        {screen && <MonitorUp size={14} />}
        <span>{local ? `${name} (You)` : name}</span>
      </div>
      {hand && <div className="tile-hand" title="Hand raised"><Hand size={18} /></div>}
    </div>
  );
}
