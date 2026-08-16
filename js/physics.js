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

// Default/vanilla gravity — the formula's own correctness at this value
// isn't confirmed (see docs/acceleration_formulas.md), which is exactly why
// every caller threads its own gravity_ms2 through rather than this module
// hardcoding it: the Physics tab's gravity control lets it be overridden
// end to end for comparison against real in-game telemetry.
const DEFAULT_GRAVITY_MS2 = 9.81;
const ROLLING_RESISTANCE_C = 0.002;

// Squared, not square-rooted — confirmed against real in-game telemetry
// (../../tf2-watcher/tests/*.csv, see docs/acceleration_formulas.md's
// "Resolved: the exponent, not the constant"). The onset constant (20) and
// the 0.95 threshold were already correct; a sqrt here over-tapers
// immediately past v_95, while squaring reproduces the observed shape
// (barely noticeable taper just past v_95, falling off hard near the cap)
// to within noise of the already-trusted pre-95% zone on both captured
// vehicles.
function taperFactor(v, k) {
  const x = 20 * (v / k - 0.95);
  const clamped = Math.max(0, Math.min(1, x));
  return clamped * clamped;
}

// Builds the full-curve acceleration function for one aggregate + track
// speed limit. Total drive force at speed v is the sum of each locomotive
// type's own min(P_i/v, F_i_max) — force-limited and power-limited
// locomotives can coexist in the same consist at the same speed. The taper
// factor naturally evaluates to 0 below v_95 (see acceleration_formulas.md),
// so no separate phase branching is needed for that either.
function buildDynamics(aggregate, gravity_ms2 = DEFAULT_GRAVITY_MS2) {
  const { mass_t: m, topSpeed_kmh: V, locomotiveUnits } = aggregate;
  if (!m || !V || !locomotiveUnits || locomotiveUnits.length === 0) return null;

  const units = locomotiveUnits
    .map((u) => ({ P: u.power_kW, F: 2 * u.tractiveEffort_kN, count: u.count })) // the game doubles the stated tractive effort
    .filter((u) => u.P > 0 && u.F > 0 && u.count > 0);
  if (units.length === 0) return null;

  const R = m * gravity_ms2 * ROLLING_RESISTANCE_C;

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

  // Taper applies to net force only, never to rolling resistance — R is a
  // flat penalty subtracted at full strength regardless of speed (the
  // source's own description is "a = a * (1 - f(v))", i.e. the taper
  // multiplies the already-net acceleration, not the raw drive force).
  // effectiveForce is the force-domain quantity that reproduces that exact
  // acceleration through the ordinary a = (F - R) / m relationship, so the
  // Force-vs-speed graph and the Acceleration-vs-speed graph agree with
  // each other rather than one silently double-counting friction's taper.
  // (Naively tapering just F_drive and then subtracting a full, untapered
  // R would under-count net force by R * taper(v) — friction doesn't taper.)
  const effectiveForce = (v) => R + (driveForce(v) - R) * (1 - taperFactor(v, k));
  const accel = (v) => (effectiveForce(v) - R) / m;

  return { m, R, F0, vt, a0, k, ownTopSpeed, accel, driveForce, effectiveForce };
}

const RK4_DT = 0.02; // seconds
const MAX_STEPS = 300_000; // safety cap; real curves finish in a few thousand steps

// One classic 4-stage Runge-Kutta step for dv/dt = accel(v), dd/dt = v, over
// a caller-chosen step size — shared by simulate() and simulateToStop() so
// the tableau itself isn't duplicated between them (they differ only in
// how they choose `step` and when they stop).
function rk4Step(v, step, accel) {
  const k1v = accel(v);
  const k1d = v;
  const k2v = accel(v + (step / 2) * k1v);
  const k2d = v + (step / 2) * k1v;
  const k3v = accel(v + (step / 2) * k2v);
  const k3d = v + (step / 2) * k2v;
  const k4v = accel(v + step * k3v);
  const k4d = v + step * k3v;
  return {
    dv: (step / 6) * (k1v + 2 * k2v + 2 * k3v + k4v),
    dd: (step / 6) * (k1d + 2 * k2d + 2 * k3d + k4d),
  };
}

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
 * @param {number} [options.gravity_ms2=9.81] - see buildDynamics
 * @returns {null|{warning:string}|object} null if the vehicle can't move (no
 *   power/TE/mass/topSpeed — e.g. a wagon), a { warning } object if it can't
 *   overcome rolling resistance, or the simulation result.
 */
