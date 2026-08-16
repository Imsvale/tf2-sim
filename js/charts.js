import { forceAtSpeed, accelerationAtSpeed, simulate, simulateToStop } from "./physics.js";
import { stationHoldTime } from "./loading.js";
import { effectiveTrackDistance } from "./route.js";
import { formatMoneyCompact } from "./vehicles.js";
import { breakEvenAverageSpeed_kmh } from "./finance.js";

// Chart.js and its zoom plugin are loaded globally via plain <script> tags
// (vendor/chart.umd.min.js, vendor/chartjs-plugin-zoom.umd.min.js) before
// this module — no bundler, consistent with the rest of the app. The zoom
// plugin doesn't auto-register itself; it just exposes window.ChartZoom.
// Registering it globally is harmless for charts that don't opt in (they
// simply have no plugins.zoom/pan config for it to act on) — see
// renderChartInto's zoomEnabled flag, used by js/chartGallery.js only.
if (typeof Chart !== "undefined" && typeof ChartZoom !== "undefined") {
  Chart.register(ChartZoom);
}

// How close (CSS px) the cursor must be to a line before its hover/tooltip
// shows at all — tweak this to taste.
export const HOVER_RADIUS_PX = 20;

// Chart.js's built-in "nearest" mode always shows *something*, even when the
// cursor is nowhere near any line — every position in the chart area is
// "nearest" to whichever series happens to be closest. This wraps it: reuse
// Chart.js's own nearest-point lookup (so it stays consistent with however
// it computes distance), then discard the result unless it's actually
// within HOVER_RADIUS_PX of the cursor.
if (typeof Chart !== "undefined") {
  Chart.Interaction.modes.nearestWithinRadius = (chart, e, options) => {
    const nearest = Chart.Interaction.modes.nearest(chart, e, options);
    if (nearest.length === 0) return nearest;
    const position = Chart.helpers.getRelativePosition(e, chart);
    const { x, y } = nearest[0].element;
    const distance = Math.hypot(x - position.x, y - position.y);
    return distance <= HOVER_RADIUS_PX ? nearest : [];
  };
}

// Categorical palette (dataviz skill): 8 fixed-order hues, validated against
// this app's actual card surfaces in both themes (CVD ΔE, contrast, etc. —
// see css/styles.css's --series-* comment). Read from CSS custom properties
// so light/dark stays in one place. Never cycled past 8 — a 9th+ series
// falls back to a shared muted color rather than a generated hue; the
// legend and hover tooltip (both show the label as text) carry identity
// past that point, not color alone.
export const SERIES_SLOTS = 8;

function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const get = (name) => style.getPropertyValue(name).trim();
  return {
    text: get("--text"),
    textMuted: get("--text-muted"),
    border: get("--border"),
    seriesColor: (i) => get(i < SERIES_SLOTS ? `--series-${i + 1}` : "--series-other"),
  };
}

/** The actual (theme-resolved) color for a --series-N slot — used by js/main.js's per-train color picker so its swatches match the charts exactly. */
export function seriesColor(slot) {
  return themeColors().seriesColor(slot);
}

// Four chart groups today: the 4 Physics line charts, the 5 Finance bar
// charts (see LEG_CHART_METRICS below), the 2 Route leg-profile charts
// (see renderRouteProfileCharts), and the single whole-route chart (see
// renderWholeRouteChart). js/chartGallery.js's prev/next navigation stays
// confined to whichever group it was opened from — see chartGroupOf().
// routeWhole is a single-chart group; prev/next within it is a harmless
// no-op (wraps to itself).
export const CHART_GROUPS = {
  physics: ["chart-force", "chart-acceleration", "chart-speed", "chart-distance", "chart-speed-distance"],
  finance: ["chart-leg-time", "chart-leg-speed", "chart-leg-revenue", "chart-leg-maintenance", "chart-leg-profit"],
  route: [
    "chart-route-speed-time",
    "chart-route-accel-time",
    "chart-route-distance-track-time",
    "chart-route-distance-crow-time",
    "chart-route-avgspeed-time",
    "chart-route-speed-track",
    "chart-route-avgspeed-track",
    "chart-route-speed-crow",
    "chart-route-avgspeed-crow",
  ],
  routeWhole: ["chart-route-whole"],
};

export function chartGroupOf(chartId) {
  return Object.keys(CHART_GROUPS).find((group) => CHART_GROUPS[group].includes(chartId)) ?? null;
}

