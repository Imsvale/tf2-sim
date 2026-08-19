import { forceAtSpeed, accelerationAtSpeed, simulate, simulateToStop } from "./physics.js";
import { stationHoldTime } from "./loading.js";
import { effectiveTrackDistance } from "./route.js";
import { formatMoneyCompact } from "./vehicles.js";
import { breakEvenAverageSpeed_kmh, breakEvenAverageSpeedForRoute_kmh } from "./finance.js";

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

// Three chart groups today: the 4 Physics line charts, the 5 Finance bar
// charts (see LEG_CHART_METRICS below), and the 9 Route profile charts
// (see renderRouteProfileCharts / renderRouteProfileChartsForRoute) — the
// same 9 canvases show either one leg's profile or the whole route's,
// depending on the Route tab's Leg selector (js/main.js's
// state.selectedLegIndex; -1 = "All"). js/chartGallery.js's prev/next
// navigation stays confined to whichever group it was opened from — see
// chartGroupOf().
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
  company: ["chart-company-networth"],
};

export function chartGroupOf(chartId) {
  return Object.keys(CHART_GROUPS).find((group) => CHART_GROUPS[group].includes(chartId)) ?? null;
}

// The 9 route-chart titles depend on the Leg selector's mode (one leg vs.
// "All"), so these aren't fixed like every other entry — both
// renderRouteProfileCharts and renderRouteProfileChartsForRoute overwrite
// their own 9 entries every render with the current mode's wording; the
// object itself (not a fresh one) is what js/chartGallery.js imports and
// reads live from at open-time.
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
  "chart-company-networth": "Company — Net Worth over Time",
};

// Regenerated for both modes by setRouteChartTitles() below — the fixed
// "what this chart shows" suffix, keyed the same as CHART_TITLES.
const ROUTE_CHART_TITLE_SUFFIXES = {
  "chart-route-speed-time": "Time — Speed",
  "chart-route-accel-time": "Time — Acceleration",
  "chart-route-distance-track-time": "Time — Distance (Track)",
  "chart-route-distance-crow-time": "Time — Distance (Crow-flies)",
  "chart-route-avgspeed-time": "Time — Average Speed (Crow-flies)",
  "chart-route-speed-track": "Track Distance — Speed",
  "chart-route-avgspeed-track": "Track Distance — Average Speed",
  "chart-route-speed-crow": "Crow-flies Distance — Speed",
  "chart-route-avgspeed-crow": "Crow-flies Distance — Average Speed",
};