export function simulate(aggregate, options) {
  const { initialSpeed_kmh = 0, trackSpeedLimit_kmh = null, stopAt, sample = false, gravity_ms2 } = options;
  const dynamics = buildDynamics(aggregate, gravity_ms2);
  if (!dynamics) return null;
  if (dynamics.warning) return dynamics;

  const { m, accel, ownTopSpeed, k, vt } = dynamics;

  const effectiveTop = trackSpeedLimit_kmh != null ? Math.min(ownTopSpeed, trackSpeedLimit_kmh / 3.6) : ownTopSpeed;
  const v95 = 0.95 * k;

  let v = initialSpeed_kmh / 3.6;
  let t = 0;
  let d = 0;
  let v95Checkpoint = null;
  let vtCheckpoint = null; // null forever if vt is null (mixed-locomotive consist, see buildDynamics) or never reached (e.g. capped by a lower track speed limit)

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
    const { dv, dd } = rk4Step(v, step, accel);

    v += dv;
    d += dd;
    t += step;

    if (!vtCheckpoint && vt != null && v >= vt) vtCheckpoint = { t, d };
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
    vtCheckpoint,
    v95Checkpoint,
  };
  if (sample) result.samples = downsample(rawSamples, 200);
  return result;
}

/**
 * Simulate one leg door-to-door: accelerate from a standing start (same
 * assumption legTime() already makes — trains fully stop at every
 * station), cruise if the leg is long enough to reach effectiveTop, then
 * brake to a full stop exactly at `distance_m`. Unlike simulate(), this
 * always ends at v=0 — there's no "keep going past this point" case,
 * since every leg ends at a station.
 *
 * Braking is modeled as a flat deceleration (not run through accel()/the
 * taper — braking is a distinct game mechanic, not reduced engine power),
 * so once braking starts it's closed-form: v²=2·a_brake·d_brake. The only
 * numerically-interesting part is finding *where* braking must start,
 * which this does by checking, at every accel/cruise step, "if I braked
 * right now, would I stop by the station?" — the first step where that's
 * true is where braking begins.
 *
 * @param {object} aggregate - see simulate()
 * @param {number} distance_m - the leg's real (track) distance
 * @param {object} options
 * @param {number|null} [options.trackSpeedLimit_kmh=null]
 * @param {number} options.brakingDeceleration_ms2 - flat, positive (e.g. 2.5)
 * @param {boolean} [options.sample=false] - collect a downsampled
 *   {t,v_kmh,d_m,a_ms2,phase} trajectory; phase is "run" (accelerating/
 *   cruising) or "brake" (a_ms2 is exactly -brakingDeceleration_ms2
 *   throughout that phase — flat, not run through accel()/the taper), so
 *   callers can render the two differently
 * @param {number} [options.gravity_ms2=9.81] - see buildDynamics
 * @returns {null|{warning:string}|object}
 */
