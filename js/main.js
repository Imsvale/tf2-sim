import { initTheme } from "./theme.js";
import { loadVehicles, formatValue, formatMoney, formatCompactSpec, ACCELERATION_FIELDS } from "./vehicles.js";
import {
  createTrain,
  cloneTrain,
  insertLocomotive,
  insertWagon,
  removeLocomotiveAt,
  removeWagonAt,
  setLocomotiveQuantityAt,
  setWagonQuantityAt,
  setLocomotiveTypeAt,
  setWagonTypeAt,
  aggregateTrain,
  TRAIN_SPEC_FIELDS,
  formatTrainSpecValue,
} from "./train.js";
import { createRoute, addStation, removeStation, estimateTrackDistance } from "./route.js";
import { computeAccelerationStats } from "./physics.js";
import { DIFFICULTY_FACTORS, tripSummary } from "./finance.js";
import { renderCharts, renderFinanceCharts } from "./charts.js";
import { initChartGallery } from "./chartGallery.js";
import { saveState, loadState } from "./storage.js";
import { imageForVehicle } from "./images.js";

const state = {
  vehicles: [],
  vehicleById: new Map(),
  trains: [], // seeded by buildDefaultTrains() once vehicles are loaded, before loadState() is consulted
  route: createRoute(),
  trackSpeedLimit_kmh: 300,
  difficultyKey: "easy",
  financeGroupBy: "metric",
  chipView: "compact",
  activeTab: "trains",
};

// ---- helpers ----

function locomotivesOf(vehicles) {
  return vehicles.filter((v) => v.kind === "locomotive").sort((a, b) => a.name.localeCompare(b.name));
}
function wagonsOf(vehicles) {
  return vehicles.filter((v) => v.kind === "wagon").sort((a, b) => a.name.localeCompare(b.name));
}

function trainLabel(train, index) {
  return train.name || `Train ${index + 1}`;
}

function aggregatesWithLabels() {
  return state.trains.map((train, i) => {
    const aggregate = aggregateTrain(train, state.vehicleById);
    return aggregate ? { aggregate, label: trainLabel(train, i) } : null;
  });
}

function populateSelectOptions(select, vehicles) {
  for (const v of vehicles) select.appendChild(new Option(v.name, v.id));
}

/** First-alphabetically locomotive/wagon — the "sensible default" for a freshly added chip. */
function defaultLocomotive() {
  return locomotivesOf(state.vehicles)[0] ?? null;
}
function defaultWagon() {
  return wagonsOf(state.vehicles)[0] ?? null;
}

// A train seeded with one default locomotive + one default wagon — used
// both for the initial 2 default trains and whenever "+ Add train" is
// clicked, so there's always at least one group of each type to hang the
// per-chip +/✕ controls on (see buildTrainStrip's empty-category fallback
// for the rare case that still isn't true, e.g. after manually emptying a
// category).
function buildSeedTrain() {
  const loco = defaultLocomotive();
  const wagon = defaultWagon();
  const t = createTrain();
  if (loco) insertLocomotive(t, 0, loco.id, 1);
  if (wagon) insertWagon(t, 0, wagon.id, 1);
  return t;
}

// Called once vehicles are loaded, before loadState() — so a saved state
// (including a deliberately emptied train list) still overrides this normally.
function buildDefaultTrains() {
  return [buildSeedTrain(), buildSeedTrain()];
}

// ---- warning banner ----

function showWarning(message) {
  document.getElementById("warning-banner-text").textContent = message;
  document.getElementById("warning-banner").hidden = false;
}

function initWarningBanner() {
  document.getElementById("warning-banner-dismiss").addEventListener("click", () => {
    document.getElementById("warning-banner").hidden = true;
  });
}

// ---- tabs ----

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveTab(btn.dataset.tab);
      saveState(state);
    });
  });
}

function setActiveTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== `tab-${tab}`;
  });
}

// ---- popover (chip quantity/remove — see css .popover for why this is
// appended to document.body with position:fixed rather than nested in the
// scrolling chip strip) ----

let openPopoverEl = null;
let closeOpenPopoverListeners = null;

function closePopover() {
  if (openPopoverEl) {
    openPopoverEl.remove();
    openPopoverEl = null;
  }
  if (closeOpenPopoverListeners) {
    closeOpenPopoverListeners();
    closeOpenPopoverListeners = null;
  }
}

