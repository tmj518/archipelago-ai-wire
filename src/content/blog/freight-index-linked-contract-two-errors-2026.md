---
title: "An Index-Linked Freight Clause Has Two Ways to Be Wrong, and They Are Independent"
subtitle: "Index-linked container freight contracts and the 2026 CCFI SCFI divergence: which series the clause names, and whether the index already holds the surcharge"
description: "In the week to 30 September the CCFI composite moved 0.3% while its Southeast Asia lane rose 9.1% and Europe fell 2.9%. On a $900 container the wrong series hides $78.97. The second error is whether the index already includes the surcharge you are being billed for."
publishDate: 2026-10-07
reviewBy: 2027-01-31
stakes: priced
category: "logistics"
audience: "importer"
tags: ["container freight", "CCFI", "SCFI", "index-linked contract", "BAF", "surcharge"]
priority: "P0"
featured: false
draft: false
articleNumber: 18
target_keyword: "CCFI SCFI index-linked freight surcharge clause which series"
search_intent: "informational"
information_gain: "custom-calculation"
figures:
  - value: "1322.15"
    unit: "CCFI Southeast Asia Service index points, previous reading 1211.87"
    period: "week ending 30 September 2026, a rise of 9.1 per cent"
    source: "Shanghai Shipping Research Institute, CCFI index page"
    retrieved: "2026-10-07"
  - value: "1970.38"
    unit: "CCFI Europe Service index points, previous reading 2028.95"
    period: "week ending 30 September 2026, a fall of 2.9 per cent"
    source: "Shanghai Shipping Research Institute, CCFI index page"
    retrieved: "2026-10-07"
  - value: "1923.93"
    unit: "CCFI composite index points, previous reading 1917.68"
    period: "week ending 30 September 2026, a rise of 0.33 per cent"
    source: "Shanghai Shipping Research Institute, CCFI index page"
    retrieved: "2026-10-07"
  - value: "8.77"
    unit: "percentage points of difference between the Southeast Asia lane reading and the composite in the same week"
    period: "week ending 30 September 2026"
    source: "Landed Math freight-index model, freightAdjustment()"
    retrieved: "2026-10-07"
  - value: "78.97"
    unit: "US dollars per container at a 900-dollar base — what the composite-based clause fails to see against the lane"
    period: "week ending 30 September 2026"
    source: "Landed Math freight-index model"
    retrieved: "2026-10-07"
  - value: "7"
    unit: "container indices whose compiling and publishing body changed on 18 June 2026"
    period: "effective 18:00 on 18 June 2026"
    source: "Shanghai Shipping Exchange announcement on the transfer of index compilation"
    retrieved: "2026-10-07"
  - value: "15"
    unit: "individual routes in the SCFI composite, weighted; the CCFI composite covers national export container transport"
    period: "methodology as published by the Shanghai Shipping Exchange"
    source: "Shanghai Shipping Exchange, freight index methodology and FAQ"
    retrieved: "2026-10-07"
  - value: "1 August 2026 to 31 January 2027"
    unit: "six-month extension of Suez Canal Periodical No. 1 of 2026, all vessel types"
    period: "circular dated 7 September 2026 — routing cost rather than index composition"
    source: "Suez Canal Authority, Periodical No. 28 of 2026"
    retrieved: "2026-10-07"
sources:
  - "Shanghai Shipping Exchange, freight index methodology and FAQ, including the SCFI surcharge definition"
  - "Shanghai Shipping Research Institute, CCFI and SCFI index pages, week ending 30 September 2026"
  - "Shanghai Shipping Exchange announcement of 18 June 2026 on transfer of index compilation"
  - "Suez Canal Authority, Periodical No. 28 of 2026"
  - "Landed Math freight-index model, freightAdjustment()"
  - "HFW client advisory, quoted in trade press, on index composition differences"
---

## AI Summary

An index-linked freight clause can be wrong two ways: it names a composite index when your cost is one lane, and it assumes the index excludes a surcharge the index contains. In the week to 30 September the CCFI composite moved 0.3 per cent while its Southeast Asia lane rose 9.1 per cent. Two errors, not one error twice.

## What happened

Two things about container freight indices changed in 2026, and each creates a separate way for a clause to misfire.

**The publishing body moved.** Seven container indices transferred their compilation and release from the Shanghai Shipping Exchange to a new institute, effective 18:00 on 18 June 2026, as [the publisher change analysis](/blog/container-freight-index-publisher-change-2026/) sets out. Any surcharge formula that names an index now names an index published by a different body, on the same values.