export const CHART_TITLES = {
  "chart-force": "Force vs. Speed",
  "chart-acceleration": "Acceleration vs. Speed",
  "chart-speed": "Speed over Time",
  "chart-distance": "Distance over Time",
  "chart-speed-distance": "Speed over Distance",
  "chart-leg-time": "Time per Leg",
  "chart-leg-speed": "Average Speed per Leg",
  "chart-leg-revenue": "Revenue per Leg",
  "chart-leg-maintenance": "Maintenance per Leg",
  "chart-leg-profit": "Profit per Leg",
  "chart-route-speed-time": "Leg Profile — Time — Speed",
  "chart-route-accel-time": "Leg Profile — Time — Acceleration",
  "chart-route-distance-track-time": "Leg Profile — Time — Distance (Track)",
  "chart-route-distance-crow-time": "Leg Profile — Time — Distance (Crow-flies)",
  "chart-route-avgspeed-time": "Leg Profile — Time — Average Speed (Crow-flies)",
  "chart-route-speed-track": "Leg Profile — Track Distance — Speed",
  "chart-route-avgspeed-track": "Leg Profile — Track Distance — Average Speed",
  "chart-route-speed-crow": "Leg Profile — Crow-flies Distance — Speed",
  "chart-route-avgspeed-crow": "Leg Profile — Crow-flies Distance — Average Speed",
  "chart-route-whole": "Whole Route — Speed over Time",
};

const LEG_CHART_METRICS = [
  { id: "chart-leg-time", yLabel: "Time (s)", key: "time_s" },
  { id: "chart-leg-speed", yLabel: "Speed (km/h)", key: "avgSpeed_kmh" },
  { id: "chart-leg-revenue", yLabel: "Revenue ($)", key: "revenue", isMoney: true },
  { id: "chart-leg-maintenance", yLabel: "Maintenance ($)", key: "maintenance", isMoney: true },
  { id: "chart-leg-profit", yLabel: "Profit ($)", key: "profit", isMoney: true },
];

const POINT_COUNT = 120;
const charts = {}; // canvasId -> small-card Chart instance
const lastConfigs = {}; // canvasId -> last-rendered chart config, reused by js/chartGallery.js

// After zooming/panning to an arbitrary (non-"nice") range, Chart.js's own
// tick generator still plants a tick at the exact min and exact max —
// showing a many-decimal number right at the edge. Verified against a real
// Chart.js instance (headless-browser trace, not just logic-only): the
// *first* fix attempted here just deleted that boundary tick when it sat
// too close to its neighbor, but that missed the actual mechanism — Chart.js
// itself already drops the nearest *interior* nice tick to avoid crowding
// (e.g. zoomed to [526.3, 1034.7], the raw array comes back as
// [526.3, 600, 700, 800, 900, 1034.7] — 1000 is simply never generated),
// so by the time this hook runs there's no longer a close pair to detect;
// the gap just looks abnormally wide. Deleting boundary ticks can't put 1000
// back. So instead of trimming, rebuild: take the regular step from any two
// interior ticks (both survive on-grid regardless of how ugly the
// boundaries are), then regenerate every multiple of that step inside
// [scale.min, scale.max] from scratch, discarding Chart.js's raw array
// entirely. This drops the decimal boundary ticks (item 3) and restores
// whatever interior tick Chart.js silently swallowed (item 4) as one fix,
// since both were really the same generator quirk.
function trimBoundaryTicks(scale) {
  const ticks = scale.ticks;
  if (ticks.length < 3) return; // need at least one interior tick pair to read a step from
  const interior = ticks.slice(1, -1);
  if (interior.length < 2) return;
  const step = interior[1].value - interior[0].value;
  if (step <= 0) return;
  const anchor = interior[0].value; // already on-grid; regenerate the whole grid relative to it
  const firstK = Math.ceil((scale.min - anchor) / step - 1e-9);
  const lastK = Math.floor((scale.max - anchor) / step + 1e-9);
  // Each tick computed independently (anchor + k*step) rather than by
  // repeatedly adding step in a loop — the latter accumulates binary-
  // floating-point error further with every tick (classic 0.2+0.2+0.2±ε);
  // multiplying by an integer index keeps each tick's error bounded
  // instead of growing. formatAxisTick (below) cleans up what's left at
  // display time regardless, but there's no reason to generate more noise
  // than necessary here.
  const rebuilt = [];
  for (let k = firstK; k <= lastK; k++) {
    rebuilt.push({ value: anchor + k * step });
  }
  if (rebuilt.length >= 2) scale.ticks = rebuilt;
}

