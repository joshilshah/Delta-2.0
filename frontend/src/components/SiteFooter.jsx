import { Link } from 'react-router-dom';
import { ArrowRight, Phone } from 'lucide-react';
import { Mark, Wordmark } from './Layout.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Plain <a> for in-page sections (/#pricing) so the browser handles the scroll; <Link> for app routes.
const COLUMNS = [
  ['Ride', [
    ['Book a ride', '/passenger/book'],
    ['How it works', '/#how-it-works', true],
    ['Fares & pricing', '/#pricing', true],
    ['Your trips', '/passenger/activity'],
  ]],
  ['Drive', [
    ['Drive with Delta', '/#drive', true],
    ['Sign up to drive', '/signup'],
    ['Driver log in', '/login'],
    ['Earnings', '/driver/earnings'],
  ]],
  ['Company', [
    ['Our story', '/story'],
    ['The Delta mark', '/story#mark', true],
  ]],
  ['Safety & help', [
    ['Support centre', '/passenger/support'],
    ['Safety on every ride', '/story#safety', true],
  ]],
];

/** Site-wide footer for the public pages (landing, story). */
export default function SiteFooter() {
  const { me } = useAuth();
  const home = me && !me.profile.needs_onboarding ? `/${me.user.role}/dashboard` : null;

  return (
    <footer className="theme-night border-t border-white/10 bg-canvas text-fg">
      {/* Closing band */}
      <div className="wrap pt-20">
        <div className="flex flex-col items-start justify-between gap-8 border-b border-white/10 pb-14 md:flex-row md:items-end">
          <div>
            <p className="eyebrow !text-white/50">Delta</p>
            <p className="mt-3 max-w-xl text-[34px] font-semibold leading-tight sm:text-[44px]">
              Every journey creates a <span className="serif text-volt">connection.</span>
            </p>
          </div>
          <Link to={home ?? '/signup'} className="btn-volt btn-lg shrink-0">
            {home ? 'Open Delta' : 'Take your first ride'} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>

      {/* Link columns */}
      <div className="wrap grid grid-cols-2 gap-x-6 gap-y-10 py-14 sm:grid-cols-4 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="col-span-2 space-y-4 sm:col-span-4 lg:col-span-1">
          <Link to="/" className="inline-flex items-center gap-3 text-white" aria-label="Delta home">
            <Mark className="h-9 w-10" />
            <Wordmark tagline className="text-[22px]" />
          </Link>
          <p className="max-w-xs text-sm text-white/60">Rides with an itemised fare, the nearest driver first, and live tracking from pickup to drop-off.</p>
          <a href="tel:112" className="inline-flex items-center gap-2 rounded-full bg-danger/15 px-3.5 py-2 text-sm font-semibold text-[#ff8a8d] ring-1 ring-danger/40 transition hover:bg-danger/25">
            <Phone className="h-4 w-4" aria-hidden /> Emergency? Call 112
          </a>
        </div>
        {COLUMNS.map(([title, links]) => (
          <nav key={title} aria-label={title}>
            <p className="text-sm font-semibold text-white">{title}</p>
            <ul className="mt-4 space-y-2.5">
              {links.map(([label, to, anchor]) => (
                <li key={label}>
                  {anchor
                    ? <a href={to} className="text-sm text-white/60 transition hover:text-white">{label}</a>
                    : <Link to={to} className="text-sm text-white/60 transition hover:text-white">{label}</Link>}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      {/* Legal line */}
      <div className="border-t border-white/10">
        <div className="wrap flex flex-col gap-3 py-6 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Delta · Made in Bengaluru · Move smarter</p>
          <p>Hackathon demo: drivers are unverified and fares are estimates. Not a real transport service.</p>
        </div>
      </div>
    </footer>
  );
}
