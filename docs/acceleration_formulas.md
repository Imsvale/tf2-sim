# Acceleration & Travel Time Formulas (Rail)

Canonical, machine-usable formula reference for computing acceleration time and
distance for rail vehicles under constant power. Extracted directly from the
calculator state of the [Desmos model](https://www.desmos.com/calculator/pzhondtwrd)
referenced in [acceleration.md](acceleration.md), which has the prose
explanation and experimental verification. The `T`/`D` integrals below were
independently re-derived from `m·dv/dt = F_drive − R` and match the extracted
formulas exactly, so this can be treated as verified, not just transcribed.

Applies to **flat, straight track** — no gradient or curve resistance is
modeled. Rail only; road/air/water would need different resistance and
propulsion models.

**Multiple locomotives:** everything below is written for a single
locomotive's `P`/`F_TE`. For a train with more than one locomotive *type*,
do not sum `P` and `F_TE` first and treat the result as one locomotive —
each locomotive has its own force-vs-speed curve
(`F_i(v) = min(P_i/v, F_i_max)`), and the correct total drive force at a
given speed is the **sum of those curves**, `Σ F_i(v)`, evaluated
separately per locomotive. Summing the scalars first and computing one
combined `min(ΣP_i/v, ΣF_i_max)` overstates force — by 50%+ in extreme
cases — whenever the locomotives differ, because it implicitly assumes
every locomotive crosses from force-limited to power-limited at the same
speed. It only happens to give the right answer when every locomotive in
the consist shares the same `P/F_TE` ratio (e.g. identical locomotives).
`js/physics.js` implements the sum-of-curves version; see the module
comment there and in `js/train.js`.

**Loaded mass:** `m` for a train includes passenger/cargo load, not just
tare vehicle mass — 0.2t per passenger, 1.2t per unit of cargo, assuming
the train is always fully loaded (a simplification; not tied to the
finance-side load-factor override). See `js/train.js`.

## Inputs

| Symbol | Meaning | Source |
|---|---|---|
| `m` | mass, tonnes | vehicle data (`Mass`) |
| `P` | power, kW | vehicle data (`Power`) |
| `F_TE` | tractive effort, kN, **as printed** (nominal) | vehicle data (`Tractive Effort`) |
| `V` | target/final speed, km/h | e.g. vehicle top speed, or any speed of interest |
| `V_0` | initial speed, km/h | usually 0 |
| `g` | gravitational acceleration | 9.81 |
| `C` | rolling resistance coefficient | 0.002 |

**Important:** the tractive effort actually used by the game is **double**
the value printed on the vehicle's stat sheet / in the CSV data. Confirmed by
the source author via in-game console inspection (`getTrainInfo`). Always use
`F = 2·F_TE` in the physics, never `F_TE` directly.

## Step 0 — unit conversion & derived constants

```
v   = V / 3.6                    # m/s
v_0 = V_0 / 3.6                  # m/s
R   = m·g·C                      # rolling resistance, kN (constant — flat track)
F   = 2·F_TE                     # actual tractive effort limit, kN
v_t = P / F                      # tractive threshold speed, m/s
v_1 = max(v_0, v_t)              # handles v_0 already above threshold
v_95 = 0.95·(v + 0.136)          # start of the tapering zone, m/s
```

`v_95`'s `+ 0.136` (m/s, ≈ 0.49 km/h) offset is empirical / curve-fit by the
source author, not independently derived here.

Below `v_t` the vehicle is **force-limited** (drive force = constant `F`).
Above `v_t` it's **power-limited** (drive force = `P / v`, so acceleration
falls as speed rises).

## Phase 1 — force-limited (`v_0` → `v_t`)

Only applies if `v_0 < v_t` (otherwise `t_1 = d_1 = 0`).

```
a  = (F − R) / m                 # constant acceleration
t_1 = max((v_t − v_0) / a, 0)
d_1 = v_t · t_1 / 2
```

> **Caveat:** `d_1` assumes `v_0 = 0` (average speed `= v_t/2`). For `v_0 > 0`
> this is an approximation, not exact — the source model doesn't fully
> account for a nonzero starting speed in the distance term. Fine for the
> default/common case; flag if used with `V_0 > 0` in the app.

## Phase 2 & 3 — power-limited, reusable integrals

Closed-form solution to `dv/dt = (P/v − R)/m` for any two speeds `v_1 < v_2`
(both above the traction threshold):

```
T(v_1, v_2) = m·( −(P/R²)·ln((P − R·v_2) / (P − R·v_1)) − (v_2 − v_1)/R )
D(v_1, v_2) = m·( −(P²/R³)·ln((P − R·v_2) / (P − R·v_1)) − P·(v_2 − v_1)/R² − (v_2² − v_1²)/(2R) )
```

`D` is the antiderivative of `v·dt` over the same interval.

### Phase 2 — `v_t` → `v_95` (pre-taper)

