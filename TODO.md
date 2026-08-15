# TF2 Sim — Roadmap

Current state: build any number of named, cloneable trains (locomotive(s) +
wagons, real game data and artwork) as horizontal strips of image chips with
inline insert/remove controls, compare aggregate specs on the Trains tab,
their derived acceleration stats and 4 comparison graphs (force/accel vs.
speed, speed/distance vs. time — with hover tooltips, legend-click show/hide,
and a maximize/fullscreen/zoom gallery) on the Physics tab, define a
multi-station **looped** route (name/distance/track distance/load % per
stop, plus a global track speed limit) on the Route tab, and see per-leg +
trip-total financials (revenue, maintenance, profit, profit/hour,
profit/game-year) for the full loop on the Finances tab. Everything
persists to localStorage across refreshes. Light/dark theme throughout.

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
  - [x] Taper applies to net drive force, not to rolling resistance — the
        Force graph plots `F_effective(v) = R + (F_drive(v) − R) · (1 −
        taper(v))` rather than the raw (untapered) drive-force curve, so
        the taper is visible on Force as well as Acceleration. Verified
        algebraically and numerically (~1e-17) equivalent to the original
        `accel()` — see "Taper applies to net force, not to rolling
        resistance" in docs/acceleration_formulas.md
- [x] Revenue formula (per passenger/cargo payment) — [docs/revenue_formulas.md](docs/revenue_formulas.md), `js/finance.js`
- [x] Maintenance formula wired in (`js/finance.js`, "fixed over time" —
      always the operating rate, no station/depot state modeling)
- [ ] Loan and interest simulation (1% p.a., charged monthly, per
      docs/cost_formulas.md) — documented but not implemented. Once built, the
      loan amount is a single company-wide value (not per-vehicle/leg), so it
      belongs as a small global-settings widget on the Trains tab, not its own
      tab — decided when discussing the tab layout, see below.
- [ ] Aircraft acceleration model (thrust-based — distinct from rail's
      tractive-effort model)
- [ ] Curve/gradient resistance — out of scope per current design (flat,
      straight track only)

## Train building
- [x] "Add locomotive" / "Add wagon" per train, any number of trains, laid
      out as vertical horizontal-scrolling strips (`js/train.js` model,
      UI in `js/main.js`) — replaced the earlier fixed-2-slot side-by-side grid
- [x] Each locomotive/wagon group is an independent, positional slot
      (`insertLocomotive`/`insertWagon`/`removeLocomotiveAt`/etc. in
      `js/train.js`, index-keyed, not deduplicated by vehicle type) — lets
      the same vehicle type appear as separate groups at different
      positions in the same train (e.g. boxcars, then a tanker, then more
      boxcars)
- [x] Vehicles collapse to chips showing real vehicle artwork (`img/`,
      Flaticon, see CREDITS.md), native tooltip shows full name + compact
      specs, click to open a popover (type, quantity). A trailing
      locomotive auto-mirrors to face outward (`js/images.js`,
      `.chip-img--flipped`). A "Compact / Detailed" toggle switches all
      chips to also show the name inline
- [x] Small green +/red ✕ controls beside each chip insert a new default
      group after that position / remove that group; an icon-less
      fallback "+ Add locomotive"/"+ Add wagon" appears only when a
      category is completely empty (bootstrapping safety net — normally
      unreachable since default trains and "+ Add train" both seed 1 of each)
- [x] Clone-train button (📋, before the remove ✕) deep-copies a whole
      train's consist to the bottom of the list
- [x] Rename a train via the ✎ button next to its label — persists, and
      shows up everywhere the train is referenced (tables, chart legends,
      leg-time-estimator train picker)
- [x] Aggregate stats: mass sums, top speed = minimum across every consist
      member (locos AND wagons). Power/tractive-effort are summed for
      *display* only — the physics engine sums each locomotive's own
      force-vs-speed curve rather than combining scalars first (naively
      summing P/TE before computing force overstates it whenever
      locomotives differ; see docs/acceleration_formulas.md)
  - [x] "Nominal" (tractive effort), "Top speed", and "Total mass" row
        headers carry a dashed-underline info tooltip (`.info-tooltip` in
        css/styles.css, `labelParts` on `TRAIN_SPEC_FIELDS` in
        `js/train.js`) explaining the 2× TE doubling, "slowest consist
        member," and "includes full passenger/cargo load" respectively,
        instead of a permanently-visible parenthetical note
  - [x] Derived acceleration/travel-time stats (rolling resistance,
        threshold speed, time/distance to 95%+top speed) moved off this
        tab entirely — see Physics tab below. This tab now shows only raw
        consist specs (counts, mass, power, TE, capacity, price)