function setRouteChartTitles(prefix) {
  for (const [id, suffix] of Object.entries(ROUTE_CHART_TITLE_SUFFIXES)) {
    CHART_TITLES[id] = `${prefix} — ${suffix}`;
  }
}

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
// (zooms in); dragging back toward zero expands it (zooms out). Both ends
// of the visible range scale together, by the same factor, around zero —
// for every axis except the one Y-may-be-negative chart (Acceleration vs
// Time, see below), the min is 0 and stays 0 (0 * anything = 0 exactly, no
// float drift), so this reduces to the old "anchored at zero, only max
// moves" behavior; for that one exception it generalizes correctly to a
// negative min too, without needing a separate code path. Scoped to
// outside chart.chartArea specifically so it can never compete with the
// zoom plugin's in-area pan/drag-zoom for the same gesture. A real Chart.js
// plugin (afterInit/destroy) rather than manual addEventListener calls in
// renderChartInto, so cleanup is automatic on chart.destroy() — no
// coordination needed with js/chartGallery.js, which already destroys the
// previous modal chart before creating the next one.
function createAxisDragZoomPlugin() {
  const SENSITIVITY_PX = 200; // px of drag per doubling/halving of the visible range
  const MIN_SCALE_FRACTION = 0.02; // floor on how far the range can contract, relative to its drag-start extent
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
      const { axis, startMin, startMax } = dragState;
      const clampedFactor = Math.max(scaleFactor, MIN_SCALE_FRACTION);
      chart.zoomScale(axis.id, { min: startMin * clampedFactor, max: startMax * clampedFactor }, "none");
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
    dragState = { axis: hit.axis, isX: hit.isX, startPixel, startMin: hit.axis.min, startMax: hit.axis.max };
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
    // Chart.js's actual plugin-teardown hook is afterDestroy — a plain
    // "destroy" here is never called (verified empirically: Chart.js v4
    // fires beforeDestroy/afterDestroy/uninstall on chart.destroy(), not
    // "destroy"), so this cleanup was silently dead code. Left unnoticed
    // long enough that these document-level listeners leaked on every
    // gallery close, each one still closing over its now-destroyed chart's
    // canvas — the next drag on any *other* chart would trigger all the
    // leaked listeners too, each trying to zoomScale() a chart whose
    // canvas context is already null.
    afterDestroy() {
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
              // every axis here (speed, time, distance, money) except one:
              // Acceleration vs Time legitimately dips negative (braking),
              // so its y-axis opts out via config.yMayBeNegative — x (time)
              // stays anchored at 0 regardless, that's never negative here.
              limits: { x: { min: 0 }, y: config.yMayBeNegative ? {} : { min: 0 } },
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

/**
 * The two strategies' net-worth trajectories, side by side — x is calendar
 * year (`startingYear + t_s / REAL_SECONDS_PER_GAME_YEAR`, ties into the
 * loan-cap-by-year framing on the Company tab), y is net worth (can go
 * negative — a strategy running a temporary cash crunch near the end of a
 * loan paydown cycle is a real, informative outcome, not a bug — so this
 * chart opts into `yMayBeNegative`, same as the Acceleration vs Time
 * chart). Either points array may be null (js/company.js's
 * simulateCompany() returns null when the scenario can't even afford its
 * initial purchase) — that dataset is just omitted, not an error.
 *
 * @param {Array<{t_s: number, netWorth: number}>|null} reinvestPoints
 * @param {Array<{t_s: number, netWorth: number}>|null} payoffPoints
 * @param {number} startingYear
 * @param {number} realSecondsPerGameYear - js/finance.js's REAL_SECONDS_PER_GAME_YEAR
 */
export function renderCompanyChart(reinvestPoints, payoffPoints, startingYear, realSecondsPerGameYear) {
  const toYear = (t_s) => startingYear + t_s / realSecondsPerGameYear;
  const datasets = [];
  if (reinvestPoints) {
    datasets.push({
      label: "Reinvest in wagons",
      seriesIndex: 0,
      points: reinvestPoints.map((p) => ({ x: toYear(p.t_s), y: p.netWorth })),
    });
  }
  if (payoffPoints) {
    datasets.push({
      label: "Pay off loan, then invest",
      seriesIndex: 1,
      points: payoffPoints.map((p) => ({ x: toYear(p.t_s), y: p.netWorth })),
    });
  }
  renderCardChart("chart-company-networth", { xLabel: "Year", yLabel: "Net worth ($)", isMoney: true, yMayBeNegative: true, datasets });
}

// Walks a chronologically-ordered, already offset sample set (see
// simulateLegPoints below — {t, trackD, crowD, v_kmh}, run+brake only, no
// dwell) looking for the first point where its crow-flies average speed
// (crowD/t) reaches breakEven_kmh, interpolating between the two
// straddling samples for a precise crossing rather than snapping to the
// nearest one. Returns null if it never gets there. Used to mark that
// exact spot on the two *instantaneous*-speed charts (Track/Crow-flies
// Distance sections) — the point of interest there being that the
// instantaneous speed at that moment is well above breakEven_kmh itself
// (the average necessarily lags behind while still climbing). Works
// identically for one leg's samples or every leg's concatenated in route
// order — it's the offsets already baked into each sample that make that
// possible.
function findBreakEvenCrossing(samples, breakEven_kmh) {
  let prev = null;
  for (const s of samples) {
    const crowAvg = s.t > 0 ? (s.crowD / s.t) * 3.6 : 0;
    if (prev && prev.crowAvg < breakEven_kmh && crowAvg >= breakEven_kmh) {
      const frac = (breakEven_kmh - prev.crowAvg) / (crowAvg - prev.crowAvg);
      const trackD = prev.s.trackD + frac * (s.trackD - prev.s.trackD);
      const crowD = prev.s.crowD + frac * (s.crowD - prev.s.crowD);
      const v_kmh = prev.s.v_kmh + frac * (s.v_kmh - prev.s.v_kmh);
      return { trackD, crowD, v_kmh };
    }
    prev = { s, crowAvg };
  }
  return null;
}

// One leg's simulated profile (accelerate/cruise, then brake to a stop —
// js/physics.js's simulateToStop()), with every sample offset by whatever
// cumulative time/track-distance/crow-distance came before it. Shared by
// renderRouteProfileCharts (a single leg, offsets all zero) and
// renderRouteProfileChartsForRoute (every leg in the loop, offsets
// threaded leg to leg) so the physics and the run/brake segmentation every
// instantaneous-quantity chart draws live in exactly one place. Returns
// null if the leg can't be simulated (no distance yet, or simulateToStop
// itself warns).
function simulateLegPoints(aggregate, leg, options, { t0, trackD0, crowD0 }) {
  const distance_m = effectiveTrackDistance(leg);
  if (distance_m == null) return null;
  const hasCrow = leg.crowDistance_m != null && leg.crowDistance_m > 0;
  const crowScale = hasCrow ? leg.crowDistance_m / distance_m : null;

  const result = simulateToStop(aggregate, distance_m, { ...options, sample: true });
  if (!result || result.warning) return null;

  const runRaw = result.samples.filter((s) => s.phase === "run");
  const brakeRaw = result.samples.filter((s) => s.phase === "brake");
  // Include the last run sample as the brake segment's starting point too,
  // so the dashed segment visually connects to the solid one with no gap.
  const brakeWithJoinRaw = runRaw.length ? [runRaw[runRaw.length - 1], ...brakeRaw] : brakeRaw;

  const withOffsets = (s) => ({
    t: t0 + s.t,
    trackD: trackD0 + s.d_m,
    crowD: hasCrow ? crowD0 + s.d_m * crowScale : null,
    v_kmh: s.v_kmh,
    a_ms2: s.a_ms2,
  });

  return {
    hasCrow,
    run: runRaw.map(withOffsets),
    brakeWithJoin: brakeWithJoinRaw.map(withOffsets),
    all: result.samples.map(withOffsets),
    endT: t0 + result.totalTime_s,
    endTrackD: trackD0 + distance_m,
    endCrowD: hasCrow ? crowD0 + leg.crowDistance_m : null,
  };
}

/**
 * One selected leg's full door-to-door profile (accelerate/cruise, then
 * brake to a stop) for every train — js/physics.js's simulateToStop(), via
 * simulateLegPoints above. Renders 9 charts, grouped by "what's on the
 * x-axis":
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
 * See renderRouteProfileChartsForRoute below for the "All legs" sibling of
 * this function — same 9 canvases, same per-leg physics, extended to the
 * whole loop (including station dwell) instead of just one leg.
 *
 * @param {Array<{aggregate: object, label: string, colorSlot: number}|null>} trains
 * @param {object} leg - the selected leg (js/route.js) — both its track
 *   distance (for the physics) and crow distance (for every crow-flies-
 *   denominated chart below) are needed, not just a single number
 * @param {{trackSpeedLimit_kmh: number|null, brakingDeceleration_ms2: number, difficulty: number}} options
 */
export function renderRouteProfileCharts(trains, leg, options) {
  setRouteChartTitles("Leg Profile");

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
    const L = simulateLegPoints(train.aggregate, leg, options, { t0: 0, trackD0: 0, crowD0: 0 });
    if (!L) return;

    speedTimeDatasets.push({ label: train.label, seriesIndex, points: L.run.map((s) => ({ x: s.t, y: s.v_kmh })) });
    speedTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.t, y: s.v_kmh })) });

    // Distance (track) and acceleration vs time — real physical quantities
    // (no crow-flies scaling), so unlike Average Speed above these don't
    // need to wait on hasCrow. Same run/brake split as Speed vs Time, for
    // the same reason: shows at a glance where braking starts, even though
    // distance itself has no visible kink there (only a slope change).
    distanceTrackTimeDatasets.push({ label: train.label, seriesIndex, points: L.run.map((s) => ({ x: s.t, y: s.trackD })) });
    distanceTrackTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.t, y: s.trackD })) });

    accelTimeDatasets.push({ label: train.label, seriesIndex, points: L.run.map((s) => ({ x: s.t, y: s.a_ms2 })) });
    accelTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.t, y: s.a_ms2 })) });

    speedTrackDatasets.push({ label: train.label, seriesIndex, points: L.run.map((s) => ({ x: s.trackD, y: s.v_kmh })) });
    speedTrackDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.trackD, y: s.v_kmh })) });

    // Track-distance average speed so far = cumulative distance /
    // cumulative time — one continuous curve over the *full* sample set
    // (run + brake): unlike the instantaneous charts above, the average
    // already blends both phases smoothly (braking pulls it down same as
    // the run phase pulling it up), so there's no separate dashed segment
    // to draw. t=0's 0/0 is defined as 0, matching the limit as t->0 (the
    // train starts from rest, so the average approaches the same 0 the
    // instantaneous curve starts at — no discontinuity).
    const trackAvgKmh = (s) => (s.t > 0 ? (s.trackD / s.t) * 3.6 : 0);
    avgSpeedTrackDatasets.push({ label: train.label, seriesIndex, points: L.all.map((s) => ({ x: s.trackD, y: trackAvgKmh(s) })) });

    if (!L.hasCrow) return;

    // Crow-flies distance so far and crow-flies average speed so far — see
    // this function's own doc comment above for what these do and don't
    // mean physically. Speed vs Crow-flies Distance reuses the exact same
    // v_kmh samples as Speed vs Track Distance, just against the rescaled
    // x — it's real instantaneous speed, only the x-axis is virtual.
    speedCrowDatasets.push({ label: train.label, seriesIndex, points: L.run.map((s) => ({ x: s.crowD, y: s.v_kmh })) });
    speedCrowDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.crowD, y: s.v_kmh })) });

    const crowAvgKmh = (s) => (s.t > 0 ? (s.crowD / s.t) * 3.6 : 0);
    avgSpeedTimeDatasets.push({ label: train.label, seriesIndex, points: L.all.map((s) => ({ x: s.t, y: crowAvgKmh(s) })) });
    avgSpeedCrowDatasets.push({ label: train.label, seriesIndex, points: L.all.map((s) => ({ x: s.crowD, y: crowAvgKmh(s) })) });

    // Distance (crow-flies) vs time — the same virtual scaling as
    // everything else crow-flies-denominated in this function.
    distanceCrowTimeDatasets.push({ label: train.label, seriesIndex, points: L.run.map((s) => ({ x: s.t, y: s.crowD })) });
    distanceCrowTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.t, y: s.crowD })) });

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
        { x: L.endT, y: breakEven_kmh },
      ],
    });
    avgSpeedCrowDatasets.push({
      seriesIndex,
      dashed: true,
      legendHidden: true,
      points: [
        { x: 0, y: breakEven_kmh },
        { x: L.endCrowD, y: breakEven_kmh },
      ],
    });

    const crossing = findBreakEvenCrossing(L.all, breakEven_kmh);
    if (crossing) {
      speedTrackDatasets.push({ seriesIndex, legendHidden: true, pointRadius: 6, points: [{ x: crossing.trackD, y: crossing.v_kmh }] });
      speedCrowDatasets.push({ seriesIndex, legendHidden: true, pointRadius: 6, points: [{ x: crossing.crowD, y: crossing.v_kmh }] });
    }
  });

  renderCardChart("chart-route-speed-time", { xLabel: "Time (s)", yLabel: "Speed (km/h)", datasets: speedTimeDatasets });
  renderCardChart("chart-route-avgspeed-time", { xLabel: "Time (s)", yLabel: "Average speed (crow-flies, km/h)", datasets: avgSpeedTimeDatasets });
  renderCardChart("chart-route-distance-track-time", { xLabel: "Time (s)", yLabel: "Distance (m)", datasets: distanceTrackTimeDatasets });
  renderCardChart("chart-route-distance-crow-time", { xLabel: "Time (s)", yLabel: "Crow-flies distance (m)", datasets: distanceCrowTimeDatasets });
  renderCardChart("chart-route-accel-time", { xLabel: "Time (s)", yLabel: "Acceleration (m/s²)", datasets: accelTimeDatasets, yMayBeNegative: true });
  renderCardChart("chart-route-speed-track", { xLabel: "Track distance (m)", yLabel: "Speed (km/h)", datasets: speedTrackDatasets });
  renderCardChart("chart-route-avgspeed-track", { xLabel: "Track distance (m)", yLabel: "Average speed (km/h)", datasets: avgSpeedTrackDatasets });
  renderCardChart("chart-route-speed-crow", { xLabel: "Crow-flies distance (m)", yLabel: "Speed (km/h)", datasets: speedCrowDatasets });
  renderCardChart("chart-route-avgspeed-crow", { xLabel: "Crow-flies distance (m)", yLabel: "Average speed (crow-flies, km/h)", datasets: avgSpeedCrowDatasets });
}

