# TF2 Sim — Roadmap

Current state: build any number of named, cloneable, individually-colored
trains (locomotive(s) + wagons, real game data and artwork) as horizontal
strips of image chips with inline insert/remove controls, compare aggregate
specs on the Trains tab, their derived acceleration stats and 5 comparison
graphs (force/accel vs. speed, speed/distance vs. time, speed vs. distance —
with hover tooltips, legend-click show/hide, and a maximize/fullscreen/zoom
gallery) on the Physics tab, define a multi-station **looped** route
(name/distance/track distance/load % per stop, a global track speed limit
and braking deceleration, and a per-leg speed/braking profile graph) on the
Route tab, and see per-leg + trip-total financials (revenue, maintenance,
profit, profit/hour, profit/game-year) for the full loop on the Finances
tab. Everything persists to localStorage across refreshes. Light/dark theme
throughout.

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
  - [x] `simulate()` now also tracks a checkpoint at the tractive-threshold
        speed (`vtCheckpoint`, alongside the existing `v95Checkpoint`) —
        null when the consist has mixed locomotive types with different
        power/tractive-effort ratios (no single threshold speed exists
        then, see `buildDynamics`' `vt`) or when it's never reached (e.g.
        capped by a lower track speed limit)
  - [x] The Physics tab's Acceleration & Travel Time table defaults to a
        simplified view — mass, power, effective TE, rolling resistance,
        initial acceleration, and time/distance to top speed. Only the
        tractive-threshold speed and its own milestone (plus the 95%
        milestone) are hidden behind a "Detail level: Simplified/Detailed"
        select (`state.accelerationDetail`, `js/main.js`) — those are the
        rows that are genuinely confusing without knowing the internals;
        everything else is either a basic spec or the headline number.
        Mass/power are pulled straight from the aggregate and reuse
        `TRAIN_SPEC_FIELDS`' exact labels/tooltips/formatting for
        consistency with the Trains tab. Effective TE and rolling
        resistance got dashed-underline tooltips too (2× nominal; and
        `R = m · g · C, C = 0.002`, respectively), same `.info-tooltip`
        pattern as elsewhere, replacing an inline "(2× nominal)" parenthetical
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
      specs, click to open a popover (type only, see below). A trailing
      locomotive auto-mirrors to face outward (`js/images.js`,
      `.chip-img--flipped`). A "Compact / Detailed" toggle switches all
      chips to also show the name inline
  - [x] Quantity lives directly on the chip now, as a compact `[n]▲▼`
        stepper (`buildChipQtyStepper()` in `js/main.js`) — no popover
        step needed to change it. Stacked up/down arrows on the trailing
        edge, not +/- flanking each side — a leading "+" would've sat
        right next to the mini-add button's own "+" (a different action,
        insert a new group), and stacked arrows are more compact besides
  - [x] Fixed a focus glitch on the quantity input: `.chip-qty`'s
        `overflow: hidden` (used to clip the flanking buttons into a
        pill shape) was clipping the input's native focus outline down to
        a stray sliver at one edge. Rebuilt the pill shape from explicit
        per-corner `border-radius` instead (no `overflow:hidden` needed),
        and moved the focus indicator to the pill itself
        (`:focus-within` + `box-shadow`, with the input's own native
        outline suppressed) so there's nothing left for anything to clip
  - [x] The quantity value is also scroll-wheel adjustable — hovering the
        field steps it directly, and once it's focused, scrolling anywhere
        on the page does too (a document-level listener added on focus and
        removed on blur, so it doesn't linger once the field isn't active;
        `stopPropagation` on the direct hover listener avoids double-
        stepping when both apply at once)
  - [x] The chip itself is a `<div>` now, not a `<button>` — it hosts two
        independently-interactive children (the quantity stepper above,
        and a `<select>` covering the rest of it), and a `<button>` can't
        contain other interactive controls. Since Type was the only field
        left in the vehicle popover once Quantity moved out, that popover
        is gone entirely — the invisible `<select>` opens directly on
        click, styled to stay visually identical to the old chip button
        (`.chip-type-select`, `opacity: 0`, `position: absolute; inset: 0`
        — real and focusable, just not painted). It sits *underneath* the
        quantity stepper in click-priority despite covering the whole
        chip: an absolutely-positioned element normally wins pointer
        events over a non-positioned sibling regardless of DOM order, so
        `.chip-qty` needs its own explicit `position: relative; z-index:
        1` to correctly take priority over the select in its own area