```
t_2 = T(v_t, v_95)
d_2 = D(v_t, v_95)
```

### Phase 3 — `v_95` → `v` (tapered zone)

Above ~95% of top speed, the game applies an acceleration taper:

```
f(v) = sqrt(clamp(20·(v/k − 0.95), 0, 1))       # k = v_max + 0.136, m/s
a    = a_raw(v) · (1 − f(v))                    # a_raw = (min(P/v, F) − R) / m
```

This app computes `t_3`/`d_3` by **numerically integrating this directly**
(`js/physics.js`, RK4, `v_95 → v`) rather than using a closed form — there
isn't one, and given the asymptotic behavior below, a curve-fit
approximation isn't worth the uncertainty it'd introduce. It's cheap
(sub-millisecond per vehicle).

> **Historical note:** an earlier version of this doc (and an earlier
> version of this app) used a log-fit approximation instead:
> `t_3 = T(v_95,v)·(1.89·ln(V) − 2.05)`, `d_3 = D(v_95,v)·(1.92·ln(V) − 2.10)`
> (`V` in km/h). It's dropped now — direct simulation of the actual
> described formula is strictly more faithful and just as cheap. Worth
> knowing if you see it referenced elsewhere (e.g. the original Desmos
> sheet, which still has it as its own phase-3 approach).

## Totals

```
t = t_1 + t_2 + t_3
d = d_1 + d_2 + d_3
```

## Accuracy (per source author's testing)

| | Predicted | Observed | Diff |
|---|---|---|---|
| D 1/3 (lone loco), overall | | | 1.6% |
| Avelia Liberty, time to 95% | 329 s | 329 s | 0.0% |
| Avelia Liberty, distance to 95% | 17,385 m | 17,414 m | 0.17% |
| Avelia Liberty, time to v_max (untapered) | 366 s | 397 s | 8.4% |
| Avelia Liberty, distance to v_max (untapered) | 20,408 m | 23,015 m | 12.8% |

The untapered model is accurate up to `v_95`. Past that, note the "Observed"
column above comes from **manual, one-off measurement**: watching the
speedometer (integer km/h) until the vehicle seemed to have reached top
speed, then pausing and reading distance off an in-game ruler. That's a soft
stopping criterion applied to a curve that's mathematically asymptotic (see
below) — small differences in when a human decides "close enough" translate
into large differences in measured time near the tail. **The formula itself
is trusted** (it's the best available reading of what the developers
described); the old observed numbers are not being treated as ground truth
against it. See [Why "time to top speed" is asymptotic](#why-time-to-top-speed-is-asymptotic)
below.

### Why "time to top speed" is asymptotic

Let `ε = k − v` (distance from the true hard cap `k = v_max + 0.136`, not
from `v_max` itself). Near `v = k`:

```
q(v)   ≈ 1 − 10ε/k        (for small ε)
1−q(v) ≈ 10ε/k
```

So `a = a_raw·(1 − q)` decays **linearly** in `(k − v)` as `v → k`. Plugging
into `dv/dt = a` gives `dε/dt ≈ −C·ε`, i.e. **exponential relaxation**:
`v` approaches `k` asymptotically and never reaches it in finite time.
`v_max` itself sits a fixed `0.136 m/s` below that true asymptote — always,
regardless of the vehicle's actual speed — so for a fast train that's a
tiny relative gap (0.16% for a 300 km/h train) and the final approach to
`v_max` crawls. This is a plausible structural reason the taper correction
would depend on `ln(V)` at all, independent of curve-fitting.

Running the direct simulation for the Avelia Liberty example: at the
"observed" `68 s` mark the train has only reached **295.68 km/h — 98.56% of
its 300 km/h top speed**, not the mathematically exact value. Reaching
exactly 300.00 km/h takes ~237 s in that same simulation. This is consistent
with "68 s" being where a human observer judged the vehicle had visually
stopped accelerating, not a measurement of convergence to `v_max` — i.e. the
formula isn't wrong, the old manual measurement just wasn't measuring what
it was assumed to be measuring.

**Implication for this app:** "time/distance to exact top speed" is a
legitimate, accurately-simulated number now (not a fitted approximation),
but it will *look* large for fast vehicles precisely because of the
asymptotic tail — that's expected behavior, not a bug. The app also shows
time/distance to 95% of top speed alongside it, which is a more
"practical" milestone unaffected by the tail.

## Open questions / not yet modeled

- Gradient and curve resistance (flat straight track only, for now).
- Braking (only acceleration is modeled here).
- Non-zero `V_0` distance accuracy (see Phase 1 caveat).
- Non-rail vehicle types (road/air/water use different propulsion/resistance
  models — see [TODO.md](../TODO.md)).

## Sources

- Prose explanation & derivation notes: [acceleration.md](acceleration.md)
- Live formula model: <https://www.desmos.com/calculator/pzhondtwrd>
- Taper-factor-only visualization: <https://www.desmos.com/calculator/gpt6bqm9z6>
