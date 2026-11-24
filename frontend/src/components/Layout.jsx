import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import ThemeMenu from './ThemeMenu.jsx';
import RideChat from './RideChat.jsx';
import { ArrowRight, Clock3, LogOut, Navigation, UserRound, Wallet, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { LiveProvider, useLiveData } from '../context/LiveContext.jsx';
import { Alert, Avatar, FullPageSpinner } from './ui.jsx';
import { OfferTakeover } from './OfferCard.jsx';
import { STATUS_LABEL } from '../lib/format.js';

const MARK_MASK = 'url(/brand/delta-mark.png) center / contain no-repeat';
const MARK_STYLE = { mask: MARK_MASK, WebkitMask: MARK_MASK };

/**
 * The Delta mark: a "D" with a road winding through it (a journey that connects).
 * Drawn as a mask over currentColor, so it is ink on light themes and white on dark ones automatically.
 * `tile` renders the app-icon version: the mark on a white rounded square.
 */
export function Mark({ className = 'h-7 w-8', tile = false }) {
  const glyph = (
    <span aria-hidden style={MARK_STYLE} className={`inline-block shrink-0 bg-current ${tile ? 'h-[62%] w-[70%] text-ink' : className}`} />
  );
  if (!tile) return glyph;
  return <span aria-hidden className={`grid shrink-0 place-items-center rounded-[24%] bg-white shadow-sm ring-1 ring-black/10 ${className}`}>{glyph}</span>;
}

/** Wordmark: DELTΛ with the open, forward-pointing A from the brand sheet. */
export function Wordmark({ className = '', tagline = false }) {
  return (
    <span className={`inline-flex flex-col leading-none ${className}`}>
      <span className="whitespace-nowrap font-semibold tracking-[0.18em]">DELT<span className="inline-block scale-x-110">Λ</span></span>
      {tagline && <span className="mt-1.5 text-[0.42em] font-medium tracking-[0.42em] opacity-70">MOVE SMARTER</span>}
    </span>
  );
}

export function Logo({ to = '/', light = false }) {
  return (
    <Link to={to} aria-label="Delta home" className={`group flex items-center gap-2.5 text-[18px] ${light ? 'text-white' : 'text-fg'}`}>
      <Mark className="h-7 w-8 transition-transform duration-500 group-hover:-translate-y-0.5 group-hover:rotate-[-4deg]" />
      <Wordmark />
    </Link>
  );
}

/**
 * Three stable tabs per role (the bar never changes length). Modelled on how mobility apps split the job:
 * do the thing (Ride / Drive), look back (Activity / Earnings), and you (Account). A live dot marks an
 * active trip; the Ride/Drive tab takes you straight to it.
 */
function useTabs() {
  const { role } = useAuth();
  const { activeRide, offers } = useLiveData();
  const { pathname } = useLocation();
  const tabs = role === 'driver'
    ? [
      { to: activeRide ? `/driver/ride/${activeRide.id}` : '/driver/dashboard', label: 'Drive', icon: Navigation,
        match: ['/driver/dashboard', '/driver/ride', '/driver/requests'], live: Boolean(activeRide), badge: offers.length },
      { to: '/driver/earnings', label: 'Earnings', icon: Wallet, match: ['/driver/earnings', '/driver/trips'] },
      { to: '/driver/account', label: 'Account', icon: UserRound, match: ['/driver/account', '/driver/support'] },
    ]
    : [
      { to: activeRide ? `/passenger/ride/${activeRide.id}` : '/passenger/dashboard', label: 'Ride', icon: Navigation,
        match: ['/passenger/dashboard', '/passenger/book', '/passenger/ride'], live: Boolean(activeRide) },
      { to: '/passenger/activity', label: 'Activity', icon: Clock3, match: ['/passenger/activity', '/passenger/trips'] },
      { to: '/passenger/account', label: 'Account', icon: UserRound, match: ['/passenger/account', '/passenger/support'] },
    ];
  return tabs.map((t) => ({ ...t, active: t.match.some((p) => pathname.startsWith(p)) }));
}

function OnlineChip() {
  const { online, activeRide } = useLiveData();
  const label = activeRide ? 'On a trip' : online ? 'Online' : 'Offline';
  return (
    <span className="chip hidden sm:inline-flex">
      <span className={`h-2 w-2 rounded-full ${activeRide ? 'bg-accent' : online ? 'animate-pulse bg-live' : 'bg-muted'}`} />{label}
    </span>
  );
}

function TopBar() {
  const { me, role, signOut } = useAuth();
  const tabs = useTabs();
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-line bg-canvas/85 backdrop-blur-xl">
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Logo to={`/${role}/dashboard`} />
          <nav className="hidden items-center gap-1 rounded-full bg-surface-2 p-1 ring-1 ring-line md:flex" aria-label="Main">
            {tabs.map((t) => (
              <Link key={t.label} to={t.to} aria-current={t.active ? 'page' : undefined}
                className={`relative flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition ${t.active ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'}`}>
                <t.icon className="h-4 w-4" aria-hidden />{t.label}
                {t.badge ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-white">{t.badge}</span> : null}
                {t.live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live ring-2 ring-live/30" title="Trip in progress" />}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/story" className="hidden text-sm font-medium text-muted transition hover:text-fg lg:block">Our story</Link>
          {role === 'driver' && <OnlineChip />}
          <ThemeMenu />
          <Link to={`/${role}/account`} className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-1 transition hover:bg-surface sm:bg-surface-2 sm:pr-3 sm:ring-1 sm:ring-line" title="Account">
            <Avatar name={me.profile.full_name} size="h-8 w-8 text-xs" />
            <span className="hidden text-sm font-medium sm:block">{me.profile.full_name.split(' ')[0]}</span>
          </Link>
          <button onClick={signOut} className="btn-ghost btn-icon" aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" aria-hidden /></button>
        </div>
      </div>
    </header>
  );
}

/** Floating pill navigation on phones and small tablets. */
function BottomNav() {
  const tabs = useTabs();
  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
      <ul className="sheet mx-auto flex max-w-sm items-center justify-around gap-1 !rounded-full p-1.5">
        {tabs.map((t) => (
          <li key={t.label} className="flex-1">
            <Link to={t.to} aria-current={t.active ? 'page' : undefined}
              className={`relative flex items-center justify-center gap-2 rounded-full px-3 py-2.5 text-[13px] font-semibold transition ${t.active ? 'bg-fg text-canvas' : 'text-muted'}`}>
              <span className="relative">
                <t.icon className="h-[18px] w-[18px]" aria-hidden />
                {t.badge ? <span className="absolute -right-2.5 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{t.badge}</span> : null}
                {t.live && <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-live ring-2 ring-surface" />}
              </span>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Driver-side cross-page signals: the request takeover and a strip back to an active trip. */
function DriverSignals() {
  const { activeRide, offers } = useLiveData();
  const { pathname } = useLocation();
  const onTrip = activeRide && pathname === `/driver/ride/${activeRide.id}`;
  return (
    <>
      {offers[0] && !pathname.startsWith('/driver/requests') && <OfferTakeover offer={offers[0]} />}
      {activeRide && !onTrip && pathname !== '/driver/dashboard' && (
        <Link to={`/driver/ride/${activeRide.id}`} className="block bg-volt text-ink">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold sm:px-6">
            <span>Active trip · {STATUS_LABEL[activeRide.status]}</span>
            <span className="inline-flex items-center gap-1">Open <ArrowRight className="h-4 w-4" aria-hidden /></span>
          </div>
        </Link>
      )}
    </>
  );
}

/** Network / realtime health, shown only when it matters (offline, or live updates down during a ride). */
function ConnectionBanner() {
  const { connection, activeRide } = useLiveData();
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (connection !== 'polling') return undefined;
    const t = setTimeout(() => setStale(true), 8000); // ignore the brief "connecting" moment on load
    return () => { clearTimeout(t); setStale(false); };
  }, [connection]);
  if (connection === 'offline') {
    return <div className="bg-danger px-4 py-2 text-center text-sm font-semibold text-white" role="status"><WifiOff className="mr-2 inline h-4 w-4" aria-hidden />You’re offline. We’ll reconnect and catch up automatically.</div>;
  }
  if (connection === 'polling' && stale && activeRide) {
    return <div className="bg-amber-400 px-4 py-1.5 text-center text-[13px] font-semibold text-ink" role="status">Live updates reconnecting… refreshing every few seconds meanwhile.</div>;
  }
  return null;
}

function AppShell() {
  const { role } = useAuth();
  // Theme (light / dark / system, grey or AMOLED) is applied globally by ThemeProvider.
  return (
    <LiveProvider>
      <div className="min-h-screen pb-24 md:pb-0">
        <TopBar />
        <ConnectionBanner />
        {role === 'driver' && <DriverSignals />}
        <main><Outlet /></main>
        <BottomNav />
        <RideChat />
      </div>
    </LiveProvider>
  );
}

/** Standard (non-map) page container. */
export function Page({ children, className = '' }) {
  return <div className={`mx-auto max-w-3xl animate-rise px-4 py-8 sm:px-6 sm:py-12 ${className}`}>{children}</div>;
}

/** Requires a signed-in user with the given role; wraps pages in the app shell. */
export function ProtectedRoute({ role }) {
  const { session, me, loading, error, configured, refresh } = useAuth();
  const location = useLocation();
  if (!configured) {
    return <div className="mx-auto max-w-lg p-6"><Alert tone="warn">Supabase is not configured. Add the frontend environment variables (see README).</Alert></div>;
  }
  if (loading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!me) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <Alert>{error ?? 'Could not load your account.'}</Alert>
        <button className="btn-primary" onClick={refresh}>Try again</button>
      </div>
    );
  }
  if (me.profile.needs_onboarding) return <Navigate to="/onboarding" replace />;
  if (me.user.role !== role) return <Navigate to={`/${me.user.role}/dashboard`} replace />;
  return <AppShell />;
}
