// Driver ranking strategies. A strategy is a comparator over candidate drivers.
// Candidate shape: { driver_id, distance_km, location_updated_at, ...future fields }
//
// Phase 1: 'proximity' (straight-line distance to pickup). Straight-line distance is only a
// proxy - it is not road distance and says nothing about traffic or arrival time.
//
// Later phases register more strategies WITHOUT touching the dispatch service, e.g.:
//   registerStrategy('eta', (a, b) => a.pickup_eta_seconds - b.pickup_eta_seconds)
//   (road distance via Routes matrix, traffic-aware ETA, vehicle category filters...)

const byId = (a, b) => String(a.driver_id).localeCompare(String(b.driver_id));

const strategies = {
  proximity: (a, b) =>
    a.distance_km - b.distance_km ||
    // tie-break: fresher location first, then stable id order for determinism
    new Date(b.location_updated_at ?? 0) - new Date(a.location_updated_at ?? 0) ||
    byId(a, b),
};

export function registerStrategy(name, comparator) {
  strategies[name] = comparator;
}

export function rankDrivers(candidates, { strategy = 'proximity' } = {}) {
  const compare = strategies[strategy];
  if (!compare) throw new Error(`Unknown ranking strategy: ${strategy}`);
  return [...candidates].sort(compare);
}
