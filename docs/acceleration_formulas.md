# Acceleration & Travel Time Formulas (Rail)

Canonical, machine-usable formula reference for computing acceleration time and
distance for rail vehicles under constant power. Extracted directly from the
calculator state of the [Desmos model](https://www.desmos.com/calculator/pzhondtwrd)
referenced in [acceleration.md](acceleration.md), which has the prose
explanation and experimental verification. The `T`/`D` integrals below were
independently re-derived from `m·dv/dt = F_drive − R` and match the extracted
formulas exactly, so this can be treated as verified, not just transcribed.

Applies to **flat track** — no gradient (slope) resistance is modeled.
Curves aren't a resistance mechanic in TF2 at all — they just impose a
lower speed limit, not a drag force — so there's nothing curve-related to
model here beyond speed limits. Rail only; road/air/water would need
different resistance and propulsion models.

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
| `g` | gravitational acceleration | 9.81 (confirmed — see below) |
| `C` | rolling resistance coefficient | 0.002 |

**Important:** the tractive effort actually used by the game is **double**
the value printed on the vehicle's stat sheet / in the CSV data. Confirmed by
the source author via in-game console inspection (`getTrainInfo`), and
independently corroborated by a third-party mod (Steam Workshop
"Statistics++", `3238328414`) that reached the same doubling via its own
observation of in-game behavior. Always use `F = 2·F_TE` in the physics,
never `F_TE` directly.

**`g` is now confirmed** — 9.81 m/s² (real-world standard gravity), same as
the TE doubling above. Verified by sweeping `0.1g` through `2.0g` in `0.1g`
steps and comparing the resulting acceleration curve against real tf2-watcher
captures at every step; `1.0g` is clearly the best fit, not just "close
enough among untested alternatives." The Physics tab's "Gravity" control
(`state.gravity_ms2` in `js/main.js`, threaded through every physics call in
`js/physics.js`, `js/route.js`, `js/finance.js`, `js/charts.js`) is hidden
now that this is settled, but deliberately not removed — the plumbing stays
in place in case it's ever needed again.

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
f(v) = clamp(20·(v/k − 0.95), 0, 1)²            # k = v_max + 0.136, m/s
a    = a_raw(v) · (1 − f(v))                    # a_raw = (min(P/v, F) − R) / m
```

**The exponent is squared, not square-rooted** — corrected from an earlier
version of this doc (and this app) that used `sqrt` here, per real in-game
telemetry; see "Precision validation" below (specifically "Resolved: the
exponent, not the constant") for the captures and the fit that confirmed
this.

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

### Taper applies to net force, not to rolling resistance

`a = a_raw · (1 − f(v))` taper the *whole net acceleration* — i.e. it acts
on `(F_drive − R)`, after `R` has already been subtracted, not on `F_drive`
alone. `R` (rolling resistance) is a flat penalty at every speed; the game
doesn't taper friction, only the locomotive's own force output.

This matters once you want a force-domain curve (e.g. a force-vs-speed
graph) that's consistent with the tapered acceleration. Naively tapering
just the raw drive force and then subtracting a full, untapered `R`:

```
F_naive(v) = F_drive(v) · (1 − f(v))
a_wrong(v) = (F_naive(v) − R) / m        # NOT equal to the real a(v)
```

under-counts net force by `R · f(v)` — friction gets penalized twice near
top speed. The correct force-domain quantity, derived by requiring
`(F_effective − R)/m` to reproduce the real `a(v)` exactly:

```
F_effective(v) = R + (F_drive(v) − R) · (1 − f(v))
```

`js/physics.js` implements `accel(v)` as `(F_effective(v) − R) / m` (a pure
refactor of the same formula — verified numerically identical to the
previous direct implementation across multiple vehicles, differences at
float-precision noise level, ~1e-17), and `forceAtSpeed()` (used by the
force-vs-speed graph) returns `F_effective`, not the raw `F_drive` — so the
graph now visibly tapers near top speed the same way the acceleration graph
does, rather than showing an idealized, untapered force curve. Below `v_95`
the two are identical (`f(v) = 0` there), so this only changes anything in
the last ~5% of the speed range.

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
from `v_max` itself). Near `v = k`, `x = 20·(v/k − 0.95) ≈ 1 − 20ε/k`, so
with the corrected `f(v) = x²`:

```
f(v)   ≈ 1 − 40ε/k        (for small ε)
1−f(v) ≈ 40ε/k
```

(The squared formula decays 4× steeper right at the cap than the old
square-root one would have — `d(x²)/dx` at `x=1` is `2`, versus `d(√x)/dx`
there being `0.5` — but the shape of the conclusion below is unchanged
either way, since both are smooth with a nonzero derivative at `x = 1`.)

So `a = a_raw·(1 − f)` decays **linearly** in `(k − v)` as `v → k`. Plugging
into `dv/dt = a` gives `dε/dt ≈ −C·ε`, i.e. **exponential relaxation**:
`v` approaches `k` asymptotically and never reaches it in finite time.
`v_max` itself sits a fixed `0.136 m/s` below that true asymptote — always,
regardless of the vehicle's actual speed — so for a fast train that's a
tiny relative gap (0.16% for a 300 km/h train) and the final approach to
`v_max` crawls.

**This asymptotic-crawl picture is itself not what the captures show,
independent of the exponent fix** — see "Confirmed NOT matching the
formula" above: real vehicles hit a hard, exact cap at `v_max` and stop,
they don't keep asymptotically creeping toward `k`. The reasoning here
describes the model's own idealized behavior, not confirmed in-game
behavior at the very top of the speed range.

Running the direct simulation for the Avelia Liberty example: the source
article's own table ([acceleration.md](acceleration.md)) reports "Time 95%
to v_max: predicted 37 s, observed 68 s" — both **past the 95% mark**
(`t_95 ≈ 329 s`), not from a standing start, so the observed milestone is
`t_95 + 68 s ≈ 397 s` total. At that point the train has only reached
**299.70 km/h — 99.90% of its 300 km/h top speed**, not the mathematically
exact value — displayed speed doesn't read exactly 300.000 km/h until
`t_95 + 78 s`. This is consistent with "68 s" being where a human observer
judged the vehicle had visually stopped accelerating, not a measurement of
convergence to `v_max` — i.e. the formula isn't wrong, the old manual
measurement just wasn't measuring what it was assumed to be measuring.

**Implication for this app:** "time/distance to exact top speed" is a
legitimate, accurately-simulated number now (not a fitted approximation),
but it will *look* large for fast vehicles precisely because of the
asymptotic tail — that's expected behavior, not a bug. The app also shows
time/distance to 95% of top speed alongside it, which is a more
"practical" milestone unaffected by the tail.

## Precision validation (tf2-watcher, in-game captures)

Supersedes the manual-measurement caveat above for the taper zone
specifically: `../tf2-watcher` (a sibling project) captures real in-game
`(time, speed, acceleration)` traces directly from the engine's own
`MOVE_PATH.dyn` state at the simulation's own ~5 Hz tick rate — not manual
speedometer/ruler reading. Two full 0→top-speed captures exist so far,
both from a standing start on a flat, straight track: Russian Class CHS4
(wagon-limited, effective top speed 120 km/h) and Russian Class VL80S
(loco-limited, effective top speed 110 km/h, otherwise identical consist).

**Confirmed matching the formula, essentially exactly:**
- Force-limited and power-limited phases (`v_0` through `v_95`): predicted
  acceleration matches observed to within ~0.1–1% at almost every sampled
  point on both vehicles (mean absolute error ≈0.003 m/s²).
- The `v_95` onset point itself: the real acceleration curve visibly
  steepens right at `0.95·(v_max/3.6 + 0.136)` on both vehicles (CHS4:
  ≈31.8 m/s; VL80S: ≈29.16 m/s) — within a tick or two of the predicted
  value in both cases.

**Confirmed NOT matching the formula (as it stood — see "Resolved" below):**
- The taper zone's decay *rate* (`v_95 → v_max`). Real acceleration
  exceeded the formula's prediction at every single sampled point past
  `v_95`, on both vehicles — not noise, a clean single-peaked discrepancy
  (roughly 100–130% relative error at its worst, around 97% of top speed).
  `f(v) = sqrt(clamp(20·(v/k − 0.95), 0, 1))` did not agree with in-game
  observation in this zone — since fixed, see below.
- The approach to top speed is not the asymptotic crawl toward
  `k = v_max + 0.136` described above. In both captures, `speed` hits a
  hard, exact cap at `v_max` (float32-identical across 100+ consecutive
  ticks) and stops — it does not keep creeping toward `k`. `accel` doesn't
  reach zero either; it freezes at a small nonzero residual (different
  between the two vehicles) the instant the cap engages, rather than
  decaying to zero the way the formula's asymptotic framing implies it
  should.

Raw captures: `../tf2-watcher/tests/CHS4.csv`, `../tf2-watcher/tests/VL80S.csv`.

### Resolved: the exponent, not the constant

An earlier pass here tried refitting just the multiplier `N` in
`f(v) = sqrt(clamp(N·(v/k − 0.95), 0, 1))` (documented `N = 20`) and found
CHS4's best fit around `N ≈ 7.25`, VL80S's around `N ≈ 6.75` — a real
improvement (RMSE roughly halved on both) but not a clean one: at that
`N` the curve still visibly undershoots early in the taper zone and
overshoots late, a different-shaped residual than `N = 20`'s, not a flat
improvement to zero. That's because `N` was the wrong knob.

Freeing the *exponent* instead — `f(v) = clamp(N·(v/k − 0.95), 0, 1) ^ p`,
searching `N` and `p` jointly — resolves it. Both captures, fit
independently, converge on essentially the same answer: `N ≈ 20` (the
*documented* value, unchanged) and `p ≈ 2.1`. Fixing `p = 2` exactly (not
re-fitting, just checking) still lands within noise of the best possible
fit on both vehicles:

```
f(v) = clamp(20·(v/k − 0.95), 0, 1)²        # squared, not square-rooted
```

| | CHS4 | VL80S | (pre-95% zone, for scale) |
|---|---|---|---|
| RMSE, current (`sqrt`) | 0.050 m/s² | 0.069 m/s² | — |
| RMSE, corrected (`²`) | 0.0015 m/s² | 0.0033 m/s² | 0.0018 / 0.0076 m/s² |

The corrected formula's taper-zone error is now in the same range as the
already-trusted pre-95% zone, on both vehicles — not just "better," but
essentially exact. `sqrt(x)` rises steeply the instant `x` leaves 0, which
is why the current formula over-tapers immediately past `v_95`; `x²` rises
slowly at first and steeply only near `x = 1`, matching the observed shape
(taper barely noticeable just past `v_95`, then falls off hard approaching
the cap) far better than either a bare square root or a rescaled one ever
could.

Train mass for this analysis (not logged by the capture — only locomotive
type is known, not the wagon consist) is back-solved from each capture's
own flat force-limited plateau at the very start of the run:
`a₀ = F/m − g·C`, so `m = F / (a₀ + g·C)` directly, no consist guess
needed. With that derived mass, the pre-95% zone matches the *un-tapered*
formula almost exactly (mean absolute error <0.003 m/s² on both vehicles)
— confirming the mass is sound before trusting anything built on top of
it in the taper zone.

**Applied to `js/physics.js`** (`taperFactor()`) — this was a strong,
cross-validated result on the only two captures available, but still just
two vehicles; worth re-checking as more captures come in.

## Open questions / not yet modeled

- The hard cap at `v_max` (see "Confirmed NOT matching the formula" above)
  — the model still assumes an asymptotic crawl toward
  `k = v_max + 0.136` that the captures don't show. Separate from the
  exponent fix above and still unresolved.

- Gradient (slope) resistance — not curves, which aren't a resistance
  mechanic in-game, only a speed-limit one. On a slope, gravity is no
  longer orthogonal to the direction of travel, so it contributes a
  resistance/assist term, and rolling resistance presumably scales with
  the (now slightly reduced) normal force too. Not modeled; low priority.
- Braking (only acceleration is modeled here).
- Non-zero `V_0` distance accuracy (see Phase 1 caveat).
- Non-rail vehicle types (road/air/water use different propulsion/resistance
  models — see [TODO.md](../TODO.md)).

## Sources

- Prose explanation & derivation notes: [acceleration.md](acceleration.md)
- Live formula model: <https://www.desmos.com/calculator/pzhondtwrd>
- Taper-factor-only visualization: <https://www.desmos.com/calculator/gpt6bqm9z6>
