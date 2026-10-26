---
title: "China Is Removing the Export Rebate That Funded Cheap Quotes"
subtitle: "The 2026 export tax rebate removal for battery and solar exporters, and what the change does to the importer's FOB price"
description: "The rebate was cancelled on 249 product lines from 1 April 2026, and the list is not solar-only. Battery rebates fall from 9% to 6%, then to zero on 1 January 2027. Nine points become money on your invoice."
publishDate: 2026-10-02
updatedDate: 2026-10-02
reviewBy: 2027-01-01
stakes: priced
revisions:
  - date: 2026-10-02
    note: "An earlier version described the cancelled schedule as covering photovoltaic products. It covers 249 product lines spanning nicotine products, lithium compounds, methanol, 1,4-butanediol, phosphite and phosphonate chemicals, glassware and vaping hardware as well as solar cells and modules. The battery sequence was also stated without the preceding cut from 13% to 9% in December 2024, and Article 4's rule that the applicable rate follows the export date on the customs declaration was absent. All three are corrected above."
category: "sourcing"
audience: "importer"
tags: ["export tax rebate", "fob pricing", "batteries", "solar", "supplier negotiation"]
priority: "P0"
featured: false
draft: false
articleNumber: 3
target_keyword: "China export tax rebate removal 2026 battery solar importer price"
search_intent: "informational"
information_gain: "custom-calculation"
figures:
  - value: "1 April 2026"
    unit: "date the export VAT rebate on photovoltaic products was abolished"
    period: "announcement published early January 2026"
    source: "Ministry of Finance of the PRC and State Taxation Administration, export tax rebate adjustment announcement, January 2026"
    retrieved: "2026-10-02"
  - value: "9 to 6"
    unit: "percent — the export VAT rebate rate for battery-related products from 1 April 2026"
    period: "effective 1 April 2026"
    source: "Ministry of Finance of the PRC and State Taxation Administration, export tax rebate adjustment announcement, January 2026"
    retrieved: "2026-10-02"
  - value: "1 January 2027"
    unit: "date the battery-related export VAT rebate is abolished"
    period: "second stage of the same announcement"
    source: "Ministry of Finance of the PRC and State Taxation Administration, export tax rebate adjustment announcement, January 2026"
    retrieved: "2026-10-02"
  - value: "9"
    unit: "percentage points of export value removed from the rebate across both stages"
    period: "9% to 6% in April 2026, then 6% to zero in January 2027"
    source: "Ministry of Finance of the PRC and State Taxation Administration, export tax rebate adjustment announcement, January 2026"
    retrieved: "2026-10-02"
  - value: "$1.20"
    unit: "per unit — the three-point cut on a $40 FOB battery cell, at full passthrough"
    period: "from 1 April 2026"
    source: "Landed Math export-rebate passthrough model, rebatePassthrough()"
    retrieved: "2026-10-02"
  - value: "$2.40"
    unit: "per unit — the further six-point cut on a $40 FOB battery cell, at full passthrough"
    period: "from 1 January 2027"
    source: "Landed Math export-rebate passthrough model, rebatePassthrough()"
    retrieved: "2026-10-02"
  - value: "$3,600"
    unit: "additional cost per 1,000 units if all nine points are passed through"
    period: "worked example, this article"
    source: "Landed Math export-rebate passthrough model, rebatePassthrough()"
    retrieved: "2026-10-02"
  - value: "249"
    unit: "product lines in Annex 1 (photovoltaic and other products) that lose the export VAT rebate"
    period: "published 8 January 2026, effective 1 April 2026"
    source: "Ministry of Finance and State Taxation Administration, 财政部 税务总局公告2026年第2号, Annex 1"
    retrieved: "2026-10-02"
  - value: "22"
    unit: "product lines in Annex 2 (battery products) whose rebate is cut and then cancelled"
    period: "published 8 January 2026"
    source: "Ministry of Finance and State Taxation Administration, 财政部 税务总局公告2026年第2号, Annex 2"
    retrieved: "2026-10-02"
  - value: "export date on the customs declaration"
    unit: "the date that fixes which rebate rate applies"
    period: "Article 4 of the announcement, effective 1 April 2026"
    source: "Ministry of Finance and State Taxation Administration, 财政部 税务总局公告2026年第2号, Article 4"
    retrieved: "2026-10-02"
