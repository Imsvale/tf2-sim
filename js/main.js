import { initTheme } from "./theme.js";
import { loadVehicles, COMPARE_FIELDS, formatFieldValue } from "./vehicles.js";

const SLOT_COUNT = 2;

function populateSelect(select, vehicles) {
  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "— none —";
  select.appendChild(emptyOption);

  for (const vehicle of vehicles) {
    const option = document.createElement("option");
    option.value = vehicle.id;
    option.textContent = vehicle.name;
    select.appendChild(option);
  }
}

function renderComparisonTable(vehicles, selectedIds) {
  const head = document.getElementById("compare-table-head");
  const body = document.getElementById("compare-table-body");
  head.innerHTML = "";
  body.innerHTML = "";

  const selectedVehicles = selectedIds.map((id) => vehicles.find((v) => v.id === id) || null);

  const cornerTh = document.createElement("th");
  cornerTh.textContent = "Spec";
  head.appendChild(cornerTh);

  for (let i = 0; i < SLOT_COUNT; i++) {
    const th = document.createElement("th");
    th.textContent = selectedVehicles[i] ? selectedVehicles[i].name : `Vehicle ${i + 1}`;
    head.appendChild(th);
  }

  if (!selectedVehicles.some(Boolean)) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = SLOT_COUNT + 1;
    cell.textContent = "Select one or two vehicles above to see a comparison.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  for (const field of COMPARE_FIELDS) {
    const row = document.createElement("tr");

    const rowHeader = document.createElement("th");
    rowHeader.scope = "row";
    rowHeader.textContent = field.label;
    row.appendChild(rowHeader);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const cell = document.createElement("td");
      const vehicle = selectedVehicles[i];
      cell.textContent = vehicle ? formatFieldValue(vehicle, field) : "—";
      row.appendChild(cell);
    }

    body.appendChild(row);
  }
}

async function init() {
  initTheme();

  const vehicles = await loadVehicles();
  const selects = [];

  for (let i = 0; i < SLOT_COUNT; i++) {
    const select = document.getElementById(`vehicle-select-${i}`);
    populateSelect(select, vehicles);
    selects.push(select);
  }

  function handleChange() {
    const selectedIds = selects.map((s) => s.value);
    renderComparisonTable(vehicles, selectedIds);
  }

  selects.forEach((select) => select.addEventListener("change", handleChange));
  handleChange();
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<p style="color:red; max-width:960px; margin:1rem auto; padding:0 1.5rem;">Failed to initialize app: ${err.message}</p>`
  );
});