- [x] Small green +/red ✕ controls beside each chip insert a group after
      that position / remove that group. + clones the chip it's on (same
      vehicle type and quantity), not a generic default — a duplicated
      group (e.g. another 3 of the same wagon) is what's wanted far more
      often than reverting to the first vehicle in the list every time. An
      icon-less fallback "+ Add locomotive"/"+ Add wagon" (still a plain
      default, since there's no chip to clone from) appears only when a
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
- [x] A train's chart color can be pinned to one of the 8 validated
      `--series-*` slots via a small swatch button next to its rename icon
      (`train.color`, `buildTrainColorButton`/`openTrainColorPopover` in
      `js/main.js`) — reuses the same popover plumbing and the same colors
      already defined for the charts (`SERIES_SLOTS`/`seriesColor()`,
      newly exported from `js/charts.js`), so there's exactly one place
      the 8 colors are defined. Persists (`js/storage.js`); resets to
      "Auto" on clone, same reasoning as the name reset. A train left on
      "Auto" still follows its position in the list (unchanged behavior),
      but a pinned train now keeps its color regardless of what's added,
      removed, or reordered around it

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
- [x] 5 comparison graphs: force vs. speed, acceleration vs. speed, speed
      over time, distance over time, speed over distance — `js/charts.js`,
      vendored Chart.js (`vendor/chart.umd.min.js`). Speed-over-distance
      reuses the same simulated trajectory samples as speed/distance-over-
      time, just re-keyed on distance instead of time — no new physics,
      but a more directly useful view since routes/legs are distance-based
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
- [x] Route graphs: each train's full door-to-door profile for one
      selected leg — accelerate, cruise if the leg's long enough, then
      **brake to a stop at the station**, plotted as Speed vs Distance and
      Speed vs Time (`chart-route-speed-distance`/`-time`, a third
      `CHART_GROUPS` entry in `js/charts.js`, gallery-enabled like the
      others). Lives on the Route tab: a "Leg" `<select>`
      (`state.selectedLegIndex`, `renderLegSelect()` in `js/main.js`,
      rebuilt on route structure changes and station rename) picks which
      leg to show, rather than a permanently-stacked chart-grid per leg.
  - [x] New global, user-customizable braking deceleration
        (`state.brakingDeceleration_ms2`, default 2.5 m/s² to match
        vanilla, a number input on the Route tab next to the track speed
        limit)
  - [x] New `simulateToStop()` in `js/physics.js`: runs the same
        accel/cruise stepping as `simulate()` (the RK4 tableau itself was
        factored out into a shared `rk4Step()` helper so it isn't
        duplicated), but at every step checks "if braking started right
        now, would the train stop by the station?" (`v² = 2·a_brake·d`,
        exact for a flat deceleration) — the first step where that's true
        is where braking begins. The braking phase itself is closed-form
        from there. Verified against real vehicle data: long legs reach
        cruise and brake starting exactly where the kinematics predict;
        short legs brake mid-acceleration without ever reaching cruise;
        every case lands at the leg's real distance with speed ≈ 0
  - [x] Each train's line is split into a solid "run" segment and a
        dashed, legend-hidden "brake" segment sharing one color/legend
        entry (`renderRouteProfileCharts()` in `js/charts.js`, new
        `dashed`/`legendHidden` dataset options on `renderChartInto()`) —
        shows where braking starts without a separate annotation plugin
  - [x] Reference for other potentially interesting mechanics to explore
        later: Steam Workshop mods 3454209257 and 3238328414 (files under
        the Workshop folder in the user's SteamLibrary on the S: drive)
  - **Scope note (superseded — see "Whole-route timing" below):** this
        was originally additive/visual only, with `tripSummary()`
        unchanged. It's since been wired into financials too, behind an
        explicit "Include stops" toggle on the Finances tab (default off,
        so nothing changes unless it's turned on) — see Financial features
- [x] Whole-route graph: every leg back to back for the entire loop,
      accelerate/cruise/brake per leg (reusing `simulateToStop()`) with a
      flat "stopped" segment at each station for that stop's loading +
      unloading dwell (see "Whole-route timing" under Financial features)
      — one continuous Speed-over-Time line per train covering the full
      route (`chart-route-whole`, its own single-chart `CHART_GROUPS`
      entry, `renderWholeRouteChart()` in `js/charts.js`). Lives on the
      Route tab below the per-leg Leg Profile section; no leg selector
      needed since it always shows the whole loop

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
- [x] Trip Summary table has its own "Trip Summary" heading (was missing
      one — every other table/mini-table on this tab has a heading, this
      was the odd one out)
- [x] Leg distance is shown alongside the leg name (`legLabelWithDistance()`
      in `js/main.js`, e.g. "A → B (15.0 km)") on every per-leg table
      heading ("Group by: Leg") and, per `LEG_METRIC_FIELDS.showLegDistance`,
      on the Time and Average speed row labels specifically in "Group by:
      Metric" mode — distance is directly relevant context for those two,
      not for Revenue/Maintenance/Profit
- [x] Finance bar charts use bare leg indices ("1", "2", ...) on the x-axis
      instead of full "Station M → Station N" names — the axis is already
      titled "Leg", and full names get unwieldy as a category axis; the
      tables above keep the full names (+ distance, see above)
- [x] Large currency figures collapse to "k"/"M" on the Finances tab
      (`formatMoneyCompact()` in `js/vehicles.js`, e.g. "$1.2M" instead of
      "$1,246,247") — used for Revenue/Maintenance/Profit in both the
      per-leg/trip-summary tables and the finance bar charts' y-axis tick
      labels. Vehicle prices elsewhere (Trains tab, chip tooltips) keep the
      exact `formatMoney()` — purchase-price comparison benefits from
      precision more than trip financials do
- [x] Difficulty setting (revenue-only multiplier)
- [x] Load factor (capacity utilization) override, defaults to 100% — now
      per-leg, set on the Route tab (see "Route & track" above), not a
      single global value on this tab
- [x] Whole-route timing: loading/unloading dwell time and stop-aware
      maintenance accrual (was the "operating/parked-at-station state
      model" item below — done, not just parked/depot rates but the
      actual per-stop load/unload duration too). New `js/loading.js`:
  - `loadUnloadTime(units, targetAmount)` — **not** a naive
        `amount/Σ(loadingSpeed)`. That shortcut is only exact when every
        active wagon/MU shares the same capacity-to-loadingSpeed ratio;
        the real vehicle data doesn't (loadingSpeed 1-4, capacity 4-33,
        independently), so a wagon with a smaller ratio saturates first,
        drops out of the pool, and the combined rate for the rest falls
        below Σ(loadingSpeed) — same category of bug as naively summing
        locomotive power/TE, fixed the same way (piecewise, per-unit, not
        pre-summed). Verified: matches the naive formula exactly below
        saturation and for equal-ratio consists, exceeds it once a wagon
        saturates, and resolves to `max(capacity/loadingSpeed)` at 100%
        load with mismatched wagons
  - `stationHoldTime(aggregate, loadFactor)` — passenger and cargo load in
        parallel (different wagons/doors), so hold time is
        `max(passengerTime, cargoTime)`, not their sum. `loadFactor` is
        *that leg's own* load factor: since it represents how full the
        train is on that leg, it governs both the boarding at the leg's
        start and the disembarking at the leg's end, so load time and
        unload time come out identical — confirmed this also means every
        leg's time is self-contained (no need to reference neighboring
        legs), and summing it over the whole loop covers each station's
        loading once (as the leg departing it) and unloading once (as the
        leg arriving there) — the "split at the boundary between
        unloading and loading" convention, with no double-counting
  - `js/train.js`'s `aggregateTrain()` gained a `loadUnits` array (same
        per-group-not-merged pattern as `locomotiveUnits`) covering both
        wagons and multiple-unit locomotives that carry passengers (17 in
        the data have capacity > 0 — previously not tracked per-unit
        anywhere)
  - New "Include stops (loading, unloading, braking)" checkbox on the
        Finances tab (`state.includeStopsInFinancials`, default off — see
        below), which is also what turns on braking-aware leg time here
        (via `simulateToStop()`) — "including stops" naturally means
        including the deceleration into them too
  - Maintenance during a stop only accrues at 40% of the normal rate
        (`js/finance.js`'s `tripSummary()`, `STOPPED_MAINTENANCE_FACTOR`)
- [x] "Include stops" toggle (`js/finance.js`'s `tripSummary(...,
      {includeStops, brakingDeceleration_ms2})`) — off (default): byte-
      identical to the pre-existing travel-only model, verified by
      regression trace. On: per-leg time becomes braking-inclusive travel
      + loading + unloading (see "Whole-route timing" above), which flows
      through unchanged into `totalTime_s`, `profitPerRealHour`,
      `profitPerGameYear` — those already just consume whatever time/
      maintenance each leg reports. Revenue is untouched either way
      (`legRevenue()` was never time-based)
- [ ] Financial simulation over time (e.g. accumulate profit, optionally buy
      more wagons/vehicles as money allows)
- [ ] Loan/interest, once wired in (see "Game formulas" above for where its
      UI belongs)

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
- [x] Links use the theme-aware `--accent` token (`a, a:visited` in
      css/styles.css) instead of the browser default blue/purple — the
      latter isn't dark-mode-aware and the default visited purple read
      muddy against the dark background. Previously only `.site-footer a`
      had a color rule, which happened to cover most links but missed the
      one in the Physics tab's acceleration hint; now global, and the
      redundant footer-specific rule was removed
- [x] Native form-control chrome (mainly number-input spin buttons) now
      respects the app's theme via the CSS `color-scheme` property (set
      alongside the existing light/dark token blocks in css/styles.css) —
      without it, every spin button rendered in light browser chrome
      (a bright box) regardless of the app's own dark mode
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