sources:
  - "Ministry of Finance and State Taxation Administration, 财政部 税务总局公告2026年第2号 on adjusting export tax rebate policy for photovoltaic and other products, issued 8 January 2026"
  - "Ministry of Finance and State Taxation Administration, 财政部 税务总局公告2024年第15号, issued 15 November 2024, effective 1 December 2024"
  - "State Taxation Administration, 税总货劳函〔2026〕27号, publishing rebate rate library 2026A, 3 March 2026"
  - "State Taxation Administration policy database, canonical record for 2026年第2号"
  - "Guangdong Provincial Department of Finance, official mirror of 2026年第2号 with Annexes 1 and 2"
---

## AI Summary

China cancelled the export VAT rebate on 249 product lines from 1 April 2026 — chemicals, glassware and vaping hardware included, not just solar — and cut battery rebates from 9% to 6%, with abolition on 1 January 2027. The rate follows the customs declaration date.

Here is what makes this one unusual. Chinese industrial policy usually arrives as support for exporters. This is the opposite: the state is withdrawing a subsidy that funded low export prices, and saying so publicly as a measure against what it calls involuntary competition.

For a buyer, the practical consequence is simple and slightly uncomfortable. The cheapest quotes in these categories were partly financed by a rebate that is going away, and the next one to go is worth six points.

## What happened

The Ministry of Finance and the State Taxation Administration issued 财政部 税务总局公告2026年第2号 on 8 January 2026, titled "on adjusting the export tax rebate policy for photovoltaic and other products". The title undersells the scope, and so does most of the coverage.

| Instrument | Change | Effective |
| --- | --- | --- |
| Annex 1 — 249 product lines | Export VAT rebate cancelled | 1 April 2026 |
| Annex 2 — 22 battery product lines | Rebate cut from 9% to 6% | 1 April 2026 |
| Annex 2 — 22 battery product lines | Rebate cancelled | 1 January 2027 |

**Read Annex 1 before assuming it is a solar list.** The announcement is titled "photovoltaic and other products" and the cancelled schedule runs to 249 lines. Row 1 is 2404120000, a nicotine product. The list continues through lithium hexafluorophosphate, lithium manganese and lithium cobalt oxides, nickel-cobalt-manganese oxides, methanol, 1,4-butanediol, a large block of phosphite and phosphonate chemicals, glassware, and an electronic-cigarette device code. Solar cells appear at rows 247 and 248, and the module line at 249. An importer of industrial chemicals, glassware or vaping hardware is inside this measure and would not know it from the trade press, which reports the story as a solar one.

**And the deadline is a shipping deadline, not a negotiation.** Article 4 of the announcement states that the applicable export rebate rate is determined by the export date recorded on the customs declaration for the goods. Not the order date, not the contract date, not the date the rebate was quoted into your price. Cargo whose declaration date falls on or after 1 April 2026 loses the rebate regardless of when it was ordered.

The predecessor step is worth knowing because it sets the baseline. 财政部 税务总局公告2024年第15号, issued on 15 November 2024 and effective from 1 December 2024, had already cut the rebate on photovoltaic and battery products from 13% to 9%. The full withdrawal therefore happened inside a sixteen-month window rather than as a sudden move. It is also one half of a two-sided export policy: the same tariff plan taxes raw metal on the way out under [the 2026 export duty schedule](/blog/china-2026-export-duty-wrought-metals/), so material and finished goods are being treated in opposite directions.

