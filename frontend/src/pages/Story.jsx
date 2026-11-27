import { useEffect, useRef } from 'react';
import { Compass, HeartHandshake, Route as RouteIcon, Sparkles } from 'lucide-react';
import { Mark, Wordmark } from '../components/Layout.jsx';
import PublicHeader from '../components/PublicHeader.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { useScrollToHash } from '../hooks/useScrollToHash.js';

/** Fade sections in as they scroll into view (respects reduced motion via the global CSS rule). */
function useReveal() {
  const root = useRef(null);
  useEffect(() => {
    const els = root.current?.querySelectorAll('.reveal') ?? [];
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return root;
}

// Moments from one ordinary day: different people, times and routes, all moving through the same city.
const MOMENTS = [
  ['5:40 AM', 'Meena', 'starts the early shift at the hospital', 'Indiranagar → Victoria Hospital'],
  ['8:15 AM', 'Arjun', 'is racing to the first exam of his final year', 'HSR Layout → Christ University'],
  ['1:30 PM', 'Farah', 'picks up her daughter after school', 'Koramangala → Jayanagar'],
  ['7:05 PM', 'Ravi', 'heads home after a ten-hour shift behind the wheel', 'MG Road → Whitefield'],
  ['9:20 PM', 'Kamala', 'crosses town for her grandson’s birthday dinner', 'Malleshwaram → BTM Layout'],
];

const PILLARS = [
  [Sparkles, 'Smarter', 'You see the whole fare (base, distance, time) before you book, and the nearest driver is asked first. No surprises, no guesswork.'],
  [HeartHandshake, 'More connected', 'Follow your driver live, message them in the app, and share your trip with the people who wait for you to get home.'],
  [Compass, 'More accessible', 'A few taps from where you are to where you need to be, with safety a tap away: 112, trusted contacts and trip alerts.'],
];

const MARK_PARTS = [
  ['The letter D', 'Our identity', 'Bold and grounded. The shape you can recognise from across the street.'],
  ['The journey', 'Endless possibilities', 'A road that winds through the D: every route a little different, every one leading somewhere that matters.'],
  ['Forward motion', 'A smarter tomorrow', 'The open, arrow-like Λ in our name points ahead. There is always a better way forward.'],
];

/** Our story: why Delta exists and what the mark stands for. Public, linked from every menu bar. */
export default function Story() {
  const root = useReveal();
  useScrollToHash();

  return (
    <div ref={root} className="min-h-screen bg-canvas text-fg">
      {/* Hero */}
      <section className="theme-night relative overflow-hidden bg-canvas text-fg">
        <div className="pointer-events-none absolute -right-24 top-10 h-[520px] w-[560px] opacity-[0.07] sm:opacity-10">
          <Mark className="h-full w-full text-white" />
        </div>
        <div className="relative wrap">
          <PublicHeader />
          <div className="max-w-3xl animate-rise pb-24 pt-16 sm:pb-32 sm:pt-24">
            <p className="eyebrow !text-white/60">Our story</p>
            <h1 className="mt-4 text-[44px] font-semibold leading-[1.02] sm:text-[72px]">
              Every journey creates a <span className="serif text-volt">connection.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-white/70">Why we built Delta, and what the road through our D is really about.</p>
          </div>
        </div>
      </section>

      {/* The city */}
      <section className="wrap py-20 sm:py-28">
        <div className="reveal max-w-2xl">
          <p className="eyebrow">The city</p>
          <h2 className="mt-3 text-[34px] font-semibold leading-tight sm:text-[44px]">Imagine a city where millions of people move every day.</h2>
          <p className="mt-5 text-lg text-fg-soft">Everyone has somewhere to go. A different destination, a different schedule, a different route. Look a little closer at a single day and you start to see the people inside those numbers.</p>
        </div>
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {MOMENTS.map(([time, who, what, route], i) => (
            <li key={who} className="reveal card flex flex-col !p-5" style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="mono text-muted">{time}</span>
              <p className="mt-3 text-[15px] leading-snug"><span className="font-semibold">{who}</span> {what}.</p>
              <p className="mt-auto pt-4 text-xs text-muted">{route}</p>
            </li>
          ))}
        </ol>
        <p className="reveal mt-12 max-w-2xl text-2xl font-semibold leading-snug">
          Five people who will never meet. <span className="serif text-accent">Yet all these journeys are connected:</span> by the same roads, the same drivers, the same city waking up and winding down together.
        </p>
      </section>

      {/* More than A to B */}
      <section id="safety" className="scroll-mt-6 border-y border-line bg-surface">
        <div className="wrap py-20 sm:py-28">
          <div className="reveal max-w-2xl">
            <p className="eyebrow">What we believe</p>
            <h2 className="mt-3 text-[34px] font-semibold leading-tight sm:text-[44px]">Transportation should be more than getting from point A to point B.</h2>
            <p className="mt-5 text-lg text-fg-soft">A ride is someone getting to work on time, getting home safely, or getting to the people they love. So it should be:</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {PILLARS.map(([Icon, title, body], i) => (
              <div key={title} className="reveal rounded-3xl bg-surface-2 p-6 ring-1 ring-line" style={{ transitionDelay: `${i * 110}ms` }}>
                <Icon className="h-6 w-6 text-accent" aria-hidden />
                <h3 className="mt-4 text-2xl font-semibold">{title}.</h3>
                <p className="mt-2 text-fg-soft">{body}</p>
              </div>
            ))}
          </div>
          <p className="reveal mt-14 text-center text-3xl font-semibold sm:text-4xl">That’s why we created <Wordmark className="align-baseline" />.</p>
        </div>
      </section>

      {/* The mark */}
      <section id="mark" className="wrap scroll-mt-6 py-20 sm:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div className="reveal flex flex-col items-center gap-8 rounded-[36px] bg-surface p-10 ring-1 ring-line sm:p-14">
            <Mark className="h-44 w-48 sm:h-56 sm:w-64" />
            <Wordmark tagline className="text-[34px] sm:text-[44px]" />
          </div>
          <div className="reveal space-y-5">
            <p className="eyebrow">The mark</p>
            <h2 className="text-[34px] font-semibold leading-tight sm:text-[44px]">A journey that <span className="serif text-accent">connects.</span></h2>
            <p className="text-lg text-fg-soft">Our name comes from delta, Δ, the symbol for change. Our identity imagines a world where journeys never exist in isolation: every route connects people, places and possibilities.</p>
            <p className="text-lg text-fg-soft">The road never breaks as it winds through the D. That continuous form is our belief that there is always a better way forward: a smarter route, a shared journey, or a new connection waiting to happen.</p>
          </div>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {MARK_PARTS.map(([title, sub, body], i) => (
            <div key={title} className="reveal card" style={{ transitionDelay: `${i * 110}ms` }}>
              <p className="flex items-center gap-2 text-sm font-semibold"><RouteIcon className="h-4 w-4 text-accent" aria-hidden />{title}</p>
              <p className="text-xs text-muted">{sub}</p>
              <p className="mt-3 text-fg-soft">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Close */}
      <section className="theme-night bg-canvas text-fg">
        <div className="mx-auto max-w-4xl px-5 py-24 text-center sm:py-32">
          <Mark className="mx-auto h-16 w-[72px] text-white" />
          <p className="reveal mt-8 text-[30px] font-semibold leading-tight sm:text-[44px]">
            DELTA isn’t just about reaching your destination. <span className="serif text-volt">It’s about changing the way you move.</span>
          </p>
          <p className="reveal mt-6 text-white/70">Because at Delta, every journey leads somewhere better: for you, and for the people waiting at the other end.</p>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
