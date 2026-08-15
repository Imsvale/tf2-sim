import { simulate } from "./physics.js";

// A route is N named stations with N-1 legs between consecutive stations.
// Each leg has a required crow-flies distance and an optional track
// distance (defaults to crow-flies when not given, per docs/revenue_formulas.md
// and the user's own framing of track distance as usually unavailable in-game).

export function createRoute() {
  return {
    stations: [{ name: "Station 1" }, { name: "Station 2" }],
    legs: [{ crowDistance_m: 10000, trackDistance_m: null }], // 10km default so the app shows live numbers immediately
  };
}

export function addStation(route, name) {
  route.stations.push({ name: name || `Station ${route.stations.length + 1}` });
  route.legs.push({ crowDistance_m: 10000, trackDistance_m: null });
}

export function removeStation(route, index) {
  if (route.stations.length <= 2) return; // need at least 2 stations / 1 leg
  route.stations.splice(index, 1);
  // Removing station i removes the leg arriving at it (leg i-1), except for
  // station 0, which removes the leg leaving it (leg 0).
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