function positionPopoverNear(popover, anchorEl) {
  const anchor = anchorEl.getBoundingClientRect();
  const pop = popover.getBoundingClientRect();
  const margin = 8;

  let left = anchor.left;
  if (left + pop.width > window.innerWidth - margin) left = window.innerWidth - pop.width - margin;
  if (left < margin) left = margin;

  let top = anchor.bottom + margin;
  if (top + pop.height > window.innerHeight - margin) top = anchor.top - pop.height - margin;
  if (top < margin) top = margin;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

// Popover is just Type + Quantity now — removal moved to the chip's own
// inline ✕ (see renderChip), so there's no longer a second path for the
// same action.
function openVehiclePopover(anchorEl, { train, trainIndex, item, type, indexInType, vehicle, countEl }) {
  closePopover();

  const popover = document.createElement("div");
  popover.className = "popover";

  const name = document.createElement("div");
  name.className = "popover-name";
  name.textContent = vehicle.name;
  popover.appendChild(name);

  const typeRow = document.createElement("div");
  typeRow.className = "popover-row";
  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Type";
  const typeSelect = document.createElement("select");
  populateSelectOptions(typeSelect, type === "locomotive" ? locomotivesOf(state.vehicles) : wagonsOf(state.vehicles));
  typeSelect.value = item.vehicleId;
  typeSelect.addEventListener("change", () => {
    const newVehicleId = typeSelect.value;
    if (newVehicleId === item.vehicleId) return;
    const setType = type === "locomotive" ? setLocomotiveTypeAt : setWagonTypeAt;
    setType(train, indexInType, newVehicleId);
    closePopover();
    refreshTrainStrip(trainIndex);
    recompute();
  });
  typeRow.append(typeLabel, typeSelect);
  popover.appendChild(typeRow);

  const qtyRow = document.createElement("div");
  qtyRow.className = "popover-row";
  const qtyLabel = document.createElement("label");
  qtyLabel.textContent = "Quantity";
  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.min = "1";
  qtyInput.value = item.quantity;
  qtyInput.addEventListener("change", () => {
    const setQty = type === "locomotive" ? setLocomotiveQuantityAt : setWagonQuantityAt;
    const newQty = Math.max(1, Math.floor(Number(qtyInput.value)) || 1);
    setQty(train, indexInType, newQty); // mutates `item` in place (same object, this train's array at this index)
    qtyInput.value = newQty;
    countEl.textContent = `×${newQty}`;
    recompute();
  });
  qtyRow.append(qtyLabel, qtyInput);
  popover.appendChild(qtyRow);

  document.body.appendChild(popover);
  positionPopoverNear(popover, anchorEl);
  openPopoverEl = popover;

  const onDocClick = (e) => {
    if (!popover.contains(e.target) && e.target !== anchorEl) closePopover();
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") closePopover();
  };
  const onScroll = () => closePopover();
  document.addEventListener("click", onDocClick, true);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("scroll", onScroll, true);

  closeOpenPopoverListeners = () => {
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("scroll", onScroll, true);
  };
}

// ---- train list (strips + chips) ----

function renderChip(train, trainIndex, item, type, indexInType, vehicle, isLastInTrain) {
  const wrap = document.createElement("div");
  wrap.className = "chip-wrap";

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.title = `${vehicle.name} — ${formatCompactSpec(vehicle)}`;

  const img = document.createElement("img");
  img.className = "chip-img";
  if (type === "locomotive" && isLastInTrain) img.classList.add("chip-img--flipped");
  img.src = imageForVehicle(vehicle);
  img.alt = ""; // decorative — the chip's title tooltip (and, in detailed mode, the name below) carry the label
  chip.appendChild(img);

  if (state.chipView === "detailed") {
    const name = document.createElement("span");
    name.className = "chip-name";
    name.textContent = vehicle.name;
    chip.appendChild(name);
  }

  const count = document.createElement("span");
  count.className = "chip-count";
  count.textContent = `×${item.quantity}`;
  chip.appendChild(count);

  chip.addEventListener("click", () =>
    openVehiclePopover(chip, { train, trainIndex, item, type, indexInType, vehicle, countEl: count })
  );

  // Small per-group insert/remove controls, replacing the old strip-level
  // "add locomotive"/"add wagon" buttons — + inserts a fresh default group
  // of the same type right after this one; ✕ removes this specific group.
  const miniActions = document.createElement("div");
  miniActions.className = "chip-mini-actions";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "chip-mini-add";
  addBtn.textContent = "+";
  addBtn.title = `Insert ${type} after`;
  addBtn.setAttribute("aria-label", `Insert ${type} after ${vehicle.name}`);
  addBtn.addEventListener("click", () => {
    const def = type === "locomotive" ? defaultLocomotive() : defaultWagon();
    if (!def) return;
    const insert = type === "locomotive" ? insertLocomotive : insertWagon;
    insert(train, indexInType + 1, def.id, 1);
    refreshTrainStrip(trainIndex);
    recompute();
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "chip-mini-remove";
  removeBtn.textContent = "✕";
  removeBtn.title = "Remove";
  removeBtn.setAttribute("aria-label", `Remove ${vehicle.name}`);
  removeBtn.addEventListener("click", () => {
    const removeAt = type === "locomotive" ? removeLocomotiveAt : removeWagonAt;
    removeAt(train, indexInType);
    refreshTrainStrip(trainIndex);
    recompute();
  });

  miniActions.append(addBtn, removeBtn);

  wrap.append(chip, miniActions);
  return wrap;
}

// Shown in place of a category's chips when it's empty (e.g. after removing
// the last locomotive or last wagon via a chip's ✕) — otherwise there'd be
// no chip left to hang a + button on, a dead end for that category. Icon-
// less by design, unlike the per-chip controls, since it's a fallback, not
// the primary way to add vehicles (both default trains and "+ Add train"
// seed one of each type, so this is rarely seen in practice).
function buildEmptyCategoryButton(train, trainIndex, type) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "add-category-fallback";
  btn.textContent = type === "locomotive" ? "+ Add locomotive" : "+ Add wagon";
  btn.addEventListener("click", () => {
    const def = type === "locomotive" ? defaultLocomotive() : defaultWagon();
    if (!def) return;
    const insert = type === "locomotive" ? insertLocomotive : insertWagon;
    insert(train, 0, def.id, 1);
    refreshTrainStrip(trainIndex);
    recompute();
  });
  return btn;
}

// Toggles the label between plain text and an inline text input on rename-
// icon click. Enter/blur commits; Escape cancels without saving. An empty
// or unchanged-from-default name just clears the custom name.
function buildTrainStripLabel(train, trainIndex) {
  const wrap = document.createElement("div");
  wrap.className = "train-strip-label-wrap";

  const label = document.createElement("span");
  label.className = "train-strip-label";
  label.textContent = trainLabel(train, trainIndex);

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "train-strip-rename";
  renameBtn.textContent = "✎";
  renameBtn.title = "Rename train";
  renameBtn.setAttribute("aria-label", `Rename ${trainLabel(train, trainIndex)}`);
  renameBtn.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "train-strip-rename-input";
    input.value = trainLabel(train, trainIndex);
    input.setAttribute("aria-label", `${trainLabel(train, trainIndex)} name`);

    const commit = () => {
      const value = input.value.trim();
      train.name = value && value !== `Train ${trainIndex + 1}` ? value : null;
      label.textContent = trainLabel(train, trainIndex);
      input.replaceWith(label);
      recompute();
    };
    const cancel = () => {
      input.removeEventListener("blur", commit);
      input.replaceWith(label);
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur(); // triggers commit via the blur listener above
      } else if (e.key === "Escape") {
        cancel();
      }
    });

    label.replaceWith(input);
    input.focus();
    input.select();
  });

  wrap.append(label, renameBtn);
  return wrap;
}

