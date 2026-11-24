export const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
export const km = (n) => `${Number(n).toFixed(1)} km`;
export const mins = (n) => `${Math.round(n)} min`;

export function timeAgo(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString();
}

export const STATUS_LABEL = {
  requested: 'Requested',
  searching: 'Finding a driver',
  accepted: 'Driver confirmed',
  in_progress: 'Trip in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  unmatched: 'No driver available',
};

export const STATUS_TONE = {
  requested: 'bg-gray-100 text-gray-700',
  searching: 'bg-blue-50 text-accent',
  accepted: 'bg-green-50 text-success',
  in_progress: 'bg-green-50 text-success',
  completed: 'bg-gray-100 text-ink',
  cancelled: 'bg-red-50 text-danger',
  unmatched: 'bg-amber-50 text-amber-700',
};
