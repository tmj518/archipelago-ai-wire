---
title: "Your Supplier's Input Costs Rose 5.8%. Your 2027 Invoice Should Not."
subtitle: "China's August 2026 price data shows what factories paid for inputs rising faster than what they charged for output, and that 4.3-point gap is the buyer's room"
description: "In August 2026 China's purchasing price index rose 5.8% year on year against 3.8% at the factory gate, a 4.3-point gap. On a 500,000-dollar sourcing budget that is 21,500 dollars, and it decides who absorbs a supplier price increase."
publishDate: 2026-10-07
reviewBy: 2026-12-31
stakes: priced
category: "supply-chain"
audience: "both"
tags: ["supplier price negotiation", "ppi", "input costs", "sourcing budget", "factory gate prices"]
priority: "P1"
featured: false
draft: false
articleNumber: 21
target_keyword: "China PPI August 2026 supplier price increase negotiation importers"
search_intent: "informational"
information_gain: "custom-calculation"
figures:
  - value: "5.8"
    unit: "percent — year-on-year rise in the purchasing price index for industrial producers, the inputs a factory buys"
    period: "August 2026"
    source: "National Bureau of Statistics of China, Industrial Producer Price Indexes in August 2026, released 10 September 2026"
    retrieved: "2026-10-07"
  - value: "3.8"
    unit: "percent — year-on-year rise in the producer price index, the prices factories charge at the gate"
    period: "August 2026"
    source: "National Bureau of Statistics of China, Industrial Producer Price Indexes in August 2026, released 10 September 2026"
    retrieved: "2026-10-07"
  - value: "3.2"
    unit: "percent — average year-on-year rise in the purchasing price index for industrial producers"
    period: "January to August 2026"
    source: "National Bureau of Statistics of China, Industrial Producer Price Indexes in August 2026, released 10 September 2026"
    retrieved: "2026-10-07"
  - value: "2.0"
    unit: "percent — average year-on-year rise in the producer price index"
    period: "January to August 2026"
    source: "National Bureau of Statistics of China, Industrial Producer Price Indexes in August 2026, released 10 September 2026"
    retrieved: "2026-10-07"
  - value: "19.8"
    unit: "percent — year-on-year rise in purchasing prices for nonferrous metals and cables"
    period: "August 2026"
    source: "National Bureau of Statistics of China, Industrial Producer Price Indexes in August 2026, released 10 September 2026"
    retrieved: "2026-10-07"
  - value: "-0.5"
    unit: "percent — year-on-year change in producer prices for consumer goods, a fall"
    period: "August 2026"
    source: "National Bureau of Statistics of China, Industrial Producer Price Indexes in August 2026, released 10 September 2026"
    retrieved: "2026-10-07"
  - value: "21,500"
    unit: "US dollars — cost of the 4.3 percentage point gap between input prices and output prices on an annual sourcing budget of 500,000 dollars"
    period: "worked example, this article"
    source: "Landed Math price-drift model, priceDrift(), annual spend 500,000 dollars"
    retrieved: "2026-10-07"
  - value: "29,000"
    unit: "US dollars — added annual cost on a 500,000 dollar budget at 5.8 percent, full pass-through"
    period: "worked example, this article"
    source: "Landed Math price-drift model, priceDrift()"
    retrieved: "2026-10-07"
  - value: "19,000"
    unit: "US dollars — added annual cost on a 500,000 dollar budget at 3.8 percent, full pass-through"
    period: "worked example, this article"
    source: "Landed Math price-drift model, priceDrift()"
    retrieved: "2026-10-07"
  - value: "14,500"
    unit: "US dollars — added annual cost on a 500,000 dollar budget when the supplier absorbs half of the 5.8 percent input move"
    period: "worked example, this article"
    source: "Landed Math price-drift model, priceDrift(), passthrough 50 percent"
    retrieved: "2026-10-07"
  - value: "99,000"
    unit: "US dollars — added annual cost on a 500,000 dollar budget at the 19.8 percent nonferrous metals and cables input rate"
    period: "worked example, this article"
    source: "Landed Math price-drift model, priceDrift()"
    retrieved: "2026-10-07"
  - value: "2,416.67"
    unit: "US dollars — the monthly equivalent of a 29,000 dollar annual input-cost increase"
    period: "worked example, this article"
    source: "Landed Math price-drift model, priceDrift()"
    retrieved: "2026-10-07"
  - value: "1.45"
    unit: "US dollars per unit — the 29,000 dollar annual input-cost increase spread over 20,000 units"
    period: "worked example, this article"
    source: "Landed Math price-drift model, priceDrift(), divided by 20,000 units"
    retrieved: "2026-10-07"
  - value: "0.95"
    unit: "US dollars per unit — the 19,000 dollar annual factory-gate cost spread over 20,000 units"
    period: "worked example, this article"
    source: "Landed Math price-drift model, priceDrift(), divided by 20,000 units"
    retrieved: "2026-10-07"
