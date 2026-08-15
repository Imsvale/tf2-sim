import { forceAtSpeed, accelerationAtSpeed, simulate } from "./physics.js";

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
const SERIES_SLOTS = 8;

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

// Two chart groups today: the 4 Physics line charts and the 5 Finance bar
// charts (see LEG_CHART_METRICS below). js/chartGallery.js's prev/next
// navigation stays confined to whichever group it was opened from — see
// chartGroupOf().
export const CHART_GROUPS = {
  physics: ["chart-force", "chart-acceleration", "chart-speed", "chart-distance"],
  finance: ["chart-leg-time", "chart-leg-speed", "chart-leg-revenue", "chart-leg-maintenance", "chart-leg-profit"],
};

export function chartGroupOf(chartId) {
  return Object.keys(CHART_GROUPS).find((group) => CHART_GROUPS[group].includes(chartId)) ?? null;
}

export const CHART_TITLES = {
  "chart-force": "Force vs. Speed",
  "chart-acceleration": "Acceleration vs. Speed",
  "chart-speed": "Speed over Time",
  "chart-distance": "Distance over Time",
  "chart-leg-time": "Time per Leg",
  "chart-leg-speed": "Average Speed per Leg",
  "chart-leg-revenue": "Revenue per Leg",
  "chart-leg-maintenance": "Maintenance per Leg",
  "chart-leg-profit": "Profit per Leg",
};

const LEG_CHART_METRICS = [
  { id: "chart-leg-time", yLabel: "Time (s)", key: "time_s" },
  { id: "chart-leg-speed", yLabel: "Speed (km/h)", key: "avgSpeed_kmh" },
  { id: "chart-leg-revenue", yLabel: "Revenue ($)", key: "revenue" },
  { id: "chart-leg-maintenance", yLabel: "Maintenance ($)", key: "maintenance" },
  { id: "chart-leg-profit", yLabel: "Profit ($)", key: "profit" },
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
  const { type = "line", yLabel, datasets } = config;
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
          ticks: { color: colors.textMuted },
          grid: { color: colors.border },
        },
      },
      plugins: {
        // Legend click-to-toggle series visibility is Chart.js's default
        // behavior (not configured here) — intentional, doubles as the
        // "selective show/hide" for readability with more trains.
        legend: { labels: { color: colors.text } },
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
 * @param {Array<{aggregate: object, label: string}|null>} trains - any number of slots;
 *   a train's color is its position in this array, so removing an earlier
 *   train will shift later trains' colors (no stable per-train id exists
 *   to prevent that — acceptable for this app's scale).
 * @param {number|null} trackSpeedLimit_kmh
 */
export function renderCharts(trains, trackSpeedLimit_kmh) {
  const forceDatasets = [];
  const accelDatasets = [];
  const speedDatasets = [];
  const distanceDatasets = [];

  trains.forEach((train, seriesIndex) => {
    if (!train) return;
    const { aggregate, label } = train;

    forceDatasets.push({ label, seriesIndex, points: sampleOverSpeed(aggregate, forceAtSpeed, aggregate.topSpeed_kmh) });
    accelDatasets.push({ label, seriesIndex, points: sampleOverSpeed(aggregate, accelerationAtSpeed, aggregate.topSpeed_kmh) });

    const result = simulate(aggregate, { trackSpeedLimit_kmh, stopAt: {}, sample: true });
    if (result && !result.warning) {
      speedDatasets.push({ label, seriesIndex, points: result.samples.map((s) => ({ x: s.t, y: s.v_kmh })) });
      distanceDatasets.push({ label, seriesIndex, points: result.samples.map((s) => ({ x: s.t, y: s.d_m })) });
    }
  });

  renderCardChart("chart-force", { xLabel: "Speed (km/h)", yLabel: "Force (kN)", datasets: forceDatasets });
  renderCardChart("chart-acceleration", { xLabel: "Speed (km/h)", yLabel: "Acceleration (m/s²)", datasets: accelDatasets });
  renderCardChart("chart-speed", { xLabel: "Time (s)", yLabel: "Speed (km/h)", datasets: speedDatasets });
  renderCardChart("chart-distance", { xLabel: "Time (s)", yLabel: "Distance (m)", datasets: distanceDatasets });
}

/**
 * @param {Array<{label: string, summary: object}|null>} trains - any number of
 *   slots, same seriesIndex-by-position convention as renderCharts(); `summary`
 *   is a js/finance.js tripSummary() result (uses only its `.legs` array here).
 * @param {string[]} legLabels - one label per leg, in route order (e.g. "A → B").
 */
export function renderFinanceCharts(trains, legLabels) {
  for (const metric of LEG_CHART_METRICS) {
    const datasets = [];
    trains.forEach((train, seriesIndex) => {
      if (!train) return;
      datasets.push({ label: train.label, seriesIndex, data: train.summary.legs.map((leg) => leg[metric.key]) });
    });
    renderCardChart(metric.id, { type: "bar", xLabels: legLabels, yLabel: metric.yLabel, datasets });
  }
}
