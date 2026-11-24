import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Pause, Play } from 'lucide-react';
import LiveMap from '../components/LiveMap.jsx';
import SlideToConfirm from '../components/SlideToConfirm.jsx';
import { useMediaQuery } from '../components/CanvasLayout.jsx';
import { ContactCard, FareTicket } from '../components/RideParts.jsx';
import { useCountUp } from '../components/ui.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import PublicHeader from '../components/PublicHeader.jsx';
import { useScrollToHash } from '../hooks/useScrollToHash.js';
import { useAuth } from '../context/AuthContext.jsx';
import { getPublicPricing } from '../services/api.js';

const FROM = { name: 'MG Road', latitude: 12.9756, longitude: 77.6068 };
// Real Bengaluru destinations for the hero tour.
const PLACES = [
  { word: 'there', name: 'Indiranagar', latitude: 12.9784, longitude: 77.6408 },
  { word: 'the airport', name: 'Kempegowda Airport', latitude: 13.1986, longitude: 77.7066 },
  { word: 'Koramangala', name: 'Koramangala', latitude: 12.9352, longitude: 77.6245 },
  { word: 'the office', name: 'Whitefield', latitude: 12.9698, longitude: 77.75 },
  { word: 'the park', name: 'Cubbon Park', latitude: 12.9763, longitude: 77.5929 },
];
const TOUR_MS = 5200;

const toRad = (d) => (d * Math.PI) / 180;
const haversine = (a, b) => {
  const dLat = toRad(b.latitude - a.latitude); const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
/** Rough, clearly-labelled estimate for the showcase only (real fares use road routing). */
function roughFare(pricing, to) {
  const km = haversine(FROM, to) * 1.3;
  const min = Math.ceil((km / 25) * 60);
  return { km, min, total: Math.round(pricing.base_fare + km * pricing.per_km_rate + min * pricing.per_minute_rate) };
}

/** Fades and lifts sections into view as you scroll. */
function Reveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

/** The hero ticket tilts towards the pointer. */
function useTilt() {
  const ref = useRef(null);
  const onMove = (e) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / r.width;
    const y = (e.clientY - (r.top + r.height / 2)) / r.height;
    el.style.transform = `perspective(900px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) rotate(-2deg)`;
  };
  const onLeave = () => { if (ref.current) ref.current.style.transform = 'perspective(900px) rotate(-2deg)'; };
  return { ref, onMove, onLeave };
}

function HeroTicket({ pricing, place, ref }) {
  const fare = pricing ? roughFare(pricing, place) : null;
  const total = useCountUp(fare?.total ?? 0);
  if (!fare) return null;
  return (
    <div ref={ref} className="w-80 rounded-[28px] bg-paper p-6 text-ink shadow-2xl transition-transform duration-300 ease-out" style={{ transform: 'perspective(900px) rotate(-2deg)' }}>
      <div className="flex items-center justify-between text-xs text-[#747C89]">
        <span className="font-medium uppercase tracking-[0.14em]">MG Road → {place.name.split(' ')[0]}</span>
      </div>
      <p className="num mt-4 text-6xl font-semibold leading-none">₹{Math.round(total)}</p>
      <p className="mt-2 text-xs text-[#747C89]">≈ {fare.km.toFixed(1)} km · {fare.min} min · rough estimate</p>
      <div className="relative my-5 border-t-2 border-dashed border-[#E4E0D5]">
        <span className="absolute -left-9 -top-3 h-6 w-6 rounded-full bg-night" /><span className="absolute -right-9 -top-3 h-6 w-6 rounded-full bg-night" />
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between"><dt className="text-[#434A57]">Base fare</dt><dd className="num font-medium">₹{pricing.base_fare}</dd></div>
        <div className="flex justify-between"><dt className="text-[#434A57]">{fare.km.toFixed(1)} km × ₹{pricing.per_km_rate}</dt><dd className="num font-medium">₹{Math.round(fare.km * pricing.per_km_rate)}</dd></div>
        <div className="flex justify-between"><dt className="text-[#434A57]">{fare.min} min × ₹{pricing.per_minute_rate}</dt><dd className="num font-medium">₹{fare.min * pricing.per_minute_rate}</dd></div>
      </dl>
    </div>
  );
}

function Slider({ label, value, set, min, max, unit }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-sm"><span className="text-fg-soft">{label}</span><span className="num text-base font-semibold">{value} {unit}</span></span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value))}
        className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-line accent-[#2F5BFF]" />
    </label>
  );
}

function Calculator({ pricing }) {
  const [kmV, setKm] = useState(8);
  const [minV, setMin] = useState(20);
  const total = pricing ? Math.round(pricing.base_fare + kmV * pricing.per_km_rate + minV * pricing.per_minute_rate) : 0;
  const shown = useCountUp(total);
  if (!pricing) return <p className="text-sm text-muted">Live rates are unavailable right now (is the API running?).</p>;
  const parts = [pricing.base_fare, kmV * pricing.per_km_rate, minV * pricing.per_minute_rate];
  const colors = ['#0E1116', '#2F5BFF', '#D7FF3C'];
  return (
    <div className="grid gap-10 md:grid-cols-[1fr_1.1fr] md:items-center">
      <div className="space-y-8">
        <Slider label="Distance" value={kmV} set={setKm} min={1} max={30} unit="km" />
        <Slider label="Time on the road" value={minV} set={setMin} min={3} max={90} unit="min" />
      </div>
      <div className="rounded-[28px] bg-surface p-6 ring-1 ring-line sm:p-8">
        <p className="mono text-muted">₹{pricing.base_fare} + {kmV} × ₹{pricing.per_km_rate} + {minV} × ₹{pricing.per_minute_rate}</p>
        <p className="num mt-4 text-7xl font-semibold leading-none sm:text-8xl">₹{Math.round(shown)}</p>
        {/* where the money goes, as a live stacked bar */}
        <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          {parts.map((p, i) => <span key={i} className="h-full transition-[width] duration-500" style={{ width: `${(p / total) * 100}%`, background: colors[i] }} />)}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {['Base', 'Distance', 'Time'].map((l, i) => <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: colors[i] }} />{l} ₹{Math.round(parts[i])}</span>)}
        </div>
      </div>
    </div>
  );
}

