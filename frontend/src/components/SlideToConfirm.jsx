import { useRef, useState } from 'react';
import { ArrowRight, ChevronsRight } from 'lucide-react';
import { Spinner } from './ui.jsx';

const KNOB = 56;
const PAD = 4;

/**
 * Slide-to-confirm for consequential driver actions (go online, start trip, complete trip):
 * a deliberate gesture that can't happen by accident in a pocket or a bumpy car.
 * Keyboard and screen-reader users press Enter/Space on the handle instead.
 */
export default function SlideToConfirm({ label, onConfirm, busy = false, disabled = false, tone = 'volt' }) {
  const track = useRef(null);
  const drag = useRef(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [range, setRange] = useState(1); // measured on interaction, never during render

  const max = () => (track.current ? track.current.clientWidth - KNOB - PAD * 2 : 1);
  const fire = () => {
    if (busy || disabled) return;
    const m = max();
    setRange(m);
    setX(m);
    Promise.resolve(onConfirm()).finally(() => setX(0));
  };

  const onDown = (e) => {
    if (busy || disabled) return;
    drag.current = { start: e.clientX - x };
    setRange(max());
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.current) return;
    setX(Math.max(0, Math.min(max(), e.clientX - drag.current.start)));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (x >= range * 0.82) fire(); else setX(0);
  };

  const progress = Math.min(1, x / range);
  const knobTone = tone === 'volt' ? 'cta-surface' : tone === 'accent' ? 'bg-accent text-white' : 'bg-success text-white';
  const fillTone = tone === 'volt' ? 'bg-live/20' : tone === 'accent' ? 'bg-accent/20' : 'bg-success/20';

  return (
    <div ref={track} className={`relative h-16 select-none overflow-hidden rounded-full bg-surface-2 ring-1 ring-line ${disabled ? 'opacity-50' : ''}`}>
      <div className={`absolute inset-y-0 left-0 rounded-full ${fillTone} ${dragging ? '' : 'transition-[width] duration-300'}`} style={{ width: x + KNOB + PAD * 2 }} />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 pl-12 text-sm font-semibold text-fg" style={{ opacity: 1 - progress * 1.4 }}>
        {label}
        <ChevronsRight className="h-4 w-4 animate-nudge text-muted" aria-hidden />
      </div>
      <button
        type="button"
        aria-label={`${label}. Press Enter to confirm`}
        disabled={disabled || busy}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } }}
        className={`absolute top-1 grid h-14 w-14 touch-none place-items-center rounded-full shadow-lg ${knobTone} ${dragging ? '' : 'transition-transform duration-300 ease-out'} cursor-grab active:cursor-grabbing`}
        style={{ transform: `translateX(${x + PAD}px)` }}
      >
        {busy ? <Spinner className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" aria-hidden />}
      </button>
    </div>
  );
}