- [x] Passenger/cargo load mass (0.2t/passenger, 1.2t/cargo unit) added to
      train mass, always assuming full capacity — decoupled from the
      finance load-factor slider for now (see `js/train.js`)
- [x] Trains (incl. custom names) and chip/tab/display preferences persist
      to localStorage (`js/storage.js`) — see "Persistence" below
- [ ] Drag-and-drop reordering of vehicles within a train — purely cosmetic
      (order doesn't affect any computation; the insert-after mini-buttons
      cover the main reordering need already), deferred as low-priority polish
- [ ] A train's chart/table color follows its position in the list, not a
      stable per-train identity — removing an earlier train shifts later
      trains' colors. Would need a stable id per train to fix; not worth the
      complexity yet at this app's scale

## Route & track
- [x] Multi-station **looped** route: N stations, N legs — `legs[i]` is the
      distance from `stations[i]` to `stations[(i+1) % n]`, so the last
      stop's row holds the distance back to the first, matching how a TF2
      line actually runs continuously rather than stopping at a linear
      endpoint (`js/route.js`). Trip totals (time/revenue/profit) cover the
      full loop, not just a one-way A→B leg
- [x] Route tab is a single table (`#route-table` in index.html, built by
      `renderRoute`/`buildRouteRow` in `js/main.js`): one row per stop with
      name, distance and track distance to the next stop (each header
      carries an `.info-tooltip` explaining the wraparound), and that leg's
      load %  — replaced the earlier separate "Stations" list + "Legs"
      card-list layout
- [x] Per-leg load factor (0-100%, default 100), replacing the old single
      global Load factor slider on the Finances tab — each leg carries its
      own `loadFactor`, read directly by `js/finance.js`'s `legRevenue`
- [x] Track-distance helper: back-derive track distance from an observed
      trip time for a chosen train — now a small "≈" popover per row
      (reuses the same generic popover plumbing as the vehicle-chip
      popover) instead of an inline `<details>` card
- [x] Global track speed limit (120/300/custom km/h) — caps achieved speed
      without affecting where each train's own taper zone starts. Lives on
      the Route tab (thematic fit) even though it's a global value, not a
      per-leg one
- [ ] Per-leg track speed limits (currently one global limit for the whole route)
- [x] Route (incl. per-leg load factor) persists to localStorage — old
      saved routes from before the loop-model change fail the new
      `legs.length === stations.length` check and reset once, surfaced via
      the usual warning banner (no versioning/migration, by design)

## Comparison & graphs
- [x] 4 comparison graphs: force vs. speed, acceleration vs. speed, speed
      over time, distance over time — `js/charts.js`, vendored Chart.js
      (`vendor/chart.umd.min.js`)