// Even with the above, an arbitrary step (0.2, say) isn't exactly
// representable in binary floating point, so ticks can still come out as
// 0.6000000000000001 or 1.5999999999999998 — displayed raw, both the
// leftover imprecision and the inconsistent decimal count between ticks
// are visible. The imprecision itself is unfixable (it's inherent to
// binary floats), but it's a non-issue once formatted for display: read
// the step directly from the (already regular, post-trimBoundaryTicks)
// tick array, and round every tick's label to just enough decimal places
// to represent that step exactly — toFixed's rounding is what actually
// absorbs the noise.
function decimalPlacesForStep(step) {
  if (!(step > 0)) return 0;
  const normalized = Number(step.toPrecision(10)); // clears FP noise in the step itself before counting its digits
  const str = normalized.toString();
  if (str.includes("e") || str.includes("E")) return 2; // exponential notation (extremely small/large step) — reasonable fallback
  const dot = str.indexOf(".");
  return dot === -1 ? 0 : Math.min(str.length - dot - 1, 6);
}

function formatAxisTick(value, index, ticks) {
  const step = ticks.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) : 0;
  return Number(value).toFixed(decimalPlacesForStep(step));
}

// Drag directly on an axis (below the x-axis' tick labels, or left of the
// y-axis') to scale *that axis specifically* — dragging in the axis' own
// increasing direction (right for x, up for y) contracts the visible range
// (zooms in); dragging back toward zero expands it (zooms out). Always
// anchored at zero (min is
// always 0, never negative) rather than at the cursor's value — negative
// values are out of scope for every axis in this app (speed, time,
// distance, money), so there's nothing meaningful on that side to reveal.
// Scoped to outside chart.chartArea specifically so it can never compete
// with the zoom plugin's in-area pan/drag-zoom for the same gesture. A real
// Chart.js plugin (afterInit/destroy) rather than manual addEventListener
// calls in renderChartInto, so cleanup is automatic on chart.destroy() — no
// coordination needed with js/chartGallery.js, which already destroys the
// previous modal chart before creating the next one.
function createAxisDragZoomPlugin() {
  const SENSITIVITY_PX = 200; // px of drag per doubling/halving of the visible range
  const MIN_MAX_FRACTION = 0.02; // floor on how far max can contract, relative to its drag-start value
  let chart, canvas, dragState = null;

  const relativePos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Which axis (if any) a point outside the plot area belongs to, and the
  // cursor to hint that — reused by both the hover-feedback and drag-start
  // handlers so they can't disagree about where the "hot zone" is.
  const axisAt = ({ x, y }) => {
    const area = chart.chartArea;
    if (y > area.bottom && x >= area.left && x <= area.right) return { axis: chart.scales.x, isX: true };
    if (x < area.left && y >= area.top && y <= area.bottom) return { axis: chart.scales.y, isX: false };
    return null;
  };

  const onMouseMove = (e) => {
    if (dragState) {
      const pos = relativePos(e);
      const currentPixel = dragState.isX ? pos.x : pos.y;
      const rawDelta = currentPixel - dragState.startPixel;
      const delta = dragState.isX ? rawDelta : -rawDelta; // screen y grows downward; flip so "up" is the y-axis' positive direction
      const scaleFactor = Math.pow(2, -delta / SENSITIVITY_PX); // inverted: dragging the positive direction contracts, not expands
      const { axis, startMax } = dragState;
      const newMax = Math.max(startMax * scaleFactor, startMax * MIN_MAX_FRACTION);
      chart.zoomScale(axis.id, { min: 0, max: newMax }, "none");
      return;
    }
    // Not dragging: just hint that this zone is draggable.
    const hit = axisAt(relativePos(e));
    canvas.style.cursor = hit ? (hit.isX ? "ew-resize" : "ns-resize") : "";
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return; // primary button/plain drag only
    const hit = axisAt(relativePos(e));
    if (!hit || hit.axis.type !== "linear") return; // category axes (bar chart x) aren't continuously scalable this way
    const pos = relativePos(e);
    const startPixel = hit.isX ? pos.x : pos.y;
    dragState = { axis: hit.axis, isX: hit.isX, startPixel, startMax: hit.axis.max };
    e.preventDefault();
  };

  const onMouseUp = () => {
    dragState = null;
  };

  return {
    id: "axisDragZoom",
    afterInit(c) {
      chart = c;
      canvas = c.canvas;
      canvas.addEventListener("mousedown", onMouseDown);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    destroy() {
      canvas.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    },
  };
}

/**
 * Builds and returns a Chart.js instance for the given canvas. Shared by the
 * small inline cards (zoomEnabled: false) and js/chartGallery.js's modal
 * (zoomEnabled: true) so there's exactly one place that defines what a
 * chart's base options are. `config.type` is "line" (default, the 4 Physics
 * curves — continuous, sampled) or "bar" (the 5 Finance per-leg charts —
 * discrete categories, one bar per train per leg).
 */
export function renderChartInto(canvas, config, { zoomEnabled = false } = {}) {
  const { type = "line", yLabel, datasets, isMoney = false } = config;
  const isBar = type === "bar";
  const colors = themeColors();

  const data = isBar
    ? {
        labels: config.xLabels,
        datasets: datasets.map((ds) => {
          const color = colors.seriesColor(ds.seriesIndex);
          return { label: ds.label, data: ds.data, backgroundColor: color, borderColor: color, borderWidth: 1 };
        }),
      }
    : {
        datasets: datasets.map((ds) => {
          const color = colors.seriesColor(ds.seriesIndex);
          return {
            label: ds.label,
            data: ds.points,
            borderColor: color,
            backgroundColor: color,
            // ds.pointRadius: a single-point "marker" dataset (see
            // renderRouteProfileCharts' break-even crossing marker) opts
            // into a visible dot instead of the default invisible-until-
            // hovered line-chart point.
            pointRadius: ds.pointRadius ?? 0,
            pointHoverRadius: ds.pointRadius != null ? ds.pointRadius + 2 : 4,
            borderWidth: 2,
            tension: 0.15,
            // Route leg-profile charts split each train into a solid
            // "run" segment and a dashed "brake" segment sharing the same
            // color (see renderRouteProfileCharts) — dashed marks the
            // brake portion, hideFromLegend keeps it from adding a
            // redundant second legend entry for the same train.
            borderDash: ds.dashed ? [6, 4] : undefined,
            hideFromLegend: ds.legendHidden ?? false,
          };
        }),
      };

  // Bar charts get Chart.js's standard "index" hover (whole category at
  // once, generous bar hit-areas) — the custom "nearestWithinRadius" mode
  // below exists specifically for line charts, where points are invisible
  // until hovered (pointRadius: 0) and "xy" distance is needed so two
  // curves passing close together in x don't flip the tooltip between them
  // on tiny mouse movements. Bars don't have either problem.
  const interactionMode = isBar ? "index" : "nearestWithinRadius";
  const interactionAxis = isBar ? "x" : "xy";

  return new Chart(canvas, {
    type,
    data,
    // Per-instance plugin (not globally registered, unlike the zoom plugin
    // above) — only the gallery's zoomable charts get the axis-drag-to-scale
    // behavior, same scoping as wheel/pan below.
    plugins: zoomEnabled ? [createAxisDragZoomPlugin()] : [],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: !isBar ? false : undefined,
      interaction: { mode: interactionMode, axis: interactionAxis, intersect: false },
      scales: {
        x: isBar
          ? {
              type: "category",
              title: { display: true, text: "Leg", color: colors.text },
              ticks: { color: colors.textMuted },
              grid: { color: colors.border },
            }
          : {
              type: "linear",
              title: { display: true, text: config.xLabel, color: colors.text },
              ticks: { color: colors.textMuted, callback: formatAxisTick },
              grid: { color: colors.border },
              // See trimBoundaryTicks — only meaningful for a continuous
              // (linear) axis; a bar chart's category x-axis never has
              // arbitrary zoomed-to boundaries to trim.
              afterBuildTicks: trimBoundaryTicks,
            },
        y: {
          title: { display: true, text: yLabel, color: colors.text },
          // Revenue/Maintenance/Profit can run into six or seven figures —
          // "$1.2M" instead of "$1,246,247" repeated at every gridline.
          ticks: { color: colors.textMuted, callback: isMoney ? (value) => formatMoneyCompact(value) : formatAxisTick },
          grid: { color: colors.border },
          afterBuildTicks: trimBoundaryTicks,
        },
      },
      plugins: {
        // Legend click-to-toggle series visibility is Chart.js's default
        // behavior (not configured here) — intentional, doubles as the
        // "selective show/hide" for readability with more trains. The
        // filter hides any dataset marked hideFromLegend (a train's
        // dashed brake-segment twin — see the line-dataset mapping above).
        legend: { labels: { color: colors.text, filter: (item, chartData) => !chartData.datasets[item.datasetIndex]?.hideFromLegend } },
        tooltip: { mode: interactionMode, axis: interactionAxis, intersect: false },
        zoom: zoomEnabled
          ? {
              // A category x-axis (bar charts) doesn't have a well-defined
              // "zoom" the way a continuous line-chart axis does — restrict
              // zoom/pan to y for bar charts, keep xy for line charts.
              // scaleMode gives wheel-zoom the same "hovering directly over
              // an axis restricts to just that axis" behavior the new
              // axis-drag plugin implements for dragging.
              zoom: { wheel: { enabled: true }, drag: { enabled: false }, mode: isBar ? "y" : "xy", scaleMode: isBar ? "y" : "xy" },
              // Hammer's gesture recognizer (which drives pan) is attached
              // to the whole canvas, not just chart.chartArea — without
              // this it also starts panning (moving both x and y) when a
              // drag begins in the axis-drag-zoom plugin's own hot zone
              // below/left of the chart area, since that's still part of
              // the same canvas element. Rejecting any pan that doesn't
              // start inside chartArea keeps the two gestures mutually
              // exclusive by region, matching the axis-drag plugin's own
              // chart.chartArea scoping.
              pan: {
                enabled: true,
                mode: isBar ? "y" : "xy",
                onPanStart: ({ chart, point }) => {
                  const area = chart.chartArea;
                  return point.x >= area.left && point.x <= area.right && point.y >= area.top && point.y <= area.bottom;
                },
              },
              // Wheel-zoom-out and pan can otherwise drift below zero same
              // as drag could before the axisDragZoom plugin's own
              // zero-anchor fix — negative values are out of scope for
              // every axis here (speed, time, distance, money).
              limits: { x: { min: 0 }, y: { min: 0 } },
            }
          : undefined,
      },
    },
  });
}