Li Xianzhong of the Ministry of Finance described the adjustment at a press conference as a way to curb involuntary competition, promote more efficient use of resources, and reduce environmental pollution and carbon emissions — the same framing the ministry used when it published the announcement. The rebate was already coded out of the system before it disappeared: 税总货劳函〔2026〕27号, issued on 3 March 2026, published rebate rate library 2026A implementing this announcement, a month ahead of the effective date.

> **Export VAT rebate** — a refund of value-added tax on exported goods, paid to the Chinese exporter. It is not a payment to the buyer, and it does not appear on your invoice. It reduces the exporter's net cost, which is why it shows up as a lower FOB price rather than as a line item. When the rebate falls by a percentage point, the exporter's net receipt on the same invoice falls by roughly a percentage point, and the negotiation over who absorbs that is entirely commercial.

## Why now

The first stage has already happened. Photovoltaic rebates ended in April 2026 and battery rebates are running at 6% rather than 9%. Anyone who has quoted a 2027 budget off 2025 pricing has two changes baked out of it and has not noticed.

The second stage is the one worth acting on. On 1 January 2027 the remaining six points disappear for battery-related products. That is roughly a quarter away from the publication of this piece, which is inside the normal window for locking annual volumes and inside the window for a supplier to decide what their 2027 price list looks like.

The third reason is strategic rather than arithmetic. Read the ministry's own framing: the adjustment is designed to stop firms competing on price to the point of destroying their own margins. That is a policy decision to make Chinese exports in these categories more expensive by design. Buyers who treat this as a temporary tax technicality are misreading the direction. The rebate is being withdrawn because the state no longer wants to subsidise the price war, and the price war was the thing that made these categories attractive.

## So what

Nine percentage points is easy to say and hard to feel. Converted to money on a real invoice, using a $40 FOB battery cell and a 1,000-unit shipment:

| Stage | Rebate points lost | Per unit | Per 1,000 units |
| --- | --- | --- | --- |
| 1 April 2026 (9% to 6%) | 3 points | $1.20 | $1,200 |
| 1 January 2027 (6% to zero) | 6 points | $2.40 | $2,400 |
| Both stages together | 9 points | $3.60 | $3,600 |

Three observations, and the third is the important one.

**The first stage was small enough to hide.** $1.20 on a $40 unit is a 3% move, and 3% disappears inside freight volatility, exchange-rate movement and packaging changes. Plenty of buyers absorbed it without identifying it, which means the same thing will happen again in January unless somebody is watching for it.

**Passthrough is a negotiation, not a law.** The table assumes the exporter recovers the full nine points. A supplier who absorbs half of it lands at $41.80 rather than $43.60 — a genuine competitive advantage, and exactly the kind of supplier worth keeping. The way to find out which kind you have is to ask what the January change does to their 2027 price, in writing, before you place the order.

**The right time to negotiate is now, and the leverage runs the other way from usual.** Buyers normally wait for a price increase and negotiate afterwards. Here the increase is published, dated and known to both sides, which means a supplier quoting 2027 volumes today has to decide whether to price in six points and risk losing the order, or hold the price and carry it. That decision is easier for them to make in your favour if you commit volume in exchange. The window closes when their 2027 price list is final, not when the announcement takes effect.

**So do not ask for a discount. Ask for the mechanism.** Specifically, ask what the 1 January change does to their unit price, whether their quote assumes domestic or exported input VAT treatment, and whether they will hold the current price against a committed volume with a delivery date. A supplier who cannot answer the first question has not modelled it, and will model it in January, on your order. The same date rule makes the supplier's registration status worth knowing before you commit, which is what the 2026 real-name registration rule now exposes.

> Work it out: [the landed cost calculator](/calculator/)

> Different question, same method: [the step-by-step guides](/guide/)

## For you