function buildTrainStrip(trainIndex) {
  const train = state.trains[trainIndex];
  const strip = document.createElement("div");
  strip.className = "train-strip";
  strip.dataset.trainIndex = String(trainIndex);

  strip.appendChild(buildTrainStripLabel(train, trainIndex));

  const body = document.createElement("div");
  body.className = "train-strip-body";

  const chips = document.createElement("div");
  chips.className = "train-strip-chips";

  const totalCount = train.locomotives.length + train.wagons.length;

  if (train.locomotives.length === 0) {
    chips.appendChild(buildEmptyCategoryButton(train, trainIndex, "locomotive"));
  } else {
    train.locomotives.forEach((item, indexInType) => {
      const vehicle = state.vehicleById.get(item.vehicleId);
      const isLastInTrain = totalCount > 1 && indexInType === totalCount - 1;
      chips.appendChild(renderChip(train, trainIndex, item, "locomotive", indexInType, vehicle, isLastInTrain));
    });
  }

  if (train.wagons.length === 0) {
    chips.appendChild(buildEmptyCategoryButton(train, trainIndex, "wagon"));
  } else {
    train.wagons.forEach((item, indexInType) => {
      const vehicle = state.vehicleById.get(item.vehicleId);
      const mergedIndex = train.locomotives.length + indexInType;
      const isLastInTrain = totalCount > 1 && mergedIndex === totalCount - 1;
      chips.appendChild(renderChip(train, trainIndex, item, "wagon", indexInType, vehicle, isLastInTrain));
    });
  }

  body.appendChild(chips);
  strip.appendChild(body);

  const cloneBtn = document.createElement("button");
  cloneBtn.type = "button";
  cloneBtn.className = "train-strip-clone";
  cloneBtn.textContent = "📋";
  cloneBtn.title = "Clone this train";
  cloneBtn.setAttribute("aria-label", `Clone Train ${trainIndex + 1}`);
  cloneBtn.addEventListener("click", () => {
    state.trains.push(cloneTrain(train));
    renderTrainList();
    recompute();
  });
  strip.appendChild(cloneBtn);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "train-strip-remove";
  removeBtn.textContent = "✕";
  removeBtn.setAttribute("aria-label", `Remove Train ${trainIndex + 1}`);
  removeBtn.addEventListener("click", () => {
    state.trains.splice(trainIndex, 1);
    renderTrainList();
    recompute();
  });
  strip.appendChild(removeBtn);

  return strip;
}

