import { initTheme } from "./theme.js";
import { loadVehicles, formatValue, formatCompactSpec, ACCELERATION_FIELDS } from "./vehicles.js";
import {
  createTrain,
  addLocomotive,
  addWagon,
  removeLocomotive,
  removeWagon,
  setLocomotiveQuantity,
  setWagonQuantity,
  aggregateTrain,
  TRAIN_SPEC_FIELDS,
  formatTrainSpecValue,
} from "./train.js";
import { createRoute, addStation, removeStation, estimateTrackDistance } from "./route.js";
import { computeAccelerationStats } from "./physics.js";
import { DIFFICULTY_FACTORS, tripSummary } from "./finance.js";
import { renderCharts } from "./charts.js";

const SLOT_COUNT = 2;
const TRAIN_LABELS = ["Train 1", "Train 2"];

const state = {
  vehicles: [],
  vehicleById: new Map(),
  trains: [createTrain(), createTrain()],
  route: createRoute(),
  trackSpeedLimit_kmh: 300,
  difficultyKey: "easy",
  loadFactor: 1.0,
};

// ---- helpers ----

function locomotivesOf(vehicles) {
  return vehicles.filter((v) => v.kind === "locomotive").sort((a, b) => a.name.localeCompare(b.name));
}
function wagonsOf(vehicles) {
  return vehicles.filter((v) => v.kind === "wagon").sort((a, b) => a.name.localeCompare(b.name));
}

function aggregatesWithLabels() {
  return state.trains.map((train, i) => {
    const aggregate = aggregateTrain(train, state.vehicleById);
    return aggregate ? { aggregate, label: TRAIN_LABELS[i] } : null;
  });
}

// ---- train builder UI ----

function populateVehicleSelects() {
  const locos = locomotivesOf(state.vehicles);
  const wagons = wagonsOf(state.vehicles);

  document.querySelectorAll(".add-locomotive-select").forEach((select) => {
    select.innerHTML = "";
    for (const v of locos) select.appendChild(new Option(v.name, v.id));
  });
  document.querySelectorAll(".add-wagon-select").forEach((select) => {
    select.innerHTML = "";
    for (const v of wagons) select.appendChild(new Option(v.name, v.id));
  });
}

function renderConsistList(slot) {
  const panel = document.querySelector(`.train-panel[data-slot="${slot}"]`);
  const list = panel.querySelector(".consist-list");
  const train = state.trains[slot];
  list.innerHTML = "";

  const items = [
    ...train.locomotives.map((item) => ({ ...item, type: "locomotive" })),
    ...train.wagons.map((item) => ({ ...item, type: "wagon" })),
  ];

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "consist-empty";
    li.textContent = "No vehicles added yet.";
    list.appendChild(li);
    return;
  }

  for (const item of items) {
    const vehicle = state.vehicleById.get(item.vehicleId);
    const li = document.createElement("li");
    li.className = "consist-item";

    const nameDiv = document.createElement("div");
    nameDiv.className = "consist-item-name";
    const strong = document.createElement("strong");
    strong.textContent = vehicle.name;
    const span = document.createElement("span");
    span.textContent = formatCompactSpec(vehicle);
    nameDiv.append(strong, span);

    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.className = "consist-item-qty";
    qtyInput.value = item.quantity;
    qtyInput.addEventListener("change", () => {
      // Recompute only — rebuilding the list here would steal focus mid-edit.
      const setQty = item.type === "locomotive" ? setLocomotiveQuantity : setWagonQuantity;
      setQty(train, item.vehicleId, Number(qtyInput.value));
      recompute();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "consist-item-remove";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `Remove ${vehicle.name}`);
    removeBtn.addEventListener("click", () => {
      const remove = item.type === "locomotive" ? removeLocomotive : removeWagon;
      remove(train, item.vehicleId);
      rebuildConsist(slot);
    });

    li.append(nameDiv, qtyInput, removeBtn);
    list.appendChild(li);
  }
}

function initTrainPanels() {
  document.querySelectorAll(".train-panel").forEach((panel) => {
    const slot = Number(panel.dataset.slot);
    const train = state.trains[slot];

    panel.querySelector(".add-locomotive-btn").addEventListener("click", () => {
      const select = panel.querySelector(".add-locomotive-select");
      if (!select.value) return;
      addLocomotive(train, select.value, 1);
      rebuildConsist(slot);
    });

    panel.querySelector(".add-wagon-btn").addEventListener("click", () => {
      const select = panel.querySelector(".add-wagon-select");
      const qtyInput = panel.querySelector(".add-wagon-qty");
      if (!select.value) return;
      addWagon(train, select.value, Math.max(1, Number(qtyInput.value) || 1));
      rebuildConsist(slot);
    });
  });
}

// ---- train spec + acceleration tables ----