function renderCardChart(canvasId, config) {
  lastConfigs[canvasId] = config;

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  charts[canvasId]?.destroy();
  charts[canvasId] = renderChartInto(canvas, config, { zoomEnabled: false });
}

/** Reused by js/chartGallery.js to render the same data into its own (bigger) canvas. */
export function getChartConfig(canvasId) {
  return lastConfigs[canvasId] ?? null;
}

function sampleOverSpeed(aggregate, fn, maxSpeed_kmh, gravity_ms2) {
  const points = [];
  for (let i = 0; i <= POINT_COUNT; i++) {
    const v_kmh = (maxSpeed_kmh * i) / POINT_COUNT;
    const y = fn(aggregate, v_kmh, gravity_ms2);
    if (y != null) points.push({ x: v_kmh, y });
  }
  return points;
}

/**
 * @param {Array<{aggregate: object, label: string, colorSlot: number}|null>} trains - any
 *   number of slots; colorSlot is the train's own explicit --series-N choice if the user set
 *   one (js/main.js's train-strip color picker), else its position in this array — so an
 *   unpinned train's color still shifts if an earlier train is removed, but a pinned one won't.
 * @param {number|null} trackSpeedLimit_kmh
 * @param {number} [gravity_ms2] - see js/physics.js's buildDynamics
 */