// Rebuilds just one strip in place — used for add/remove-vehicle-within-train,
// so other trains (and any popover open on another train) are undisturbed.
function refreshTrainStrip(trainIndex) {
  closePopover();
  const container = document.getElementById("train-list");
  const oldStrip = container.querySelector(`.train-strip[data-train-index="${trainIndex}"]`);
  const newStrip = buildTrainStrip(trainIndex);
  if (oldStrip) oldStrip.replaceWith(newStrip);
  else container.appendChild(newStrip);
}

// Full rebuild — only for structural changes (train count changed) or the
// chip-view toggle (every chip's markup changes).
function renderTrainList() {
  closePopover();
  const container = document.getElementById("train-list");
  container.innerHTML = "";

  if (state.trains.length === 0) {
    const empty = document.createElement("div");
    empty.className = "train-empty";
    empty.textContent = 'No trains yet — click "Add train" to get started.';
    container.appendChild(empty);
    return;
  }

  state.trains.forEach((_, i) => container.appendChild(buildTrainStrip(i)));
}

function initTrainListControls() {
  document.getElementById("add-train-btn").addEventListener("click", () => {
    state.trains.push(buildSeedTrain());
    renderTrainList();
    recompute();
  });

  document.getElementById("chip-view-select").addEventListener("change", (e) => {
    state.chipView = e.target.value;
    renderTrainList();
    saveState(state);
  });
}

// ---- train spec + acceleration tables ----

// Reads labels straight from state.trains (not the aggregates array) so a
// custom name still shows up in the header even for a train whose aggregate
// is currently null (e.g. renamed, then temporarily emptied of locomotives).
function buildHeaderRow(head, cornerLabel) {
  head.innerHTML = "";
  const corner = document.createElement("th");
  corner.textContent = cornerLabel;
  head.appendChild(corner);
  state.trains.forEach((train, i) => {
    const th = document.createElement("th");
    th.textContent = trainLabel(train, i);
    head.appendChild(th);
  });
}

// Builds a row-header <th> from field.labelParts (mix of plain strings and
// { text, tooltip } spans — the latter rendered as a dashed-underline,
// help-cursor info tooltip, see css .info-tooltip) if present, else just
// field.label as plain text.
function buildFieldHeaderCell(field) {
  const th = document.createElement("th");
  th.scope = "row";
  if (field.labelParts) {
    for (const part of field.labelParts) {
      if (typeof part === "string") {
        th.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement("span");
        span.className = "info-tooltip";
        span.textContent = part.text;
        span.title = part.tooltip;
        th.appendChild(span);
      }
    }
  } else {
    th.textContent = field.label;
  }
  return th;
}

