import { useEffect, useRef, useState } from 'react';
import { Check, Crosshair, Loader2, MapPin, MapPinned } from 'lucide-react';
import { mapsConfigured, newSessionToken, resolvePlace, searchOsm, suggestPlaces } from '../lib/maps.js';
import MapPicker from './MapPicker.jsx';

const DEBOUNCE_MS = 300;

/**
 * Location input. `value` is only ever a *confirmed* place ({address, latitude, longitude}): chosen from
 * suggestions, picked on the map, or set by the parent (e.g. "use my location"). Typing clears it, so a
 * half-typed string can never be booked.
 *
 * Suggestions: Google Places when a browser key is configured; otherwise real OpenStreetMap places (Photon).
 * "Choose on map" covers anything no search service knows about.
 */
export default function PlaceInput({ label, value, onChange, placeholder, variant = 'pickup', onLocate, locating = false, near }) {
  const [text, setText] = useState(value?.address ?? '');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(''); // the query the current options belong to
  const [problem, setProblem] = useState(null);
  const [picking, setPicking] = useState(false);
  const token = useRef(null);
  const seq = useRef(0);
  const timer = useRef(null);
  const abort = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => { document.removeEventListener('mousedown', close); clearTimeout(timer.current); abort.current?.abort(); };
  }, []);

  // Parent set a value from outside (e.g. current location): show its address.
  useEffect(() => {
    if (value && value.address !== text) setText(value.address); // eslint-disable-line react-hooks/set-state-in-effect -- mirror an externally set value
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runSearch(q, mine) {
    abort.current?.abort();
    abort.current = new AbortController();
    try {
      let found;
      if (mapsConfigured) {
        token.current ??= await newSessionToken();
        found = await suggestPlaces(q, token.current);
      } else {
        const { signal } = abort.current;
        try {
          found = await searchOsm(q, near, signal);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          // The free OSM service occasionally drops a request: retry once before giving up.
          await new Promise((r) => setTimeout(r, 700));
          if (signal.aborted) return;
          found = await searchOsm(q, near, signal);
        }
      }
      if (mine === seq.current) { setOptions(found); setSearched(q); setOpen(true); }
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (mine === seq.current) { setOptions([]); setSearched(q); setOpen(true); setProblem('Place search is unavailable right now. You can still choose the spot on the map.'); }
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  function onType(q) {
    setText(q);
    onChange(null);
    setProblem(null);
    clearTimeout(timer.current);
    const mine = ++seq.current;
    if (q.trim().length < 2) { setOptions([]); setOpen(false); setBusy(false); return; }
    setBusy(true);
    timer.current = setTimeout(() => runSearch(q.trim(), mine), DEBOUNCE_MS);
  }

  async function choose(option) {
    setOpen(false);
    setProblem(null);
    if (!option.prediction) { // OpenStreetMap results already carry coordinates
      setText(option.address);
      onChange({ address: option.address, latitude: option.latitude, longitude: option.longitude });
      return;
    }
    setBusy(true);
    try {
      const place = await resolvePlace(option.prediction);
      token.current = null; // a Google session ends when a place is selected
      setText(place.address);
      onChange(place);
    } catch {
      setProblem('Could not read that place. Please pick another, or choose it on the map.');
    } finally {
      setBusy(false);
    }
  }

  function pickedOnMap(place) {
    setPicking(false);
    setOpen(false);
    setText(place.address);
    onChange(place);
  }

  const working = busy || locating;
  const showList = open && text.trim().length >= 2 && !busy;
  return (
    <div ref={box} className="relative">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label className="label !mb-0" htmlFor={`place-${label}`}>{label}</label>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setPicking(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-fg-soft hover:text-fg hover:underline">
            <MapPinned className="h-3.5 w-3.5" aria-hidden /> Choose on map
          </button>
          {onLocate && (
            <button type="button" onClick={onLocate} disabled={locating} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline disabled:opacity-60">
              <Crosshair className="h-3.5 w-3.5" aria-hidden /> Use my location
            </button>
          )}
        </div>
      </div>
      <div className="relative">
        {variant === 'pickup'
          ? <span className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-surface ring-[4px] ring-fg" aria-hidden />
          : <svg viewBox="0 0 28 26" className="pointer-events-none absolute left-[13px] top-1/2 h-4 w-[18px] -translate-y-1/2" aria-hidden><path d="M14 2 26.5 23.5h-25Z" fill="#2F5BFF" /></svg>}
        <input
          id={`place-${label}`} className="input !bg-surface pl-11 pr-10" value={locating && !text ? 'Finding your location…' : text} placeholder={placeholder}
          autoComplete="off" onChange={(e) => onType(e.target.value)} onFocus={() => searched && setOpen(true)}
          aria-invalid={Boolean(problem)} disabled={locating && !text} role="combobox" aria-expanded={showList} aria-autocomplete="list"
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2">
          {working ? <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />
            : value ? <Check className="h-4 w-4 text-success" aria-label="Location confirmed" /> : null}
        </span>
      </div>
      {problem && <p className="mt-1.5 text-xs text-danger">{problem}</p>}
      {!problem && text.trim().length > 1 && !value && !working && !open && (
        <p className="mt-1.5 text-xs text-muted">Select a suggestion, or choose the spot on the map.</p>
      )}

      {showList && (
        <ul className="sheet absolute z-30 mt-2 max-h-80 w-full animate-pop overflow-auto !rounded-2xl py-1.5" role="listbox">
          {options.map((o) => (
            <li key={o.id}>
              <button type="button" role="option" aria-selected="false" className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-surface-2" onClick={() => choose(o)}>
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden /> <span>{o.text}</span>
              </button>
            </li>
          ))}
          {options.length === 0 && !problem && (
            <li className="px-4 py-2.5 text-sm text-muted">No places found for “{searched}”.</li>
          )}
          <li className="border-t border-line">
            <button type="button" onClick={() => setPicking(true)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-accent hover:bg-surface-2">
              <MapPinned className="h-4 w-4 shrink-0" aria-hidden /> Can’t find it? Choose on map
            </button>
          </li>
          <li className="px-4 pb-2 pt-1 text-[11px] text-muted">
            {mapsConfigured ? 'Suggestions by Google' : 'Suggestions from OpenStreetMap (add a Google Maps key for Google suggestions)'}
          </li>
        </ul>
      )}

      {picking && (
        <MapPicker title={`Choose ${label.toLowerCase()} on map`} start={value ?? near} onPick={pickedOnMap} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}
