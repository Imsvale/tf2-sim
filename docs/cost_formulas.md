# Cost Formulas

## Maintenance

Annual maintenance cost is a fraction of purchase price, scaled by vehicle
state:

```
annual_maintenance = purchasePrice / 6 * stateFactor
```

| State | Factor |
|---|---|
| Operating (driving) | 1.0 |
| Parked in a station | 0.4 |
| Parked in a depot | 0.05–0.10 (not modeled — out of scope, see below) |

`purchasePrice / 6` is the normal-operation annual rate (≈16.7% of price per
year). Depot-parked vehicles aren't relevant to this app's scope, so that
state doesn't need modeling.

## Loan interest

Flat **1% per annum**, charged **monthly** (i.e. simple interest, not
compounding annually — apply `principal * 0.01 / 12` each month).

## Open questions / not yet modeled

- How maintenance state (operating vs. station-parked) is determined for a
  given simulated schedule — needs a trip/route model first.
- Loan repayment schedule / principal paydown mechanics beyond the flat
  interest rate itself.
