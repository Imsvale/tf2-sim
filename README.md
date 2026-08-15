# TF2 Sim

A vehicle performance and profit calculator for Transport Fever 2 — primarily
trains, with other vehicle types (e.g. aircraft) planned. Compare acceleration,
speed, travel times, and financial performance across vehicles.

Static site, no build step. See [TODO.md](TODO.md) for the feature roadmap —
this is currently just a skeleton (pick up to 2 vehicles, compare raw specs).

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

`data/vehicles.json` currently holds placeholder data for UI development.
Real vehicle data and the game's speed/acceleration/financial formulas will
be added once provided.
