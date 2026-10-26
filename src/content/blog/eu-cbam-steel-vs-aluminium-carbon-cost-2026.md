---
title: "Two EU Charges Reach Steel and Only One Reaches Aluminium, and That Reverses the Ranking"
subtitle: "CBAM costs EUR 981.88 a tonne on Chinese aluminium against EUR 163.53 on steel, but the 50 per cent steel quota duty reaches steel alone"
description: "The EU applies a carbon charge to both metals and a 50 per cent quota duty to steel alone. On Chinese goods that reverses which material looks expensive, and the crossing point is a single CIF value you can work out."
publishDate: 2026-10-07
reviewBy: 2027-03-31
stakes: priced
category: "sourcing"
audience: "importer"
tags: ["cbam", "steel safeguard", "aluminium", "eu tariff rate quota", "carbon cost", "landed cost"]
priority: "P0"
featured: false
draft: false
articleNumber: 19
target_keyword: "CBAM aluminium versus steel cost per tonne EU 2026"
search_intent: "informational"
information_gain: "custom-calculation"
figures:
  - value: "981.88"
    unit: "EUR per tonne — CBAM cost on Chinese unwrought aluminium, CN 7601, at the Q1 2026 certificate price"
    period: "2026 declaration year, Q1 2026 certificate price of EUR 75.36 per tCO2e"
    source: "Landed Math CBAM model, from corrected Annex I to Regulation (EU) 2026/1740 and the Commission's published certificate price"
    retrieved: "2026-10-07"
  - value: "163.53"
    unit: "EUR per tonne — CBAM cost on Chinese hot-rolled coil, CN 7208, at the same certificate price"
    period: "2026 declaration year, Q1 2026 certificate price"
    source: "Landed Math CBAM model"
    retrieved: "2026-10-07"
  - value: "968.45"
    unit: "EUR per tonne — the lowest CBAM cost across the eight Chinese aluminium lines in the model"
    period: "2026 declaration year, Q1 2026 certificate price"
    source: "Landed Math CBAM model, aluminium lines 7601, 7603, 7604 10 10, 7605, 7606, 7607, 7608, 7610 10 00"
    retrieved: "2026-10-07"
  - value: "100.11"
    unit: "EUR per tonne — the lowest CBAM cost across the fifteen Chinese steel lines in the model"
    period: "2026 declaration year, Q1 2026 certificate price"
    source: "Landed Math CBAM model"
    retrieved: "2026-10-07"
  - value: "50"
    unit: "per cent ad valorem — the EU steel out-of-quota duty, doubled from 25 per cent"
    period: "from 1 July 2026, on covered steel categories"
    source: "Regulation (EU) 2026/1384, recital 16"
    retrieved: "2026-10-07"
  - value: "26"
    unit: "steel product categories covered by the tariff-rate quotas"
    period: "quota year 1 July 2026 to 30 June 2027"
    source: "Commission Implementing Regulation (EU) 2026/1457, recital 1"
    retrieved: "2026-10-07"
  - value: "327.06"
    unit: "EUR per tonne of CIF value — the point at which the 50 per cent quota duty on hot-rolled coil equals its CBAM charge"
    period: "2026, at the Q1 2026 certificate price"
    source: "Landed Math comparison of the CBAM model against the safeguard rate"
    retrieved: "2026-10-07"
  - value: "4.76"
    unit: "ratio of the average CBAM cost on the eight Chinese aluminium lines to the average across the fifteen steel lines"
    period: "2026 declaration year, Q1 2026 certificate price"
    source: "Landed Math CBAM model"
    retrieved: "2026-10-07"
sources:
  - "Commission Implementing Regulation (EU) 2026/1740, corrected Annex I, China default values"
  - "Commission Implementing Regulation (EU) 2025/2620, Annex point 5, benchmarks"
  - "Regulation (EU) 2026/1384, recital 16, the out-of-quota duty raised to 50 per cent"
  - "Commission Implementing Regulation (EU) 2026/1457, recital 1 and Annex I, the allocation table"
  - "Regulation (EU) 2023/956 as amended, Article 21(1a), the certificate price for the quarter of importation"
  - "European Commission, DG TAXUD, Price of CBAM certificates, retrieved 3 October 2026"
  - "Landed Math CBAM model, src/lib/cbam.mjs, and the public calculator"
---

## AI Summary

CBAM costs EUR 981.88 a tonne on Chinese unwrought aluminium and EUR 163.53 on hot-rolled coil. But the EU steel safeguard's 50 per cent quota duty reaches steel and not aluminium, so above a CIF of EUR 327 a tonne the quota duty is the larger charge on steel. Which metal looks expensive depends on which instrument reaches it.

## What happened

Two EU instruments both land on imported metal in 2026, and they do not cover the same goods.

**CBAM covers iron, steel and aluminium.** On Chinese material the certificate cost per tonne runs from **EUR 100.11** on the cheapest steel line in our model to **EUR 981.88** on unwrought aluminium, at the Q1 2026 certificate price of EUR 75.36 per tonne of CO2e. The full chain behind those figures, code by code, is worked through in [the CBAM cost per tonne analysis](/blog/eu-cbam-cost-per-tonne-chinese-steel-aluminium-2026/).