/**
 * The "All" mode of the same 9 charts (js/main.js's Leg selector, "All" at
 * index -1): every leg of the loop back to back, for every train, via
 * simulateLegPoints — same per-leg physics as renderRouteProfileCharts,
 * just threaded leg to leg with running time/track-distance/crow-distance
 * offsets — with each station's loading/unloading dwell (js/loading.js's
 * stationHoldTime, that leg's own load factor — see js/finance.js's
 * tripSummary() for why the leg's own factor governs both ends of its own
 * load) spliced in between as a flat segment before the next leg
 * continues. A train that fails to simulate any single leg is skipped
 * entirely (no partial loop rendered).
 *
 * Differences from the single-leg version, all a direct consequence of the
 * loop now spending real elapsed time standing at stations:
 * - The four Time-axis instantaneous charts (Speed/Acceleration/Distance
 *   x2) get an extra flat "dwell" segment per leg, holding at whatever
 *   value was reached when braking finished (0 for speed/acceleration, the
 *   leg's own end distance for the two Distance charts) — the visual cost
 *   of standing still. The two Distance-axis charts (Track/Crow-flies
 *   Distance sections) don't need one: distance can't move while stopped,
 *   so a stop there is just where one leg's line picks up exactly where
 *   the last one left off.
 * - Average Speed is one continuous curve across the *whole* loop (crow
 *   distance covered anywhere in the loop so far / wall-clock time elapsed
 *   anywhere in the loop so far, dwell included) rather than resetting
 *   each leg — this is the number that actually says whether the loop as
 *   a whole is ahead of or behind break-even at any given moment. Two
 *   bookend points are added at each dwell's start and end so the drop
 *   while parked (distance frozen, time still advancing) shows up
 *   explicitly; the true decay in between is a curve (1/t), but a straight
 *   line between the two bookends is a reasonable stand-in given dwell
 *   time is typically much shorter than travel time.
 * - The break-even reference line is one flat threshold for the *entire*
 *   route (js/finance.js's breakEvenAverageSpeedForRoute_kmh) rather than
 *   a leg-specific one — see that function's own doc comment for why a
 *   single flat number is still exactly right even with dwell in the mix.
 * - The break-even crossing marker is the *first* such crossing anywhere
 *   in the loop, searched across every leg's run+brake samples in route
 *   order (dwell samples are excluded from that search — the average can
 *   only fall during a stop, never newly cross upward there).
 *
 * @param {Array<{aggregate: object, label: string, colorSlot: number}|null>} trains
 * @param {object} route - js/route.js route (stations/legs)
 * @param {{trackSpeedLimit_kmh: number|null, brakingDeceleration_ms2: number, difficulty: number}} options
 */