export function renderCharts(trains, trackSpeedLimit_kmh, gravity_ms2) {
  const forceDatasets = [];
  const accelDatasets = [];
  const speedDatasets = [];
  const distanceDatasets = [];
  const speedDistanceDatasets = [];

  trains.forEach((train, arrayIndex) => {
    if (!train) return;
    const { aggregate, label } = train;
    const seriesIndex = train.colorSlot ?? arrayIndex;

    forceDatasets.push({ label, seriesIndex, points: sampleOverSpeed(aggregate, forceAtSpeed, aggregate.topSpeed_kmh, gravity_ms2) });
    accelDatasets.push({ label, seriesIndex, points: sampleOverSpeed(aggregate, accelerationAtSpeed, aggregate.topSpeed_kmh, gravity_ms2) });

    const result = simulate(aggregate, { trackSpeedLimit_kmh, stopAt: {}, sample: true, gravity_ms2 });
    if (result && !result.warning) {
      speedDatasets.push({ label, seriesIndex, points: result.samples.map((s) => ({ x: s.t, y: s.v_kmh })) });
      distanceDatasets.push({ label, seriesIndex, points: result.samples.map((s) => ({ x: s.t, y: s.d_m })) });
      // Same trajectory samples as the two charts above, just re-keyed on
      // distance instead of time — routes are defined by leg distance, so
      // "what speed am I at after covering X" is often the more directly
      // useful question than the time-based equivalent.
      speedDistanceDatasets.push({ label, seriesIndex, points: result.samples.map((s) => ({ x: s.d_m, y: s.v_kmh })) });
    }
  });

  renderCardChart("chart-force", { xLabel: "Speed (km/h)", yLabel: "Force (kN)", datasets: forceDatasets });
  renderCardChart("chart-acceleration", { xLabel: "Speed (km/h)", yLabel: "Acceleration (m/s²)", datasets: accelDatasets });
  renderCardChart("chart-speed", { xLabel: "Time (s)", yLabel: "Speed (km/h)", datasets: speedDatasets });
  renderCardChart("chart-distance", { xLabel: "Time (s)", yLabel: "Distance (m)", datasets: distanceDatasets });
  renderCardChart("chart-speed-distance", { xLabel: "Distance (m)", yLabel: "Speed (km/h)", datasets: speedDistanceDatasets });
}

/**
 * @param {Array<{label: string, summary: object, colorSlot: number}|null>} trains - any number
 *   of slots, same colorSlot-vs-position convention as renderCharts(); `summary` is a
 *   js/finance.js tripSummary() result (uses only its `.legs` array here).
 * @param {string[]} legLabels - one label per leg, in route order (e.g. "A → B").
 */