**And the lanes diverged hard.** In the week ending 30 September 2026 the CCFI composite sat at 1923.93, up 0.33 per cent. Underneath it, the Southeast Asia Service rose 9.1 per cent to 1322.15 and the Europe Service fell 2.9 per cent to 1970.38. The same week shows up in the origin-data rules for RCEP shipments, covered in [the electronic origin data analysis](/blog/china-malaysia-origin-data-electronic-december-2026/), because a certificate that fails at the border and a surcharge that misreads a lane are both paperwork problems with a price.

The two are the same event seen from different places. A composite is a weighted average of its routes, so it moves least exactly when the lanes move most in opposite directions. That week the lanes cancelled each other out almost perfectly: eight point seven seven percentage points of divergence between the lane and the composite, producing a composite reading that describes no route in the index.

> **A composite is not a summary of its lanes. It is a weighted mean, and a mean of opposing numbers sits nearer zero than either of them.** When a contract's surcharge tracks the composite, the clause is most wrong in precisely the weeks when freight is most volatile.

## Why now

Because the surcharge question became urgent for a reason that has nothing to do with price levels.

Index-linked contracts came under scrutiny in 2026 over emergency bunker surcharges, with shippers arguing that a carrier cannot levy an emergency BAF on top of an index-linked rate when the index already contains fuel components. Trade press reports the argument, and a law firm advisory quoted in it makes the composition point directly: the SCFI explicitly includes BAF, FAF and other seaborne surcharges in its cumulative rate calculation, and indices do not all treat those components the same way.

The Shanghai Shipping Exchange's own methodology confirms the SCFI side of that. Individual SCFI route rates are the average all-in price, considering spot ocean freight **and** seaborne surcharges, which include:

- Bunker Adjustment Factor / Fuel Adjustment Factor / Low Sulphur Surcharge
- Emergency Bunker Surcharge
- Currency Adjustment Factor
- Peak Season Surcharge
- **War Risk Surcharge**
- Port Congestion Surcharge
- Suez and Panama canal fees

Landside charges are excluded: terminal handling at either end, security surcharges, origin surcharges, customs declaration fees, inland on-carriage.

**So on the SCFI side, an emergency bunker surcharge billed on top of an index-linked rate is billing for something the index already contains.** Whether the same is true of the CCFI is a question primary sources did not settle for me, and it is the first thing to check in a contract that names it.

## So what

The two failure modes are independent, and a clause can get one right and the other wrong.

| Question | Wrong answer | What it costs |
| --- | --- | --- |
| Which series does the clause name? | A composite when your cost is one lane | $78.97 per container on a $900 base, in the week to 30 September |
| Does the index already contain the surcharge? | Assuming it excludes what it includes, and paying again | The whole surcharge, charged twice |
| Do both apply to you? | Either can apply without the other | Independent errors, not one bigger error |

Three things follow.

**Getting the series right does not protect you on composition, and the reverse.** A contract that names a lane series correctly can still be double-charged if the lane series is all-in and the carrier also bills a bunker surcharge. A contract that correctly assumes an all-in index can still be mis-indexed if it points at the composite rather than the lane.

**The composite error is directional and measurable, and it does not always favour the carrier.** In the week to 30 September the composite understated the Southeast Asia lane by 8.77 points, so a composite-linked clause underpaid that lane by $78.97 on a $900 base. It also *overstated* nothing on Europe, where the lane fell 2.9 per cent and the composite rose — so a composite-linked clause overpaid a lane that had gone down. The same clause was wrong in opposite directions on two routes at once.

**And the timing of the divergence is not random.** Lanes diverge when the drivers are route-specific: canal transit costs, regional congestion, war risk on one corridor and not another. The Suez Canal Authority extended its periodical terms for six months from 1 August 2026 to 31 January 2027, which affects routing cost on Asia-Europe and not on intra-Asia trades. Route-specific causes produce route-specific moves, which is the condition under which a composite is least informative.

> Work it out: [the landed cost calculator](/calculator/)

> Different question, same method: [the step-by-step guides](/guide/)

## For you