**The steel safeguard covers steel.** Regulation (EU) 2026/1384 raised the out-of-quota duty to **50 per cent ad valorem** from 25 per cent, across **26 product categories** whose tariff-rate quotas total 18,345,922 tonnes, as set out in [the steel quota analysis](/blog/eu-steel-safeguard-quota-2026-chinese-hrc-cost/). Aluminium is not among them.

That asymmetry decides the answer, and it decides it in opposite directions for the two metals.

> **The two instruments do not compete. They overlap on steel and stand alone on aluminium.** A steel importer faces both and an aluminium importer faces one, so comparing the headline carbon figures answers the wrong question.

## Why now

Because the duty was doubled six weeks ago and the crossing point is a single number, so the ranking is not a matter of opinion.

At any given CIF value, the quota duty on covered steel is half of it. CBAM on hot-rolled coil is EUR 163.53 a tonne and does not vary with the goods value, because it is charged on emissions rather than on price.

```
quota duty  = CIF x 50%
CBAM        = EUR 163.53 per tonne, fixed for the year at a given certificate price

they are equal when CIF x 50% = 163.53
                    CIF      = EUR 327.06 per tonne
```

**Below EUR 327 a tonne of CIF, the carbon charge is the larger of the two. Above it, the quota duty is** — and everything imported at a normal CIF sits above it.

**And the doubling itself is a comparable number to the carbon charge.** At CIF EUR 700, moving the quota duty from 25 to 50 per cent added **EUR 175** a tonne. CBAM on the same steel is **EUR 163.53**. The increase alone is 1.07 times the entire carbon charge.

## So what

Put both instruments on one page, at one CIF value, and the asymmetry is the whole story.

| CIF per tonne | Quota duty at 50% | CBAM on hot-rolled coil | Which is larger |
| --- | --- | --- | --- |
| EUR 300 | EUR 150.00 | EUR 163.53 | **CBAM** |
| EUR 400 | EUR 200.00 | EUR 163.53 | quota duty, 1.22x |
| EUR 700 | EUR 350.00 | EUR 163.53 | quota duty, 2.14x |
| EUR 1,000 | EUR 500.00 | EUR 163.53 | quota duty, 3.06x |

Three things follow.

**For steel, the carbon charge is usually the smaller of the two, and by a widening margin as value rises.** A buyer who has modelled CBAM and not the quota duty has modelled the smaller number. That is the same failure shape as the rest of this site's articles — one layer missing from the model — but here the missing layer is the one that scales with price while the one that is present does not.

**For aluminium the position is the reverse, and the magnitude is different.** No safeguard quota applies, so CBAM is the only one of the two, and it is **EUR 981.88 a tonne on unwrought aluminium at CIF EUR 700** — 140 per cent of the goods value. On steel at the same CIF, quota duty and CBAM together come to **EUR 513.53**, or 73 per cent of goods value.

**And the aluminium number does not vary with the goods value, which makes it more dangerous at the cheap end.** A fixed EUR 981.88 per tonne is a rounding error on high-value aluminium and a prohibitive one on low-value aluminium. The steel quota duty does the opposite: it shrinks as a share of value the cheaper the goods get, because it is ad valorem.

**The ranking between the two metals is not stable over time either.** Holding the certificate price flat, the aluminium-to-steel CBAM ratio falls from 6.00x in 2026 to 4.11x in 2034, because both materials' benchmarks are deducted on the same schedule while the phase-out moves the base. The gap narrows without the ranking flipping, over the years the free-allocation adjustment runs to zero.

> Also read: [China Cut the Refund on Finished Goods and Added a Tax on Raw Metal](/blog/china-export-rebate-vs-export-duty-2026/)

> Work it out: [the landed cost calculator](/calculator/)

> Different question, same method: [the step-by-step guides](/guide/)

## For you

- **Importing steel into the EU:** work out which category your goods sit in before anything else, because the duty applies per category and the quota is allocated per category and origin. Then compute both charges. On hot-rolled coil the quota duty is the larger one above a CIF of EUR 327 a tonne, which is almost every real shipment.
- **Importing aluminium into the EU:** CBAM is the only one of the two, it is a fixed amount per tonne rather than a percentage, and on unwrought aluminium it exceeds the goods value at a CIF of EUR 700. There is no quota to claim a place in, so there is no duty-free window to time an entry against.
- **Deciding between the two metals for a component:** the comparison is not the carbon intensity of the material. Steel carries two instruments and aluminium carries one, and the crossing point between steel's two is a single CIF value you can calculate for your own line.
- **Anyone modelling EU metal costs from the headline rate:** the 50 per cent figure and the carbon price are the two numbers most often quoted in coverage of this reform, and neither is the one that decides your cost. For steel the deciding question is the category and whether your origin holds an allocation in it; for aluminium it is the CN code's default emissions value.

## The data point

<div class="callout">
<span class="callout-label">Data point</span>