function buildHeaderRow(head, label, aggregates) {
  head.innerHTML = "";
  const corner = document.createElement("th");
  corner.textContent = label;
  head.appendChild(corner);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const th = document.createElement("th");
    th.textContent = aggregates[i] ? aggregates[i].label : TRAIN_LABELS[i];
    head.appendChild(th);
  }
}

function renderTrainSpecTable(aggregates) {
  const head = document.getElementById("train-spec-head");
  const body = document.getElementById("train-spec-body");
  buildHeaderRow(head, "Spec", aggregates);
  body.innerHTML = "";

  if (!aggregates.some(Boolean)) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = SLOT_COUNT + 1;
    cell.textContent = "Add vehicles to a train above to see its specs.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const field of TRAIN_SPEC_FIELDS) {
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = field.label + (field.note ? ` (${field.note})` : "");
    row.appendChild(th);

    for (const entry of aggregates) {
      const td = document.createElement("td");
      td.textContent = entry ? formatTrainSpecValue(entry.aggregate, field) : "—";
      row.appendChild(td);
    }
    body.appendChild(row);
  }
}

function appendDerivedRow(body, label, results, getValue, unit, digits) {
  const row = document.createElement("tr");
  const th = document.createElement("th");
  th.scope = "row";
  th.textContent = label;
  row.appendChild(th);
  for (const result of results) {
    const td = document.createElement("td");
    td.textContent = result && !result.warning ? formatValue(getValue(result), { unit, digits }) : "—";
    row.appendChild(td);
  }
  body.appendChild(row);
}

function renderAccelerationSection(aggregates) {
  const section = document.getElementById("acceleration-section");
  const head = document.getElementById("acceleration-table-head");
  const body = document.getElementById("acceleration-table-body");

  const results = aggregates.map((entry) =>
    entry ? computeAccelerationStats(entry.aggregate, state.trackSpeedLimit_kmh) : null
  );

  if (!results.some(Boolean)) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  buildHeaderRow(head, "Acceleration (to top speed)", aggregates);
  body.innerHTML = "";

  for (const field of ACCELERATION_FIELDS) {
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = field.label + (field.note ? ` (${field.note})` : "");
    row.appendChild(th);
    for (const result of results) {
      const td = document.createElement("td");
      td.textContent = result && !result.warning ? formatValue(result[field.key], field) : "—";
      row.appendChild(td);
    }
    body.appendChild(row);
  }

  appendDerivedRow(body, "Time to 95% of top speed", results, (r) => r.time95_s, "s", 1);
  appendDerivedRow(body, "Distance to 95% of top speed", results, (r) => r.distance95_m, "m", 0);
  appendDerivedRow(body, "Time to exact top speed (asymptotic tail — see docs)", results, (r) => r.totalTime_s, "s", 1);
  appendDerivedRow(body, "Distance to exact top speed (asymptotic tail — see docs)", results, (r) => r.totalDistance_m, "m", 0);

  const warnRow = document.createElement("tr");
  const warnTh = document.createElement("th");
  warnTh.scope = "row";
  warnTh.textContent = "Notes";
  warnRow.appendChild(warnTh);
  for (const result of results) {
    const td = document.createElement("td");
    td.textContent = result && result.warning ? result.warning : "";
    warnRow.appendChild(td);
  }
  body.appendChild(warnRow);
}

// ---- route UI ----

function initRouteControls() {
  const select = document.getElementById("track-speed-limit-select");
  const custom = document.getElementById("track-speed-limit-custom");

  function applyTrackSpeedLimit() {
    if (select.value === "none") state.trackSpeedLimit_kmh = null;
    else if (select.value === "custom") state.trackSpeedLimit_kmh = Number(custom.value) || null;
    else state.trackSpeedLimit_kmh = Number(select.value);
    recompute();
  }

  select.addEventListener("change", () => {
    custom.hidden = select.value !== "custom";
    if (select.value === "custom") custom.focus();
    applyTrackSpeedLimit();
  });
  custom.addEventListener("change", applyTrackSpeedLimit);

  document.getElementById("add-station-btn").addEventListener("click", () => {
    addStation(state.route);
    rebuildRoute();
  });
}