export function simulateToStop(aggregate, distance_m, options) {
  const { trackSpeedLimit_kmh = null, brakingDeceleration_ms2, sample = false, gravity_ms2 } = options;
  const dynamics = buildDynamics(aggregate, gravity_ms2);
  if (!dynamics) return null;
  if (dynamics.warning) return dynamics;

  const { accel, ownTopSpeed } = dynamics;
  const effectiveTop = trackSpeedLimit_kmh != null ? Math.min(ownTopSpeed, trackSpeedLimit_kmh / 3.6) : ownTopSpeed;

  let v = 0;
  let t = 0;
  let d = 0;
  const rawSamples = sample ? [{ t, v_kmh: 0, d_m: 0, a_ms2: accel(0), phase: "run" }] : null;

  for (let i = 0; i < MAX_STEPS && v < effectiveTop; i++) {
    const brakeDistanceIfNow = (v * v) / (2 * brakingDeceleration_ms2);
    if (d + brakeDistanceIfNow >= distance_m) break; // this step is where braking must start
    const { dv, dd } = rk4Step(v, RK4_DT, accel);
    v += dv;
    d += dd;
    t += RK4_DT;
    if (sample) rawSamples.push({ t, v_kmh: v * 3.6, d_m: d, a_ms2: accel(v), phase: "run" });
  }

  // The loop above can only exit by the braking trigger (v stays below
  // effectiveTop) or by reaching effectiveTop first (long leg) — in the
  // latter case, cruise for whatever distance remains before the brake
  // point, at effectiveTop, before handing off to the braking phase below.
  if (v >= effectiveTop) {
    const brakeDistance = (effectiveTop * effectiveTop) / (2 * brakingDeceleration_ms2);
    const cruiseDistance = Math.max(0, distance_m - d - brakeDistance);
    t += cruiseDistance / effectiveTop;
    d += cruiseDistance;
    if (sample) rawSamples.push({ t, v_kmh: effectiveTop * 3.6, d_m: d, a_ms2: accel(v), phase: "run" });
  }

  const brakeStart = { t, d, v };
  const brakeTime = v / brakingDeceleration_ms2;
  if (sample) {
    const BRAKE_STEPS = 20;
    for (let i = 1; i <= BRAKE_STEPS; i++) {
      const bt = (brakeTime * i) / BRAKE_STEPS;
      const bv = Math.max(0, v - brakingDeceleration_ms2 * bt);
      const bd = d + v * bt - 0.5 * brakingDeceleration_ms2 * bt * bt;
      rawSamples.push({ t: t + bt, v_kmh: bv * 3.6, d_m: bd, a_ms2: -brakingDeceleration_ms2, phase: "brake" });
    }
  }

  const result = { totalTime_s: t + brakeTime, distance_m, brakeStart };
  if (sample) {
    // Downsample the run phase only — it's the one that can have
    // thousands of RK4 steps on a long leg. The brake phase is always
    // exactly BRAKE_STEPS points (cheap either way), and downsampling the
    // two together could otherwise thin out the brake segment's shape on
    // long legs, since a uniform stride over "thousands of run points +
    // 20 brake points" mostly falls on run points.
    const runSamples = downsample(rawSamples.filter((s) => s.phase === "run"), 200);
    const brakeSamples = rawSamples.filter((s) => s.phase === "brake");
    result.samples = runSamples.concat(brakeSamples);
  }
  return result;
}

function downsample(samples, maxPoints) {
  if (samples.length <= maxPoints) return samples;
  const stride = Math.ceil(samples.length / maxPoints);
  const out = samples.filter((_, i) => i % stride === 0);
  if (out[out.length - 1] !== samples[samples.length - 1]) out.push(samples[samples.length - 1]);
  return out;
}

/**
 * Effective (taper-applied) force at a given speed (kN), for the
 * force-vs-speed graph — see buildDynamics' effectiveForce comment for why
 * this, and not the raw drive force, is what should be plotted: it's the
 * force-domain quantity consistent with the actual (tapered) acceleration.
 */
export function forceAtSpeed(aggregate, v_kmh, gravity_ms2) {
  const dynamics = buildDynamics(aggregate, gravity_ms2);
  if (!dynamics || dynamics.warning) return null;
  return dynamics.effectiveForce(v_kmh / 3.6);
}

/** Acceleration at a given speed (m/s²), including taper, for the acceleration-vs-speed graph. */
export function accelerationAtSpeed(aggregate, v_kmh, gravity_ms2) {
  const dynamics = buildDynamics(aggregate, gravity_ms2);
  if (!dynamics || dynamics.warning) return null;
  return dynamics.accel(v_kmh / 3.6);
}

/** Rolling resistance (kN) for an aggregate, exposed for the acceleration-stats display. */
export function rollingResistance(aggregate, gravity_ms2) {
  const dynamics = buildDynamics(aggregate, gravity_ms2);
  if (!dynamics || dynamics.warning) return null;
  return dynamics.R;
}

/** Convenience: full-curve stats to the aggregate's own (optionally track-capped) top speed. */
export function computeAccelerationStats(aggregate, trackSpeedLimit_kmh = null, gravity_ms2) {
  const dynamics = buildDynamics(aggregate, gravity_ms2);
  if (!dynamics) return null;
  if (dynamics.warning) return dynamics;

  const result = simulate(aggregate, { trackSpeedLimit_kmh, stopAt: {}, gravity_ms2 });
  return {
    rollingResistance_kN: dynamics.R,
    effectiveTractiveEffort_kN: dynamics.F0,
    tractiveThreshold_kmh: dynamics.vt != null ? dynamics.vt * 3.6 : null,
    initialAcceleration_ms2: dynamics.a0,
    timeThreshold_s: result.vtCheckpoint?.t ?? null,
    distanceThreshold_m: result.vtCheckpoint?.d ?? null,
    time95_s: result.v95Checkpoint?.t ?? null,
    distance95_m: result.v95Checkpoint?.d ?? null,
    totalTime_s: result.time_s,
    totalDistance_m: result.distance_m,
    finalSpeed_kmh: result.finalSpeed_kmh,
  };
}