**EUR 981.88 against EUR 163.53.** CBAM costs six times more per tonne on Chinese unwrought aluminium than on hot-rolled coil, at the same certificate price and the same year. But **EUR 175** — the increase in the steel quota duty from doubling it at a CIF of EUR 700 — is larger than the entire CBAM charge on that steel. The metal that looks expensive on carbon is not the one carrying the larger total.

</div>

## How we calculated this

Both charges use the same model. CBAM is emissions multiplied by a published certificate price. The quota duty is a percentage of customs value.

```text
CBAM per tonne = chargeable emissions x certificate price
981.88 EUR/t   = 13.02918 tCO2eq/t x 75.36 EUR/tCO2e     (CN 7601, unwrought aluminium)
163.53 EUR/t   =  2.16995 tCO2eq/t x 75.36 EUR/tCO2e     (CN 7208, hot-rolled coil)

chargeable emissions = (default value x (1 + mark-up)) - (benchmark x CBAM factor)
13.02918 tCO2eq/t    = (13.106 x 1.1) - (1.423 x 0.975)   (aluminium, 2026)
 2.16995 tCO2eq/t    = (3.187 x 1.1) - (1.370 x 0.975)    (steel, 2026)

quota duty     = CIF x 50%
crossing point = CBAM per tonne / 50%
327.06 EUR/t   = 163.53 / 0.5                              (hot-rolled coil, 2026)
```

Substitute your own CIF and your own CN code. The emissions figures are published defaults, so the only input is the code; the crossing point moves with the CBAM charge, so it changes by code and rises as the free-allocation adjustment phases out.

## The point

The EU charges both metals for carbon and charges steel alone for quota overhang, and the second instrument is the one that decides which metal looks expensive. On carbon alone, Chinese unwrought aluminium costs six times what hot-rolled coil costs a tonne. Add the 50 per cent quota duty that reaches steel and not aluminium, and above a CIF of EUR 327 the steel importer is paying more than the carbon charge on the same tonne.

The two figures most often quoted about this — the 50 per cent rate and the certificate price — are the two that decide the least. What decides a steel importer's cost is which of the 26 categories the goods sit in and whether the origin holds a named allocation there. What decides an aluminium importer's cost is the default emissions value attached to the CN code, which at the Q1 2026 price puts EUR 981.88 a tonne on unwrought aluminium regardless of what it is worth.

## FAQ

### Does CBAM apply to both steel and aluminium?

Yes. CBAM covers iron, steel and aluminium among its sectors, so both metals carry a carbon charge on import into the EU. What differs is the amount, which follows the default emissions value for the CN code and the country of origin rather than anything about the material in the abstract. Chinese unwrought aluminium carries a default of 13.106 tonnes of CO2e per tonne of goods, while hot-rolled coil carries 3.187, and that fourfold gap is what produces the per-tonne difference. In our model the cost runs from EUR 100.11 on the cheapest Chinese steel line to EUR 981.88 on unwrought aluminium, both at the Q1 2026 certificate price of EUR 75.36 per tonne of CO2e.

### Does the steel safeguard apply to aluminium?

The safeguard covers steel product categories: Regulation (EU) 2026/1384 and the allocation regulation that follows it set tariff-rate quotas across 26 product categories, and aluminium goods are not among the categories as published. That is our reading of the instruments and it is the basis of the comparison here, but we have not read the definition of each of the 26 categories line by line, so if your product sits near the boundary, check the category definitions in the allocation regulation's annex rather than relying on this.

### Which charge is larger on Chinese steel?

It depends on the CIF value, because one charge is ad valorem and the other is not. The quota duty is 50 per cent of customs value; CBAM on hot-rolled coil is EUR 163.53 a tonne at the Q1 2026 certificate price. They are equal at a CIF of EUR 327.06 a tonne, so below that the carbon charge is larger and above it the quota duty is. Real shipments sit above it: at CIF EUR 700 the quota duty is EUR 350 against EUR 163.53.

### How much did doubling the quota duty add?

At a CIF of EUR 700 a tonne, moving the out-of-quota duty from 25 to 50 per cent added EUR 175 a tonne. That increase on its own is larger than the entire CBAM charge on the same hot-rolled coil, which is EUR 163.53 at the Q1 2026 certificate price. At a CIF of EUR 500 the increase is EUR 125, which is smaller than the carbon charge, so whether the doubling exceeds CBAM depends on the goods value in the same way the total charge does. The rate was raised by Regulation (EU) 2026/1384, whose recital 16 gives the reason as reducing the risk of trade diversion, and recital 17 confirms the duty sits on top of other duties already applying to the same categories.

### Why does the aluminium figure not change with the goods value?

Because CBAM is charged on emissions, not on price. The chargeable emissions for a CN code are a fixed number of tonnes of CO2e per tonne of goods, multiplied by the certificate price for the quarter of importation. So the charge is a fixed amount per tonne regardless of what the goods cost, which makes it proportionally more punishing the cheaper the goods are — the opposite of an ad valorem duty. At a CIF of EUR 700 the EUR 981.88 on unwrought aluminium is 140 per cent of the goods value; on goods worth EUR 2,000 the same charge is 49 per cent. The steel quota duty behaves in the reverse way, since 50 per cent is 50 per cent whatever the goods are worth.