export function renderRouteProfileChartsForRoute(trains, route, options) {
  setRouteChartTitles("Whole Route");

  const hasCrowForRoute = route.legs.every((leg) => leg.crowDistance_m != null && leg.crowDistance_m > 0);

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

    // First pass: simulate every leg in order, threading cumulative
    // offsets and each leg's dwell — bail on this train entirely if any
    // leg fails, rather than rendering a partial loop.
    const legPoints = [];
    let t0 = 0, trackD0 = 0, crowD0 = 0;
    let ok = true;
    for (const leg of route.legs) {
      const L = simulateLegPoints(train.aggregate, leg, options, { t0, trackD0, crowD0 });
      if (!L) { ok = false; break; }
      const hold = stationHoldTime(train.aggregate, leg.loadFactor);
      const dwellEndT = L.endT + hold.holdTime_s;
      legPoints.push({ L, dwellEndT });
      t0 = dwellEndT;
      trackD0 = L.endTrackD;
      crowD0 = hasCrowForRoute ? L.endCrowD : 0;
    }
    if (!ok) return;

    // Second pass: the loop simulated cleanly end to end — push every
    // chart's datasets. t0/trackD0/crowD0 now hold the loop's grand totals
    // (final leg's dwellEndT/endTrackD/endCrowD), reused below for the
    // break-even reference line's far endpoint.
    const trackAvgPoints = [];
    const crowAvgTimePoints = [];
    const crowAvgCrowPoints = [];
    const crossingSearchSamples = [];

    legPoints.forEach(({ L, dwellEndT }, legIndex) => {
      const firstLeg = legIndex === 0;
      const label = firstLeg ? train.label : undefined;
      const legendHidden = !firstLeg;

      speedTimeDatasets.push({ label, seriesIndex, legendHidden, points: L.run.map((s) => ({ x: s.t, y: s.v_kmh })) });
      speedTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.t, y: s.v_kmh })) });

      distanceTrackTimeDatasets.push({ label, seriesIndex, legendHidden, points: L.run.map((s) => ({ x: s.t, y: s.trackD })) });
      distanceTrackTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.t, y: s.trackD })) });

      accelTimeDatasets.push({ label, seriesIndex, legendHidden, points: L.run.map((s) => ({ x: s.t, y: s.a_ms2 })) });
      accelTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.t, y: s.a_ms2 })) });

      speedTrackDatasets.push({ label, seriesIndex, legendHidden, points: L.run.map((s) => ({ x: s.trackD, y: s.v_kmh })) });
      speedTrackDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.trackD, y: s.v_kmh })) });

      trackAvgPoints.push(...L.all.map((s) => ({ x: s.trackD, y: s.t > 0 ? (s.trackD / s.t) * 3.6 : 0 })));

      if (hasCrowForRoute) {
        speedCrowDatasets.push({ label, seriesIndex, legendHidden, points: L.run.map((s) => ({ x: s.crowD, y: s.v_kmh })) });
        speedCrowDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.crowD, y: s.v_kmh })) });

        distanceCrowTimeDatasets.push({ label, seriesIndex, legendHidden, points: L.run.map((s) => ({ x: s.t, y: s.crowD })) });
        distanceCrowTimeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: L.brakeWithJoin.map((s) => ({ x: s.t, y: s.crowD })) });

        const crowAvgKmh = (s) => (s.t > 0 ? (s.crowD / s.t) * 3.6 : 0);
        crowAvgTimePoints.push(...L.all.map((s) => ({ x: s.t, y: crowAvgKmh(s) })));
        crowAvgCrowPoints.push(...L.all.map((s) => ({ x: s.crowD, y: crowAvgKmh(s) })));

        crossingSearchSamples.push(...L.all);
      }

      // Dwell: flat for the four Time-axis instantaneous charts, holding
      // at this leg's end value. Plus the average-speed bookends — see
      // this function's doc comment for why 2 points per dwell here.
      speedTimeDatasets.push({ seriesIndex, legendHidden: true, points: [{ x: L.endT, y: 0 }, { x: dwellEndT, y: 0 }] });
      distanceTrackTimeDatasets.push({ seriesIndex, legendHidden: true, points: [{ x: L.endT, y: L.endTrackD }, { x: dwellEndT, y: L.endTrackD }] });
      accelTimeDatasets.push({ seriesIndex, legendHidden: true, points: [{ x: L.endT, y: 0 }, { x: dwellEndT, y: 0 }] });
      trackAvgPoints.push({ x: L.endTrackD, y: dwellEndT > 0 ? (L.endTrackD / dwellEndT) * 3.6 : 0 });
      if (hasCrowForRoute) {
        distanceCrowTimeDatasets.push({ seriesIndex, legendHidden: true, points: [{ x: L.endT, y: L.endCrowD }, { x: dwellEndT, y: L.endCrowD }] });
        crowAvgTimePoints.push({ x: dwellEndT, y: dwellEndT > 0 ? (L.endCrowD / dwellEndT) * 3.6 : 0 });
        crowAvgCrowPoints.push({ x: L.endCrowD, y: dwellEndT > 0 ? (L.endCrowD / dwellEndT) * 3.6 : 0 });
      }
    });

    avgSpeedTrackDatasets.push({ label: train.label, seriesIndex, points: trackAvgPoints });
    if (!hasCrowForRoute) return;

    avgSpeedTimeDatasets.push({ label: train.label, seriesIndex, points: crowAvgTimePoints });
    avgSpeedCrowDatasets.push({ label: train.label, seriesIndex, points: crowAvgCrowPoints });

    const breakEven_kmh = breakEvenAverageSpeedForRoute_kmh(train.aggregate, route, options);
    if (breakEven_kmh == null) return;

    // Flat reference line at this train's own break-even speed for the
    // *whole route* — spans the loop's grand-total time/crow-distance
    // (t0/crowD0, left holding their final values by the loop above).
    avgSpeedTimeDatasets.push({
      seriesIndex,
      dashed: true,
      legendHidden: true,
      points: [
        { x: 0, y: breakEven_kmh },
        { x: t0, y: breakEven_kmh },
      ],
    });
    avgSpeedCrowDatasets.push({
      seriesIndex,
      dashed: true,
      legendHidden: true,
      points: [
        { x: 0, y: breakEven_kmh },
        { x: crowD0, y: breakEven_kmh },
      ],
    });

    const crossing = findBreakEvenCrossing(crossingSearchSamples, breakEven_kmh);
    if (crossing) {
      speedTrackDatasets.push({ seriesIndex, legendHidden: true, pointRadius: 6, points: [{ x: crossing.trackD, y: crossing.v_kmh }] });
      speedCrowDatasets.push({ seriesIndex, legendHidden: true, pointRadius: 6, points: [{ x: crossing.crowD, y: crossing.v_kmh }] });
    }
  });

  renderCardChart("chart-route-speed-time", { xLabel: "Time (s)", yLabel: "Speed (km/h)", datasets: speedTimeDatasets });
  renderCardChart("chart-route-avgspeed-time", { xLabel: "Time (s)", yLabel: "Average speed (crow-flies, km/h)", datasets: avgSpeedTimeDatasets });
  renderCardChart("chart-route-distance-track-time", { xLabel: "Time (s)", yLabel: "Distance (m)", datasets: distanceTrackTimeDatasets });
  renderCardChart("chart-route-distance-crow-time", { xLabel: "Time (s)", yLabel: "Crow-flies distance (m)", datasets: distanceCrowTimeDatasets });
  renderCardChart("chart-route-accel-time", { xLabel: "Time (s)", yLabel: "Acceleration (m/s²)", datasets: accelTimeDatasets, yMayBeNegative: true });
  renderCardChart("chart-route-speed-track", { xLabel: "Track distance (m)", yLabel: "Speed (km/h)", datasets: speedTrackDatasets });
  renderCardChart("chart-route-avgspeed-track", { xLabel: "Track distance (m)", yLabel: "Average speed (km/h)", datasets: avgSpeedTrackDatasets });
  renderCardChart("chart-route-speed-crow", { xLabel: "Crow-flies distance (m)", yLabel: "Speed (km/h)", datasets: speedCrowDatasets });
  renderCardChart("chart-route-avgspeed-crow", { xLabel: "Crow-flies distance (m)", yLabel: "Average speed (crow-flies, km/h)", datasets: avgSpeedCrowDatasets });
}
