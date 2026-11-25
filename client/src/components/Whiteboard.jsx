import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Eraser, Undo2, Trash2, Download, X } from 'lucide-react';

const COLORS = ['#111111', '#2b3dff', '#e5322d', '#10a36b', '#f59e0b', '#8a4bff'];
const SIZES = [3, 7, 14];
const REF_WIDTH = 900; // stroke sizes are relative to this width so every screen sees the same drawing

function paint(ctx, w, h, strokes) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.strokeStyle = s.tool === 'eraser' ? '#ffffff' : s.color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = s.size * (w / REF_WIDTH);
    const pts = s.points;
    if (pts.length === 1) {
      ctx.beginPath(); ctx.arc(pts[0][0] * w, pts[0][1] * h, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
    ctx.stroke();
  }
}

/** Shared whiteboard. Strokes are normalised (0-1) so they scale across screen sizes. */
export default function Whiteboard({ strokes, selfUid, isHost, onStroke, onUndo, onClear, onClose }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const live = useRef(null); // stroke being drawn right now
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[0]);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, c.width / dpr, c.height / dpr, live.current ? [...strokesRef.current, live.current] : strokesRef.current);
  }, []);

  useEffect(() => {
    const fit = () => {
      const r = wrap.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.current.width = Math.floor(r.width * dpr);
      canvas.current.height = Math.floor(r.height * dpr);
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(redraw, [strokes, redraw]);

  const pos = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const down = (e) => {
    canvas.current.setPointerCapture(e.pointerId);
    live.current = { id: crypto.randomUUID(), uid: selfUid, tool, color, size: tool === 'eraser' ? size * 2.5 : size, points: [pos(e)] };
    redraw();
  };
  const move = (e) => {
    if (!live.current) return;
    live.current.points.push(pos(e));
    redraw();
  };
  const up = () => {
    const s = live.current;
    live.current = null;
    if (s) onStroke(s);
  };
  const savePng = () => canvas.current.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'whiteboard.png'; a.click(); URL.revokeObjectURL(a.href);
  });

  return (
    <div className="wb">
      <div className="wb-bar">
        <button className={`wb-btn ${tool === 'pen' ? 'on' : ''}`} onClick={() => setTool('pen')} aria-label="Pen" title="Pen"><Pencil size={16} /></button>
        <button className={`wb-btn ${tool === 'eraser' ? 'on' : ''}`} onClick={() => setTool('eraser')} aria-label="Eraser" title="Eraser"><Eraser size={16} /></button>
        <span className="wb-sep" />
        {COLORS.map((c) => <button key={c} className={`wb-color ${color === c && tool === 'pen' ? 'on' : ''}`} style={{ background: c }} onClick={() => { setColor(c); setTool('pen'); }} aria-label={`Colour ${c}`} />)}
        <span className="wb-sep" />
        {SIZES.map((s) => <button key={s} className={`wb-btn ${size === s ? 'on' : ''}`} onClick={() => setSize(s)} aria-label={`Size ${s}`}><span className="wb-dot" style={{ width: s + 3, height: s + 3 }} /></button>)}
        <span className="wb-sep" />
        <button className="wb-btn" onClick={onUndo} aria-label="Undo my last stroke" title="Undo my last stroke"><Undo2 size={16} /></button>
        {isHost && <button className="wb-btn" onClick={onClear} aria-label="Clear board for everyone" title="Clear board for everyone"><Trash2 size={16} /></button>}
        <button className="wb-btn" onClick={savePng} aria-label="Save as image" title="Save as image"><Download size={16} /></button>
        <span className="grow" />
        <button className="wb-btn" onClick={onClose} aria-label="Close whiteboard" title="Back to video"><X size={16} /></button>
      </div>
      <div className="wb-canvas" ref={wrap}>
        <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Shared whiteboard" />
      </div>
    </div>
  );
}