function renderTrainSpecTable(aggregates) {
  const head = document.getElementById("train-spec-head");
  const body = document.getElementById("train-spec-body");
  buildHeaderRow(head, "Spec");
  body.innerHTML = "";

  if (!aggregates.some(Boolean)) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = aggregates.length + 1;
    cell.textContent = "Add vehicles to a train above to see its specs.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const field of TRAIN_SPEC_FIELDS) {
    const row = document.createElement("tr");
    row.appendChild(buildFieldHeaderCell(field));

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

  buildHeaderRow(head, "Acceleration (to top speed)");
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

// "A → B" for leg i (stop[i] -> stop[(i+1) % n], wrapping for the last leg)
// — used by the Finances tab's per-leg breakdown, both the grouped tables
// and the bar charts' x-axis labels.
function legLabel(index) {
  const n = state.route.stations.length;
  const from = state.route.stations[index]?.name ?? `Station ${index + 1}`;
  const to = state.route.stations[(index + 1) % n]?.name ?? `Station ${((index + 1) % n) + 1}`;
  return `${from} → ${to}`;
}

// Renders the route table from scratch — one row per stop, holding that
// stop's name plus the leg leaving it (distance/track distance/load,
// leg[i] = stop[i] -> stop[(i+1) % n], last row wraps back to the first
// stop). Only called for structural changes (add/remove station) — editing
// a cell's value updates state + recompute() directly instead, so an open
// popover or an in-progress edit elsewhere isn't blown away by a rebuild.
function renderRoute(aggregates) {
  const body = document.getElementById("route-table-body");
  body.innerHTML = "";

  state.route.stations.forEach((station, i) => {
    body.appendChild(buildRouteRow(station, i, aggregates));
  });
}

function buildRouteRow(station, index, aggregates) {
  const leg = state.route.legs[index];
  const row = document.createElement("tr");

  const nameTd = document.createElement("td");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = station.name;
  nameInput.addEventListener("change", () => {
    station.name = nameInput.value || `Station ${index + 1}`;
    saveState(state);
  });
  nameTd.appendChild(nameInput);
  row.appendChild(nameTd);

  const crowTd = document.createElement("td");
  crowTd.appendChild(
    routeNumberInput(leg.crowDistance_m != null ? leg.crowDistance_m / 1000 : "", (value) => {
      leg.crowDistance_m = value === "" ? null : Number(value) * 1000;
      recompute();
    })
  );
  row.appendChild(crowTd);

  const trackTd = document.createElement("td");
  const trackWrap = document.createElement("div");
  trackWrap.className = "route-track-cell";
  const trackInput = routeNumberInput(
    leg.trackDistance_m != null ? leg.trackDistance_m / 1000 : "",
    (value) => {
      leg.trackDistance_m = value === "" ? null : Number(value) * 1000;
      recompute();
    },
    "= distance"
  );
  trackWrap.appendChild(trackInput);
  const estimateBtn = document.createElement("button");
  estimateBtn.type = "button";
  estimateBtn.className = "route-estimate-btn";
  estimateBtn.textContent = "≈";
  estimateBtn.title = "Estimate track distance from an observed trip time";
  estimateBtn.addEventListener("click", () => openTrackDistanceEstimatorPopover(estimateBtn, leg, trackInput, aggregates));
  trackWrap.appendChild(estimateBtn);
  trackTd.appendChild(trackWrap);
  row.appendChild(trackTd);

  const loadTd = document.createElement("td");
  const loadInput = document.createElement("input");
  loadInput.type = "number";
  loadInput.min = "0";
  loadInput.max = "100";
  loadInput.value = Math.round(leg.loadFactor * 100);
  loadInput.addEventListener("change", () => {
    leg.loadFactor = Math.max(0, Math.min(100, Number(loadInput.value) || 0)) / 100;
    loadInput.value = Math.round(leg.loadFactor * 100);
    recompute();
  });
  loadTd.append(loadInput, "%");
  row.appendChild(loadTd);

  const removeTd = document.createElement("td");
  if (state.route.stations.length > 2) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `Remove ${station.name}`);
    removeBtn.addEventListener("click", () => {
      removeStation(state.route, index);
      rebuildRoute();
    });
    removeTd.appendChild(removeBtn);
  }
  row.appendChild(removeTd);

  return row;
}

