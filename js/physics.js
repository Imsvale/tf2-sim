// Rail acceleration/travel-time model. See docs/acceleration_formulas.md for
// the derivation, units, and why the taper zone is handled by direct
// simulation rather than a closed form.
//
// `aggregate` throughout this module means a train's aggregated totals from
// js/train.js: { mass_t, topSpeed_kmh, locomotiveUnits }, where
// locomotiveUnits is [{ power_kW, tractiveEffort_kN, count }] — kept
// per-locomotive-type rather than pre-summed. See the comment in
// js/train.js: summing power/TE first and treating the train as one big
// locomotive overstates force whenever locomotives differ, because each
// locomotive has its own force-vs-speed curve F_i(v) = min(P_i/v, F_i_max),
// and only the *sum of those curves* — not a curve built from summed
// scalars — gives the correct total drive force at a given speed.

const G = 9.81;
const ROLLING_RESISTANCE_C = 0.002;

function taperFactor(v, k) {
  const x = 20 * (v / k - 0.95);
  return Math.sqrt(Math.max(0, Math.min(1, x)));
}

// Builds the full-curve acceleration function for one aggregate + track
// speed limit. Total drive force at speed v is the sum of each locomotive
// type's own min(P_i/v, F_i_max) — force-limited and power-limited
// locomotives can coexist in the same consist at the same speed. The taper
// factor naturally evaluates to 0 below v_95 (see acceleration_formulas.md),
// so no separate phase branching is needed for that either.
function buildDynamics(aggregate) {
  const { mass_t: m, topSpeed_kmh: V, locomotiveUnits } = aggregate;
  if (!m || !V || !locomotiveUnits || locomotiveUnits.length === 0) return null;

  const units = locomotiveUnits
    .map((u) => ({ P: u.power_kW, F: 2 * u.tractiveEffort_kN, count: u.count })) // the game doubles the stated tractive effort
    .filter((u) => u.P > 0 && u.F > 0 && u.count > 0);
  if (units.length === 0) return null;

  const R = m * G * ROLLING_RESISTANCE_C;

  // v/0 is +Infinity in IEEE754 (P is always positive here), so this
  // correctly reduces to each locomotive's force-limited max at v=0
  // without needing a special case.
  const driveForce = (v) => units.reduce((sum, u) => sum + u.count * Math.min(u.P / v, u.F), 0);

  const F0 = driveForce(0); // total force at a standstill — every locomotive is force-limited there
  if (F0 <= R) return { warning: "Tractive effort does not exceed rolling resistance — vehicle cannot accelerate." };

  const ownTopSpeed = V / 3.6; // m/s, always governs the taper zone regardless of track speed limit
  const k = ownTopSpeed + 0.136;
  const a0 = (F0 - R) / m;

  // A single "tractive threshold speed" (force-limited -> power-limited
  // transition) only exists when every locomotive shares the same P/F
  // ratio — otherwise different locomotives cross over at different
  // speeds, so there's no one value to report.
  const ratios = new Set(units.map((u) => (u.P / u.F).toFixed(6)));
  const vt = ratios.size === 1 ? units[0].P / units[0].F : null;

  const accel = (v) => ((driveForce(v) - R) / m) * (1 - taperFactor(v, k));

  return { m, R, F0, vt, a0, k, ownTopSpeed, accel, driveForce };
}

const RK4_DT = 0.02; // seconds
const MAX_STEPS = 300_000; // safety cap; real curves finish in a few thousand steps

/**
 * Simulate a train/vehicle accelerating from initialSpeed_kmh, stopping when
 * `stopAt` is satisfied (or once the effective top speed is reached and
 * held, for distance/duration targets beyond that point).
 *
 * @param {object} aggregate - { mass_t, topSpeed_kmh, locomotiveUnits } from js/train.js's aggregateTrain()
 * @param {object} options
 * @param {number} [options.initialSpeed_kmh=0]
 * @param {number|null} [options.trackSpeedLimit_kmh=null] - caps the target/cruise
 *   speed; does NOT affect where the taper zone (v_95/k) starts — that's always
 *   tied to the vehicle/train's own topSpeed_kmh.
 * @param {object} options.stopAt - exactly one of { speed_kmh } | { distance_m } | { duration_s }
 * @param {boolean} [options.sample=false] - collect a downsampled {t,v_kmh,d_m,a_ms2} trajectory
 * @returns {null|{warning:string}|object} null if the vehicle can't move (no
 *   power/TE/mass/topSpeed — e.g. a wagon), a { warning } object if it can't
 *   overcome rolling resistance, or the simulation result.
 */
