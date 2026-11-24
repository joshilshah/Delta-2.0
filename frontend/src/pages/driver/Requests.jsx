import { Link } from 'react-router-dom';
import { Check, Inbox, Minus } from 'lucide-react';
import { useLiveData } from '../../context/LiveContext.jsx';
import { useNow } from '../../hooks/useLive.js';
import { OfferCard } from '../../components/OfferCard.jsx';
import { Page } from '../../components/Layout.jsx';
import { Alert, EmptyState } from '../../components/ui.jsx';

function Check1({ ok, label, hint }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${ok ? 'cta-surface' :'bg-surface-2 text-muted ring-1 ring-line'}`}>
        {ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Minus className="h-3.5 w-3.5" aria-hidden />}
      </span>
      <div><p className="text-sm font-medium">{label}</p>{!ok && <p className="text-xs text-muted">{hint}</p>}</div>
    </li>
  );
}

export default function DriverRequests() {
  const live = useLiveData();
  const { driver, online, offers, activeRide } = live;
  const now = useNow(1000);
  const age = driver?.location ? (now - new Date(driver.location.updated_at).getTime()) / 1000 : Infinity;
  const allGood = online && age < 120 && !activeRide;

  return (
    <Page className="max-w-xl space-y-6">
      <header>
        <p className="text-sm text-muted">Inbox</p>
        <h1 className="text-[40px] font-semibold leading-[1.02]">Ride <span className="serif text-live">requests</span></h1>
        <p className="mt-2 text-sm text-muted">One request at a time, nearest driver first. Each one waits 30 seconds for you.</p>
      </header>

      {live.offerError && <Alert>{live.offerError}</Alert>}
      {offers.map((o) => <OfferCard key={o.id} offer={o} busy={live.busyOfferId === o.id} onAccept={live.acceptOffer} onReject={live.rejectOffer} />)}

      {offers.length === 0 && (
        <>
          <EmptyState icon={Inbox} title={allGood ? 'All set. Waiting for the next request' : online ? 'No requests right now' : 'You’re offline'}>
            {online ? 'New requests appear here and take over your screen on other pages.' : 'Go online from the cockpit to start receiving requests.'}
          </EmptyState>
          <section className="card">
            <h2 className="text-base font-semibold">Ready to receive requests?</h2>
            <ul className="mt-1 divide-y divide-line">
              <Check1 ok={online} label="You’re online" hint="Slide to go online in the cockpit." />
              <Check1 ok={age < 120} label="Your location is fresh" hint="Tap Update in the cockpit. Stale locations are skipped by matching." />
              <Check1 ok={!activeRide} label="You’re free for a new ride" hint="Finish your current trip first." />
            </ul>
            {!online && <Link to="/driver/dashboard" className="btn-volt mt-4 w-full">Open the cockpit</Link>}
          </section>
        </>
      )}
    </Page>
  );
}