export function renderFinanceCharts(trains, legLabels) {
  for (const metric of LEG_CHART_METRICS) {
    const datasets = [];
    trains.forEach((train, arrayIndex) => {
      if (!train) return;
      const seriesIndex = train.colorSlot ?? arrayIndex;
      datasets.push({ label: train.label, seriesIndex, data: train.summary.legs.map((leg) => leg[metric.key]) });
    });
    renderCardChart(metric.id, { type: "bar", xLabels: legLabels, yLabel: metric.yLabel, isMoney: metric.isMoney, datasets });
  }
}

// Walks a train's full (run+brake) sample set looking for the first point
// where its crow-flies average speed reaches breakEven_kmh, interpolating
// between the two straddling samples for a precise crossing rather than
// snapping to the nearest one. Returns null if the leg never gets there.
// Used to mark that exact spot on the two *instantaneous*-speed charts
// (Track/Crow-flies Distance sections) — the point of interest there being
// that the instantaneous speed at that moment is well above breakEven_kmh
// itself (the average necessarily lags behind while still climbing).
function findBreakEvenCrossing(samples, crowScale, breakEven_kmh) {
  let prev = null;
  for (const s of samples) {
    const crowAvg = s.t > 0 ? (s.d_m / s.t) * 3.6 * crowScale : 0;
    if (prev && prev.crowAvg < breakEven_kmh && crowAvg >= breakEven_kmh) {
      const frac = (breakEven_kmh - prev.crowAvg) / (crowAvg - prev.crowAvg);
      const d_m = prev.s.d_m + frac * (s.d_m - prev.s.d_m);
      const v_kmh = prev.s.v_kmh + frac * (s.v_kmh - prev.s.v_kmh);
      return { d_m, v_kmh, crowD_m: d_m * crowScale };
    }
    prev = { s, crowAvg };
  }
  return null;
}

/**
 * One selected leg's full door-to-door profile (accelerate/cruise, then
 * brake to a stop) for every train — js/physics.js's simulateToStop().
 * Renders 9 charts, grouped by "what's on the x-axis":
 *
 * - Time: Speed and Acceleration (both instantaneous), Distance — both
 *   flavors, track and crow-flies (see below) — and Average Speed, the
 *   crow-flies one (see docs/breakeven_formulas.md for why crow-flies, not
 *   track distance, is the average that determines profitability), with
 *   each train's own break-even speed for this leg as a flat dashed
 *   reference. Deliberately doesn't repeat Force/Acceleration *vs Speed*
 *   from the Physics tab here — those are pure functions of the vehicle's
 *   own physics, identical regardless of which leg is selected, so
 *   duplicating them per leg would show nothing new.
 * - Track Distance: Speed and Average Speed, both real physical
 *   quantities — how fast the train actually moved, on average, over the
 *   ground it actually covered.
 * - Crow-flies Distance: the same pair again, but x is a *virtual*
 *   "crow-flies distance so far" (track distance so far, scaled by the
 *   leg's crow/track ratio) — not a real physical position, but the
 *   scaling is exact enough that Average Speed here still lands precisely
 *   on the leg's true crow-flies average at the end, and it's how far
 *   along a break-even crossing (marked below) sits in crow-flies terms.
 *
 * Each train gets a solid "run" + dashed "brake" segment sharing one color
 * for every instantaneous-quantity chart (Speed/Distance/Acceleration vs
 * Time, Speed vs Track/Crow-flies Distance) — average-speed charts don't
 * need the split, since the average already blends both phases smoothly.
 * The two instantaneous-*speed* charts also get a marker point at wherever
 * the crow-flies average first reaches break-even (none if it never does
 * that leg) — deliberately on the *instantaneous*-speed charts, to show
 * that speed is well above the break-even threshold at that moment, not
 * equal to it (only the average has caught up; the train itself is still
 * going faster).
 *
 * @param {Array<{aggregate: object, label: string, colorSlot: number}|null>} trains
 * @param {object} leg - the selected leg (js/route.js) — both its track
 *   distance (for the physics) and crow distance (for every crow-flies-
 *   denominated chart below) are needed, not just a single number
 * @param {{trackSpeedLimit_kmh: number|null, brakingDeceleration_ms2: number, difficulty: number}} options
 */
