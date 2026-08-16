// Loading/unloading (station dwell) time. See docs/ for the derivation —
// summary: this is deliberately NOT a flat amount/Σ(loadingSpeed) formula.
// That shortcut is only exact when every active wagon/MU shares the same
// capacity-to-loadingSpeed ratio. js/train.js's real vehicle data doesn't
// (loadingSpeed 1-4, capacity 4-33, independently) — once wagons differ,
// the one with the smallest capacity/loadingSpeed ratio saturates first,
// drops out of the pool, and the combined rate for the remainder falls
// below Σ(loadingSpeed). Same category of bug as naively summing
// locomotive power/tractive effort (see js/physics.js's module comment) —
// fixed the same way, by working the constraint out per-unit instead of
// on pre-summed totals.

/**
 * Time to move `targetAmount` units (passengers or cargo) through a pool
 * of same-purpose load units, each independently accepting at its own
 * loadingSpeed until it hits its own capacity.
 *
 * @param {Array<{capacity: number, loadingSpeed: number, count: number}>} units -
 *   per-group (not merged), pre-filtered to one purpose by the caller —
 *   see js/train.js's aggregateTrain() `loadUnits`.
 * @param {number} targetAmount
 * @returns {number|null} seconds, or null if there's a nonzero amount to
 *   move but no unit can move it (zero loadingSpeed everywhere — doesn't
 *   happen with real vehicle data, guarded defensively anyway)
 */
export function loadUnloadTime(units, targetAmount) {
  if (targetAmount <= 0) return 0;

  // A group of N identical wagons behaves as one "super-unit" (they always
  // saturate together): cap = per-unit capacity × count, rate = per-unit
  // loadingSpeed × count.
  const pool = units
    .map((u) => ({ cap: u.capacity * u.count, rate: u.loadingSpeed * u.count }))
    .filter((u) => u.cap > 0 && u.rate > 0)
    .sort((a, b) => a.cap / a.rate - b.cap / b.rate); // ascending time-to-saturate
  if (pool.length === 0) return null;

  // Each unit fills/drains at its own fixed rate from t=0, independent of
  // the others, until it hits its own cap at t = cap/rate (fixed, doesn't
  // depend on arrival order) — so this just walks through units in
  // saturation order, accumulating how much the *combined* (still-active)
  // pool has delivered by each such breakpoint, until the target is met.
  let cumulative = 0;
  let prevT = 0;
  let activeRate = pool.reduce((sum, u) => sum + u.rate, 0);
  for (const u of pool) {
    const saturatesAt = u.cap / u.rate;
    const amountInInterval = activeRate * (saturatesAt - prevT);
    if (cumulative + amountInInterval >= targetAmount) {
      return prevT + (targetAmount - cumulative) / activeRate;
    }
    cumulative += amountInInterval;
    activeRate -= u.rate;
    prevT = saturatesAt;
  }
  return prevT; // only reached if targetAmount slightly exceeds float-precision total capacity
}

/**
 * One station's dwell time for a train arriving/departing on one leg.
 * `loadFactor` is that *leg's own* load factor — the same factor governs
 * both the unloading at the leg's end (disembarking from how full the leg
 * was) and the loading at the leg's start (boarding up to how full the
 * leg will be), so load and unload time come out identical here. Passenger
 * and cargo loading happen in parallel (different wagons/doors), so hold
 * time is max(passenger, cargo), not their sum.
 */
export function stationHoldTime(aggregate, loadFactor) {
  const passengerUnits = aggregate.loadUnits.filter((u) => u.isPassenger);
  const cargoUnits = aggregate.loadUnits.filter((u) => !u.isPassenger);
  const loadTime_s = Math.max(
    loadUnloadTime(passengerUnits, aggregate.passengerCapacity * loadFactor) ?? 0,
    loadUnloadTime(cargoUnits, aggregate.cargoCapacity * loadFactor) ?? 0
  );
  const unloadTime_s = loadTime_s; // identical: same units, same amount, same rate
  return { loadTime_s, unloadTime_s, holdTime_s: loadTime_s + unloadTime_s };
}
