import { legTime, effectiveTrackDistance } from "./route.js";

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
 */
export function tripSummary(aggregate, route, { trackSpeedLimit_kmh, difficulty, yearBasis = "standard" }) {
  if (!aggregate || aggregate.power_kW === 0) return null;

  const yearSeconds = yearBasis === "average" ? REAL_SECONDS_PER_GAME_YEAR_AVG : REAL_SECONDS_PER_GAME_YEAR;
  const maintenanceRate = annualMaintenance(aggregate) / yearSeconds; // $ per second, constant regardless of leg

  const legs = [];
  for (const leg of route.legs) {
    const time_s = legTime(aggregate, leg, trackSpeedLimit_kmh);
    const revenue = legRevenue(aggregate, leg, { difficulty });
    if (time_s == null || revenue == null) return null;
    const distance_m = effectiveTrackDistance(leg);
    const maintenance = maintenanceRate * time_s;
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