sources:
  - "National Bureau of Statistics of China, Industrial Producer Price Indexes in August 2026, released 10 September 2026"
  - "Xinhua News Agency, Update: China's PPI returns to monthly growth in August, 9 September 2026, citing NBS statistician Dong Lijuan"
  - "National Bureau of Statistics of China, producer and purchasing price index series for 2026"
  - "Landed Math price-drift model, tools/price-drift.mjs"
---

## AI Summary

In August 2026 China's purchasing price index rose 5.8% year on year, above the 3.8% factory-gate reading: a 4.3-point gap between what suppliers pay for inputs and what they charge for output. Priced on a 500,000-dollar budget at the model's outputs, that gap is 21,500 dollars. It decides who absorbs the next price increase.

China's August price data measured something more useful than inflation. It measured a gap.

The producer price index gets the coverage, because 3.8% is the number with a story attached. The purchasing price index, published in the same release, is the number that decides your next quotation: it records what industrial enterprises paid for the raw materials, fuel and power they bought. It rose 5.8% year on year.

Factories are paying more for what they buy than they are earning from what they sell. That is a margin problem for them, and the arithmetic of the gap is the buyer's negotiating room.

## What happened

The National Bureau of Statistics released the August 2026 price data on 9 September. Two indices in that release matter to anyone buying from a Chinese factory, and they moved in opposite directions.

| Index | August 2026, year on year | January to August average |
| --- | --- | --- |
| Producer price index, prices received at the factory gate | **+3.8%** | +2.0% |
| Purchasing price index, prices paid for inputs | **+5.8%** | +3.2% |

The gap between them is **4.3 percentage points** on the month's reading and **1.2 points** on the year-to-date average. The first describes the pressure a supplier is under right now. The second describes the squeeze that has been running all year.

On the month, the factory-gate index rose 0.4%, reversing a 0.7% fall in July. The purchasing index rose 0.3%.

The averages hide a wide spread, and the spread is where a buyer's exposure lives. On the input side, prices paid for nonferrous metals and cables rose 19.8% year on year, fuel and power 9.8%, and raw chemical materials 9.5%, while building materials and non-metals fell 3.2%. On the output side, prices received for coal mining and washing rose 26.6% and for nonferrous metal smelting and pressing 20.8%, while producer prices for consumer goods fell 0.5% — food down 2.3%, clothing down 1.2%, articles for daily use down 0.8%, and durable consumer goods up 1.2%.

So a factory making anoraks and a factory making cable face the same composite number and opposite problems. One sells into falling prices while its materials rise. The other sells into a rising market and passes the increase along.

> **Purchasing price index for industrial producers** — the prices industrial enterprises pay for the raw materials, fuel and power they buy, including imports. It is the input side of the factory gate. The producer price index is the other side: what they receive when they sell. The distance between the two is the margin squeeze, in percentage points.

## Why now

**The gap has not closed all year.** The year-to-date averages say the purchasing index ran at 3.2% while the producer index ran at 2.0%. Eight months of data, one direction. A supplier who sustained that all year has been paying the difference out of margin rather than out of price.

