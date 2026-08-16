import { initTheme } from "./theme.js";
import { loadVehicles, formatValue, formatMoneyCompact, formatCompactSpec, ACCELERATION_FIELDS } from "./vehicles.js";
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
import { createRoute, addStation, removeStation, estimateTrackDistance, effectiveTrackDistance } from "./route.js";
import { computeAccelerationStats } from "./physics.js";
import { DIFFICULTY_FACTORS, tripSummary } from "./finance.js";
import { renderCharts, renderFinanceCharts, renderRouteProfileCharts, renderWholeRouteChart, SERIES_SLOTS, seriesColor } from "./charts.js";
import { initChartGallery } from "./chartGallery.js";
import { saveState, loadState, validateState } from "./storage.js";
import { decodeShareHash, buildShareUrl } from "./shareLink.js";
import { iconSvg } from "./icons.js";
import { imageForVehicle } from "./images.js";

const state = {
  vehicles: [],
  vehicleById: new Map(),
  trains: [], // seeded by buildDefaultTrains() once vehicles are loaded, before loadState() is consulted
  route: createRoute(),
  trackSpeedLimit_kmh: 300,
  brakingDeceleration_ms2: 2.5,
  selectedLegIndex: 0,
  difficultyKey: "easy",
  includeStopsInFinancials: false,
  accelerationDetail: "simple",
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

// colorSlot: the train's own explicit chart-color choice (a --series-N
// index, see the color picker in buildTrainStripLabel) if set, else its
// position in the list — same fallback js/charts.js used unconditionally
// before per-train colors existed.
function aggregatesWithLabels() {
  return state.trains.map((train, i) => {
    const aggregate = aggregateTrain(train, state.vehicleById);
    return aggregate ? { aggregate, label: trainLabel(train, i), colorSlot: train.color ?? i } : null;
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

// ---- train list (strips + chips) ----

function renderChip(train, trainIndex, item, type, indexInType, vehicle, isLastInTrain) {
  const wrap = document.createElement("div");
  wrap.className = "chip-wrap";

  // Not a <button> — it hosts two independently-interactive children (the
  // type <select> below and the quantity stepper), which a <button> can't
  // contain. The select's own visible :hover/:focus feedback (see css)
  // stands in for a button's, so this is still keyboard/AT accessible.
  const chip = document.createElement("div");
  chip.className = "chip";
  const tooltip = `${vehicle.name} — ${formatCompactSpec(vehicle)}`;
  chip.title = tooltip;

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

  // Type is the only thing left to configure here (Quantity is the
  // stepper below; Remove is the mini ✕) — so the chip can just open this
  // <select> directly instead of a popover that only ever held one
  // control. Invisible (opacity: 0 in css) but real and focusable; sized
  // to cover the whole chip, but .chip-qty below wins the overlap (see its
  // own comment in css — position+z-index, not just DOM order) so clicks
  // there land on the stepper instead of passing through to this.
  const typeSelect = document.createElement("select");
  typeSelect.className = "chip-type-select";
  typeSelect.title = tooltip; // hovering the select directly (most of the chip's area) should still show it, not just hovering .chip's own padding
  typeSelect.setAttribute("aria-label", `${vehicle.name} type`);
  populateSelectOptions(typeSelect, type === "locomotive" ? locomotivesOf(state.vehicles) : wagonsOf(state.vehicles));
  typeSelect.value = item.vehicleId;
  typeSelect.addEventListener("change", () => {
    const newVehicleId = typeSelect.value;
    if (newVehicleId === item.vehicleId) return;
    const setType = type === "locomotive" ? setLocomotiveTypeAt : setWagonTypeAt;
    setType(train, indexInType, newVehicleId);
    refreshTrainStrip(trainIndex);
    recompute();
  });
  chip.appendChild(typeSelect);

  chip.appendChild(buildChipQtyStepper(train, item, type, indexInType, vehicle));

  // Small per-group insert/remove controls, replacing the old strip-level
  // "add locomotive"/"add wagon" buttons — + inserts a clone of *this*
  // group (same vehicle type and quantity) right after it, rather than a
  // fresh default — a duplicated group is far more often what's wanted
  // (e.g. another 3 of the same wagon) than reverting to the first vehicle
  // in the list; ✕ removes this specific group.
  const miniActions = document.createElement("div");
  miniActions.className = "chip-mini-actions";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "chip-mini-add";
  addBtn.textContent = "+";
  addBtn.title = `Duplicate this ${type}`;
  addBtn.setAttribute("aria-label", `Duplicate ${vehicle.name}`);
  addBtn.addEventListener("click", () => {
    const insert = type === "locomotive" ? insertLocomotive : insertWagon;
    insert(train, indexInType + 1, item.vehicleId, item.quantity);
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

/**
 * Wraps a plain <input type="number"> in the compact themed pill (see css
 * .num-field): hides the native spinner, adds stacked up/down arrows plus
 * scroll-wheel stepping (while hovered, or from anywhere on the page once
 * focused — the document-level listener is added/removed on focus/blur so
 * it doesn't linger past the field losing focus), and an optional inline
 * visual-only unit suffix. Arrows/wheel just nudge input.value by `step`
 * (clamped to the input's own min/max attributes) and dispatch a real
 * "change" event — so whatever "change" listener the caller already put on
 * the input keeps working unmodified; this only changes how the value gets
 * set, never what happens after. Originally built just for the Trains
 * chip's quantity stepper, generalized site-wide per feedback that a plain
 * number input looks out of place next to it.
 */
function wrapNumberField(input, { step = 1, unit, widthCh, upLabel = "Increase", downLabel = "Decrease" } = {}) {
  if (widthCh != null) input.style.width = `${widthCh}ch`;

  const wrap = document.createElement("div");
  wrap.className = "num-field";

  const clamp = (v) => {
    if (input.min !== "" && v < Number(input.min)) v = Number(input.min);
    if (input.max !== "" && v > Number(input.max)) v = Number(input.max);
    return v;
  };

  const bump = (direction) => {
    const current = Number(input.value) || 0;
    input.value = clamp(current + direction * step);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const arrows = document.createElement("div");
  arrows.className = "num-field-arrows";

  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "num-field-up";
  upBtn.title = upLabel;
  upBtn.setAttribute("aria-label", upLabel);
  upBtn.addEventListener("click", () => bump(1));

  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "num-field-down";
  downBtn.title = downLabel;
  downBtn.setAttribute("aria-label", downLabel);
  downBtn.addEventListener("click", () => bump(-1));

  // stopPropagation on the direct listener avoids double-stepping when
  // both are active at once (hovering an already-focused field).
  const onWheel = (e) => {
    e.preventDefault();
    bump(e.deltaY < 0 ? 1 : -1);
  };
  input.addEventListener(
    "wheel",
    (e) => {
      onWheel(e);
      e.stopPropagation();
    },
    { passive: false }
  );
  const onDocumentWheel = (e) => onWheel(e);
  input.addEventListener("focus", () => document.addEventListener("wheel", onDocumentWheel, { passive: false }));
  input.addEventListener("blur", () => document.removeEventListener("wheel", onDocumentWheel));

  arrows.append(upBtn, downBtn);
  wrap.append(input);
  if (unit) {
    const unitEl = document.createElement("span");
    unitEl.className = "num-field-unit";
    unitEl.textContent = unit;
    wrap.appendChild(unitEl);
  }
  wrap.appendChild(arrows);
  return wrap;
}

/** wrapNumberField, but for an <input> that's already sitting in the DOM (static markup, not built here) — reinserts the wrapper at the input's original spot instead of leaving it detached. */
function wrapExistingNumberField(input, options) {
  const { parentNode, nextSibling } = input;
  const wrap = wrapNumberField(input, options);
  parentNode.insertBefore(wrap, nextSibling);
  return wrap;
}

// Compact quantity stepper, a direct child of .chip now (not a separate
// popover field, not a sibling pill) — see renderChip. Stacked up/down
// arrows on the trailing edge (rather than +/- flanking the input on each
// side) — the leading "+" would sit right next to the mini-add button's
// own "+" (a different action, insert a new group), so this avoids that
// visual clash as well as just being more compact (see css .chip-qty, a
// width modifier on top of the shared .num-field widget).
function buildChipQtyStepper(train, item, type, indexInType, vehicle) {
  const setQty = type === "locomotive" ? setLocomotiveQuantityAt : setWagonQuantityAt;

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.value = item.quantity;
  input.setAttribute("aria-label", `${vehicle.name} quantity`);
  input.addEventListener("change", () => {
    const newQty = Math.max(1, Math.floor(Number(input.value)) || 1);
    setQty(train, indexInType, newQty); // mutates `item` in place (same object, this train's array at this index)
    input.value = newQty;
    recompute();
  });

  const wrap = wrapNumberField(input, {
    upLabel: `Increase ${vehicle.name} quantity`,
    downLabel: `Decrease ${vehicle.name} quantity`,
  });
  wrap.classList.add("chip-qty"); // narrow-width modifier — see css
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

  wrap.append(label, renameBtn, buildTrainColorButton(train, trainIndex));
  return wrap;
}

// Small swatch button showing this train's current chart color (its own
// pinned --series-N slot if set, else its position in the list — same
// fallback js/charts.js uses). Click opens a popover to pin one of the 8
// validated palette slots, or revert to "Auto".
function buildTrainColorButton(train, trainIndex) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "train-strip-color";
  const currentSlot = () => train.color ?? trainIndex;
  const refresh = () => {
    btn.style.background = seriesColor(currentSlot());
    btn.title = train.color != null ? "Chart color (pinned) — click to change" : "Chart color (auto) — click to pin";
  };
  refresh();
  btn.setAttribute("aria-label", `Set chart color for ${trainLabel(train, trainIndex)}`);
  btn.addEventListener("click", () => openTrainColorPopover(btn, train, refresh));
  return btn;
}

function openTrainColorPopover(anchorEl, train, onChange) {
  closePopover();

  const popover = document.createElement("div");
  popover.className = "popover";

  const name = document.createElement("div");
  name.className = "popover-name";
  name.textContent = "Chart color";
  popover.appendChild(name);

  const swatchRow = document.createElement("div");
  swatchRow.className = "popover-swatch-row";
  for (let slot = 0; slot < SERIES_SLOTS; slot++) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "popover-swatch";
    swatch.style.background = seriesColor(slot);
    swatch.setAttribute("aria-label", `Color ${slot + 1}`);
    if (train.color === slot) swatch.classList.add("is-selected");
    swatch.addEventListener("click", () => {
      train.color = slot;
      onChange();
      closePopover();
      recompute();
    });
    swatchRow.appendChild(swatch);
  }
  popover.appendChild(swatchRow);

  const autoBtn = document.createElement("button");
  autoBtn.type = "button";
  autoBtn.className = "popover-swatch-auto";
  autoBtn.textContent = "Auto (position in list)";
  if (train.color == null) autoBtn.classList.add("is-selected");
  autoBtn.addEventListener("click", () => {
    train.color = null;
    onChange();
    closePopover();
    recompute();
  });
  popover.appendChild(autoBtn);

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

function initAccelerationControls() {
  document.getElementById("acceleration-detail-select").addEventListener("change", (e) => {
    state.accelerationDetail = e.target.value;
    recompute();
  });
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

  const detailed = state.accelerationDetail === "detailed";

  // Mass/Power are basic specs, always known regardless of whether the
  // train can actually accelerate at all — sourced straight from the
  // aggregate (not gated behind a physics warning like the fields below)
  // and reusing the exact same field defs/formatting as the Trains tab
  // (labelParts tooltip included) for consistency between the two tables.
  for (const key of ["mass_t", "power_kW"]) {
    const field = TRAIN_SPEC_FIELDS.find((f) => f.key === key);
    const row = document.createElement("tr");
    row.appendChild(buildFieldHeaderCell(field));
    for (const entry of aggregates) {
      const td = document.createElement("td");
      td.textContent = entry ? formatTrainSpecValue(entry.aggregate, field) : "—";
      row.appendChild(td);
    }
    body.appendChild(row);
  }

  // Effective TE / Rolling resistance / Initial acceleration are always
  // shown; Tractive threshold speed (detailOnly) and the milestone
  // time/distance rows below are hidden in the simplified view — they're
  // meaningless to a reader who doesn't already know what a "tractive
  // threshold" is.
  for (const field of ACCELERATION_FIELDS) {
    if (field.detailOnly && !detailed) continue;
    const row = document.createElement("tr");
    row.appendChild(buildFieldHeaderCell(field));
    for (const result of results) {
      const td = document.createElement("td");
      td.textContent = result && !result.warning ? formatValue(result[field.key], field) : "—";
      row.appendChild(td);
    }
    body.appendChild(row);
  }

  if (detailed) {
    appendDerivedRow(body, "Time to tractive threshold", results, (r) => r.timeThreshold_s, "s", 1);
    appendDerivedRow(body, "Distance to tractive threshold", results, (r) => r.distanceThreshold_m, "m", 0);
    appendDerivedRow(body, "Time to 95% of top speed", results, (r) => r.time95_s, "s", 1);
    appendDerivedRow(body, "Distance to 95% of top speed", results, (r) => r.distance95_m, "m", 0);
  }
  appendDerivedRow(body, "Time to top speed", results, (r) => r.totalTime_s, "s", 1);
  appendDerivedRow(body, "Distance to top speed", results, (r) => r.totalDistance_m, "m", 0);

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
  const customField = wrapExistingNumberField(custom, { step: 10 });

  function applyTrackSpeedLimit() {
    if (select.value === "none") state.trackSpeedLimit_kmh = null;
    else if (select.value === "custom") state.trackSpeedLimit_kmh = Number(custom.value) || null;
    else state.trackSpeedLimit_kmh = Number(select.value);
    recompute();
  }

  select.addEventListener("change", () => {
    customField.hidden = select.value !== "custom";
    if (select.value === "custom") custom.focus();
    applyTrackSpeedLimit();
  });
  custom.addEventListener("change", applyTrackSpeedLimit);

  const brakingInput = document.getElementById("braking-decel-input");
  wrapExistingNumberField(brakingInput, { step: 0.1, unit: "m/s²" });
  brakingInput.addEventListener("change", (e) => {
    const value = Number(e.target.value);
    state.brakingDeceleration_ms2 = value > 0 ? value : 2.5;
    e.target.value = state.brakingDeceleration_ms2;
    recompute();
  });

  document.getElementById("route-leg-select").addEventListener("change", (e) => {
    state.selectedLegIndex = Number(e.target.value);
    recompute();
  });

  document.getElementById("add-station-btn").addEventListener("click", () => {
    addStation(state.route);
    rebuildRoute();
  });
}

// Rebuilds the leg <select>'s options from the current route (label via
// legLabel(), so it always matches the route table's station names) and
// clamps state.selectedLegIndex if the previously-selected leg no longer
// exists (e.g. that station was removed). Called on every structural route
// change (renderRoute) and on station rename, since legLabel() output
// changes then too but nothing else currently triggers a rebuild for that.
function renderLegSelect() {
  const select = document.getElementById("route-leg-select");
  const legCount = state.route.legs.length;
  if (state.selectedLegIndex >= legCount) state.selectedLegIndex = 0;

  select.innerHTML = "";
  state.route.legs.forEach((_, i) => {
    select.appendChild(new Option(legLabel(i), String(i), false, i === state.selectedLegIndex));
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

// legLabel() plus the leg's actual distance (track distance, falling back
// to crow-flies — same value the Time/Average speed figures are computed
// over), e.g. "A → B (15.0 km)". Used for the per-leg table headings
// ("Group by: Leg") and, per LEG_METRIC_FIELDS.showLegDistance, for row
// labels where the distance is directly relevant context.
function legLabelWithDistance(index) {
  const distance_m = effectiveTrackDistance(state.route.legs[index]);
  const distance = distance_m != null ? ` (${formatValue(distance_m / 1000, { unit: "km", digits: 1 })})` : "";
  return `${legLabel(index)}${distance}`;
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
  renderLegSelect();
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
    renderLegSelect(); // leg labels (legLabel()) include station names
    saveState(state);
  });
  nameTd.appendChild(nameInput);
  row.appendChild(nameTd);

  const crowTd = document.createElement("td");
  crowTd.appendChild(
    routeNumberInput(leg.crowDistance_m != null ? leg.crowDistance_m / 1000 : "", (value) => {
      leg.crowDistance_m = value === "" ? null : Number(value) * 1000;
      recompute();
    }, null, 6).field
  );
  row.appendChild(crowTd);

  const trackTd = document.createElement("td");
  const trackWrap = document.createElement("div");
  trackWrap.className = "route-track-cell";
  const track = routeNumberInput(
    leg.trackDistance_m != null ? leg.trackDistance_m / 1000 : "",
    (value) => {
      leg.trackDistance_m = value === "" ? null : Number(value) * 1000;
      recompute();
    },
    null,
    6
  );
  trackWrap.appendChild(track.field);
  const estimateBtn = document.createElement("button");
  estimateBtn.type = "button";
  estimateBtn.className = "route-estimate-btn";
  estimateBtn.textContent = "≈";
  estimateBtn.title = "Estimate track distance from an observed trip time";
  estimateBtn.addEventListener("click", () => openTrackDistanceEstimatorPopover(estimateBtn, leg, track.input, aggregates));
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
  loadTd.append(wrapNumberField(loadInput, { unit: "%", widthCh: 8 }));
  row.appendChild(loadTd);

  const removeTd = document.createElement("td");
  if (state.route.stations.length > 2) {
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "route-remove-btn";
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

function routeNumberInput(value, onChange, placeholder, widthCh) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "any";
  input.value = value;
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("change", () => onChange(input.value));
  return { input, field: wrapNumberField(input, { step: 1, widthCh }) };
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
  helperRow.appendChild(wrapNumberField(timeInput, { step: 10, unit: "s", widthCh: 5 }));

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
// showLegDistance: leg distance is directly relevant context for these two
// (see legLabelWithDistance) — appended to their row labels in "Group by:
// Metric" mode; the other three don't need the reminder.
const LEG_METRIC_FIELDS = [
  { key: "time_s", label: "Time", format: (v) => formatValue(v, { unit: "s", digits: 1 }), showLegDistance: true },
  { key: "avgSpeed_kmh", label: "Average speed", format: (v) => formatValue(v, { unit: "km/h", digits: 1 }), showLegDistance: true },
  { key: "revenue", label: "Revenue", format: formatMoneyCompact },
  { key: "maintenance", label: "Maintenance", format: formatMoneyCompact },
  { key: "profit", label: "Profit", format: formatMoneyCompact },
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
  document.getElementById("include-stops-checkbox").addEventListener("change", (e) => {
    state.includeStopsInFinancials = e.target.checked;
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
      buildFinanceGroupTable(container, legLabelWithDistance(i), "Metric", rows, summaries);
    });
  } else {
    LEG_METRIC_FIELDS.forEach((field) => {
      const rows = state.route.legs.map((_, i) => ({
        label: field.showLegDistance ? legLabelWithDistance(i) : legLabel(i),
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
    ["Total revenue", (s) => formatMoneyCompact(s.totalRevenue)],
    ["Maintenance for this trip", (s) => formatMoneyCompact(s.maintenanceForTrip)],
    ["Profit", (s) => formatMoneyCompact(s.profit)],
    ["Profit per real hour", (s) => formatMoneyCompact(s.profitPerRealHour)],
    ["Profit per game year", (s) => formatMoneyCompact(s.profitPerGameYear)],
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
  const options = {
    trackSpeedLimit_kmh: state.trackSpeedLimit_kmh,
    difficulty: DIFFICULTY_FACTORS[state.difficultyKey],
    includeStops: state.includeStopsInFinancials,
    brakingDeceleration_ms2: state.brakingDeceleration_ms2,
  };
  const summaries = aggregates.map((entry) => (entry ? tripSummary(entry.aggregate, state.route, options) : null));

  renderLegBreakdown(summaries);
  renderTripSummary(summaries);

  // Bare indices, not full station-pair names — the x-axis is already
  // titled "Leg" (see js/charts.js), and the full "Station M → Station N"
  // names get unwieldy fast as a chart category axis. Full names + distance
  // are still shown in the tables above (legLabel()/legLabelWithDistance()).
  const legLabels = state.route.legs.map((_, i) => String(i + 1));
  const chartTrains = aggregates.map((entry, i) => (entry && summaries[i] ? { label: entry.label, summary: summaries[i], colorSlot: entry.colorSlot } : null));
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

    const selectedLeg = state.route.legs[state.selectedLegIndex];
    const legDistance_m = selectedLeg ? effectiveTrackDistance(selectedLeg) : null;
    if (legDistance_m != null) {
      renderRouteProfileCharts(aggregates, legDistance_m, {
        trackSpeedLimit_kmh: state.trackSpeedLimit_kmh,
        brakingDeceleration_ms2: state.brakingDeceleration_ms2,
      });
    }
    renderWholeRouteChart(aggregates, state.route, {
      trackSpeedLimit_kmh: state.trackSpeedLimit_kmh,
      brakingDeceleration_ms2: state.brakingDeceleration_ms2,
    });

    saveState(state);
  } catch (e) {
    console.error("Failed to update the page:", e);
    showWarning("Something went wrong updating the page. Your data should still be saved — try refreshing.");
  }
}

function applyLoadedUIState() {
  document.getElementById("acceleration-detail-select").value = state.accelerationDetail;
  document.getElementById("difficulty-select").value = state.difficultyKey;
  document.getElementById("finance-group-by-select").value = state.financeGroupBy;
  document.getElementById("include-stops-checkbox").checked = state.includeStopsInFinancials;
  document.getElementById("chip-view-select").value = state.chipView;

  const trackSelect = document.getElementById("track-speed-limit-select");
  const trackCustom = document.getElementById("track-speed-limit-custom");
  const trackCustomField = trackCustom.closest(".num-field"); // hide the whole pill, not just the input inside it
  if (state.trackSpeedLimit_kmh === null) {
    trackSelect.value = "none";
    trackCustomField.hidden = true;
  } else if (state.trackSpeedLimit_kmh === 120 || state.trackSpeedLimit_kmh === 300) {
    trackSelect.value = String(state.trackSpeedLimit_kmh);
    trackCustomField.hidden = true;
  } else {
    trackSelect.value = "custom";
    trackCustomField.hidden = false;
    trackCustom.value = state.trackSpeedLimit_kmh;
  }
  document.getElementById("braking-decel-input").value = state.brakingDeceleration_ms2;

  setActiveTab(state.activeTab);
}

// Copies a link that reproduces the current train/route/physics config for
// whoever opens it — see js/shareLink.js for exactly what that does and
// doesn't include. Text label rather than an icon — share icons are
// commonly associated with social-media sharing specifically, not what
// this is. Confirmation morphs the pill into a circle around a checkmark
// for 1.5s (the shape's own CSS transition, see .share-link-btn/.copied —
// this just toggles the class and swaps the content) — no toast system
// elsewhere in the app to match instead.
function initShareLink() {
  const btn = document.getElementById("share-link-btn");
  btn.textContent = "Share";

  let resetTimer = null;
  btn.addEventListener("click", async () => {
    try {
      const url = await buildShareUrl(state);
      await navigator.clipboard.writeText(url);
      btn.classList.add("copied");
      btn.innerHTML = iconSvg("check2");
      btn.setAttribute("aria-label", "Link copied to clipboard");
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        btn.classList.remove("copied");
        btn.textContent = "Share";
        btn.setAttribute("aria-label", "Copy a shareable link");
      }, 1500);
    } catch (e) {
      console.error("Failed to copy share link:", e);
      showWarning("Couldn't copy the link — your browser may be blocking clipboard access.");
    }
  });
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

  // A share link overrides both the defaults and localStorage above (same
  // Object.assign-only-present-keys pattern), then is treated as this
  // session's real state from here on — saved immediately and the hash
  // cleared, rather than kept as a fragile one-time overlay that would
  // silently keep re-applying (or go stale) across refreshes.
  if (location.hash) {
    try {
      const decoded = await decodeShareHash(location.hash);
      if (decoded) {
        const { state: shared, warning: shareWarning } = validateState(decoded, state.vehicleById);
        Object.assign(state, shared);
        saveState(state);
        if (shareWarning) showWarning(shareWarning);
      }
    } catch (e) {
      console.error("Failed to decode shared link:", e);
      showWarning("The link's shared configuration couldn't be read and was ignored.");
    }
    history.replaceState(null, "", location.pathname + location.search);
  }

  initTrainListControls();
  initAccelerationControls();
  initRouteControls();
  initFinanceControls();
  initShareLink();
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
