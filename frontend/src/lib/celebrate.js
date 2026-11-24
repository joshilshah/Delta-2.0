// Δ-confetti: a short burst of small triangles for moments worth marking (driver found, trip complete).
// Pure DOM + Web Animations API, no dependency. Skipped entirely when the user prefers reduced motion.

const COLORS = ['#2F5BFF', '#D7FF3C', '#0E1116', '#8FA8FF'];

export function celebrate({ x, y, count = 30 } = {}) {
  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const ox = x ?? window.innerWidth / 2;
  const oy = y ?? window.innerHeight * 0.35;
  for (let i = 0; i < count; i += 1) {
    const el = document.createElement('span');
    const size = 6 + Math.random() * 7;
    const color = COLORS[i % COLORS.length];
    Object.assign(el.style, {
      position: 'fixed', left: `${ox}px`, top: `${oy}px`, width: '0', height: '0', zIndex: '9999', pointerEvents: 'none',
      borderLeft: `${size / 2}px solid transparent`, borderRight: `${size / 2}px solid transparent`, borderBottom: `${size}px solid ${color}`,
    });
    document.body.appendChild(el);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const dist = 90 + Math.random() * 170;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 60;
    const anim = el.animate([
      { transform: 'translate(-50%, -50%) rotate(0deg) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy + 120}px) rotate(${(Math.random() - 0.5) * 720}deg) scale(0.6)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 600, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)' });
    anim.onfinish = () => el.remove();
  }
}
