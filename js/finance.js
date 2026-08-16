import { legTime, effectiveTrackDistance } from "./route.js";
import { simulateToStop } from "./physics.js";
import { stationHoldTime } from "./loading.js";

// Implements docs/revenue_formulas.md and docs/cost_formulas.md directly.
// Rail only for now (basePrice formula) — see TODO.md for road/air/water.

export const DIFFICULTY_FACTORS = {
  easy: 1.0,
  medium: 0.8,
  hard: 0.6,
  veryHard: 0.4,
};

const MILLIS_PER_DAY = 2000;
const REAL_SECONDS_PER_GAME_YEAR = 730; // 2s/game-day * 365 days; see docs/revenue_formulas.md
const REAL_SECONDS_PER_GAME_YEAR_AVG = 730.5; // using 365.25-day average

// Maintenance rate while stopped at a station (loading/unloading), as a
// fraction of the normal running rate. Shared by tripSummary and
// breakEvenAverageSpeedForRoute_kmh so both model a stop's cost the same
// way.
const STOPPED_MAINTENANCE_FACTOR = 0.4;

function basePriceRail(topSpeed_kmh) {
  return Math.pow(topSpeed_kmh, 0.86) + 10;
}

/** Payment for one passenger/cargo unit over one leg. distance_m is crow-flies. */
export function paymentPerUnit(distance_m, topSpeed_kmh, cargoFactor, difficulty) {
  const basePrice = basePriceRail(topSpeed_kmh);
  return (300.0 + distance_m) * basePrice * cargoFactor * (125 / MILLIS_PER_DAY) * difficulty;
}

/**
 * Revenue for one leg, given a train aggregate (js/train.js). Uses the
 * train's own rated top speed for pricing (not track-limited or per-leg
 * realized speed — see the plan's clarified assumptions). Passenger and
 * cargo capacity are priced separately (cargoFactor 1 vs 1.75); the
 * specific cargo *type* doesn't affect price.
 */
export function legRevenue(aggregate, leg, { difficulty }) {
  if (leg.crowDistance_m == null) return null;
  const passengerRevenue = aggregate.passengerCapacity * paymentPerUnit(leg.crowDistance_m, aggregate.topSpeed_kmh, 1, difficulty);
  const cargoRevenue = aggregate.cargoCapacity * paymentPerUnit(leg.crowDistance_m, aggregate.topSpeed_kmh, 1.75, difficulty);
  return leg.loadFactor * (passengerRevenue + cargoRevenue);
}

/** Annual maintenance, assumed constantly-operating (no station/depot state modeling yet). */
export function annualMaintenance(aggregate) {
  return aggregate.price / 6;
}

function yearSecondsFor(yearBasis) {
  return yearBasis === "average" ? REAL_SECONDS_PER_GAME_YEAR_AVG : REAL_SECONDS_PER_GAME_YEAR;
}

/**
 * The average *crow-flies* speed (leg's crow distance / leg time) a train
 * would need to exactly break even on this leg — revenue in, maintenance
 * out. Crow-flies, not track-distance: revenue is paid on crow distance
 * (paymentPerUnit above) while maintenance is paid on however long the leg
 * actually takes — and there's only one time regardless of *why* it took
 * that long (a longer track than crow distance, a lower speed limit,
 * anything). Crow distance over that one time is the only average speed
 * that speaks to whether the trip pays for itself; track-distance average
 * speed (see js/charts.js's renderRouteProfileCharts) is a real physical
 * quantity but the wrong one for this — see docs/breakeven_formulas.md.
 * Null if the leg has no crow distance yet, the train can't earn revenue
 * on it, or maintenance is free (nothing to break even against).
 */
export function breakEvenAverageSpeed_kmh(aggregate, leg, { difficulty, yearBasis = "standard" }) {
  if (leg.crowDistance_m == null || leg.crowDistance_m <= 0) return null;
  const revenue = legRevenue(aggregate, leg, { difficulty });
  if (revenue == null || revenue <= 0) return null;
  const maintenanceRate = annualMaintenance(aggregate) / yearSecondsFor(yearBasis); // $ per second
  if (maintenanceRate <= 0) return null;
  const breakEvenTime_s = revenue / maintenanceRate;
  return (leg.crowDistance_m / breakEvenTime_s) * 3.6;
}

