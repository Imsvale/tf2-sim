import { formatValue, formatMoney } from "./vehicles.js";

// Per-unit load mass, added to a train's tare mass assuming it's always
// fully loaded (matches the finance-side default load factor of 100%, but
// applied unconditionally here — decoupled from that slider for now, since
// only revenue was asked to respect partial loads. Revisit if/when mass
// should also scale with load factor).
const PASSENGER_MASS_T = 0.2;
const CARGO_MASS_T = 1.2;

// A train is a consist: one or more locomotives, zero or more wagons, each
// referenced by vehicle id with a quantity. See docs/ for why top speed is
// the minimum across every consist member (locomotives AND wagons — a slow
// wagon holds the whole train back, same as a slow locomotive would).
//
// Locomotive power and tractive effort are NOT simply summed for physics
// purposes: each locomotive has its own force-vs-speed curve
// (F_i(v) = min(P_i/v, F_i_max)), and only the *summed force at a given
// speed* is meaningful — summing P and F_max first and treating the result
// as one big locomotive overstates force (by up to 50%+ in the mixed
// force-/power-limited regime) whenever locomotives differ. So
// `aggregateTrain` keeps `power_kW`/`tractiveEffort_kN` as simple sums for
// *display* only, and separately exposes `locomotiveUnits` (grouped by
// vehicle type) for js/physics.js to compute the force curve correctly.

export function createTrain() {
  return { locomotives: [], wagons: [] };
}

export function addLocomotive(train, vehicleId, quantity = 1) {
  addOrIncrement(train.locomotives, vehicleId, quantity);
}

export function addWagon(train, vehicleId, quantity = 1) {
  addOrIncrement(train.wagons, vehicleId, quantity);
}

function addOrIncrement(list, vehicleId, quantity) {
  const existing = list.find((item) => item.vehicleId === vehicleId);
  if (existing) existing.quantity += quantity;
  else list.push({ vehicleId, quantity });
}

export function removeLocomotive(train, vehicleId) {
  train.locomotives = train.locomotives.filter((item) => item.vehicleId !== vehicleId);
}

export function removeWagon(train, vehicleId) {
  train.wagons = train.wagons.filter((item) => item.vehicleId !== vehicleId);
}

export function setLocomotiveQuantity(train, vehicleId, quantity) {
  setQuantity(train.locomotives, vehicleId, quantity);
}

export function setWagonQuantity(train, vehicleId, quantity) {
  setQuantity(train.wagons, vehicleId, quantity);
}

function setQuantity(list, vehicleId, quantity) {
  const item = list.find((i) => i.vehicleId === vehicleId);
  if (item) item.quantity = Math.max(1, Math.floor(quantity) || 1);
}

export function isEmpty(train) {
  return train.locomotives.length === 0 && train.wagons.length === 0;
}

/**
 * Aggregates a train's consist into the flat shape js/physics.js and
 * js/finance.js expect. Returns null if the train has no vehicles yet, or
 * references a vehicle id not present in `vehicleById` (stale selection).
 */
export function aggregateTrain(train, vehicleById) {
  if (isEmpty(train)) return null;

  const allItems = [...train.locomotives, ...train.wagons];
  for (const item of allItems) {
    if (!vehicleById.has(item.vehicleId)) return null;
  }

  let mass_t = 0;
  let power_kW = 0;
  let tractiveEffort_kN = 0;
  let price = 0;
  let passengerCapacity = 0;
  let cargoCapacity = 0;
  let topSpeed_kmh = Infinity;
  const locomotiveUnits = [];

  for (const { vehicleId, quantity } of train.locomotives) {
    const v = vehicleById.get(vehicleId);
    mass_t += v.mass_t * quantity;
    power_kW += v.power_kW * quantity;
    tractiveEffort_kN += v.tractiveEffort_kN * quantity;
    price += v.price * quantity;
    if (v.capacity > 0) passengerCapacity += v.capacity * quantity; // MU locomotives carry passengers
    topSpeed_kmh = Math.min(topSpeed_kmh, v.topSpeed_kmh);
    // Kept as separate per-type units (not summed) so physics.js can sum
    // each locomotive's own force-vs-speed curve rather than one combined
    // curve — see the module comment above.
    locomotiveUnits.push({ power_kW: v.power_kW, tractiveEffort_kN: v.tractiveEffort_kN, count: quantity });
  }

  for (const { vehicleId, quantity } of train.wagons) {
    const v = vehicleById.get(vehicleId);
    mass_t += v.mass_t * quantity;
    price += v.price * quantity;
    if (v.isPassengerWagon) passengerCapacity += v.capacity * quantity;
    else cargoCapacity += v.capacity * quantity;
    topSpeed_kmh = Math.min(topSpeed_kmh, v.topSpeed_kmh);
  }

  // Loaded mass: assume the train is always full (see PASSENGER_MASS_T/CARGO_MASS_T above).
  mass_t += passengerCapacity * PASSENGER_MASS_T + cargoCapacity * CARGO_MASS_T;

  return {
    mass_t,
    power_kW,
    tractiveEffort_kN,
    locomotiveUnits,
    topSpeed_kmh: Number.isFinite(topSpeed_kmh) ? topSpeed_kmh : 0,
    price,
    passengerCapacity,
    cargoCapacity,
    locomotiveCount: train.locomotives.reduce((sum, i) => sum + i.quantity, 0),
    wagonCount: train.wagons.reduce((sum, i) => sum + i.quantity, 0),
  };
}

// Fields shown in the train-vs-train aggregate spec comparison table.
export const TRAIN_SPEC_FIELDS = [
  { key: "locomotiveCount", label: "Locomotives" },
  { key: "wagonCount", label: "Wagons" },
  { key: "mass_t", label: "Total mass", unit: "t", note: "incl. full passenger/cargo load" },
  { key: "power_kW", label: "Total power", unit: "kW" },
  { key: "tractiveEffort_kN", label: "Tractive effort (nominal)", unit: "kN", note: "2× applied in physics" },
  { key: "topSpeed_kmh", label: "Top speed", unit: "km/h", note: "slowest consist member" },
  { key: "passengerCapacity", label: "Passenger capacity" },
  { key: "cargoCapacity", label: "Cargo capacity" },
  { key: "price", label: "Total price", format: "money" },
];

export function formatTrainSpecValue(aggregate, field) {
  if (field.format === "money") return formatMoney(aggregate[field.key]);
  return formatValue(aggregate[field.key], field);
}
