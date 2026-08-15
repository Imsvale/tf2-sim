// Converts data/Locos.csv and data/Wagons.csv into data/vehicles.json, the
// app's runtime vehicle library format. Re-run this whenever the source CSVs
// change:
//
//   node scripts/build-vehicles.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");

function splitCSVLine(line) {
  const values = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      values.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  values.push(cur);
  return values;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCSVLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return row;
  });
}

function num(value) {
  if (value === undefined || value === null || value.trim() === "") return null;
  return Number(value);
}

// The game's "End" year field uses both blank and 0 to mean "no retirement
// date" inconsistently across rows — normalize both to null.
function yearEnd(value) {
  const n = num(value);
  return n === null || n === 0 ? null : n;
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function mapLoco(row) {
  const type = row["Type"];
  const capacity = num(row["Capacity"]) || 0;
  return {
    id: `loco-${slug(row["Name"])}`,
    kind: "locomotive",
    name: row["Name"],
    region: row["Region"],
    type,
    isMultipleUnit: /MU/i.test(type),
    price: num(row["Price"]),
    topSpeed_kmh: num(row["Top Speed"]),
    power_kW: num(row["Power"]),
    tractiveEffort_kN: num(row["Tractive Effort"]),
    mass_t: num(row["Mass"]),
    capacity,
    capacityUnit: capacity > 0 ? "passengers" : "n/a",
    loadingSpeed: num(row["Loading speed"]),
    emission: num(row["Emission"]),
    yearStart: num(row["Start"]),
    lifespanYears: num(row["Lifespan"]),
    yearEnd: yearEnd(row["End"]),
  };
}

function mapWagon(row) {
  const cargoTypes = row["Cargo Type"]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const isPassengerWagon = cargoTypes.includes("Passengers");
  return {
    id: `wagon-${slug(row["Name"])}`,
    kind: "wagon",
    name: row["Name"],
    region: row["Region"],
    cargoTypes,
    isPassengerWagon,
    price: num(row["Price"]),
    topSpeed_kmh: num(row["Top Speed"]),
    mass_t: num(row["Mass"]),
    capacity: num(row["Capacity"]) || 0,
    capacityUnit: isPassengerWagon ? "passengers" : "cargo units",
    loadingSpeed: num(row["Loading Speed"]),
    emission: num(row["Emission"]),
    yearStart: num(row["Start"]),
    lifespanYears: num(row["Lifespan"]),
    yearEnd: yearEnd(row["End"]),
  };
}

const locoRows = parseCSV(readFileSync(path.join(dataDir, "Locos.csv"), "utf-8"));
const wagonRows = parseCSV(readFileSync(path.join(dataDir, "Wagons.csv"), "utf-8"));

const vehicles = [...locoRows.map(mapLoco), ...wagonRows.map(mapWagon)];

const ids = new Set();
for (const v of vehicles) {
  if (ids.has(v.id)) throw new Error(`Duplicate vehicle id: ${v.id}`);
  ids.add(v.id);
}

writeFileSync(path.join(dataDir, "vehicles.json"), JSON.stringify(vehicles, null, 2) + "\n");

console.log(`Wrote ${vehicles.length} vehicles (${locoRows.length} locomotives, ${wagonRows.length} wagons) to data/vehicles.json`);
