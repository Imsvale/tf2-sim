import { formatValue, formatMoney } from "./vehicles.js";

// Per-unit load mass, added to a train's tare mass assuming it's always
// fully loaded (matches the finance-side default load factor of 100%, but
// applied unconditionally here — decoupled from that slider for now, since
// only revenue was asked to respect partial loads. Revisit if/when mass
// should also scale with load factor).
const PASSENGER_MASS_T = 0.2;
const CARGO_MASS_T = 1.2;

// A train is a consist: one or more locomotives, zero or more wagons, each
// an independent, *positional* group — {vehicleId, quantity} addressed by
// its index in the array, not deduplicated by vehicleId. This lets the same
// vehicle type appear as two separate groups in different positions (e.g.
// 3 boxcars, then 2 tankers, then 2 more boxcars) — necessary for the
// insert-a-new-group-after-this-one UI in js/main.js. Every mutator below
// therefore takes an index, not a vehicleId. See docs/ for why top speed is
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
// *display* only, and separately exposes `locomotiveUnits` (one entry per
// group, NOT merged by vehicle type) for js/physics.js to compute the force
// curve correctly — summing two same-type groups separately is
// mathematically identical to summing one combined group, so this needs no
// special handling for the positional model above.

export function createTrain() {
  return { locomotives: [], wagons: [], name: null };
}

/** Deep-copies a train's consist so the clone shares no mutable state with the original. Does NOT
 *  copy the source's custom name — two identically-labeled trains would be harder to tell apart
 *  in tables/charts than the default "Train N", so the clone starts unnamed. */
export function cloneTrain(train) {
  return {
    name: null,
    locomotives: train.locomotives.map((item) => ({ ...item })),
    wagons: train.wagons.map((item) => ({ ...item })),
  };
}

export function insertLocomotive(train, index, vehicleId, quantity = 1) {
  train.locomotives.splice(index, 0, { vehicleId, quantity });
}

export function insertWagon(train, index, vehicleId, quantity = 1) {
  train.wagons.splice(index, 0, { vehicleId, quantity });
}

export function removeLocomotiveAt(train, index) {
  train.locomotives.splice(index, 1);
}

export function removeWagonAt(train, index) {
  train.wagons.splice(index, 1);
}

export function setLocomotiveQuantityAt(train, index, quantity) {
  train.locomotives[index].quantity = Math.max(1, Math.floor(quantity) || 1);
}

export function setWagonQuantityAt(train, index, quantity) {
  train.wagons[index].quantity = Math.max(1, Math.floor(quantity) || 1);
}

export function setLocomotiveTypeAt(train, index, vehicleId) {
  train.locomotives[index].vehicleId = vehicleId;
}

export function setWagonTypeAt(train, index, vehicleId) {
  train.wagons[index].vehicleId = vehicleId;
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
// `labelParts`, when present, is how a row header gets a dashed-underline
// info tooltip on part (or all) of its text — an array of plain strings and
// { text, tooltip } spans, rendered by js/main.js's buildFieldHeaderCell.
// `label` is kept as a plain-text fallback alongside it (accessibility/aria
// uses, and for fields that don't need a tooltip at all).
export const TRAIN_SPEC_FIELDS = [
  { key: "locomotiveCount", label: "Locomotives" },
  { key: "wagonCount", label: "Wagons" },
  {
    key: "mass_t",
    label: "Total mass",
    unit: "t",
    labelParts: [
      { text: "Total mass", tooltip: "Includes full passenger/cargo load, assuming the train is always fully loaded." },
    ],
  },
  { key: "power_kW", label: "Total power", unit: "kW" },
  {
    key: "tractiveEffort_kN",
    label: "Tractive effort (nominal)",
    unit: "kN",
    labelParts: [
      "Tractive effort (",
      { text: "nominal", tooltip: "Game uses 2× TE in the physics simulation. See Physics section." },
      ")",
    ],
  },
  {
    key: "topSpeed_kmh",
    label: "Top speed",
    unit: "km/h",
    labelParts: [{ text: "Top speed", tooltip: "Lowest top speed of all units in the consist." }],
  },
  { key: "passengerCapacity", label: "Passenger capacity" },
  { key: "cargoCapacity", label: "Cargo capacity" },
  { key: "price", label: "Total price", format: "money" },
];

export function formatTrainSpecValue(aggregate, field) {
  if (field.format === "money") return formatMoney(aggregate[field.key]);
  return formatValue(aggregate[field.key], field);
}