/**
 * The whole-loop analog of breakEvenAverageSpeed_kmh: the single flat
 * average crow-flies speed (crow distance summed over every leg / total
 * wall-clock time for the whole loop, dwell included) this train needs to
 * sustain for total revenue to exactly match total maintenance across the
 * entire route — see js/charts.js's renderRouteProfileChartsForRoute.
 *
 * This is well-defined as one flat number, the same way the per-leg
 * version is, even though the route now includes station dwell: each
 * station's hold time (js/loading.js's stationHoldTime) depends only on
 * load factor and the wagons' own loading speed, never on how fast the
 * train runs between stations — so total dwell time D, and what it costs
 * at STOPPED_MAINTENANCE_FACTOR, are both fixed regardless of the travel
 * time being solved for. Concretely: totalRevenue = maintenanceRate *
 * (T_travel + STOPPED_MAINTENANCE_FACTOR * D), solved for T_travel, then
 * T_total = T_travel + D. Null under the same conditions as
 * breakEvenAverageSpeed_kmh (any leg missing crow distance, no revenue, or
 * free maintenance).
 */
export function breakEvenAverageSpeedForRoute_kmh(aggregate, route, { difficulty, yearBasis = "standard" }) {
  let totalCrowDistance_m = 0;
  let totalRevenue = 0;
  let totalDwell_s = 0;
  for (const leg of route.legs) {
    if (leg.crowDistance_m == null || leg.crowDistance_m <= 0) return null;
    const revenue = legRevenue(aggregate, leg, { difficulty });
    if (revenue == null) return null;
    totalCrowDistance_m += leg.crowDistance_m;
    totalRevenue += revenue;
    totalDwell_s += stationHoldTime(aggregate, leg.loadFactor).holdTime_s;
  }
  if (totalRevenue <= 0) return null;
  const maintenanceRate = annualMaintenance(aggregate) / yearSecondsFor(yearBasis);
  if (maintenanceRate <= 0) return null;

  const travelTime_s = totalRevenue / maintenanceRate - STOPPED_MAINTENANCE_FACTOR * totalDwell_s;
  const totalTime_s = travelTime_s + totalDwell_s;
  if (totalTime_s <= 0) return null;
  return (totalCrowDistance_m / totalTime_s) * 3.6;
}

// The "K" from docs/breakeven_formulas.md: revenue's per-meter rate once
// the flat +300m floor becomes negligible (crowDistance -> infinity). Exact,
// not a large-number approximation — revenue is exactly linear in
// (300 + crowDistance) by construction (paymentPerUnit above), so
// revenue / (300 + crowDistance) is the same constant for literally any
// positive crowDistance plugged in. Shared by every "route-independent"
// derivation below so they all read the same K the same way.
function perMeterRevenueRate(aggregate, { difficulty, loadFactor = 1 }) {
  const referenceLeg = { crowDistance_m: 1, loadFactor };
  const revenue = legRevenue(aggregate, referenceLeg, { difficulty });
  return revenue == null || revenue <= 0 ? null : revenue / (300 + referenceLeg.crowDistance_m);
}

function maintenanceRatePerSecond(aggregate, yearBasis) {
  const rate = annualMaintenance(aggregate) / yearSecondsFor(yearBasis);
  return rate > 0 ? rate : null;
}

/**
 * The limit breakEvenAverageSpeed_kmh converges to as a leg's crow
 * distance -> infinity — a single number depending only on the consist
 * and difficulty/load factor, no specific leg involved. Clearing this
 * speed guarantees profitability on a leg of *any* crow distance
 * whatsoever (see docs/breakeven_formulas.md for the proof).
 */
export function breakEvenAverageSpeedUpperBound_kmh(aggregate, { difficulty, loadFactor = 1, yearBasis = "standard" }) {
  const K = perMeterRevenueRate(aggregate, { difficulty, loadFactor });
  const maintenanceRate = maintenanceRatePerSecond(aggregate, yearBasis);
  if (K == null || maintenanceRate == null) return null;
  return (maintenanceRate / K) * 3.6;
}

