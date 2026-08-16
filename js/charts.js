import { forceAtSpeed, accelerationAtSpeed, simulate, simulateToStop } from "./physics.js";
import { stationHoldTime } from "./loading.js";
import { effectiveTrackDistance } from "./route.js";
import { formatMoneyCompact } from "./vehicles.js";

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
  route: ["chart-route-speed-distance", "chart-route-speed-time"],
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
  "chart-route-speed-distance": "Leg Profile — Speed vs Distance",
  "chart-route-speed-time": "Leg Profile — Speed vs Time",
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
            pointRadius: 0,
            pointHoverRadius: 4,
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
              ticks: { color: colors.textMuted },
              grid: { color: colors.border },
            },
        y: {
          title: { display: true, text: yLabel, color: colors.text },
          // Revenue/Maintenance/Profit can run into six or seven figures —
          // "$1.2M" instead of "$1,246,247" repeated at every gridline.
          ticks: { color: colors.textMuted, callback: isMoney ? (value) => formatMoneyCompact(value) : undefined },
          grid: { color: colors.border },
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
              zoom: { wheel: { enabled: true }, drag: { enabled: false }, mode: isBar ? "y" : "xy" },
              pan: { enabled: true, mode: isBar ? "y" : "xy" },
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

function sampleOverSpeed(aggregate, fn, maxSpeed_kmh) {
  const points = [];
  for (let i = 0; i <= POINT_COUNT; i++) {
    const v_kmh = (maxSpeed_kmh * i) / POINT_COUNT;
    const y = fn(aggregate, v_kmh);
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
 */
export function renderCharts(trains, trackSpeedLimit_kmh) {
  const forceDatasets = [];
  const accelDatasets = [];
  const speedDatasets = [];
  const distanceDatasets = [];
  const speedDistanceDatasets = [];

  trains.forEach((train, arrayIndex) => {
    if (!train) return;
    const { aggregate, label } = train;
    const seriesIndex = train.colorSlot ?? arrayIndex;

    forceDatasets.push({ label, seriesIndex, points: sampleOverSpeed(aggregate, forceAtSpeed, aggregate.topSpeed_kmh) });
    accelDatasets.push({ label, seriesIndex, points: sampleOverSpeed(aggregate, accelerationAtSpeed, aggregate.topSpeed_kmh) });

    const result = simulate(aggregate, { trackSpeedLimit_kmh, stopAt: {}, sample: true });
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
 * One selected leg's full door-to-door profile (accelerate/cruise, then
 * brake to a stop) for every train — js/physics.js's simulateToStop().
 * Each train gets two datasets sharing one seriesIndex/color: a solid
 * "run" segment and a dashed, legend-hidden "brake" segment, so the two
 * charts visibly show where braking starts without adding new colors or
 * legend clutter.
 *
 * @param {Array<{aggregate: object, label: string, colorSlot: number}|null>} trains
 * @param {number} distance_m - the selected leg's real (track) distance
 * @param {{trackSpeedLimit_kmh: number|null, brakingDeceleration_ms2: number}} options
 */
export function renderRouteProfileCharts(trains, distance_m, options) {
  const distanceDatasets = [];
  const timeDatasets = [];

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

    distanceDatasets.push({ label: train.label, seriesIndex, points: runSamples.map((s) => ({ x: s.d_m, y: s.v_kmh })) });
    distanceDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: brakeWithJoin.map((s) => ({ x: s.d_m, y: s.v_kmh })) });

    timeDatasets.push({ label: train.label, seriesIndex, points: runSamples.map((s) => ({ x: s.t, y: s.v_kmh })) });
    timeDatasets.push({ seriesIndex, dashed: true, legendHidden: true, points: brakeWithJoin.map((s) => ({ x: s.t, y: s.v_kmh })) });
  });

  renderCardChart("chart-route-speed-distance", { xLabel: "Distance (m)", yLabel: "Speed (km/h)", datasets: distanceDatasets });
  renderCardChart("chart-route-speed-time", { xLabel: "Time (s)", yLabel: "Speed (km/h)", datasets: timeDatasets });
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
