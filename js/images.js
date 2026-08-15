// Maps a vehicle to its artwork under img/. See CREDITS.md for attribution
// (Flaticon, free-with-attribution license).

const IMAGES = {
  steam: "img/steam.png",
  diesel: "img/diesel.png",
  electric: "img/electric.png",
  pax: "img/maswan-pax.png",
  tanker: "img/maswan-tanker.png",
  hopper: "img/maswan-hopper.png",
  freightWagon: "img/freight-wagon.png",
};

// Bucketed by cargo type — verified against data/vehicles.json that every
// wagon's cargoTypes are homogeneous (never span two buckets), so checking
// just the first entry is sufficient.
const CARGO_BUCKET = {
  Crude: "tanker",
  Oil: "tanker",
  Fuel: "tanker",
  Coal: "hopper",
  Iron: "hopper",
  Stone: "hopper",
  Grain: "hopper",
  Logs: "hopper",
  Steel: "hopper",
  Planks: "hopper",
  "Construction material": "hopper",
  Plastic: "freightWagon",
  Machines: "freightWagon",
  Machine: "freightWagon",
  Tools: "freightWagon",
  Food: "freightWagon",
  Goods: "freightWagon",
};

export function imageForVehicle(vehicle) {
  if (vehicle.kind === "locomotive") {
    const type = vehicle.type.toLowerCase();
    if (type.includes("steam")) return IMAGES.steam;
    if (type.includes("diesel")) return IMAGES.diesel;
    if (type.includes("electric")) return IMAGES.electric;
    return IMAGES.diesel; // shouldn't happen — every known locomotive type matches one of the above
  }

  if (vehicle.isPassengerWagon) return IMAGES.pax;
  const bucket = CARGO_BUCKET[vehicle.cargoTypes[0]];
  return IMAGES[bucket] ?? IMAGES.freightWagon;
}
