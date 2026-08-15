# TF2 Sim

A train performance and profit calculator for Transport Fever 2, with other
vehicle types (e.g. aircraft) planned. Build two trains (locomotive(s) +
wagons), compare their acceleration and performance graphs, lay out a
multi-station route, and see per-leg and trip-total financials.

Static site, no build step (a single vendored `vendor/chart.umd.min.js` for
graphs is loaded via a plain `<script>` tag — no bundler involved). See
[TODO.md](TODO.md) for the feature roadmap.

## Running locally

Any static file server works, e.g.:

```
python -m http.server 8000
```

or

```
npx serve
```

Then open the printed local address in a browser. Opening `index.html`
directly via `file://` will not work, since the app fetches
`data/vehicles.json`.

## Vehicle data

`data/Locos.csv` and `data/Wagons.csv` are the source data. `data/vehicles.json`
(the format the app actually loads) is generated from them — re-run after
editing the CSVs:

```
node scripts/build-vehicles.mjs
```

## Game formulas

Reverse-engineered game formulas (acceleration/travel time, revenue,
maintenance/loan costs) are documented in [docs/](docs/), separate from
their implementation in `js/`, so the source and any caveats are easy to
check against the code.
