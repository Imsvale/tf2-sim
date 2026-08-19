// Company-level financial simulation: a loan (drawn/repaid only in exact
// $500k steps, tied to a starting-year loan cap that mirrors TF2's own
// schedule), monthly maintenance + interest, and a discrete-event walk
// through actual leg completions — reusing js/finance.js's tripSummary()
// for per-leg time/revenue rather than a separate continuous-rate model.
// Run once per reinvestment strategy so js/main.js can chart both
// side by side. See docs/ for the two strategies' exact rules; summarized
// at simulateCompany()'s own doc comment below.

import { buildSingleWagonTypeTrain } from "./train.js";
import { tripSummary, annualMaintenance, REAL_SECONDS_PER_GAME_YEAR } from "./finance.js";

export const LOAN_INCREMENT = 500_000;

// TF2's real loan-cap schedule — a step function of the in-game year, not
// of anything the company itself does. Only gates the *starting* loan
// input (see simulateCompany's own comment on why the cap never needs to
// be re-checked mid-simulation).
const LOAN_CAP_TIERS = [
  { year: 1850, cap: 10_000_000 },
  { year: 1900, cap: 30_000_000 },
  { year: 1950, cap: 100_000_000 },
];

export function loanCapForYear(year) {
  let cap = LOAN_CAP_TIERS[0].cap;
  for (const tier of LOAN_CAP_TIERS) {
    if (year >= tier.year) cap = tier.cap;
    else break;
  }
  return cap;
}

const MONTH_SECONDS = REAL_SECONDS_PER_GAME_YEAR / 12;
const MAX_EVENTS = 2_000_000; // safety cap, same convention as js/physics.js's MAX_STEPS

/**
 * Simulates one company's cash/loan/fleet trajectory over `simulationYears`
 * of continuous operation on `route`, for one strategy:
 *
 * - "reinvest": every dollar of surplus cash buys another wagon (of
 *   `wagonId`) the moment one's affordable, up to `maxWagons`. The loan
 *   is never touched — it sits at its starting balance for the whole run.
 * - "payoff": every dollar goes toward the loan instead, in exact
 *   `LOAN_INCREMENT` ($500k) steps — a sub-$500k amount can't make a
 *   payment, and (deliberately, per the strategy's own logic) doesn't get
 *   spent on a wagon either; it just waits for the next payment to become
 *   affordable. Once the loan hits exactly 0, this strategy starts buying
 *   wagons exactly like "reinvest" does.
 *
 * Revenue posts, and the strategy's buy/repay decision is evaluated,
 * at each leg completion — reusing tripSummary()'s own per-leg time_s/
 * revenue as the event schedule (cycled repeatedly; the route is a loop).
 * Maintenance and loan interest are charged together at each monthly
 * tick, both counted from t=0 (the moment the initial train is bought).
 * Buying a wagon takes effect at the start of the *next* leg: the
 * aggregate and its tripSummary are rebuilt immediately, and the next
 * leg's completion time is rescheduled from the current t using the new
 * (heavier, possibly slower) consist — never applied mid-leg.
 *
 * @returns {Array<{t_s: number, cash: number, loanBalance: number,
 *   wagonCount: number, netWorth: number}>|null} one point per event; null
 *   if the consist can't be built, the route can't be priced (see
 *   tripSummary), or startingCash + startingLoan can't cover the initial
 *   purchase (locomotive + initialWagonCount wagons) at all.
 */
export function simulateCompany({
  locomotiveId,
  wagonId,
  vehicleById,
  route,
  strategy,
  initialWagonCount,
  startingCash,
  startingLoan,
  maxWagons,
  simulationYears,
  difficulty,
  yearBasis,
  trackSpeedLimit_kmh,
  gravity_ms2,
}) {
  const trainWith = buildSingleWagonTypeTrain(locomotiveId, wagonId, vehicleById);
  const wagonVehicle = vehicleById.get(wagonId);
  if (!wagonVehicle) return null;
  const wagonPrice = wagonVehicle.price;

  let wagonCount = initialWagonCount;
  let aggregate = trainWith(wagonCount);
  if (!aggregate) return null;

  if (startingCash + startingLoan < aggregate.price) return null; // can't afford the initial purchase at all

  let cash = startingCash + startingLoan - aggregate.price;
  let loanBalance = startingLoan;

  const tripOptions = { trackSpeedLimit_kmh, difficulty, yearBasis, gravity_ms2 };
  let tripSum = tripSummary(aggregate, route, tripOptions);
  if (!tripSum || tripSum.legs.length === 0) return null;

  const simulationDuration_s = simulationYears * REAL_SECONDS_PER_GAME_YEAR;
  const netWorth = () => cash - loanBalance + aggregate.price;

  const settle = () => {
    if (strategy === "payoff") {
      while (loanBalance > 0 && cash >= LOAN_INCREMENT) {
        const payment = Math.min(LOAN_INCREMENT, loanBalance);
        cash -= payment;
        loanBalance -= payment;
      }
      if (loanBalance > 0) return; // strict: no reinvesting until the loan is fully clear
    }
    while (wagonCount < maxWagons && cash >= wagonPrice) {
      cash -= wagonPrice;
      wagonCount += 1;
      aggregate = trainWith(wagonCount);
      tripSum = tripSummary(aggregate, route, tripOptions);
      if (!tripSum) return; // shouldn't happen (same route, heavier consist) — bail defensively
    }
  };

  let t = 0;
  let legIndex = 0;
  let nextLegAt = tripSum.legs[legIndex].time_s;
  let nextMonthAt = MONTH_SECONDS;
  const points = [{ t_s: 0, cash, loanBalance, wagonCount, netWorth: netWorth() }];

  let events = 0;
  while (t < simulationDuration_s && events < MAX_EVENTS) {
    events++;
    if (nextLegAt <= nextMonthAt) {
      t = nextLegAt;
      cash += tripSum.legs[legIndex].revenue;
      legIndex = (legIndex + 1) % tripSum.legs.length;
      settle();
      nextLegAt = t + tripSum.legs[legIndex].time_s;
    } else {
      t = nextMonthAt;
      cash -= annualMaintenance(aggregate) / 12;
      cash -= loanBalance * 0.01 / 12; // flat 1% p.a., simple (non-compounding) interest — docs/cost_formulas.md
      nextMonthAt = t + MONTH_SECONDS;
    }
    points.push({ t_s: t, cash, loanBalance, wagonCount, netWorth: netWorth() });
  }
  return points;
}