- **Anyone with a surcharge clause naming the CCFI composite:** check whether your cargo is one lane. If it is, the composite is a weighted mean across routes you do not ship on, and in the week to 30 September it was 8.77 points away from the Southeast Asia lane. Ask for the lane series and compare a year of both before conceding the point.
- **Anyone being billed a bunker or emergency surcharge on top of an index-linked rate:** check the index's own definition before arguing. The SCFI methodology states that seaborne surcharges including BAF, emergency bunker and war risk are inside the all-in route rate. For the CCFI, get the definition in writing, because primary sources did not settle it for me and the answer decides whether the charge has grounds.
- **Anyone with an Asia-Europe and an intra-Asia book:** do not assume one clause behaves the same on both. In that single week the composite overpaid a falling lane and underpaid a rising one, so a composite-linked formula can be generous on one route and punitive on the other in the same month.
- **Anyone renewing for 2027:** the Suez terms currently run to 31 January 2027, and canal terms drive routing cost on Europe trades specifically. That is a route-specific input, which means it widens lane divergence rather than moving the composite.

## The data point

<div class="callout">
<span class="callout-label">Data point</span>

**Eight point seven seven percentage points**: the gap in the week ending 30 September 2026 between the CCFI Southeast Asia Service (+9.1%) and the CCFI composite (+0.33%). On a **$900** container that is **$78.97** the composite-based clause never sees, in the same week that the same composite rose while the Europe lane fell 2.9 per cent.

</div>

## How we calculated this

Index points are not currency, so the conversion needs a stated freight cost. The index readings are sourced; the per-container cost is your contract, and it is the only input needed.

```text
adjustment per container = freight per container x index move
+$81.90 = $900 x 9.10%     (Southeast Asia lane, week to 30 September)
+$2.93  = $900 x 0.33%     (CCFI composite, same week)
$78.97  = the difference   (8.77 points of divergence)

-$69.28 = $2,400 x -2.89%  (Europe lane, same week, opposite direction)
```

Substitute your own contract rate. Then check the second question separately, because it is not arithmetic: read the index's published definition and confirm whether the surcharge you are being billed for sits inside the all-in route rate or outside it.

## The point

An index-linked freight clause is two decisions wearing one sentence. The first is which number to follow, and the arithmetic for that is straightforward: a composite is a weighted mean, a mean of opposite moves lands near zero, and the lanes that diverge are the lanes with route-specific drivers. That error is measurable and, as the week to 30 September shows, it runs in whichever direction the divergence happens to take — underpayment on the rising lane, overpayment on the falling one.

The second decision is whether the index already contains the surcharge the carrier is separately billing. That one is not arithmetic at all. The SCFI definition published by the exchange lists bunker, emergency bunker and war risk components inside the all-in route rate, with landside charges outside it. The same exchange publishes the CCFI on a different basis — national rather than Shanghai-only, contract as well as spot — and whether its route rates are equally all-in is the question a shipper has to resolve before accepting or rejecting a surcharge demand.

The two errors do not substitute for each other. A clause can name the perfect series and still be double-charged, or assume an all-in index correctly and follow the wrong number.

## FAQ

### Why did the freight indices change publisher in 2026?

Seven container indices transferred their compilation and release from the Shanghai Shipping Exchange to a new institute, effective 18:00 on 18 June 2026. The announcement is the exchange's own. For a contract the practical consequence is that the entity named in a surcharge clause is no longer the entity publishing the number, while the values continued under the new body — so a clause naming the old publisher needs checking rather than being treated as lapsed.

### Does the CCFI composite represent the Southeast Asia lane?

No, and the week ending 30 September 2026 shows how far apart they can be. The composite moved 0.33 per cent to 1923.93 while the Southeast Asia Service rose 9.1 per cent to 1322.15 and the Europe Service fell 2.9 per cent to 1970.38. A composite is a weighted mean of its routes, and a mean of moves in opposite directions sits near zero. The divergence that week was 8.77 percentage points, which on a $900 container is $78.97.

### Does the SCFI include bunker and war risk surcharges?

Yes, according to the Shanghai Shipping Exchange's published methodology. Individual SCFI route rates are described as the average all-in price covering spot ocean freight and related seaborne surcharges, and the list includes Bunker Adjustment Factor, Fuel Adjustment Factor, Low Sulphur Surcharge, Emergency Bunker Surcharge, Currency Adjustment Factor, Peak Season Surcharge, War Risk Surcharge, Port Congestion Surcharge and canal fees. Landside items such as terminal handling, security surcharges and inland on-carriage are excluded.

### Does the CCFI include them as well?

That is the question primary sources did not settle for me, and it is the one to settle before accepting or rejecting a surcharge demand on a CCFI-linked contract. The exchange publishes the two indices on different bases — SCFI covers Shanghai export spot rates across fifteen weighted routes, while CCFI covers national export container transport including contractual as well as spot rates — and the published SCFI definition does not establish the CCFI's. Get the definition in writing from the index publisher or the carrier rather than inferring it from the other index.