export function simulate(aggregate, options) {
  const dynamics = buildDynamics(aggregate);
  if (!dynamics) return null;
  if (dynamics.warning) return dynamics;

  const { m, accel, ownTopSpeed, k } = dynamics;
  const { initialSpeed_kmh = 0, trackSpeedLimit_kmh = null, stopAt, sample = false } = options;

  const effectiveTop = trackSpeedLimit_kmh != null ? Math.min(ownTopSpeed, trackSpeedLimit_kmh / 3.6) : ownTopSpeed;
  const v95 = 0.95 * k;

  let v = initialSpeed_kmh / 3.6;
  let t = 0;
  let d = 0;
  let v95Checkpoint = null;

  const rawSamples = sample ? [{ t, v_kmh: v * 3.6, d_m: d, a_ms2: accel(v) }] : null;

  const speedTarget = stopAt.speed_kmh != null ? Math.min(stopAt.speed_kmh / 3.6, effectiveTop) : effectiveTop;
  const distanceTarget = stopAt.distance_m ?? null;
  const durationTarget = stopAt.duration_s ?? null;

  const reachedStopCondition = () => {
    if (stopAt.speed_kmh != null) return v >= speedTarget;
    if (distanceTarget != null) return d >= distanceTarget;
    if (durationTarget != null) return t >= durationTarget;
    return false;
  };

  // Acceleration phase: numerically integrate up to effectiveTop, or until
  // the stop condition is met first, whichever comes first.
  for (let i = 0; i < MAX_STEPS && v < effectiveTop && !reachedStopCondition(); i++) {
    const step = Math.min(RK4_DT, (effectiveTop - v) / Math.max(accel(v), 1e-6));
    const k1v = accel(v);
    const k1d = v;
    const k2v = accel(v + (step / 2) * k1v);
    const k2d = v + (step / 2) * k1v;
    const k3v = accel(v + (step / 2) * k2v);
    const k3d = v + (step / 2) * k2v;
    const k4v = accel(v + step * k3v);
    const k4d = v + step * k3v;

    v += (step / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    d += (step / 6) * (k1d + 2 * k2d + 2 * k3d + k4d);
    t += step;

    if (!v95Checkpoint && v >= v95) v95Checkpoint = { t, d };
    if (sample) rawSamples.push({ t, v_kmh: v * 3.6, d_m: d, a_ms2: accel(v) });
  }

  // Cruise phase: if we reached effectiveTop before satisfying a
  // distance/duration stop condition, finish the remainder at constant speed.
  if (v >= effectiveTop && !reachedStopCondition()) {
    if (distanceTarget != null) {
      const remaining = distanceTarget - d;
      const cruiseTime = remaining / effectiveTop;
      t += cruiseTime;
      d = distanceTarget;
    } else if (durationTarget != null) {
      const remaining = durationTarget - t;
      d += effectiveTop * remaining;
      t = durationTarget;
    }
    if (sample) rawSamples.push({ t, v_kmh: effectiveTop * 3.6, d_m: d, a_ms2: 0 });
  }

  const result = {
    time_s: t,
    distance_m: d,
    finalSpeed_kmh: v * 3.6,
    v95Checkpoint,
  };
  if (sample) result.samples = downsample(rawSamples, 200);
  return result;
}

function downsample(samples, maxPoints) {
  if (samples.length <= maxPoints) return samples;
  const stride = Math.ceil(samples.length / maxPoints);
  const out = samples.filter((_, i) => i % stride === 0);
  if (out[out.length - 1] !== samples[samples.length - 1]) out.push(samples[samples.length - 1]);
  return out;
}

/** Drive force at a given speed (kN), for the force-vs-speed graph. */
export function forceAtSpeed(aggregate, v_kmh) {
  const dynamics = buildDynamics(aggregate);
  if (!dynamics || dynamics.warning) return null;
  return dynamics.driveForce(v_kmh / 3.6);
}

/** Acceleration at a given speed (m/s²), including taper, for the acceleration-vs-speed graph. */
export function accelerationAtSpeed(aggregate, v_kmh) {
  const dynamics = buildDynamics(aggregate);
  if (!dynamics || dynamics.warning) return null;
  return dynamics.accel(v_kmh / 3.6);
}

/** Rolling resistance (kN) for an aggregate, exposed for the acceleration-stats display. */
export function rollingResistance(aggregate) {
  const dynamics = buildDynamics(aggregate);
  if (!dynamics || dynamics.warning) return null;
  return dynamics.R;
}

/** Convenience: full-curve stats to the aggregate's own (optionally track-capped) top speed. */
export function computeAccelerationStats(aggregate, trackSpeedLimit_kmh = null) {
  const dynamics = buildDynamics(aggregate);
  if (!dynamics) return null;
  if (dynamics.warning) return dynamics;

  const result = simulate(aggregate, { trackSpeedLimit_kmh, stopAt: {} });
  return {
    rollingResistance_kN: dynamics.R,
    effectiveTractiveEffort_kN: dynamics.F0,
    tractiveThreshold_kmh: dynamics.vt != null ? dynamics.vt * 3.6 : null,
    initialAcceleration_ms2: dynamics.a0,
    time95_s: result.v95Checkpoint?.t ?? null,
    distance95_m: result.v95Checkpoint?.d ?? null,
    totalTime_s: result.time_s,
    totalDistance_m: result.distance_m,
    finalSpeed_kmh: result.finalSpeed_kmh,
  };
}