function routeNumberInput(value, onChange, placeholder) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "any";
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("change", () => onChange(input.value));
  return input;
}

// Reuses the generic popover plumbing (closePopover/positionPopoverNear,
// see above) for the same "estimate track distance from an observed trip
// time" helper the old per-leg <details> card had.
function openTrackDistanceEstimatorPopover(anchorEl, leg, trackDistanceInput, aggregates) {
  closePopover();

  const popover = document.createElement("div");
  popover.className = "popover";

  const name = document.createElement("div");
  name.className = "popover-name";
  name.textContent = "Estimate track distance";
  popover.appendChild(name);

  const helperRow = document.createElement("div");
  helperRow.className = "popover-row";

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
  popover.appendChild(helperRow);

  const estimateBtn = document.createElement("button");
  estimateBtn.type = "button";
  estimateBtn.textContent = "Estimate";
  popover.appendChild(estimateBtn);

  const result = document.createElement("div");
  result.className = "leg-helper-result";
  popover.appendChild(result);

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
    trackDistanceInput.value = (distance_m / 1000).toFixed(3);
    recompute();
  });

  document.body.appendChild(popover);
  positionPopoverNear(popover, anchorEl);
  openPopoverEl = popover;

  const onDocClick = (e) => {
    if (!popover.contains(e.target) && e.target !== anchorEl) closePopover();
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") closePopover();
  };
  const onScroll = () => closePopover();
  document.addEventListener("click", onDocClick, true);
  document.addEventListener("keydown", onKeydown);
  window.addEventListener("scroll", onScroll, true);

  closeOpenPopoverListeners = () => {
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKeydown);
    window.removeEventListener("scroll", onScroll, true);
  };
}

function rebuildRoute() {
  renderRoute(aggregatesWithLabels());
  recompute();
}

// ---- financials UI ----

// Single source of truth for the per-leg metrics shown on the Finances tab
// (both grouping modes below) — key must match a field on a
// js/finance.js tripSummary() leg entry.
const LEG_METRIC_FIELDS = [
  { key: "time_s", label: "Time", format: (v) => formatValue(v, { unit: "s", digits: 1 }) },
  { key: "avgSpeed_kmh", label: "Average speed", format: (v) => formatValue(v, { unit: "km/h", digits: 1 }) },
  { key: "revenue", label: "Revenue", format: formatMoney },
  { key: "maintenance", label: "Maintenance", format: formatMoney },
  { key: "profit", label: "Profit", format: formatMoney },
];

function initFinanceControls() {
  document.getElementById("difficulty-select").addEventListener("change", (e) => {
    state.difficultyKey = e.target.value;
    recompute();
  });
  document.getElementById("finance-group-by-select").addEventListener("change", (e) => {
    state.financeGroupBy = e.target.value;
    recompute();
  });
}

// Builds one <table class="compare-table"> (train columns via the existing
// buildHeaderRow) with the given row definitions, under a heading, and
// appends it to the container.
function buildFinanceGroupTable(container, heading, cornerLabel, rows, summaries) {
  const group = document.createElement("div");
  group.className = "finance-group";

  const h3 = document.createElement("h3");
  h3.textContent = heading;
  group.appendChild(h3);

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "compare-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  thead.appendChild(headRow);
  buildHeaderRow(headRow, cornerLabel);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const { label, getValue } of rows) {
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = label;
    row.appendChild(th);
    summaries.forEach((s) => {
      const td = document.createElement("td");
      td.textContent = s ? getValue(s) : "—";
      row.appendChild(td);
    });
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  group.appendChild(wrap);
  container.appendChild(group);
}

function renderLegBreakdown(summaries) {
  const container = document.getElementById("leg-breakdown-container");
  container.innerHTML = "";

  if (!summaries.some(Boolean)) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Add vehicles and leg distances to see revenue.";
    container.appendChild(p);
    return;
  }

  if (state.financeGroupBy === "leg") {
    state.route.legs.forEach((_, i) => {
      const rows = LEG_METRIC_FIELDS.map((field) => ({
        label: field.label,
        getValue: (s) => field.format(s.legs[i][field.key]),
      }));
      buildFinanceGroupTable(container, legLabel(i), "Metric", rows, summaries);
    });
  } else {
    LEG_METRIC_FIELDS.forEach((field) => {
      const rows = state.route.legs.map((_, i) => ({
        label: legLabel(i),
        getValue: (s) => field.format(s.legs[i][field.key]),
      }));
      buildFinanceGroupTable(container, field.label, "Leg", rows, summaries);
    });
  }
}