- **Buyers of anything on the 249-line schedule:** check your own product codes against Annex 1 rather than against the headline. The list reaches nicotine products, lithium compounds, methanol, 1,4-butanediol, phosphite and phosphonate chemicals, glassware and e-cigarette devices. The rebate is already gone, so the price movement has already happened — if your 2026 quotes came in level with 2025, ask what your supplier changed elsewhere in the cost stack.
- **Buyers of battery-related products:** you have until the end of the year to negotiate around a known, dated six-point change. Lock volume against price now, and put the delivery date in writing. This is the rare negotiation where the other side already knows the number.
- **Buyers using these products as components:** the increase does not stop at the cell or the module. A bill of materials that contains a battery or a photovoltaic component inherits part of the increase, and how much depends on how many supplier tiers pass it on. Ask your first-tier supplier directly, rather than waiting to see it in next year's quote.
- **Anyone who ordered before April 2026 and is still shipping:** the declaration date decides the rate, so a shipment that was ordered at last year's price can still cross into the zero-rebate regime. Confirm the declaration date with the exporter before the goods move, not after.

## The data point

<div class="callout">
<span class="callout-label">Data point</span>
Nine points, two dates: three points removed in April 2026 and six more on 1 January 2027. On a $40 unit that is $3.60, and the only question that matters is how much of it your supplier intends to price into your next order.
</div>

## FAQ

### Does the export tax rebate change appear on my invoice?

No, and that is why it is easy to miss. The rebate is a refund paid by the Chinese tax authority to the exporter, calculated on the export value. It reduces the supplier's net cost, so it influences the FOB price rather than appearing as a line item. When the rate falls, the supplier's net receipt on an unchanged invoice falls with it, and the supplier decides how much to recover through price. The buyer sees the consequence as a higher quotation, with no line that explains it. Asking the supplier to identify it explicitly is the only way to see the number.

### Which products are affected?

The announcement covers photovoltaic products and battery-related products. Photovoltaic goods lost their export VAT rebate from 1 April 2026. Battery-related products ran at a 9% rebate, moved to 6% on the same date, and lose the remaining six points on 1 January 2027. The announcement adjusts rebates on a range of products including these two groups, so buyers in adjacent categories should check their own product codes rather than assuming the change is confined to solar and batteries.

### How much of the increase will my supplier pass on?

That is a commercial decision, not a published one, and it is the question worth asking before you place an order rather than after. A supplier with strong margins and idle capacity can absorb part of a six-point change to keep volume, and a supplier running at capacity has no reason to. The same nine-point change therefore produces different price outcomes for two buyers in the same category. The practical answer is to ask what the January change does to their 2027 unit price in writing, and to treat a vague answer as information in itself.

### Why is China removing a subsidy that helps its own exporters?

The Ministry of Finance's stated rationale is to curb involuntary competition — firms competing on price to the point of destroying their own margins — and to push industry toward higher-quality, greener production. That is a deliberate choice to make these exports more expensive, and it is stated publicly rather than disguised. For buyers, the strategic reading matters more than the arithmetic: the cheap pricing in these categories was partly policy-funded, and the policy is being withdrawn on purpose. Planning on the assumption that it returns is planning against the stated direction.

## How we calculated this

Full passthrough is the assumption, and unit FOB value is the input. The rebate is a share of FOB, so the cost of losing it is a share of the same base, and nothing else enters the arithmetic:

```text
lost rebate per unit = rebate points lost x unit FOB value
$3.60 = 9 points x $40 FOB        $3,600 per 1,000 units
```

Substitute your own unit FOB and your supplier's passthrough share. The $3.60 figure assumes the exporter recovers all nine points, which the negotiation decides rather than the announcement.

## The point

This is a domestic Chinese tax decision whose cost lands on an importer's invoice, which is precisely why it escapes notice. The first three points went by quietly in April. The remaining six arrive on 1 January 2027, and unlike most price movements this one is published, dated, and known to both sides of the table. That makes the next few weeks the cheapest window you will get to fix the number, because a supplier pricing a committed order today is making a different decision from one pricing a spot enquiry in January.
