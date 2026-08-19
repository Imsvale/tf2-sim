# Company Mode / Line Manager — design discussion (not yet built)

Working notes from an ongoing design conversation, not a spec — the vision
is still coagulating (the user's own words), and part of settling it is
prototyping and seeing how it feels in use. Captured here so it survives
across sessions instead of living only in chat history. Supersedes nothing
in `TODO.md`; that file's own entry links here for the detail.

## The mode split

Two modes, not two products:

- **Simple/Basic mode** (name TBD): today's app as it already exists —
  Trains, Physics, Route, Finances. A single implicit route/line, no
  company wrapper, no loan. This is *not* a new restricted view to build;
  it's what's already here before Company entered the picture.
- **Advanced/Extended mode** (name TBD — deliberately *not* "Company
  mode," to avoid colliding with the "Company" tab living inside it,
  since the mode restructures every tab, not just adds one): unlocks the
  Line Manager and full company finances. The current "Company" tab
  concept becomes a mode, not a tab.

The mode toggle itself (hide/show the extra tabs) is cheap and separable
from the reorganization below — it doesn't need to wait on the data model
actually changing.

## Route → Line

`Route` generalizes into `Line` — the same stations/legs/load-factor
shape, but reusable: multiple lines can exist, and (important) **multiple
lines can share the same physical infrastructure** (track/stations). This
is *why* infrastructure cost is a company-level concept, not a per-line
one — it can't be attributed to a single line.

**Line Manager** is the tab that owns this: create/edit lines, assign
vehicles to them.

## Finance, three tiers

- **Vehicle**: that vehicle's own revenue and maintenance only.
- **Line**: the above, summed across every vehicle assigned to the line.
- **Company**: every line, plus costs that aren't attributable to any one
  line — infrastructure maintenance (see below) and loan interest.

## Infrastructure cost

- **10% of purchase price, per annum** (parallel to vehicle maintenance's
  own 1/6 = ~16.7%/year, per `docs/cost_formulas.md` — infrastructure is
  cheaper to maintain than rolling stock, per unit spent).
- The user provides a lump infrastructure spend during initial setup.
  This comes out of the starting loan+cash pool as setup expenditure,
  *before* any vehicle purchase — so it reduces what's left for buying
  the first line's vehicles, rather than being a separate budget.
- **Open question, not yet resolved:** is infrastructure spend a one-time
  thing at company setup, or can it recur when a *new* line requires
  extending track/stations into new territory? Leaning toward "can
  recur," but not settled.

## Vehicle purchases: budget-driven, not count-driven

Today's Company tab has the user type an explicit starting wagon count.
The new model **inverts that**: given a locomotive and wagon choice, the
wagon count *emerges* from whatever budget is left after infrastructure
spend — you don't typically state a number, the number falls out of
"spend what's left on this loco + as many of this wagon as it takes."

This pairs naturally with a real strategic pattern the user described:
start with **one** train (maximally efficient — the fixed cost of a
locomotive is spread over the largest possible revenue base), keep adding
wagons as profit allows (more wagons per locomotive = more revenue for
the same fixed running cost), until a **terrain-driven efficiency
ceiling** is hit — a long/heavy train loses too much speed climbing
grades and starts costing more (time = maintenance) than it earns. That's
the actual signal to buy a *second* train instead of continuing to grow
the first, not an arbitrary cap.

**This has a direct, important consequence for this app's physics
model:** gradient/slope resistance is currently unmodeled
(`TODO.md`'s "Gradient (slope) resistance... not modeled; low priority").
Without it, there is *no* economic reason in the current simulation to
ever prefer a second train over an infinitely-growing first one — more
wagons is strictly better forever on flat ground. If growth strategy is
meant to be an emergent choice the simulation itself can show (not
something hard-coded), gradient modeling may need to move from "low
priority" to "a prerequisite for this specific feature" — flagged, not
decided.

There's also a clean connection to math this app *already has*:
`js/finance.js`'s `breakEvenWagonCount()` (Experimental tab) already
answers "how many wagons until this consist guarantees profit" in closed
form. Worth deciding whether budget-driven purchasing means "spend
everything affordable" or "buy the break-even-safe amount and bank the
rest" as the default reinvestment behavior.

## Vehicle/consist abstraction

Needs generalizing so a consist can be defined once and then be reused,
duplicated, and multiplied — both for "N identical copies on one line"
and for "the same design considered across multiple contexts" (see
Physics below).

## Per-vehicle finance books

Confirmed: **yes, technically per physical vehicle**, even when identical
to its fleet-mates — because maintenance ages from each vehicle's own
purchase date, not a calendar-uniform boundary (open question, marked
below). In the real game each vehicle is independently, physically
simulated (traffic, terrain, obstruction), so identical vehicles on the
same line can genuinely diverge in their actual timings. **This app
explicitly won't simulate that** — no traffic, no obstruction, no
bunching — that's "remaking the simulation part of the game," not this
app's job.

The practical consequence is favorable, not a burden: since none of that
divergence is modeled, every vehicle on a line runs an **identical**
run/dwell timeline (same legs, same load, same physics) — the only thing
that differs between fleet-mates is *when* their timeline started (their
purchase date). So a fleet's books don't need N independent simulations —
one canonical timeline, offset per vehicle by its own start time, is
sufficient. (This is the same "fleet growth is cheap to simulate"
property raised earlier in the chat discussion — confirmed here from a
different angle.)

**Open question, unconfirmed — the user needs to verify this in-game:**
does maintenance actually accrue from each vehicle's own purchase-date
"age," or does it tick on fixed calendar-month boundaries shared by every
vehicle regardless of purchase date? If it's calendar-based, the model
simplifies further: accumulated operational time at the 100% rate plus
parked time at 40%, same for every vehicle, no per-vehicle offset needed
at all.

## Physics stays per-vehicle, with two entry points

Physics is inherently a property of one vehicle/consist configuration —
that doesn't change. Two ways to reach it:

1. From the Line Manager: a button on a line's assigned vehicle opens
   that vehicle's physics metrics directly.
2. A **separate comparison sandbox**, decoupled from any line — for
   comparing two or more vehicle/train configurations purely for
   planning/decision-making, not tied to an assignment. This is
   essentially what today's Trains + Physics tabs *already* do — the
   sandbox isn't new, it's what gets kept as-is when the reorg happens.

## Explicit non-goals

- Real traffic simulation, obstruction, bunching, or per-vehicle timing
  divergence from any of the above.
- Modeling exactly why/when in-game timings fluctuate — this app
  reasons about the theoretical/ideal case throughout, by design.
