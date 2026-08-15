export async function loadVehicles() {
  const response = await fetch("data/vehicles.json");
  if (!response.ok) {
    throw new Error(`Failed to load vehicle data: ${response.status}`);
  }
  return response.json();
}

// Ordered fields shown in the comparison table.
// This is a placeholder set until real game formulas define derived stats.
export const COMPARE_FIELDS = [
  { key: "category", label: "Category" },
  { key: "length_m", label: "Length", unit: "m" },
  { key: "weight_t", label: "Weight", unit: "t" },
  { key: "maxSpeed_kmh", label: "Max speed", unit: "km/h" },
  { key: "power_kW", label: "Power", unit: "kW" },
  { key: "tractiveEffort_kN", label: "Tractive effort", unit: "kN" },
  { key: "capacity", label: "Capacity", unitKey: "capacityUnit" },
  { key: "purchaseCost", label: "Purchase cost", format: "currency" },
];

export function formatFieldValue(vehicle, field) {
  const value = vehicle[field.key];
  if (value === undefined || value === null || value === "") return "—";

  if (field.format === "currency") {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  }

  const unit = field.unitKey ? vehicle[field.unitKey] : field.unit;
  if (unit && unit !== "n/a") {
    return `${value} ${unit}`;
  }
  return `${value}`;
}
