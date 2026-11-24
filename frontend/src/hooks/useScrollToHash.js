import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Arriving at /page#section (e.g. from the footer): scroll to that section once the lazy page has rendered. */
export function useScrollToHash() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return undefined;
    // Instant jump, retried briefly while the page (lazy chunks, images, map) is still settling its layout.
    let tries = 0;
    const t = setInterval(() => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) el.scrollIntoView({ block: 'start' });
      if (++tries >= 5) clearInterval(t);
    }, 150);
    return () => clearInterval(t);
  }, [hash]);
}