function renderTripSummary(summaries) {
  const tripHead = document.getElementById("trip-summary-head");
  const tripBody = document.getElementById("trip-summary-body");
  buildHeaderRow(tripHead, "Trip total");
  tripBody.innerHTML = "";

  const rows = [
    ["Total time", (s) => formatValue(s.totalTime_s, { unit: "s", digits: 1 })],
    ["Total revenue", (s) => formatMoney(s.totalRevenue)],
    ["Maintenance for this trip", (s) => formatMoney(s.maintenanceForTrip)],
    ["Profit", (s) => formatMoney(s.profit)],
    ["Profit per real hour", (s) => formatMoney(s.profitPerRealHour)],
    ["Profit per game year", (s) => formatMoney(s.profitPerGameYear)],
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

function renderFinance(aggregates) {
  const options = { trackSpeedLimit_kmh: state.trackSpeedLimit_kmh, difficulty: DIFFICULTY_FACTORS[state.difficultyKey] };
  const summaries = aggregates.map((entry) => (entry ? tripSummary(entry.aggregate, state.route, options) : null));

  renderLegBreakdown(summaries);
  renderTripSummary(summaries);

  const legLabels = state.route.legs.map((_, i) => legLabel(i));
  const chartTrains = aggregates.map((entry, i) => (entry && summaries[i] ? { label: entry.label, summary: summaries[i] } : null));
  renderFinanceCharts(chartTrains, legLabels);
}

// ---- orchestration ----
//
// recompute() re-derives and re-renders everything that depends on train/
// route/setting state EXCEPT the train-list DOM structure and the route's
// station/leg DOM structure — those are only rebuilt on structural changes
// (renderTrainList/refreshTrainStrip/rebuildRoute), so in-progress edits (a
// focused input, an open popover, an open <details> helper) survive
// value-only changes like a quantity tweak or a distance edit. It's also
// the single point that persists to localStorage, and is wrapped so a
// rendering bug surfaces as a warning banner instead of a dead page.
// UI-only preferences that don't affect computed data (active tab, chip
// view) persist directly via saveState() instead of routing through here.

function recompute() {
  try {
    const aggregates = aggregatesWithLabels();
    renderTrainSpecTable(aggregates);
    renderAccelerationSection(aggregates);
    renderFinance(aggregates);
    renderCharts(aggregates, state.trackSpeedLimit_kmh);
    saveState(state);
  } catch (e) {
    console.error("Failed to update the page:", e);
    showWarning("Something went wrong updating the page. Your data should still be saved — try refreshing.");
  }
}

function applyLoadedUIState() {
  document.getElementById("difficulty-select").value = state.difficultyKey;
  document.getElementById("finance-group-by-select").value = state.financeGroupBy;
  document.getElementById("chip-view-select").value = state.chipView;

  const trackSelect = document.getElementById("track-speed-limit-select");
  const trackCustom = document.getElementById("track-speed-limit-custom");
  if (state.trackSpeedLimit_kmh === null) {
    trackSelect.value = "none";
    trackCustom.hidden = true;
  } else if (state.trackSpeedLimit_kmh === 120 || state.trackSpeedLimit_kmh === 300) {
    trackSelect.value = String(state.trackSpeedLimit_kmh);
    trackCustom.hidden = true;
  } else {
    trackSelect.value = "custom";
    trackCustom.hidden = false;
    trackCustom.value = state.trackSpeedLimit_kmh;
  }

  setActiveTab(state.activeTab);
}

async function init() {
  initWarningBanner();
  initTabs();
  initChartGallery();

  state.vehicles = await loadVehicles();
  state.vehicleById = new Map(state.vehicles.map((v) => [v.id, v]));
  state.trains = buildDefaultTrains();

  const { state: saved, warning } = loadState(state.vehicleById);
  if (saved) Object.assign(state, saved); // only keys that validated are present, so this only overrides good data
  if (warning) showWarning(warning);

  initTrainListControls();
  initRouteControls();
  initFinanceControls();
  initTheme(() => renderCharts(aggregatesWithLabels(), state.trackSpeedLimit_kmh));

  applyLoadedUIState();
  renderTrainList();
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
