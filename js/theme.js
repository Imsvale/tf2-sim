const STORAGE_KEY = "tf2sim-theme";

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function currentEffectiveTheme() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit) return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** @param {() => void} [onChange] - called after the theme toggles, e.g. to re-color charts */
export function initTheme(onChange) {
  const stored = localStorage.getItem(STORAGE_KEY);
  applyTheme(stored);

  const toggleButton = document.getElementById("theme-toggle");
  const icon = toggleButton.querySelector(".theme-toggle-icon");

  function updateIcon() {
    icon.textContent = currentEffectiveTheme() === "dark" ? "☀️" : "🌙";
  }

  updateIcon();

  toggleButton.addEventListener("click", () => {
    const next = currentEffectiveTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    updateIcon();
    onChange?.();
  });
}
