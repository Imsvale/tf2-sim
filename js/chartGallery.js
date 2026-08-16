import { CHART_GROUPS, CHART_TITLES, chartGroupOf, getChartConfig, renderChartInto } from "./charts.js";
import { iconSvg } from "./icons.js";

// Lightbox-style gallery for the small chart cards: a maximize button opens
// this modal large-in-viewport, with prev/next to cycle the charts within
// the same group (CHART_GROUPS in js/charts.js — Physics's 4 line charts
// and Finances' 5 per-leg bar charts don't mix into one nav sequence), a
// separate true-fullscreen toggle (Fullscreen API, stacked on top of the
// modal rather than replacing it), and mouse wheel/drag zoom+pan (only
// here, not on the small cards, where it would fight page scrolling).
//
// The modal is a blocking overlay — the page underneath can't be interacted
// with while it's open — so the cached configs from js/charts.js can't go
// stale mid-session; no live-update concern while navigating.

let modalChart = null;
let currentGroup = "physics";
let currentIndex = 0;

function currentIds() {
  return CHART_GROUPS[currentGroup];
}

function els() {
  return {
    modal: document.getElementById("chart-gallery"),
    panel: document.getElementById("chart-gallery-panel"),
    canvas: document.getElementById("chart-gallery-canvas"),
    title: document.getElementById("chart-gallery-title"),
    closeBtn: document.getElementById("chart-gallery-close"),
    prevBtn: document.getElementById("chart-gallery-prev"),
    nextBtn: document.getElementById("chart-gallery-next"),
    fullscreenBtn: document.getElementById("chart-gallery-fullscreen"),
    resetZoomBtn: document.getElementById("chart-gallery-reset-zoom"),
  };
}

function renderCurrent() {
  const { canvas, title } = els();
  const chartId = currentIds()[currentIndex];
  const config = getChartConfig(chartId);

  title.textContent = CHART_TITLES[chartId] ?? chartId;

  modalChart?.destroy();
  modalChart = config ? renderChartInto(canvas, config, { zoomEnabled: true }) : null;
}

function navigate(delta) {
  const ids = currentIds();
  currentIndex = (currentIndex + delta + ids.length) % ids.length;
  renderCurrent();
}

function updateFullscreenButton() {
  const { modal, fullscreenBtn } = els();
  const isFullscreen = document.fullscreenElement != null;
  fullscreenBtn.innerHTML = iconSvg(isFullscreen ? "fullscreen-exit" : "fullscreen");
  fullscreenBtn.title = isFullscreen ? "Exit fullscreen" : "Fullscreen";
  modal.classList.toggle("is-fullscreen", isFullscreen); // see css: hides the dimmed backdrop while truly fullscreen
}

function toggleFullscreen() {
  const { panel } = els();
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    panel.requestFullscreen().catch(() => {
      // Fullscreen can be denied (e.g. no user-gesture context in some
      // embeds, or browser policy) — the modal itself still works fine
      // "just maximized" without it, so this is a silent no-op.
    });
  }
}

function onKeydown(e) {
  if (e.key === "Escape") closeChartGallery();
  else if (e.key === "ArrowLeft") navigate(-1);
  else if (e.key === "ArrowRight") navigate(1);
}

export function openChartGallery(chartId) {
  const { modal } = els();
  currentGroup = chartGroupOf(chartId) ?? "physics";
  const index = currentIds().indexOf(chartId);
  currentIndex = index >= 0 ? index : 0;

  modal.hidden = false;
  document.body.classList.add("chart-gallery-open"); // suppresses body scroll while open
  document.addEventListener("keydown", onKeydown);

  renderCurrent();
}

export function closeChartGallery() {
  const { modal } = els();
  if (document.fullscreenElement) document.exitFullscreen();

  modal.hidden = true;
  document.body.classList.remove("chart-gallery-open");
  document.removeEventListener("keydown", onKeydown);

  modalChart?.destroy();
  modalChart = null;
}

export function initChartGallery() {
  const { modal, closeBtn, prevBtn, nextBtn, fullscreenBtn, resetZoomBtn } = els();

  closeBtn.addEventListener("click", closeChartGallery);
  prevBtn.addEventListener("click", () => navigate(-1));
  nextBtn.addEventListener("click", () => navigate(1));
  fullscreenBtn.addEventListener("click", toggleFullscreen);
  resetZoomBtn.addEventListener("click", () => modalChart?.resetZoom());
  document.addEventListener("fullscreenchange", updateFullscreenButton);

  // Click on the dimmed backdrop (not the panel itself) closes.
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeChartGallery();
  });

  // Wire every chart-card's maximize button here rather than in js/main.js —
  // this module owns the gallery end to end. Icon set here too (rather than
  // static markup in index.html) so every one of the 13 buttons stays in
  // sync from a single source of truth.
  document.querySelectorAll(".chart-maximize").forEach((btn) => {
    btn.innerHTML = iconSvg("arrows-angle-expand");
    btn.addEventListener("click", () => openChartGallery(btn.dataset.chartId));
  });

  updateFullscreenButton(); // sets the initial (non-fullscreen) icon — index.html ships this button empty
}