// Renders the station list and leg cards from scratch. Only called for
// structural changes (add/remove station) — editing a leg's distance or
// running the track-distance estimator update state + recompute() directly
// instead, so an open <details> helper or an in-progress edit isn't blown
// away by a full rebuild.
function renderRoute(aggregates) {
  const container = document.getElementById("station-list");
  container.innerHTML = "";

  const stationGroup = document.createElement("div");
  stationGroup.className = "station-group";
  const stationHeading = document.createElement("h3");
  stationHeading.textContent = "Stations";
  stationGroup.appendChild(stationHeading);

  state.route.stations.forEach((station, i) => {
    const row = document.createElement("div");
    row.className = "station-row";

    const input = document.createElement("input");
    input.type = "text";
    input.value = station.name;
    input.addEventListener("change", () => {
      station.name = input.value || `Station ${i + 1}`;
      updateLegTitles();
    });
    row.appendChild(input);

    if (state.route.stations.length > 2) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "✕";
      removeBtn.setAttribute("aria-label", `Remove ${station.name}`);
      removeBtn.addEventListener("click", () => {
        removeStation(state.route, i);
        rebuildRoute();
      });
      row.appendChild(removeBtn);
    }

    stationGroup.appendChild(row);
  });
  container.appendChild(stationGroup);

  const legGroup = document.createElement("div");
  legGroup.className = "leg-group";
  const legHeading = document.createElement("h3");
  legHeading.textContent = "Legs";
  legGroup.appendChild(legHeading);

  state.route.legs.forEach((leg, i) => {
    legGroup.appendChild(buildLegCard(leg, i, aggregates));
  });
  container.appendChild(legGroup);
}

// Renaming a station only changes leg-title text, not any computed value —
// patch the existing title elements in place rather than rebuilding the route.
function updateLegTitles() {
  document.querySelectorAll(".leg-title").forEach((el, i) => {
    const from = state.route.stations[i]?.name ?? `Station ${i + 1}`;
    const to = state.route.stations[i + 1]?.name ?? `Station ${i + 2}`;
    el.textContent = `Leg ${i + 1}: ${from} → ${to}`;
  });
}

function buildLegCard(leg, index, aggregates) {
  const card = document.createElement("div");
  card.className = "leg-card";

  const title = document.createElement("div");
  title.className = "leg-title";
  const from = state.route.stations[index]?.name ?? `Station ${index + 1}`;
  const to = state.route.stations[index + 1]?.name ?? `Station ${index + 2}`;
  title.textContent = `Leg ${index + 1}: ${from} → ${to}`;
  card.appendChild(title);

  card.appendChild(
    legField("Crow-flies distance (km)", leg.crowDistance_m != null ? leg.crowDistance_m / 1000 : "", (value) => {
      leg.crowDistance_m = value === "" ? null : Number(value) * 1000;
      recompute();
    })
  );

  const trackDistanceInput = legFieldInput(
    leg.trackDistance_m != null ? leg.trackDistance_m / 1000 : "",
    (value) => {
      leg.trackDistance_m = value === "" ? null : Number(value) * 1000;
      recompute();
    },
    "= crow-flies distance"
  );
  card.appendChild(wrapLegField("Track distance (km, optional)", trackDistanceInput));

  const details = document.createElement("details");
  details.className = "leg-helper";
  const summary = document.createElement("summary");
  summary.textContent = "Estimate track distance from an observed trip time";
  details.appendChild(summary);

  const helperRow = document.createElement("div");
  helperRow.className = "leg-helper-row";

  const timeInput = document.createElement("input");
  timeInput.type = "number";
  timeInput.min = "0";
  timeInput.placeholder = "seconds";
  helperRow.appendChild(timeInput);

  const trainSelect = document.createElement("select");
  aggregates.forEach((entry, i) => {
    if (entry) trainSelect.appendChild(new Option(entry.label, String(i)));
  });
  helperRow.appendChild(trainSelect);

  const estimateBtn = document.createElement("button");
  estimateBtn.type = "button";
  estimateBtn.textContent = "Estimate";
  helperRow.appendChild(estimateBtn);

  const result = document.createElement("span");
  result.className = "leg-helper-result";
  helperRow.appendChild(result);

  estimateBtn.addEventListener("click", () => {
    const entry = aggregates[Number(trainSelect.value)];
    const time_s = Number(timeInput.value);
    if (!entry || !time_s) {
      result.textContent = "Pick a train with vehicles and enter a time.";
      return;
    }
    const distance_m = estimateTrackDistance(entry.aggregate, time_s, state.trackSpeedLimit_kmh);
    if (distance_m == null) {
      result.textContent = "Can't estimate — that train can't move.";
      return;
    }
    result.textContent = `≈ ${(distance_m / 1000).toFixed(2)} km`;
    leg.trackDistance_m = distance_m;
    trackDistanceInput.value = (distance_m / 1000).toFixed(3); // keep the <details> open and result visible
    recompute();
  });

  details.appendChild(helperRow);
  card.appendChild(details);

  return card;
}

function legFieldInput(value, onChange, placeholder) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "any";
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

function wrapLegField(labelText, input) {
  const wrap = document.createElement("div");
  wrap.className = "leg-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.append(label, input);
  return wrap;
}

function legField(labelText, value, onChange, placeholder) {
  return wrapLegField(labelText, legFieldInput(value, onChange, placeholder));
}

// ---- financials UI ----

