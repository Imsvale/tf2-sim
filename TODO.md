# TF2 Sim — Roadmap

Skeleton is done: pick up to 2 vehicles from a placeholder library and see their
raw specs side by side, with a light/dark theme toggle. Everything below is not
yet built.

## Vehicle data
- [ ] Import real vehicle data from user-provided CSV, convert to the app's JSON
      library format (extend/replace `data/vehicles.json`)
- [ ] Finalize vehicle schema once real fields are known (current fields are
      placeholders: length, weight, max speed, power, tractive effort, capacity,
      cost)
- [ ] Support vehicle categories beyond trains (aircraft first), including
      fields specific to each category

## Game formulas
- [ ] Acceleration model (force, mass, resistance) for ground vehicles
- [ ] Aircraft acceleration model (thrust-based — distinct from ground vehicle
      tractive effort model)
- [ ] Speed-over-distance / travel time calculation given a route length
- [ ] Derived stats computed from raw vehicle data + formulas, shown in the
      comparison table alongside (or instead of) raw specs

## Comparison & graphs
- [ ] Support more than 2 vehicles in a comparison
- [ ] Comparative graphs: force vs. speed, acceleration vs. speed, speed over
      distance/time
- [ ] Possibly more graph types once formulas are in (e.g. profit over time)

## Financial features
- [ ] Financial metrics: revenue, operating cost, profit per trip/period
- [ ] Financial simulation over time (e.g. accumulate profit, optionally buy
      more wagons/vehicles as money allows)
- [ ] Difficulty setting that modulates revenue only (matches game mechanics)
- [ ] Loans and interest modeling

## Vehicle library / persistence
- [ ] Add/edit/save custom vehicles in the browser (localStorage)
- [ ] Import/export vehicle library and comparison setups as JSON
- [ ] Possibly shareable comparison links (URL-encoded state)

## Infra / polish
- [ ] GitHub Actions deploy workflow if the project ever needs a build step
      (not needed yet — plain static site deploys directly)
- [ ] Accessibility pass, especially once graphs are added
- [ ] Revisit plain JS vs. Rust/WASM only if a computation turns out to be
      genuinely performance-sensitive (unlikely for this app, per initial
      discussion — worth a quick local benchmark before committing either way)
