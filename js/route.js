import { simulate } from "./physics.js";

// A route is N named stations with N legs, one leaving each station:
// legs[i] is the distance from stations[i] to stations[(i+1) % n] — the
// last leg wraps back to the first station, matching how a TF2 line
// actually runs (it loops, it doesn't just stop at the last station). Each
// leg has a required crow-flies distance, an optional track distance
// (defaults to crow-flies when not given, per docs/revenue_formulas.md),
// and its own load factor (0-1, how full the train is on that leg).

export function createRoute() {
  return {
    stations: [{ name: "Station 1" }, { name: "Station 2" }],
    // 10km default so the app shows live numbers immediately
    legs: [
      { crowDistance_m: 10000, trackDistance_m: null, loadFactor: 1.0 },
      { crowDistance_m: 10000, trackDistance_m: null, loadFactor: 1.0 },
    ],
  };
}

export function addStation(route, name) {
  // Insert the new leg right before the current last (wraparound) leg, so
  // that leg's distance carries forward as the *new* wraparound leg
  // (previous-last-stop back to first), and the newly inserted leg becomes
  // "previous-last-stop → new stop".
  const insertLegAt = route.stations.length - 1;
  route.stations.push({ name: name || `Station ${route.stations.length + 1}` });
  route.legs.splice(insertLegAt, 0, { crowDistance_m: 10000, trackDistance_m: null, loadFactor: 1.0 });
}

export function removeStation(route, index) {
  if (route.stations.length <= 2) return; // need at least 2 stations / 2 legs
  route.stations.splice(index, 1);
  // Removing station i removes the leg arriving at it (leg i-1), except for
  // station 0, which removes the leg leaving it (leg 0) — the remaining
  // touching leg's distance carries forward across the reindex.
  const legIndex = index === 0 ? 0 : index - 1;
  route.legs.splice(legIndex, 1);
}

export function effectiveTrackDistance(leg) {
  return leg.trackDistance_m ?? leg.crowDistance_m;
}

/** Time (s) and distance for one leg, given a train aggregate. Null if the leg has no crow distance yet. */
export function legTime(aggregate, leg, trackSpeedLimit_kmh) {
  const distance_m = effectiveTrackDistance(leg);
  if (distance_m == null) return null;
  const result = simulate(aggregate, { trackSpeedLimit_kmh, stopAt: { distance_m } });
  return result && !result.warning ? result.time_s : null;
}

/**
 * Track-distance helper: given an observed trip time for some reference
 * train, back-derive the implied track distance. Lets a route be set up
 * from an in-game time measurement when the actual track distance isn't
 * known (no in-game ruler needed).
 */
export function estimateTrackDistance(aggregate, observedTime_s, trackSpeedLimit_kmh) {
  const result = simulate(aggregate, { trackSpeedLimit_kmh, stopAt: { duration_s: observedTime_s } });
  return result && !result.warning ? result.distance_m : null;
}
