import { useEffect, useState } from 'react';

export function useMediaQuery(query) {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Horizontal room the floating sheet takes on desktop, so the map keeps its points clear of it. */
export function useSheetOffset() {
  return useMediaQuery('(min-width: 1024px)') ? 470 : 0;
}

/**
 * Map-first page: the map is the stage and the UI floats on a sheet.
 * Desktop: full-height map with the sheet docked left. Phone/tablet: map on top, sheet slides up over it.
 */
export default function CanvasLayout({ map, children }) {
  return (
    <div className="relative lg:h-[calc(100dvh-4rem)]">
      <div className="relative h-[44vh] min-h-[300px] md:h-[52vh] lg:absolute lg:inset-0 lg:h-auto">{map}</div>
      <section className="relative z-10 -mt-7 lg:absolute lg:bottom-5 lg:left-5 lg:top-5 lg:mt-0 lg:w-[440px]">
        <div className="sheet min-h-[56vh] rounded-b-none pb-28 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:rounded-b-[28px] lg:pb-6">
          <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-line lg:hidden" aria-hidden />
          <div className="mx-auto max-w-xl animate-rise px-5 pt-5 sm:px-7 lg:px-6">{children}</div>
        </div>
      </section>
    </div>
  );
}