**The input move is imported, and the statistics bureau says so.** NBS statistician Dong Lijuan attributed the August move in part to higher international crude oil and nonferrous metal prices, with industrial upgrading lifting demand in some emerging sectors. A cost driven by world metal prices is not addressed by switching to a supplier in another country, because the same metal price reaches every competing factory. It is addressed by changing the material, the specification, or the share of the increase the supplier agrees to carry.

**The output side is the constraint, and it is published too.** Producer prices for consumer goods fell 0.5% year on year, and the year-to-date figure is worse than the monthly one. A supplier of consumer goods is selling into a market where the price of the category is not rising. That removes the easy exit: a factory that raises your price while its own selling market falls is not matching the market, it is choosing you. Which means the number is negotiable rather than given.

**The direction of the factory-gate index changed in the middle of the year.** July 2026 was the last month in this run with a negative month-on-month reading, and August reversed it. A buyer whose 2027 budget line assumed Chinese quotes drift flat has an expired assumption, and [the factory-gate drift analysis](/blog/china-ppi-positive-factory-price-drift/) covers that change of direction on its own terms. What it did not cover is the cost side underneath it, which is the half that tells you what your supplier is absorbing.

## So what

Two published rates, one gap. Converting them into money requires one input the statistics bureau does not publish: your spend on that supplier's category.

Set an annual sourcing budget of **500,000 dollars** and run the gap through the price-drift model, with full pass-through unless stated and a twelve-month period.

| Scenario | Rate applied | Added annual cost on a $500,000 budget | Cost per unit over 20,000 units |
| --- | --- | --- | --- |
| Purchasing price index, all inputs | 5.8% | **$29,000** | **$1.45** |
| Factory-gate producer price index | 3.8% | $19,000 | $0.95 |
| Year-to-date average, input side | 3.2% | $16,000 | $0.80 |
| Year-to-date average, factory gate | 2.0% | $10,000 | $0.50 |
| Input-output gap | 4.3 points | $21,500 | $1.08 |
| Supplier absorbs half the input move | 2.9% | $14,500 | $0.73 |
| Nonferrous metals and cables only | 19.8% | $99,000 | $4.95 |

The last two rows are the ones to argue about, and they are the same argument seen from opposite ends. A buyer whose components are metal-heavy faces a real number of 4.95 dollars a unit at the commodity's own input rate. A buyer who wins a fifty-fifty split of the composite input move turns 29,000 dollars into 14,500 dollars.

**The 21,500-dollar row is the negotiation.** That is the cost of the input-output gap on this budget, and it is the amount that has to sit somewhere: in the supplier's margin, in your invoice, or in efficiency the factory finds by other means. Section by section, the supplier's cost lines and your cost lines are the same lines.

**Read the input index, not the headline.** The composite purchasing index at 5.8% hides category rates running from 19.8% for nonferrous metals and cables down to -3.2% for building materials. A buyer's invoice follows the category, because a factory buying steel scrap and a factory buying copper cable do not share a cost base.

**And the monthly equivalent is the useful unit inside a quarter.** An annual increase of 29,000 dollars arrives at **2,416.67 dollars** a month spread evenly, which is the size of the hole a quarterly price review leaves open if the increase is agreed but not dated. On a 20,000-unit quarter the same money is 1.45 dollars a unit, and a supplier will argue about a percentage before it argues about cents.

For buyers exposed to controlled materials, the input side is larger than a price line: [the rare earth licence regime](/blog/china-rare-earth-export-controls-licence-regime/) adds administrative cost and lead time to the same purchase order, and neither shows up in a price index.