function initFinanceControls() {
  document.getElementById("difficulty-select").addEventListener("change", (e) => {
    state.difficultyKey = e.target.value;
    recompute();
  });
  document.getElementById("load-factor-input").addEventListener("change", (e) => {
    state.loadFactor = Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100;
    recompute();
  });
}

function renderFinance(aggregates) {
  const options = { trackSpeedLimit_kmh: state.trackSpeedLimit_kmh, difficulty: DIFFICULTY_FACTORS[state.difficultyKey], loadFactor: state.loadFactor };
  const summaries = aggregates.map((entry) => (entry ? tripSummary(entry.aggregate, state.route, options) : null));

  const legHead = document.getElementById("leg-breakdown-head");
  const legBody = document.getElementById("leg-breakdown-body");
  buildHeaderRow(legHead, "Leg", aggregates);
  legBody.innerHTML = "";

  if (!summaries.some(Boolean)) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = SLOT_COUNT + 1;
    cell.textContent = "Add vehicles and leg distances to see revenue.";
    row.appendChild(cell);
    legBody.appendChild(row);
  } else {
    state.route.legs.forEach((_, i) => {
      const timeRow = document.createElement("tr");
      const timeTh = document.createElement("th");
      timeTh.scope = "row";
      timeTh.textContent = `Leg ${i + 1} time`;
      timeRow.appendChild(timeTh);
      summaries.forEach((s) => {
        const td = document.createElement("td");
        td.textContent = s ? formatValue(s.legs[i].time_s, { unit: "s", digits: 1 }) : "—";
        timeRow.appendChild(td);
      });
      legBody.appendChild(timeRow);

      const revRow = document.createElement("tr");
      const revTh = document.createElement("th");
      revTh.scope = "row";
      revTh.textContent = `Leg ${i + 1} revenue`;
      revRow.appendChild(revTh);
      summaries.forEach((s) => {
        const td = document.createElement("td");
        td.textContent = s ? `$${Math.round(s.legs[i].revenue).toLocaleString()}` : "—";
        revRow.appendChild(td);
      });
      legBody.appendChild(revRow);
    });
  }

  const tripHead = document.getElementById("trip-summary-head");
  const tripBody = document.getElementById("trip-summary-body");
  buildHeaderRow(tripHead, "Trip total", aggregates);
  tripBody.innerHTML = "";

  const rows = [
    ["Total time", (s) => formatValue(s.totalTime_s, { unit: "s", digits: 1 })],
    ["Total revenue", (s) => `$${Math.round(s.totalRevenue).toLocaleString()}`],
    ["Maintenance for this trip", (s) => `$${Math.round(s.maintenanceForTrip).toLocaleString()}`],
    ["Profit", (s) => `$${Math.round(s.profit).toLocaleString()}`],
    ["Profit per real hour", (s) => `$${Math.round(s.profitPerRealHour).toLocaleString()}`],
    ["Profit per game year", (s) => `$${Math.round(s.profitPerGameYear).toLocaleString()}`],
  ];

  for (const [label, fmt] of rows) {
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = label;
    row.appendChild(th);
    summaries.forEach((s) => {
      const td = document.createElement("td");
      td.textContent = s ? fmt(s) : "—";
      row.appendChild(td);
    });
    tripBody.appendChild(row);
  }
}

// ---- orchestration ----
//
// recompute() re-derives and re-renders everything that depends on train/
// route/setting state EXCEPT the train-panel consist lists and the route's
// station/leg DOM structure — those are only rebuilt on structural changes
// (rebuildConsist/rebuildRoute below), so in-progress edits (a focused
// input, an open <details> helper) survive value-only changes like a
// quantity tweak or a distance edit.

function recompute() {
  const aggregates = aggregatesWithLabels();
  renderTrainSpecTable(aggregates);
  renderAccelerationSection(aggregates);
  renderFinance(aggregates);
  renderCharts(aggregates, state.trackSpeedLimit_kmh);
}

function rebuildConsist(slot) {
  renderConsistList(slot);
  recompute();
}

function rebuildRoute() {
  renderRoute(aggregatesWithLabels());
  recompute();
}

async function init() {
  initTheme(() => renderCharts(aggregatesWithLabels(), state.trackSpeedLimit_kmh));

  state.vehicles = await loadVehicles();
  state.vehicleById = new Map(state.vehicles.map((v) => [v.id, v]));

  populateVehicleSelects();
  initTrainPanels();
  initRouteControls();
  initFinanceControls();

  for (let slot = 0; slot < SLOT_COUNT; slot++) renderConsistList(slot);
  renderRoute(aggregatesWithLabels());
  recompute();
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<p style="color:red; max-width:1140px; margin:1rem auto; padding:0 1.5rem;">Failed to initialize app: ${err.message}</p>`
  );
});