/**
 * The load factor (0-1, can exceed 1 — see below) needed to guarantee
 * profitability on a leg of any crow-flies distance, *if* this train can
 * sustain referenceSpeed_kmh (its own crow-flies average) the whole way.
 * The load-factor mirror of breakEvenAverageSpeedUpperBound_kmh, for when
 * speed is the fixed quantity and load is the lever instead — not a
 * separate formula, just that function's own reciprocal: since revenue is
 * linear in load factor, breakEvenAverageSpeedUpperBound_kmh(loadFactor) *
 * loadFactor is a constant (call it C) regardless of loadFactor, so the
 * loadFactor that makes referenceSpeed_kmh the break-even point is just
 * C / referenceSpeed_kmh. Left unclamped on purpose: a result > 1 means
 * even full load can't guarantee profit at that speed on every distance —
 * the caller decides how to present that ("not achievable"), this just
 * reports the number.
 */
export function breakEvenLoadFactorUpperBound(aggregate, referenceSpeed_kmh, { difficulty, yearBasis = "standard" }) {
  if (!(referenceSpeed_kmh > 0)) return null;
  const speedUpperBoundAtFullLoad_kmh = breakEvenAverageSpeedUpperBound_kmh(aggregate, { difficulty, loadFactor: 1, yearBasis });
  return speedUpperBoundAtFullLoad_kmh == null ? null : speedUpperBoundAtFullLoad_kmh / referenceSpeed_kmh;
}

/**
 * Profit per real hour if this train sustains speed_kmh (crow-flies
 * average) indefinitely, on an arbitrarily long route — the same
 * distance -> infinity limit as breakEvenAverageSpeedUpperBound_kmh, just
 * evaluated away from the zero-crossing instead of solving for it:
 * profitRate(v) = K·v − maintenanceRate is linear in v (K the same
 * per-meter revenue rate as above), zero exactly at the break-even speed,
 * positive above it. Used for the Experimental tab's payback-period
 * estimate — see paybackPeriodRealHours below.
 */
export function profitPerRealHourAtSpeed(aggregate, speed_kmh, { difficulty, loadFactor = 1, yearBasis = "standard" }) {
  const K = perMeterRevenueRate(aggregate, { difficulty, loadFactor });
  const maintenanceRate = maintenanceRatePerSecond(aggregate, yearBasis);
  if (K == null || maintenanceRate == null) return null;
  const profitRatePerSecond = K * (speed_kmh / 3.6) - maintenanceRate;
  return profitRatePerSecond * 3600;
}

/**
 * Real hours until this train's purchase price is earned back, sustaining
 * speed_kmh (crow-flies average) indefinitely — purchasePrice /
 * profitPerRealHourAtSpeed. Null (not just a huge number) if profit at
 * that speed isn't positive — "never" is a distinct answer from "a very
 * long time", and dividing by a non-positive rate wouldn't mean the
 * second one anyway.
 */
export function paybackPeriodRealHours(aggregate, speed_kmh, { difficulty, loadFactor = 1, yearBasis = "standard" }) {
  const profitPerHour = profitPerRealHourAtSpeed(aggregate, speed_kmh, { difficulty, loadFactor, yearBasis });
  if (profitPerHour == null || profitPerHour <= 0) return null;
  return aggregate.price / profitPerHour;
}

/**
 * How many of the wagon that turns agg0 (locomotive alone) into agg1
 * (locomotive + 1 of that wagon) are needed before
 * breakEvenAverageSpeedUpperBound_kmh first reaches targetSpeed_kmh —
 * solved in closed form, not by searching a table, because price and
 * capacity both scale *exactly* linearly in wagon count
 * (js/train.js's aggregateTrain just sums quantity * per-vehicle
 * price/capacity — no bulk discount modeled) and top speed doesn't change
 * at all (adding more of the *same* wagon type never changes which
 * vehicle sets the train's own Math.min() top speed) — verified against
 * real vehicle data before relying on it. v_upperBound(N) = (maint0 +
 * N·maintW) / (K0 + N·Kw) is then a single linear-over-linear equation in
 * N; setting it equal to targetSpeed_kmh and solving is straight algebra.
 * Returns 0 if the target is already met with the locomotive alone, or
 * null if this wagon type never gets there (its own price/capacity ratio
 * is worse than what's needed) or agg0/agg1 aren't a valid "+1 wagon"
 * pair.
 */