> Also read: [China's Factory Profits Rose 15.7%, and Their Customers Started Paying Later](/blog/china-industrial-profits-q4-supply-chain/)

> Also read: [The Eurasian Duty on Chinese Oil Pipes Runs 12.23% to 31% — and One List Decides Which](/blog/eaeu-anti-dumping-oil-well-pipe-2026/)

> Also read: [China's 5.0% Factory-Price Rise Hides a 20-Point Split](/blog/china-producer-price-split-copper-ferrous-2026/)

> Work it out: [the landed cost calculator](/calculator/)

> Different question, same method: [the step-by-step guides](/guide/)

## For you

- **Buyers of metal-intensive goods (hardware, cable, components):** the relevant input rate is 19.8%, not 3.8%, and the per-unit cost of it is 4.95 dollars on the worked example above. Ask the supplier for the metal content of the unit before discussing the increase. A cost line you can price to the gram is a cost line you can audit, and one you cannot price is a claim.
- **Buyers of apparel, footwear and general consumer goods:** your supplier's output market is falling while its input costs rise, and that combination is your leverage. Producer prices for consumer goods fell 0.5% year on year, so the case for a full pass-through is weaker here than anywhere else in the release. Offer volume certainty and an earlier booking rather than arguing the rate down point by point.
- **Buyers of electronics and electrical goods:** the input side for this group is mixed — nonferrous metals and cables up 19.8%, fuel and power up 9.8%, but durable consumer goods output prices up only 1.2%. The copper and aluminium content of a product decides your exposure far more than its category label does.
- **Anyone writing a 2027 budget now:** do not budget on the section by section rates as though they were prices. The year-to-date averages of 2.0% and 3.2% are the only figures in the release that describe a full period rather than one month, and a category rate of 19.8% describes the input market, not your invoice.

## The data point

<div class="callout">
<span class="callout-label">Data point</span>
Factories paid 5.8% more for their inputs in August 2026 while charging 3.8% more for what they sold. Measured at the model's outputs on a 500,000-dollar budget, that gap is **21,500 dollars**, or **2,416.67 dollars** a month. It is the only number in this article that both sides of the table can act on.
</div>

## FAQ

### Is the purchasing price index the price I pay?

No. It measures what Chinese industrial enterprises paid for the raw materials, fuel and power they bought, including imported inputs. Your invoice is the price they charge for finished goods, which the producer price index tracks from the other side. The two are published in the same release and they are not the same number. What the gap between them tells you is the pressure the supplier is under, which is the starting position of a negotiation rather than its outcome. Treat 5.8% as the cost the factory is carrying, not as a price you owe.

### Which number should I put in a 2027 budget?

Use the year-to-date averages rather than the August readings, because they describe a period that happened rather than a month that just ended. For the input side that is 3.2% and for the factory gate 2.0%. Then replace the composite with your own category rate, since the averages sit on top of a spread running from 19.8% for nonferrous metals and cables to -3.2% for building materials. A budget built on the composite is a budget built on an average of things you do not buy.

### Does a 5.8% input rise mean my quote goes up 5.8%?

Not necessarily, and the output side is the reason. Producer prices for consumer goods fell 0.5% year on year in August, so a supplier in those categories is selling into a market where prices are not rising. Whether the input move reaches your invoice depends on the supplier's capacity position, the length of your agreement and the competition in your category. The published figures describe the pressure; the pass-through is a commercial outcome. What the data does establish is that the increase was not free for the supplier.

## How we calculated this

The rates are published; the spend and the passthrough are yours. The model applies an index move to an annual spend over a stated period, and the per-unit column divides that result by the units you order in the year:

```text
added cost = annual spend x index move x passthrough share x (months / 12)

21,500 dollars = 500,000 dollars x 4.3%  x 100% x 12 / 12
29,000 dollars = 500,000 dollars x 5.8%  x 100% x 12 / 12
14,500 dollars = 500,000 dollars x 5.8%  x  50% x 12 / 12
99,000 dollars = 500,000 dollars x 19.8% x 100% x 12 / 12
 2,416.67 dollars = 29,000 dollars / 12 months
 1.45 dollars = 29,000 dollars / 20,000 units
```

Substitute your own annual spend on the category, your order quantity, and the passthrough you negotiate. The 4.3-point gap is the difference between the two published year-on-year readings for August 2026: 5.8% paid for inputs, 3.8% received for output.

## The point

A price increase from a Chinese supplier is a claim about cost, and China publishes its cost data monthly with more detail than any other manufacturing base. The August 2026 release says inputs cost 5.8% more and output sold for 3.8% more, which means the supplier absorbed the difference for at least a month and probably longer. That is the context a buyer should negotiate inside: not whether costs rose, but which line rose, and which share of it lands on the next invoice.

<!-- revision-history -->
