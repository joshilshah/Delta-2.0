import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';

const ToastContext = createContext({ toast: () => {} });

/** Lightweight toasts for moments that happen while you look elsewhere ("Ravi accepted your ride"). */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback(({ title, body, tone = 'default', action, ms = 5200 }) => {
    const id = ++seq.current;
    setItems((list) => [...list.slice(-2), { id, title, body, tone, action }]);
    setTimeout(() => dismiss(id), ms);
  }, [dismiss]);

  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex w-full max-w-sm animate-pop items-start gap-3 rounded-3xl bg-ink px-4 py-3.5 text-white shadow-2xl ring-1 ring-white/10">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.tone === 'success' ? 'bg-volt' : t.tone === 'warn' ? 'bg-amber-400' : 'bg-accent'}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[13px] text-white/70">{t.body}</p>}
              {t.action && (t.action.to
                ? <Link to={t.action.to} onClick={() => dismiss(t.id)} className="mt-2 inline-block text-[13px] font-semibold text-volt hover:underline">{t.action.label}</Link>
                : <button onClick={() => { dismiss(t.id); t.action.onClick?.(); }} className="mt-2 inline-block text-[13px] font-semibold text-volt hover:underline">{t.action.label}</button>)}
            </div>
            <button onClick={() => dismiss(t.id)} className="rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Dismiss"><X className="h-4 w-4" aria-hidden /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
