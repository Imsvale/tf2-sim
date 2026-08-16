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
export function tripSummary(aggregate, route, { trackSpeedLimit_kmh, difficulty, yearBasis = "standard", includeStops = false, brakingDeceleration_ms2 }) {
  if (!aggregate || aggregate.power_kW === 0) return null;

  const yearSeconds = yearBasis === "average" ? REAL_SECONDS_PER_GAME_YEAR_AVG : REAL_SECONDS_PER_GAME_YEAR;
  const maintenanceRate = annualMaintenance(aggregate) / yearSeconds; // $ per second, constant regardless of leg
  const STOPPED_MAINTENANCE_FACTOR = 0.4;

  const legs = [];
  for (const leg of route.legs) {
    const distance_m = effectiveTrackDistance(leg);
    if (distance_m == null) return null;

    let time_s, maintenance;
    if (includeStops) {
      const result = simulateToStop(aggregate, distance_m, { trackSpeedLimit_kmh, brakingDeceleration_ms2 });
      if (!result || result.warning) return null;
      const hold = stationHoldTime(aggregate, leg.loadFactor);
      time_s = result.totalTime_s + hold.holdTime_s;
      maintenance = maintenanceRate * result.totalTime_s + maintenanceRate * STOPPED_MAINTENANCE_FACTOR * hold.holdTime_s;
    } else {
      time_s = legTime(aggregate, leg, trackSpeedLimit_kmh);
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