export function renderRouteProfileCharts(trains, leg, options) {
  const distance_m = effectiveTrackDistance(leg);
  if (distance_m == null) return;
  const hasCrow = leg.crowDistance_m != null && leg.crowDistance_m > 0;
  const crowScale = hasCrow ? leg.crowDistance_m / distance_m : null;

  const speedTimeDatasets = [];
  const avgSpeedTimeDatasets = [];
  const distanceTrackTimeDatasets = [];
  const distanceCrowTimeDatasets = [];
  const accelTimeDatasets = [];
  const speedTrackDatasets = [];
  const avgSpeedTrackDatasets = [];
  const speedCrowDatasets = [];
  const avgSpeedCrowDatasets = [];

  trains.forEach((train, arrayIndex) => {
    if (!train) return;
    const seriesIndex = train.colorSlot ?? arrayIndex;
    const result = simulateToStop(train.aggregate, distance_m, { ...options, sample: true });
    if (!result || result.warning) return;

    const runSamples = result.samples.filter((s) => s.phase === "run");
    const brakeSamples = result.samples.filter((s) => s.phase === "brake");
    // Include the last run sample as the brake segment's starting point too,
    // so the dashed segment visually connects to the solid one with no gap.
    const brakeWithJoin = runSamples.length ? [runSamples[runSamples.length - 1], ...brakeSamples] : brakeSamples;

    speedTimeDatasets.push({ label: train.label, seriesIndex, points: runSamples.map((s) => ({ x: s.t, y: s.v_kmh })) });
    speedTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: brakeWithJoin.map((s) => ({ x: s.t, y: s.v_kmh })) });

    // Distance (track) and acceleration vs time — real physical quantities
    // (no crow-flies scaling), so unlike Average Speed above these don't
    // need to wait on hasCrow. Same run/brake split as Speed vs Time, for
    // the same reason: shows at a glance where braking starts, even though
    // distance itself has no visible kink there (only a slope change).
    distanceTrackTimeDatasets.push({ label: train.label, seriesIndex, points: runSamples.map((s) => ({ x: s.t, y: s.d_m })) });
    distanceTrackTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: brakeWithJoin.map((s) => ({ x: s.t, y: s.d_m })) });

    accelTimeDatasets.push({ label: train.label, seriesIndex, points: runSamples.map((s) => ({ x: s.t, y: s.a_ms2 })) });
    accelTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: brakeWithJoin.map((s) => ({ x: s.t, y: s.a_ms2 })) });

    speedTrackDatasets.push({ label: train.label, seriesIndex, points: runSamples.map((s) => ({ x: s.d_m, y: s.v_kmh })) });
    speedTrackDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: brakeWithJoin.map((s) => ({ x: s.d_m, y: s.v_kmh })) });

    // Track-distance average speed so far = cumulative distance /
    // cumulative time — one continuous curve over the *full* sample set
    // (run + brake): unlike the instantaneous charts above, the average
    // already blends both phases smoothly (braking pulls it down same as
    // the run phase pulling it up), so there's no separate dashed segment
    // to draw. t=0's 0/0 is defined as 0, matching the limit as t->0 (the
    // train starts from rest, so the average approaches the same 0 the
    // instantaneous curve starts at — no discontinuity).
    const avgSpeedKmh = (s) => (s.t > 0 ? (s.d_m / s.t) * 3.6 : 0);
    avgSpeedTrackDatasets.push({ label: train.label, seriesIndex, points: result.samples.map((s) => ({ x: s.d_m, y: avgSpeedKmh(s) })) });

    if (!hasCrow) return;

    // Crow-flies distance so far and crow-flies average speed so far — see
    // this function's own doc comment above for what these do and don't
    // mean physically. Speed vs Crow-flies Distance reuses the exact same
    // v_kmh samples as Speed vs Track Distance, just against the rescaled
    // x — it's real instantaneous speed, only the x-axis is virtual.
    speedCrowDatasets.push({ label: train.label, seriesIndex, points: runSamples.map((s) => ({ x: s.d_m * crowScale, y: s.v_kmh })) });
    speedCrowDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: brakeWithJoin.map((s) => ({ x: s.d_m * crowScale, y: s.v_kmh })) });

    avgSpeedTimeDatasets.push({ label: train.label, seriesIndex, points: result.samples.map((s) => ({ x: s.t, y: avgSpeedKmh(s) * crowScale })) });
    avgSpeedCrowDatasets.push({ label: train.label, seriesIndex, points: result.samples.map((s) => ({ x: s.d_m * crowScale, y: avgSpeedKmh(s) * crowScale })) });

    // Distance (crow-flies) vs time — the same virtual scaling as
    // everything else crow-flies-denominated in this function; d_m*crowScale
    // lands on the leg's true crow distance at the end, same as elsewhere.
    distanceCrowTimeDatasets.push({ label: train.label, seriesIndex, points: runSamples.map((s) => ({ x: s.t, y: s.d_m * crowScale })) });
    distanceCrowTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: brakeWithJoin.map((s) => ({ x: s.t, y: s.d_m * crowScale })) });

    const breakEven_kmh = breakEvenAverageSpeed_kmh(train.aggregate, leg, options);
    if (breakEven_kmh == null) return;

    // Flat reference line at this train's own break-even speed for this
    // leg — every train can have a different one (price/capacity/top-speed
    // all differ), even on the same leg.
    avgSpeedTimeDatasets.push({
      seriesIndex,
      dashed: true,
      legendHidden: true,
      points: [
        { x: 0, y: breakEven_kmh },
        { x: result.totalTime_s, y: breakEven_kmh },
      ],
    });
    avgSpeedCrowDatasets.push({
      seriesIndex,
      dashed: true,
      legendHidden: true,
      points: [
        { x: 0, y: breakEven_kmh },
        { x: leg.crowDistance_m, y: breakEven_kmh },
      ],
    });

    const crossing = findBreakEvenCrossing(result.samples, crowScale, breakEven_kmh);
    if (crossing) {
      speedTrackDatasets.push({ seriesIndex, legendHidden: true, pointRadius: 6, points: [{ x: crossing.d_m, y: crossing.v_kmh }] });
      speedCrowDatasets.push({ seriesIndex, legendHidden: true, pointRadius: 6, points: [{ x: crossing.crowD_m, y: crossing.v_kmh }] });
    }
  });

  renderCardChart("chart-route-speed-time", { xLabel: "Time (s)", yLabel: "Speed (km/h)", datasets: speedTimeDatasets });
  renderCardChart("chart-route-avgspeed-time", { xLabel: "Time (s)", yLabel: "Average speed (crow-flies, km/h)", datasets: avgSpeedTimeDatasets });
  renderCardChart("chart-route-distance-track-time", { xLabel: "Time (s)", yLabel: "Distance (m)", datasets: distanceTrackTimeDatasets });
  renderCardChart("chart-route-distance-crow-time", { xLabel: "Time (s)", yLabel: "Crow-flies distance (m)", datasets: distanceCrowTimeDatasets });
  renderCardChart("chart-route-accel-time", { xLabel: "Time (s)", yLabel: "Acceleration (m/s²)", datasets: accelTimeDatasets });
  renderCardChart("chart-route-speed-track", { xLabel: "Track distance (m)", yLabel: "Speed (km/h)", datasets: speedTrackDatasets });
  renderCardChart("chart-route-avgspeed-track", { xLabel: "Track distance (m)", yLabel: "Average speed (km/h)", datasets: avgSpeedTrackDatasets });
  renderCardChart("chart-route-speed-crow", { xLabel: "Crow-flies distance (m)", yLabel: "Speed (km/h)", datasets: speedCrowDatasets });
  renderCardChart("chart-route-avgspeed-crow", { xLabel: "Crow-flies distance (m)", yLabel: "Average speed (crow-flies, km/h)", datasets: avgSpeedCrowDatasets });
}

