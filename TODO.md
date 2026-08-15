# TF2 Sim — Roadmap

Current state: build two trains (locomotive(s) + wagons, real game data),
compare their aggregate specs and acceleration, see 4 comparison graphs
(force/accel vs. speed, speed/distance vs. time), define a multi-station
route with a global track speed limit, and see per-leg + trip-total
financials (revenue, maintenance, profit, profit/hour, profit/game-year).
Light/dark theme throughout.

## Vehicle data
- [x] Import real vehicle data (`data/Locos.csv`, `data/Wagons.csv`), convert
      to the app's JSON library format (`scripts/build-vehicles.mjs` → `data/vehicles.json`)
- [x] Finalize vehicle schema for locomotives and wagons
- [ ] Support vehicle categories beyond trains (aircraft first), including
      fields specific to each category

## Game formulas
- [x] Acceleration/travel-time model for rail vehicles — [docs/acceleration_formulas.md](docs/acceleration_formulas.md), `js/physics.js`
  - [x] Rewritten as a single unified numeric simulator (`simulate()`) covering
        force-limited, power-limited, and tapered phases in one RK4
        integration, replacing the old closed-form/log-fit split. Also fixes
        a latent bug where nonzero initial speed distance was approximated.
  - [ ] Optional/someday: a Lua script logging in-game speed at high
        precision (0 → top speed) would let distance be computed by
        integrating the speed trace instead of an in-game ruler measurement,
        and could re-validate the whole model, not just endpoints. Shelved
        as a side project — not needed if the formula is taken as correct.
  - [ ] Verify whether `g` in the rolling-resistance formula is really the
        full 9.81 m/s² once real numbers are available.
- [x] Revenue formula (per passenger/cargo payment) — [docs/revenue_formulas.md](docs/revenue_formulas.md), `js/finance.js`
- [x] Maintenance formula wired in (`js/finance.js`, "fixed over time" —
      always the operating rate, no station/depot state modeling)
- [ ] Loan and interest simulation (1% p.a., charged monthly, per
      docs/cost_formulas.md) — documented but not implemented; wasn't part of
      the financials batch actually requested/built
- [ ] Aircraft acceleration model (thrust-based — distinct from rail's
      tractive-effort model)
- [ ] Curve/gradient resistance — out of scope per current design (flat,
      straight track only)

## Train building
- [x] "Add locomotive" / "Add wagon" consist builder per comparison slot
      (`js/train.js`, UI in `js/main.js`)
- [x] Aggregate stats: mass sums, top speed = minimum across every consist
      member (locos AND wagons). Power/tractive-effort are summed for
      *display* only — the physics engine sums each locomotive's own
      force-vs-speed curve rather than combining scalars first (naively
      summing P/TE before computing force overstates it whenever
      locomotives differ; see docs/acceleration_formulas.md)
- [x] Passenger/cargo load mass (0.2t/passenger, 1.2t/cargo unit) added to
      train mass, always assuming full capacity — decoupled from the
      finance load-factor slider for now (see `js/train.js`)
- [ ] Save/load a built train (currently lost on page reload)

## Route & track
- [x] Multi-station route, each leg with crow-flies distance (required) and
      track distance (optional, defaults to crow-flies) — `js/route.js`
- [x] Track-distance helper: back-derive track distance from an observed
      trip time for a chosen train
- [x] Global track speed limit (120/300/custom km/h) — caps achieved speed
      without affecting where each train's own taper zone starts
- [ ] Per-leg track speed limits (currently one global limit for the whole route)
- [ ] Save/load a route (currently lost on page reload)

## Comparison & graphs
- [x] 4 comparison graphs: force vs. speed, acceleration vs. speed, speed
      over time, distance over time — `js/charts.js`, vendored Chart.js
      (`vendor/chart.umd.min.js`)
- [ ] Support more than 2 trains in a comparison
- [ ] Profit-over-time graph, once a financial simulation (below) exists

## Financial features
- [x] Per-leg and trip-total revenue, maintenance, profit, profit/real-hour,
      profit/game-year — `js/finance.js`
- [x] Difficulty setting (revenue-only multiplier)
- [x] Load factor (capacity utilization) override, defaults to 100%
- [ ] Financial simulation over time (e.g. accumulate profit, optionally buy
      more wagons/vehicles as money allows)
- [ ] Loan/interest, once wired in (see above)
- [ ] Maintenance cost accrual with an operating/parked-at-station state
      model (currently always the full operating rate)

## Vehicle library / persistence
- [ ] Add/edit/save custom vehicles in the browser (localStorage)
- [ ] Import/export vehicle library, trains, and route setups as JSON
- [ ] Possibly shareable comparison links (URL-encoded state)

## Infra / polish
- [ ] GitHub Actions deploy workflow if the project ever needs a build step
      (not needed yet — plain static site deploys directly)
- [ ] Accessibility pass on the new train-builder/route/finance UI
- [ ] Revisit plain JS vs. a framework (Vite/TS/React or similar) if the UI
      keeps growing and gets fiddly — not needed yet
- [ ] Revisit plain JS vs. Rust/WASM only if a computation turns out to be
      genuinely performance-sensitive (unlikely for this app — the physics
      engine already runs full curves in single-digit milliseconds)