export function breakEvenWagonCount(agg0, agg1, targetSpeed_kmh, { difficulty, loadFactor = 1, yearBasis = "standard" }) {
  if (!(targetSpeed_kmh > 0)) return null;
  const v0 = breakEvenAverageSpeedUpperBound_kmh(agg0, { difficulty, loadFactor, yearBasis });
  if (v0 != null && v0 <= targetSpeed_kmh) return 0;

  const K0 = perMeterRevenueRate(agg0, { difficulty, loadFactor }) ?? 0;
  const K1 = perMeterRevenueRate(agg1, { difficulty, loadFactor }) ?? 0;
  const Kw = K1 - K0;
  const maint0 = maintenanceRatePerSecond(agg0, yearBasis) ?? 0;
  const maint1 = maintenanceRatePerSecond(agg1, yearBasis) ?? 0;
  const maintW = maint1 - maint0;

  const targetSpeed_ms = targetSpeed_kmh / 3.6;
  // maint0 + N*maintW = targetSpeed_ms * (K0 + N*Kw)
  // N * (maintW - targetSpeed_ms*Kw) = targetSpeed_ms*K0 - maint0
  const denominator = maintW - targetSpeed_ms * Kw;
  if (denominator === 0) return null; // v_upperBound(N) doesn't move with N at all
  const N = (targetSpeed_ms * K0 - maint0) / denominator;
  return N > 0 ? N : null;
}

/**
 * Full trip summary across every leg of a route, for one train aggregate.
 * Returns null if any leg is missing its crow distance, or the train can't
 * move (no locomotives / power).
 *
 * `includeStops` (default false, unchanged legacy behavior when omitted):
 * when true, each leg's time/maintenance also account for braking into
 * the station and the loading/unloading dwell there (see js/loading.js),
 * at 40% of the normal maintenance rate while stopped. `brakingDeceleration_ms2`
 * is required when includeStops is true. Revenue is unaffected either way
 * — legRevenue() was never time-based.
 */
export function tripSummary(
  aggregate,
  route,
  { trackSpeedLimit_kmh, difficulty, yearBasis = "standard", includeStops = false, brakingDeceleration_ms2, gravity_ms2 }
) {
  if (!aggregate || aggregate.power_kW === 0) return null;

  const yearSeconds = yearSecondsFor(yearBasis);
  const maintenanceRate = annualMaintenance(aggregate) / yearSeconds; // $ per second, constant regardless of leg

  const legs = [];
  for (const leg of route.legs) {
    const distance_m = effectiveTrackDistance(leg);
    if (distance_m == null) return null;

    let time_s, maintenance;
    if (includeStops) {
      const result = simulateToStop(aggregate, distance_m, { trackSpeedLimit_kmh, brakingDeceleration_ms2, gravity_ms2 });
      if (!result || result.warning) return null;
      const hold = stationHoldTime(aggregate, leg.loadFactor);
      time_s = result.totalTime_s + hold.holdTime_s;
      maintenance = maintenanceRate * result.totalTime_s + maintenanceRate * STOPPED_MAINTENANCE_FACTOR * hold.holdTime_s;
    } else {
      time_s = legTime(aggregate, leg, trackSpeedLimit_kmh, gravity_ms2);
      if (time_s == null) return null;
      maintenance = maintenanceRate * time_s;
    }

    const revenue = legRevenue(aggregate, leg, { difficulty });
    if (revenue == null) return null;

    legs.push({
      time_s,
      distance_m,
      crowDistance_m: leg.crowDistance_m,
      avgSpeed_kmh: time_s > 0 ? (distance_m / time_s) * 3.6 : 0,
      revenue,
      maintenance,
      profit: revenue - maintenance,
    });
  }

  const totalTime_s = legs.reduce((sum, l) => sum + l.time_s, 0);
  const totalRevenue = legs.reduce((sum, l) => sum + l.revenue, 0);
  const maintenanceForTrip = legs.reduce((sum, l) => sum + l.maintenance, 0);
  const profit = totalRevenue - maintenanceForTrip;
  const profitRatePerSecond = totalTime_s > 0 ? profit / totalTime_s : 0;

  return {
    legs,
    totalTime_s,
    totalRevenue,
    maintenanceForTrip,
    profit,
    profitPerRealHour: profitRatePerSecond * 3600,
    profitPerGameYear: profitRatePerSecond * yearSeconds,
  };
}