const STORY = [
  ['Pick your route', 'Search a place, use your location, or just tap the map. Nothing is booked until both ends are confirmed.'],
  ['See the working', 'Base, distance and time, line by line, before you commit. The total is the total.'],
  ['Nearest driver first', 'We ask one driver at a time, closest first, and move on in seconds if they pass.'],
];
const STORY_MS = 4500;

/** "How it works" as a small auto-playing story, built from the real app components. */
function Story({ pricing }) {
  const [step, setStep] = useState(0);
  const [tick, setTick] = useState(0); // restarts the progress bar animation
  useEffect(() => {
    const t = setTimeout(() => { setStep((s) => (s + 1) % STORY.length); setTick((k) => k + 1); }, STORY_MS);
    return () => clearTimeout(t);
  }, [step, tick]);
  const go = (i) => { setStep(i); setTick((k) => k + 1); };
  const example = pricing && {
    distance_km: 8, duration_minutes: 20, estimated_fare: pricing.base_fare + 8 * pricing.per_km_rate + 20 * pricing.per_minute_rate,
    breakdown: { base_fare: pricing.base_fare, per_km_rate: pricing.per_km_rate, per_minute_rate: pricing.per_minute_rate, distance_charge: 8 * pricing.per_km_rate, time_charge: 20 * pricing.per_minute_rate },
  };
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-center">
      <ol className="space-y-3">
        {STORY.map(([title, text], i) => (
          <li key={title}>
            <button onClick={() => go(i)} className={`w-full rounded-3xl p-5 text-left transition ${step === i ? 'bg-surface ring-1 ring-line shadow-sm' : 'opacity-60 hover:opacity-100'}`} aria-current={step === i}>
              <div className="flex items-baseline gap-3">
                <span className="serif text-2xl text-muted">0{i + 1}</span>
                <h3 className="text-xl font-semibold">{title}</h3>
              </div>
              {step === i && <p className="mt-2 animate-rise text-[15px] leading-relaxed text-fg-soft">{text}</p>}
              <div className="mt-4 h-1 overflow-hidden rounded-full bg-line">
                {step === i && <span key={tick} className="block h-full w-full origin-left rounded-full bg-accent" style={{ animation: `growx ${STORY_MS}ms linear both` }} />}
              </div>
            </button>
          </li>
        ))}
      </ol>
      <div className="relative min-h-[360px] overflow-hidden rounded-[32px] bg-surface-2 p-5 ring-1 ring-line sm:p-8">
        <div key={step} className="animate-pop">
          {step === 0 && (
            <div className="h-80 overflow-hidden rounded-3xl">
              <LiveMap fill interactive={false} pickup={FROM} destination={PLACES[0]} animateDriver />
            </div>
          )}
          {step === 1 && example && <div className="mx-auto max-w-sm pt-6"><FareTicket fare={example} /><p className="mt-3 text-center text-xs text-muted">Example: 8 km, 20 min, at today’s published rates</p></div>}
          {step === 2 && (
            <div className="mx-auto max-w-sm space-y-4 pt-4">
              <div className="flex items-center gap-5 rounded-3xl bg-surface p-5 ring-1 ring-line">
                <div className="relative grid h-16 w-16 shrink-0 place-items-center">
                  <span className="absolute inset-0 animate-radar rounded-full border-2 border-accent/60" />
                  <span className="absolute inset-0 animate-radar rounded-full border-2 border-accent/40 [animation-delay:0.8s]" />
                  <svg viewBox="0 0 28 26" className="relative h-7 w-8"><path d="M14 2 26.5 23.5h-25Z" fill="#2F5BFF" /></svg>
                </div>
                <div><p className="text-sm font-semibold">Asking the nearest driver…</p><p className="text-xs text-muted">30 seconds each, then the next</p></div>
              </div>
              <div className="animate-rise [animation-delay:1.4s]">
                <ContactCard title="Example driver" person={{ name: 'Asha R.' }} vehicle={{ vehicle_model: 'Maruti Swift Dzire', vehicle_registration: 'KA01 AB 1234' }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const TICKER = ['Nearest driver first', 'Itemised fares', 'Live driver on the map', 'Slide-to-confirm for drivers', 'Recent places in one tap', 'Night cockpit', 'Share your trip', 'Tap the map to book'];

export default function Landing() {
  const { me } = useAuth();
  useScrollToHash();
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [pricing, setPricing] = useState(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const { ref: tiltRef, onMove, onLeave } = useTilt();
  // The map frames each route to the right of the text column, wherever that column ends on this screen.
  const textRef = useRef(null);
  const [textEdge, setTextEdge] = useState(620);
  useEffect(() => {
    const el = textRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setTextEdge(Math.round(el.getBoundingClientRect().right) + 24));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { getPublicPricing().then(setPricing).catch(() => setPricing(null)); }, []);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setTimeout(() => setIdx((i) => (i + 1) % PLACES.length), TOUR_MS);
    return () => clearTimeout(t);
  }, [idx, playing]);
  const home = me ? (me.profile.needs_onboarding ? '/onboarding' : `/${me.user.role}/dashboard`) : null;
  const place = PLACES[idx];
  const pick = (i) => { setIdx(i); setPlaying(false); };

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas">
      {/* Hero: a live tour of real Bengaluru routes */}
      <section className="theme-night relative overflow-hidden bg-canvas text-fg" onMouseMove={onMove} onMouseLeave={onLeave}>
        <div className="absolute inset-0">
          <LiveMap fill night interactive={false} smoothFit animateDriver pickup={FROM} destination={place} pickupLabel="MG Road" fitLeft={wide ? textEdge : 0} />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-night via-night/80 to-night/0 lg:via-night/70" />
        {/* Phones and tablets: the text spans the full width, so dim the whole map behind it for legibility. */}
        <div className="pointer-events-none absolute inset-0 bg-night/85 lg:hidden" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-night to-transparent" />

        <div className="relative wrap-wide">
          <PublicHeader />

          <div className="grid items-end gap-12 pb-16 pt-10 sm:pb-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:pb-24 lg:pt-16">
            <div ref={textRef} className="animate-rise">
              <p className="chip"><span className="h-2 w-2 animate-pulse rounded-full bg-volt" /> Live in Bengaluru · demo</p>
              <h1 className="mt-6 text-[44px] font-semibold leading-[0.98] sm:text-[72px] xl:text-[88px] 2xl:text-[96px]">
                The shortest distance between you and{' '}
                <span className="relative inline-block min-w-[3ch] align-bottom" aria-live="polite">
                  <span key={place.word} className="serif inline-block animate-rise text-volt">{place.word}.</span>
                </span>
              </h1>
              <p className="mt-6 max-w-lg text-lg text-fg-soft">
                Delta finds the closest driver, shows exactly how your fare is built, and keeps you posted from pickup to drop-off.
              </p>

              {/* Try a destination: drives the map and the ticket. Hidden on phones, where it crowds the hero. */}
              <div className="mt-8 hidden sm:block">
                <div className="mb-3 flex items-center gap-3 text-xs text-muted">
                  <span>Try a trip from MG Road</span>
                  <button onClick={() => setPlaying((p) => !p)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 ring-1 ring-line hover:text-fg" aria-label={playing ? 'Pause the tour' : 'Play the tour'}>
                    {playing ? <Pause className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}{playing ? 'Auto' : 'Paused'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PLACES.map((p, i) => (
                    <button key={p.name} onClick={() => pick(i)}
                      className={`relative overflow-hidden rounded-full px-4 py-2 text-sm font-medium ring-1 transition ${i === idx ? 'bg-volt text-ink ring-volt' : 'bg-white/5 text-fg-soft ring-line hover:text-fg'}`}>
                      {i === idx && playing && <span key={idx} className="absolute inset-0 origin-left bg-black/15" style={{ animation: `growx ${TOUR_MS}ms linear both` }} />}
                      <span className="relative">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-9 flex flex-wrap gap-3">
                <Link to={home ?? '/signup?role=passenger'} className="btn-volt btn-lg">Book a ride <ArrowRight className="h-4 w-4" aria-hidden /></Link>
                <Link to="/signup?role=driver" className="btn-outline btn-lg">Drive with Delta</Link>
              </div>

              {/* Quick facts: the promise in numbers */}
              <dl className="mt-12 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-3xl bg-white/10 ring-1 ring-white/10 sm:grid-cols-4">
                {[
                  [pricing ? `₹${pricing.base_fare}` : '₹40', 'base fare'],
                  [pricing ? `₹${pricing.per_km_rate}/km` : '₹12/km', `+ ₹${pricing?.per_minute_rate ?? 2}/min, itemised`],
                  ['30 s', 'per driver, nearest first'],
                  ['Live', 'tracking, chat & trip sharing'],
                ].map(([value, label]) => (
                  <div key={label} className="bg-night/70 px-4 py-3.5 backdrop-blur">
                    <dt className="sr-only">{label}</dt>
                    <dd className="num text-xl font-semibold text-white">{value}</dd>
                    <dd className="text-xs leading-snug text-white/60">{label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {pricing && (
              <aside className="hidden justify-self-end lg:block" aria-label="Rough fare for the selected trip">
                <HeroTicket pricing={pricing} place={place} ref={tiltRef} />
              </aside>
            )}
          </div>
        </div>
      </section>

      {/* Ticker */}
      <div className="overflow-hidden border-b border-line bg-volt py-3 text-ink" aria-hidden>
        <div className="flex w-max animate-[marquee_38s_linear_infinite] gap-8 whitespace-nowrap text-sm font-semibold">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="inline-flex items-center gap-8">{t}<svg viewBox="0 0 28 26" className="h-3 w-3.5"><path d="M14 2 26.5 23.5h-25Z" fill="#0E1116" /></svg></span>
          ))}
        </div>
      </div>

      {/* How it works */}
      <section id="how-it-works" className="wrap scroll-mt-6 py-24">
        <Reveal className="mb-12 max-w-2xl">
          <p className="text-sm text-muted">How it works</p>
          <h2 className="mt-2 text-4xl font-semibold leading-tight sm:text-5xl">Three taps from <span className="serif text-accent">here</span> to there.</h2>
        </Reveal>
        <Reveal delay={120}><Story pricing={pricing} /></Reveal>
      </section>

      {/* Fare calculator */}
      <section id="pricing" className="scroll-mt-6 border-y border-line bg-surface">
        <div className="wrap py-24">
          <Reveal className="mb-12 max-w-2xl">
            <p className="text-sm text-muted">Pricing</p>
            <h2 className="mt-2 text-4xl font-semibold leading-tight sm:text-5xl">Fares with <span className="serif text-accent">nothing hidden.</span></h2>
            <p className="mt-4 text-fg-soft">A base fare, a rate per kilometre and a rate per minute, at Delta’s published rates. Slide to see exactly what a trip costs.</p>
          </Reveal>
          <Reveal delay={120}><Calculator pricing={pricing} /></Reveal>
        </div>
      </section>

      {/* Drivers */}
      <section id="drive" className="theme-night scroll-mt-6 bg-canvas text-fg">
        <div className="wrap grid items-center gap-10 py-24 md:grid-cols-2">
          <Reveal>
            <h2 className="text-4xl font-semibold leading-tight sm:text-5xl">Your car. Your hours. <span className="serif text-volt">Your call.</span></h2>
            <p className="mt-4 max-w-md text-fg-soft">Go online when you want, see the fare and the pickup distance before you accept, and watch your week add up in Earnings. Demo drivers are unverified.</p>
          </Reveal>
          <Reveal delay={150} className="w-full max-w-md md:justify-self-end">
            <SlideToConfirm label="Slide to start driving" onConfirm={() => navigate('/signup?role=driver')} />
            <p className="mt-3 text-center text-xs text-muted">Takes you to driver sign-up</p>
          </Reveal>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
