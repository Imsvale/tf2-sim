import { forceAtSpeed, accelerationAtSpeed, simulate } from "./physics.js";

// Chart.js is loaded globally via vendor/chart.umd.min.js (plain <script>,
// before this module) — no bundler, consistent with the rest of the app.

const TRAIN_COLORS = ["#2563eb", "#f59e0b"]; // blue / amber, distinct in both themes
const POINT_COUNT = 120;

const charts = {}; // canvasId -> Chart instance

function themeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    text: style.getPropertyValue("--text").trim(),
    textMuted: style.getPropertyValue("--text-muted").trim(),
    border: style.getPropertyValue("--border").trim(),
  };
}

function renderLineChart(canvasId, { xLabel, yLabel, datasets }) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  charts[canvasId]?.destroy();

  const colors = themeColors();
  charts[canvasId] = new Chart(canvas, {
    type: "line",
    data: {
      datasets: datasets.map((ds, i) => ({
        label: ds.label,
        data: ds.points,
        borderColor: TRAIN_COLORS[i],
        backgroundColor: TRAIN_COLORS[i],
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.15,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: xLabel, color: colors.text },
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
        legend: { labels: { color: colors.text } },
      },
    },
  });
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
 * @param {Array<{aggregate: object, label: string}|null>} trains - up to 2 slots
 * @param {number|null} trackSpeedLimit_kmh
 */
export function renderCharts(trains, trackSpeedLimit_kmh) {
  const forceDatasets = [];
  const accelDatasets = [];
  const speedDatasets = [];
  const distanceDatasets = [];

  for (const train of trains) {
    if (!train) continue;
    const { aggregate, label } = train;

    forceDatasets.push({ label, points: sampleOverSpeed(aggregate, forceAtSpeed, aggregate.topSpeed_kmh) });
    accelDatasets.push({ label, points: sampleOverSpeed(aggregate, accelerationAtSpeed, aggregate.topSpeed_kmh) });

    const result = simulate(aggregate, { trackSpeedLimit_kmh, stopAt: {}, sample: true });
    if (result && !result.warning) {
      speedDatasets.push({ label, points: result.samples.map((s) => ({ x: s.t, y: s.v_kmh })) });
      distanceDatasets.push({ label, points: result.samples.map((s) => ({ x: s.t, y: s.d_m })) });
    }
  }

  renderLineChart("chart-force", { xLabel: "Speed (km/h)", yLabel: "Force (kN)", datasets: forceDatasets });
  renderLineChart("chart-acceleration", { xLabel: "Speed (km/h)", yLabel: "Acceleration (m/s²)", datasets: accelDatasets });
  renderLineChart("chart-speed", { xLabel: "Time (s)", yLabel: "Speed (km/h)", datasets: speedDatasets });
  renderLineChart("chart-distance", { xLabel: "Time (s)", yLabel: "Distance (m)", datasets: distanceDatasets });
}
