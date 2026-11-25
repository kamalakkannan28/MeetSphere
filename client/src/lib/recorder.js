/**
 * Local meeting recorder (host only). Composes every visible participant tile into one canvas
 * and mixes all audio tracks (you + everyone else) into one stream, then records it with MediaRecorder.
 * Nothing is uploaded: the file is saved to the host's computer when recording stops.
 */
const pickMime = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';

export const recordingSupported = () => !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && (window.AudioContext || window.webkitAudioContext));

export function createRecorder({ getTiles, getAudioTracks, onStop }) {
  const W = 1280, H = 720;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const AC = window.AudioContext || window.webkitAudioContext;
  const audio = new AC();
  audio.resume?.();
  const dest = audio.createMediaStreamDestination();
  const connected = new Set();

  const syncAudio = () => {
    for (const t of getAudioTracks()) {
      if (t.readyState === 'live' && !connected.has(t.id)) {
        connected.add(t.id);
        try { audio.createMediaStreamSource(new MediaStream([t])).connect(dest); } catch { /* track not usable */ }
      }
    }
  };

  const draw = () => {
    ctx.fillStyle = '#0e1224';
    ctx.fillRect(0, 0, W, H);
    const tiles = getTiles();
    if (!tiles.length) return;
    const cols = Math.ceil(Math.sqrt(tiles.length));
    const rows = Math.ceil(tiles.length / cols);
    const cw = W / cols, ch = H / rows, pad = 6;
    tiles.forEach((t, i) => {
      const x = (i % cols) * cw + pad, y = Math.floor(i / cols) * ch + pad, w = cw - pad * 2, h = ch - pad * 2;
      ctx.fillStyle = '#171c35';
      ctx.fillRect(x, y, w, h);
      const v = t.video;
      if (!t.off && v && v.videoWidth > 0) {
        const s = Math.min(w / v.videoWidth, h / v.videoHeight);
        const dw = v.videoWidth * s, dh = v.videoHeight * s;
        ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      } else {
        const r = Math.min(w, h) * 0.18;
        ctx.fillStyle = '#2b3dff';
        ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = `700 ${r}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((t.name || '?')[0].toUpperCase(), x + w / 2, y + h / 2);
      }
      ctx.font = '600 20px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const label = t.name || '';
      const tw = ctx.measureText(label).width + 16;
      ctx.fillStyle = 'rgba(8,10,24,.7)'; ctx.fillRect(x + 8, y + h - 36, tw, 28);
      ctx.fillStyle = '#fff'; ctx.fillText(label, x + 16, y + h - 15);
    });
  };

  syncAudio(); draw();
  const timer = setInterval(() => { syncAudio(); draw(); }, 66);

  const out = new MediaStream([...canvas.captureStream(15).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = pickMime();
  const rec = new MediaRecorder(out, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    clearInterval(timer);
    audio.close().catch(() => {});
    onStop(new Blob(chunks, { type: rec.mimeType || 'video/webm' }));
  };
  rec.start(1000);
  return { stop: () => { if (rec.state !== 'inactive') rec.stop(); } };
}

export function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
