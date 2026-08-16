// Persists app state to localStorage. No versioning/migration — not needed
// at this stage. What IS required: never let bad/stale saved data crash the
// app. Every failure path here is caught and either drops just the affected
// piece (with a warning) or, if a JSON parse fails, resets everything —
// there's never an uncaught exception that reaches the caller.

const KEY = "tf2sim-state";

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    // Not worth interrupting the user over (e.g. storage quota, private
    // browsing edge cases) — just means this change won't survive a refresh.
    console.error("Failed to save app state:", e);
  }
}

/**
 * @param {Map} vehicleById
 * @returns {{ state: object|null, warning: string|null }} `state` is a
 *   partial object — only keys that were successfully validated are
 *   present, so the caller should merge it over its own defaults rather
 *   than use it standalone. `state` is null only when there was nothing to
 *   load or the saved data was unusable outright.
 */
export function loadState(vehicleById) {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    console.error("Failed to read saved app state:", e);
    return { state: null, warning: null }; // e.g. storage disabled — not worth alarming over
  }
  if (!raw) return { state: null, warning: null };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("Saved app state was not valid JSON:", e);
    return { state: null, warning: "Saved data was corrupted and has been reset to defaults." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { state: null, warning: "Saved data was corrupted and has been reset to defaults." };
  }

  const state = {};
  const warnings = [];

  try {
    const { trains, droppedCount } = reconstructTrains(parsed.trains, vehicleById);
    state.trains = trains;
    if (droppedCount > 0) {
      warnings.push(
        `${droppedCount} previously saved vehicle${droppedCount === 1 ? "" : "s"} no longer exist${droppedCount === 1 ? "s" : ""} and ${droppedCount === 1 ? "was" : "were"} removed.`
      );
    }
  } catch (e) {
    console.error("Failed to restore saved trains:", e);
    warnings.push("Saved train data couldn't be restored and was reset.");
  }

  try {
    state.route = reconstructRoute(parsed.route);
  } catch (e) {
    console.error("Failed to restore saved route:", e);
    warnings.push("Saved route data couldn't be restored and was reset.");
  }

  if (parsed.trackSpeedLimit_kmh === null || (typeof parsed.trackSpeedLimit_kmh === "number" && parsed.trackSpeedLimit_kmh > 0)) {
    state.trackSpeedLimit_kmh = parsed.trackSpeedLimit_kmh;
  }
  if (typeof parsed.brakingDeceleration_ms2 === "number" && parsed.brakingDeceleration_ms2 > 0) {
    state.brakingDeceleration_ms2 = parsed.brakingDeceleration_ms2;
  }
  // Out-of-range (e.g. that leg's station got removed) is self-healed by
  // js/main.js's renderLegSelect(), which clamps it back to 0 on render —
  // no need to cross-reference the reconstructed route's leg count here too.
  if (Number.isInteger(parsed.selectedLegIndex) && parsed.selectedLegIndex >= 0) {
    state.selectedLegIndex = parsed.selectedLegIndex;
  }
  if (["easy", "medium", "hard", "veryHard"].includes(parsed.difficultyKey)) {
    state.difficultyKey = parsed.difficultyKey;
  }
  if (parsed.chipView === "compact" || parsed.chipView === "detailed") {
    state.chipView = parsed.chipView;
  }
  if (parsed.financeGroupBy === "metric" || parsed.financeGroupBy === "leg") {
    state.financeGroupBy = parsed.financeGroupBy;
  }
  if (typeof parsed.includeStopsInFinancials === "boolean") {
    state.includeStopsInFinancials = parsed.includeStopsInFinancials;
  }
  if (parsed.accelerationDetail === "simple" || parsed.accelerationDetail === "detailed") {
    state.accelerationDetail = parsed.accelerationDetail;
  }
  if (["trains", "graphs", "route", "financials"].includes(parsed.activeTab)) {
    state.activeTab = parsed.activeTab;
  }

  return { state, warning: warnings.length > 0 ? warnings.join(" ") : null };
}

// Must match js/charts.js's SERIES_SLOTS — duplicated here (not imported)
// so this module stays dependency-free/standalone, as designed.
const SERIES_SLOTS = 8;

function reconstructTrains(rawTrains, vehicleById) {
  if (!Array.isArray(rawTrains)) throw new Error("trains is not an array");
  let droppedCount = 0;
  const trains = rawTrains.map((rawTrain) => ({
    name: typeof rawTrain?.name === "string" && rawTrain.name ? rawTrain.name : null,
    color: Number.isInteger(rawTrain?.color) && rawTrain.color >= 0 && rawTrain.color < SERIES_SLOTS ? rawTrain.color : null,
    locomotives: filterConsistItems(rawTrain?.locomotives, vehicleById, () => droppedCount++),
    wagons: filterConsistItems(rawTrain?.wagons, vehicleById, () => droppedCount++),
  }));
  return { trains, droppedCount };
}

function filterConsistItems(rawItems, vehicleById, onDrop) {
  if (!Array.isArray(rawItems)) return [];
  const out = [];
  for (const item of rawItems) {
    if (!item || typeof item.vehicleId !== "string" || !vehicleById.has(item.vehicleId)) {
      onDrop();
      continue;
    }
    const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? Math.floor(item.quantity) : 1;
    out.push({ vehicleId: item.vehicleId, quantity });
  }
  return out;
}

function reconstructRoute(rawRoute) {
  if (!rawRoute || !Array.isArray(rawRoute.stations) || !Array.isArray(rawRoute.legs)) {
    throw new Error("Invalid route shape");
  }
  const stations = rawRoute.stations.map((s, i) => ({
    name: typeof s?.name === "string" && s.name ? s.name : `Station ${i + 1}`,
  }));
  const legs = rawRoute.legs.map((l) => ({
    crowDistance_m: typeof l?.crowDistance_m === "number" ? l.crowDistance_m : null,
    trackDistance_m: typeof l?.trackDistance_m === "number" ? l.trackDistance_m : null,
    loadFactor: typeof l?.loadFactor === "number" && l.loadFactor >= 0 && l.loadFactor <= 1 ? l.loadFactor : 1.0,
  }));
  if (stations.length < 2 || legs.length !== stations.length) {
    throw new Error("Route stations/legs count mismatch");
  }
  return { stations, legs };
}
