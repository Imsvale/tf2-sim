# Revenue Formulas

## Payment per passenger / unit of cargo, per trip leg

```
payment = (300.0 + distance) · basePrice · cargoFactor · 125 / millisPerDay · difficulty
```

| Symbol | Meaning |
|---|---|
| `distance` | station-to-station distance for the leg, **meters, straight-line ("as the crow flies")** |
| `basePrice` | balancing factor per vehicle type, includes top-speed scaling (see below) |
| `cargoFactor` | `1.75` for cargo, `1` for passengers |
| `millisPerDay` | day length in ms; fixed at `2000` in TF2 (TF1 legacy field — no longer affected by date speed; `125/2000 = 1/16`, verified against in-game numbers) |
| `difficulty` | revenue-scaling factor from game difficulty (below) |

## `basePrice` by vehicle type

`top_speed` is in km/h.

| Vehicle type | `basePrice` |
|---|---|
| Road | `top_speed^0.78 + 4` |
| Rail | `top_speed^0.86 + 10` |
| Air | `-2.03e-5 · top_speed^2 + 0.17 · top_speed + 28.36` |
| Water | `0.65 · top_speed` |

## `difficulty` factor

| Difficulty | Percent | Factor |
|---|---|---|
| Easy | 100% | 1.0 |
| Medium | 80% | 0.8 |
| Hard | 60% | 0.6 |
| Very Hard | 40% | 0.4 |

Difficulty modulates **revenue only** — costs (purchase price, maintenance,
loan interest) are unaffected. This matters for the financial simulation
feature (see [TODO.md](../TODO.md)): difficulty should be a single global
multiplier applied at the revenue step, not baked into vehicle data.

## Open questions / not yet modeled

- Maintenance and loan interest: see [cost_formulas.md](cost_formulas.md).
- Loading speed / capacity utilization over time (payment above is per
  unit delivered, not per unit of time — trip frequency and load factor
  still need to be modeled to get a profit-per-time figure).
