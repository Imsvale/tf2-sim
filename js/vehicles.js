export async function loadVehicles() {
  const response = await fetch("data/vehicles.json");
  if (!response.ok) {
    throw new Error(`Failed to load vehicle data: ${response.status}`);
  }
  return response.json();
}

// Computed (physics-derived) fields, locomotives only. See js/physics.js.
// Order matches the Physics tab's Acceleration & Travel Time table (after
// Mass/Power, which come from TRAIN_SPEC_FIELDS instead — see
// js/main.js's renderAccelerationSection). `detailOnly` fields are hidden
// unless state.accelerationDetail === "detailed".
export const ACCELERATION_FIELDS = [
  {
    key: "effectiveTractiveEffort_kN",
    label: "Effective tractive effort",
    unit: "kN",
    labelParts: [{ text: "Effective tractive effort", tooltip: "2× nominal — the game doubles the stated tractive effort in the physics simulation." }],
  },
  {
    key: "rollingResistance_kN",
    label: "Rolling resistance",
    unit: "kN",
    digits: 1,
    labelParts: [{ text: "Rolling resistance", tooltip: "R = m · g · C, where C = 0.002." }],
  },
  { key: "initialAcceleration_ms2", label: "Initial acceleration", unit: "m/s²", digits: 3 },
  { key: "tractiveThreshold_kmh", label: "Tractive threshold speed", unit: "km/h", digits: 1, detailOnly: true },
];

export function formatValue(value, { unit, digits } = {}) {
  if (value === undefined || value === null || value === "") return "—";
  const num = typeof value === "number" ? (digits !== undefined ? value.toFixed(digits) : value) : value;
  return unit ? `${num} ${unit}` : `${num}`;
}

// TF2's in-game currency isn't real-world USD, so this formats as a plain
// grouped number with a generic "$" prefix rather than using Intl's
// currency style (which would print a locale-dependent "USD"/"$US" suffix).
export function formatMoney(value) {
  if (value === undefined || value === null) return "—";
  return `$${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)}`;
}

// Abbreviated currency for the Finances tab, where per-leg/trip totals can
// run into six or seven figures — "$1.2M" instead of "$1,246,247". Vehicle
// prices elsewhere keep the exact formatMoney() above; comparing purchase
// prices benefits from precision more than trip financials do.
export function formatMoneyCompact(value) {
  if (value === undefined || value === null) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs < 1000) return `${sign}$${Math.round(abs)}`;

  const scale = (divisor, suffix) => {
    const rounded = Number((abs / divisor).toFixed(1));
    return { rounded, text: `${rounded}${suffix}` };
  };
  // Round-then-check rather than a fixed abs<1_000_000 cutoff — a value
  // like 999,999 rounds to "1000.0" at 1 decimal in "k", which should
  // print as "$1M", not "$1000k".
  let result = scale(1_000, "k");
  if (result.rounded >= 1000) result = scale(1_000_000, "M");
  return `${sign}$${result.text}`;
}

/** Compact one-line spec summary for a chip tooltip, e.g. "30t, $243,886, 40 km/h". */
export function formatCompactSpec(vehicle) {
  const parts = [`${vehicle.mass_t}t`, formatMoney(vehicle.price), `${vehicle.topSpeed_kmh} km/h`];
  if (vehicle.kind === "locomotive") {
    parts.push(`${vehicle.power_kW} kW`, `${vehicle.tractiveEffort_kN} kN nom.`);
  } else if (vehicle.capacity > 0) {
    parts.push(`${vehicle.capacity} ${vehicle.capacityUnit}`);
  }
  return parts.join(", ");
}
