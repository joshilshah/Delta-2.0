import { Logo } from './Layout.jsx';
import LiveMap from './LiveMap.jsx';
import ThemeMenu from './ThemeMenu.jsx';

const SCENE = {
  pickup: { latitude: 12.9716, longitude: 77.5946 },
  destination: { latitude: 12.9352, longitude: 77.6245 },
  driver: { latitude: 12.9802, longitude: 77.5868 },
};

/** Split layout for login/signup/onboarding: a living night map on large screens, the form on the right. */
export default function AuthFrame({ children, title, accent, sub }) {
  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_1fr]">
      <aside className="theme-night relative hidden overflow-hidden bg-canvas text-fg lg:block">
        <div className="absolute inset-0"><LiveMap fill night interactive={false} {...SCENE} /></div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-night via-night/40 to-night/70" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Logo light />
          <div className="max-w-md">
            <h2 className="text-5xl font-semibold leading-[1.02]">{title ?? 'Every fare,'} <span className="serif text-volt">{accent ?? 'itemised.'}</span></h2>
            <p className="mt-4 text-white/70">{sub ?? 'See base, distance and time before you book, then get matched with the closest driver.'}</p>
          </div>
          <p className="text-xs text-white/50">Demo build · drivers are unverified</p>
        </div>
      </aside>
      <main className="relative grid place-items-center px-5 py-10">
        <ThemeMenu className="absolute right-4 top-4" />
        <div className="w-full max-w-md animate-rise">
          <div className="mb-10 lg:hidden"><Logo /></div>
          {children}
        </div>
      </main>
    </div>
  );
}
