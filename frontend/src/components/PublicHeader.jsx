import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Logo } from './Layout.jsx';
import ThemeMenu from './ThemeMenu.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const LINKS = [
  ['Our story', '/story'],
  ['How it works', '/#how-it-works', true],
  ['Pricing', '/#pricing', true],
  ['Drive with Delta', '/#drive', true],
];

/**
 * Top bar for the public pages (landing, story), drawn over a dark hero.
 * Desktop: links, theme, sign-in / primary action. Phones: the primary action plus a compact menu.
 */
export default function PublicHeader() {
  const { me } = useAuth();
  const { pathname } = useLocation();
  const home = me ? (me.profile.needs_onboarding ? '/onboarding' : `/${me.user.role}/dashboard`) : null;
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const links = LINKS.filter(([, to]) => to !== pathname);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const primary = home
    ? <Link to={home} className="btn-volt whitespace-nowrap !px-4 sm:!px-5">Open Delta</Link>
    : <Link to="/signup" className="btn-volt whitespace-nowrap !px-4 sm:!px-5">Get started</Link>;
  const item = 'whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium text-white/75 transition hover:bg-white/10 hover:text-white';

  return (
    <header className="relative z-30 flex h-20 items-center justify-between gap-3">
      <Logo light />
      {/* Desktop */}
      <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
        {links.map(([label, to, anchor]) => (anchor
          ? <a key={label} href={to} className={item}>{label}</a>
          : <Link key={label} to={to} className={item}>{label}</Link>))}
        <ThemeMenu className="ml-1" />
        {!home && <Link to="/login" className={item}>Log in</Link>}
        <span className="ml-1">{primary}</span>
      </nav>
      {/* Phones */}
      <div ref={box} className="relative flex items-center gap-2 md:hidden">
        {primary}
        <button className="grid h-10 w-10 place-items-center rounded-full text-white ring-1 ring-white/20 hover:bg-white/10"
          onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'}>
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
        {open && (
          <div className="absolute right-0 top-12 z-50 w-60 animate-pop rounded-3xl bg-[#1A1F29] p-2 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] ring-1 ring-white/15" role="menu">
            {links.map(([label, to, anchor]) => (anchor
              ? <a key={label} href={to} role="menuitem" onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-[15px] font-medium text-white/85 hover:bg-white/10">{label}</a>
              : <Link key={label} to={to} role="menuitem" onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-[15px] font-medium text-white/85 hover:bg-white/10">{label}</Link>))}
            {!home && <Link to="/login" role="menuitem" onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-[15px] font-medium text-white/85 hover:bg-white/10">Log in</Link>}
            <div className="mt-1 flex items-center justify-between border-t border-white/10 px-4 pb-1 pt-3 text-sm text-white/60">
              Appearance <ThemeMenu />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
