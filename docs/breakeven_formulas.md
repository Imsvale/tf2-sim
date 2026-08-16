# Break-even Speed Formulas

## The core distinction: crow-flies speed vs. track speed

Revenue is paid on **crow-flies** distance (see
[revenue_formulas.md](revenue_formulas.md)); maintenance is paid on
**time** (see [cost_formulas.md](cost_formulas.md)). There is only one
time — the leg's actual departure-to-arrival duration — regardless of
*why* it took that long: a track distance longer than the crow-flies
distance, a lower speed limit, anything. Track distance and crow-flies
distance are never divided by two different times; they're divided by the
same one.

That means two different "average speed" quantities exist for a leg, and
they answer different questions:

| Quantity | Definition | What it's for |
|---|---|---|
| Track-distance average speed | `trackDistance / time` | A real physical speed — how fast the train actually moved, on average, over the ground it covered. Useful for physics/performance analysis (see the "Average Speed vs Distance/Time" charts). |
| Crow-flies average speed | `crowDistance / time` | Not a real physical speed (the train never travels the crow-flies distance) — but it's the quantity that determines whether the leg is profitable, since it's revenue's distance term over cost's time term. |

Using the track-distance figure for a break-even judgment is a category
error: a longer or more restricted track only ever *lowers* the
crow-flies average speed for a given time budget, but the two numbers
otherwise have no fixed relationship — there's no "correction factor"
that turns one into the other beyond dividing by the same time twice.

## Break-even speed for a specific leg

A leg breaks even when revenue equals maintenance for that leg:

```
revenue(D) = (300 + D) · K                    (D = crow-flies distance; see revenue_formulas.md)
maintenance = maintenanceRate · time
```

where `K` bundles everything about the train and the leg that revenue
depends on besides distance itself — `basePrice(topSpeed) · difficulty ·
(125/2000) · loadFactor · (passengerCapacity + 1.75 · cargoCapacity)` —
and `maintenanceRate = (price / 6) / yearSeconds`, in $/second.

Setting them equal and solving for the crow-flies average speed
(`v = D / time`):

```
v_breakeven(D) = D · maintenanceRate / [(300 + D) · K]
```

`js/finance.js`'s `breakEvenAverageSpeed_kmh(aggregate, leg, options)`
implements this directly — it doesn't compute `K` by hand, it just asks
for the leg's actual revenue (`legRevenue`) and solves `time = revenue /
maintenanceRate`, then `v = crowDistance / time`. Same formula, no
duplicated math.

## The upper bound: break-even speed for *any* distance

`v_breakeven(D)` increases monotonically with `D` (verified numerically —
≈3.45, 4.81, 5.37, 5.51, 5.52, 5.526 km/h at D = 500 m, 2 km, 10 km,
100 km, 1000 km, 100,000 km, for one example consist) and converges to a
limit as `D → ∞`:

```
v_upper_bound = lim(D→∞) v_breakeven(D) = maintenanceRate / K
```

— the same result as just dropping the `+300` from the revenue formula
entirely. Since `D / (300 + D) < 1` for every finite `D > 0`,
`v_breakeven(D) < v_upper_bound` always — the limit is never reached, only
approached. That makes it a genuine, useful guarantee: a consist whose
crow-flies average speed exceeds `v_upper_bound` is profitable on a leg of
**any** crow-flies distance, because it's already faster than the
break-even speed for every possible distance, not just a specific one.

This bound depends only on the consist and difficulty/load factor — no
route involved. It hasn't been wired into the UI yet (see TODO.md); the
per-leg formula above has, on the Route tab's Leg Profile section —
specifically its Time and Crow-flies Distance subsections' Average Speed
charts, each with a dashed break-even reference line per train.

## Open questions / not yet modeled

- A route/consist-independent presentation of the upper bound (e.g. a
  table across wagon counts) — location undecided, see TODO.md.
- An optional global "track distance = crow distance × N%" inflation, to
  approximate route curvature without measuring actual track distance
  (which isn't practical to obtain from the game) — under consideration,
  not started.
