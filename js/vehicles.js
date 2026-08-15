export async function loadVehicles() {
  const response = await fetch("data/vehicles.json");
  if (!response.ok) {
    throw new Error(`Failed to load vehicle data: ${response.status}`);
  }
  return response.json();
}

// Computed (physics-derived) fields, locomotives only. See js/physics.js.
export const ACCELERATION_FIELDS = [
  { key: "rollingResistance_kN", label: "Rolling resistance", unit: "kN", digits: 1 },
  { key: "effectiveTractiveEffort_kN", label: "Effective tractive effort", unit: "kN", note: "2× nominal" },
  { key: "tractiveThreshold_kmh", label: "Tractive threshold speed", unit: "km/h", digits: 1 },
  { key: "initialAcceleration_ms2", label: "Initial acceleration", unit: "m/s²", digits: 3 },
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

/** Compact one-line spec summary for a consist-list entry, e.g. "30t, $243,886, 40 km/h". */
export function formatCompactSpec(vehicle) {
  const parts = [`${vehicle.mass_t}t`, formatMoney(vehicle.price), `${vehicle.topSpeed_kmh} km/h`];
  if (vehicle.kind === "locomotive") {
    parts.push(`${vehicle.power_kW} kW`, `${vehicle.tractiveEffort_kN} kN nom.`);
  } else if (vehicle.capacity > 0) {
    parts.push(`${vehicle.capacity} ${vehicle.capacityUnit}`);
  }
  return parts.join(", ");
}