/**
 * The entire loop, every leg back to back, for every train: accelerate,
 * cruise, brake to a stop (simulateToStop, same as renderRouteProfileCharts)
 * then a flat "stopped" segment for that station's loading+unloading dwell
 * (js/loading.js's stationHoldTime, using that leg's own load factor — see
 * js/finance.js's tripSummary() for why the leg's own factor governs both
 * ends of its own load), before the next leg's samples continue from the
 * cumulative time so far. One continuous line per train.
 *
 * @param {Array<{aggregate: object, label: string, colorSlot: number}|null>} trains
 * @param {object} route - js/route.js route (stations/legs)
 * @param {{trackSpeedLimit_kmh: number|null, brakingDeceleration_ms2: number}} options
 */
export function renderWholeRouteChart(trains, route, options) {
  const datasets = [];

  trains.forEach((train, arrayIndex) => {
    if (!train) return;
    const seriesIndex = train.colorSlot ?? arrayIndex;
    const points = [];
    let cumulativeT = 0;

    for (const leg of route.legs) {
      const distance_m = effectiveTrackDistance(leg);
      if (distance_m == null) return;
      const result = simulateToStop(train.aggregate, distance_m, { ...options, sample: true });
      if (!result || result.warning) return;

      result.samples.forEach((s) => points.push({ x: cumulativeT + s.t, y: s.v_kmh }));
      cumulativeT += result.totalTime_s;

      const hold = stationHoldTime(train.aggregate, leg.loadFactor);
      points.push({ x: cumulativeT, y: 0 });
      points.push({ x: cumulativeT + hold.holdTime_s, y: 0 });
      cumulativeT += hold.holdTime_s;
    }

    datasets.push({ label: train.label, seriesIndex, points });
  });

  renderCardChart("chart-route-whole", { xLabel: "Time (s)", yLabel: "Speed (km/h)", datasets });
}