- [x] Hover tooltips (nearest-point, since line points are invisible until
      hovered — fixed a bug where `axis:"x"` made the tooltip flip between
      series on tiny mouse movements; `axis:"xy"` tracks the actually-closest
      line) and click-legend-to-toggle series (Chart.js default) — doubles
      as the "selective show/hide" for readability with more trains
  - [x] Hover only shows when the cursor is within `HOVER_RADIUS_PX`
        (`js/charts.js`, currently 20 CSS px) of a line — a custom
        `nearestWithinRadius` interaction mode, rather than always
        highlighting whichever series is closest even far from any line
  - [x] Fixed a ~30px hover/tooltip Y-offset that only showed up on the
        small inline cards, not the gallery: Chart.js's responsive sizing
        can desync from a canvas's actual rendered box when the canvas is a
        flex item sharing space with siblings (here, the card's `<h3>`).
        Fix: wrap the canvas in its own `.chart-canvas-wrap` div and make
        the canvas `position:absolute; inset:0` inside it — the standard
        Chart.js pattern for canvases in flex/grid containers, applied to
        both the small cards and the gallery
- [x] Categorical color palette validated via the dataviz skill (8 fixed
      hues, never cycled; 9th+ train falls back to a shared muted color —
      see `--series-*` in css/styles.css and js/charts.js)
- [x] Support more than 2 trains in a comparison (no cap)
- [x] Chart gallery (`js/chartGallery.js`): a ⛶ button per chart card opens
      a large in-viewport lightbox with prev/next navigation, a separate
      true-fullscreen toggle (Fullscreen API, stacks on top of the
      maximized view rather than replacing it), and mouse wheel-zoom +
      drag-to-pan (`vendor/chartjs-plugin-zoom.umd.min.js`, gallery-only —
      not on the small inline cards, where it would fight page scroll)
  - [x] Two chart *groups* now exist — Physics (4 line charts) and Finances
        (5 per-leg bar charts, see below) — gallery prev/next stays
        confined to whichever group it was opened from
        (`CHART_GROUPS`/`chartGroupOf()` in `js/charts.js`)
- [ ] Profit-over-time graph, once a financial simulation (below) exists

## Financial features
- [x] Per-leg and trip-total revenue, maintenance, profit, profit/real-hour,
      profit/game-year — `js/finance.js`. Per leg: time, revenue,
      maintenance, and profit are computed leg-by-leg (`tripSummary()`
      allocates maintenance to each leg proportional to its share of trip
      time, then sums those for the trip total — same result as the old
      trip-only formula, just now exposed per leg too), plus average speed
      (leg's track distance / leg time)
- [x] Per-leg breakdown is user-groupable — "Group by: Metric" (default,
      one mini-table per metric: Time/Average speed/Revenue/Maintenance/
      Profit, rows = legs) or "Group by: Leg" (one mini-table per leg, rows
      = metrics) — both keep trains as columns, since cross-train
      comparison is the point. `state.financeGroupBy`, `js/main.js`
      (`renderLegBreakdown`, `LEG_METRIC_FIELDS`)
- [x] The same 5 per-leg metrics also get a bar chart each (x = leg, one
      bar per train), added to the chart gallery — `renderFinanceCharts()`
      in `js/charts.js`. Bar charts use Chart.js's standard `index`/category
      hover instead of the line charts' custom `nearestWithinRadius` mode
      (built specifically for sparse, invisible-until-hover line points —
      bars don't have that problem)
- [x] Difficulty setting (revenue-only multiplier)
- [x] Load factor (capacity utilization) override, defaults to 100% — now
      per-leg, set on the Route tab (see "Route & track" above), not a
      single global value on this tab
- [ ] Financial simulation over time (e.g. accumulate profit, optionally buy
      more wagons/vehicles as money allows)
- [ ] Loan/interest, once wired in (see "Game formulas" above for where its
      UI belongs)
- [ ] Maintenance cost accrual with an operating/parked-at-station state
      model (currently always the full operating rate)

## Persistence
- [x] Full app state (trains, route incl. per-leg load factor, track speed
      limit, difficulty, active tab, chip view) persists to `localStorage`
      (`js/storage.js`), no versioning/migration by design (not needed yet)
- [x] Never crashes on bad/stale saved data — corrupted JSON, malformed
      shapes, and vehicle ids that no longer exist in the data are all
      caught, recovered from per-section where possible, and surfaced as a
      dismissible on-page warning banner, never a console-only failure
- [ ] Export/import state as a JSON file (shareable configs) — natural
      extension of the same serialization, not yet built

## Infra / polish
- [ ] GitHub Actions deploy workflow if the project ever needs a build step
      (not needed yet — plain static site deploys directly)
- [ ] Accessibility pass on the tab/chip/popover UI (tabs and popovers use
      basic ARIA roles/attributes already, but haven't been screen-reader
      tested)
- [ ] Revisit plain JS vs. a framework (Vite/TS/React or similar) if the UI
      keeps growing and gets fiddly — not needed yet
- [ ] Revisit plain JS vs. Rust/WASM only if a computation turns out to be
      genuinely performance-sensitive (unlikely for this app — the physics
      engine already runs full curves in single-digit milliseconds)
