---
title: "China's Origin Data Goes Electronic: The 1 December 2026 Deadline for RCEP Importers"
subtitle: "The China-Malaysia RCEP certificate of origin goes electronic in 2026: what missing origin data costs an importer at customs release"
description: "From 1 December 2026, missing electronic origin data for RCEP and ACFTA certificates out of Malaysia means a duty guarantee at release. Here is what that guarantee costs, and what it does not protect."
publishDate: 2026-10-01
reviewBy: 2026-11-30
stakes: priced
category: "logistics"
audience: "importer"
tags: ["rcep", "certificate of origin", "customs clearance", "asean", "working capital"]
priority: "P1"
featured: false
draft: false
articleNumber: 1
target_keyword: "China Malaysia RCEP certificate of origin electronic data 2026"
search_intent: "informational"
information_gain: "primary-source"
figures:
  - value: "74"
    unit: "announcement number (2026)"
    period: "issued 29 May 2026"
    source: "General Administration of Customs of the PRC, Announcement No. 74 of 2026"
    retrieved: "2026-10-01"
  - value: "4"
    unit: "document types covered (RCEP certificates, back-to-back certificates, ACFTA certificates, movement certificates)"
    period: "from 1 June 2026"
    source: "General Administration of Customs of the PRC, Announcement No. 74 of 2026"
    retrieved: "2026-10-01"
  - value: "30 November 2026"
    unit: "last day manual origin-data entry is accepted as a remedy"
    period: "transition window opened 1 June 2026"
    source: "General Administration of Customs of the PRC, Announcement No. 74 of 2026"
    retrieved: "2026-10-01"
  - value: "1 December 2026"
    unit: "date a duty guarantee becomes the route to advance release"
    period: "from this date onward"
    source: "General Administration of Customs of the PRC, Announcement No. 74 of 2026"
    retrieved: "2026-10-01"
  - value: "34"
    unit: "announcement number (2021) governing paperless declaration and preferential origin declaration"
    period: "in force, referenced by Announcement No. 74"
    source: "General Administration of Customs of the PRC, Announcement No. 34 of 2021"
    retrieved: "2026-10-01"
  - value: "$6,000"
    unit: "guarantee lodged on a $60,000 shipment at a 10% duty rate"
    period: "worked example, this article"
    source: "Landed Math duty-guarantee model (tools/guarantee-cost.mjs)"
    retrieved: "2026-10-01"
  - value: "45"
    unit: "days the guarantee is tied up in the worked example"
    period: "worked example, this article"
    source: "Landed Math duty-guarantee model (tools/guarantee-cost.mjs)"
    retrieved: "2026-10-01"
  - value: "14.8"
    unit: "basis points of shipment value — funding cost of the guarantee over 45 days"
    period: "at a 12% annual funding cost, worked example"
    source: "Landed Math duty-guarantee model (tools/guarantee-cost.mjs)"
    retrieved: "2026-10-01"
sources:
  - "General Administration of Customs of the PRC, Announcement No. 74 of 2026 on electronic origin data exchange with Malaysia, issued 29 May 2026, effective 1 June 2026"
  - "General Administration of Customs of the PRC, Announcement No. 34 of 2021 on paperless declaration and preferential trade agreement origin declaration"
  - "Regional Comprehensive Economic Partnership Agreement, Chapter 3 (Rules of Origin)"
  - "China–ASEAN Free Trade Area Framework Agreement, Rules of Origin and Operational Certification Procedures"
---

## AI Summary

China's customs authority now exchanges origin certificate data with Malaysia electronically. From 1 December 2026, when that data cannot be found, a duty guarantee becomes the route to advance release instead of manual data entry. The transition window closes on 30 November 2026, and paper certificates still require paper submission.

Most importers will read this as an IT change and file it accordingly. It is a working-capital change dressed as an IT change. The date that matters is not when the system went live, but when the fallback disappears — because paper certificates have been the route that always works, and a route that always works is the one nobody builds a process around.

The good news is that the guarantee itself is cheap. The bad news is that it protects the wrong thing.

## What happened

The General Administration of Customs of the PRC issued Announcement No. 74 of 2026 on 29 May 2026, effective 1 June 2026. It put the China–Malaysia origin data electronic exchange system into operation, transmitting origin certificate data with Malaysia in real time.

Four document types are covered: RCEP certificates of origin, back-to-back RCEP certificates of origin, certificates of origin under the China–ASEAN Framework Agreement, and movement certificates.

The operational change runs in two stages.

| Stage | Period | What applies when the electronic data cannot be found |
| --- | --- | --- |
| Transition | 1 June 2026 to 30 November 2026 | Importer enters the origin data manually through the preferential trade agreement origin declaration system, and uploads the certificate electronically |
| Final | From 1 December 2026 | Manual entry no longer serves as the remedy. To obtain advance release, the importer applies for a duty guarantee |

The guarantee is refunded once the certificate data is confirmed as transmitted, through the online origin certificate status query on China Customs' origin service platform. Declarations filed on paper still require the paper certificate to be submitted at the time of declaration.

> **Origin data exchange** — a standing electronic link between two customs administrations through which origin certificates issued by one side are visible to the other in real time. Its purpose is to let the importing customs authority verify a preferential claim without requesting documents, and to remove the space in which a certificate can be claimed but not confirmed.

## Why now

The transition window closes on 30 November 2026. From the publication of this piece that leaves roughly two months, which is one ordering cycle for most importers and fewer than two for anyone shipping from a distance.

There is a second reason the timing matters. The manual-entry fallback is not a small convenience — it is the mechanism that has been absorbing every failure in the chain: a supplier who transmits late, a certificate number typed with a transposed digit, a trader who issues a back-to-back certificate without updating the underlying record. From 1 December 2026 that absorption stops, and the failure surfaces at the port as a guarantee application instead of an extra ten minutes of data entry.

Look at the sequence rather than the single announcement. Announcement No. 34 of 2021 moved preferential origin declaration onto a paperless footing. Announcement No. 74 of 2026 moved the underlying data itself into an exchange between two customs administrations. The next step in that progression is not more manual entry.

Announcement No. 74 covers the China–Malaysia corridor, and every indication is that this is the pattern China is building with free trade agreement partners one corridor at a time rather than a Malaysia-specific arrangement. Importers in other ASEAN markets reading this as someone else's problem are reading it wrong. The correct reading is that Malaysia is the first corridor to reach the end state, and the operational template is now visible. The same shift is under way on the goods themselves, where controlled materials now move under [the rare earth export licence regime](/blog/china-rare-earth-export-controls-licence-regime/) rather than on a declaration alone.

## So what

Here is what the guarantee costs. The duty rate, funding cost and shipment value are inputs — substitute your own. The structure is what matters.

| Worked example | Dutiable value | Guarantee lodged | Days tied up | Funding cost of the guarantee |
| --- | --- | --- | --- | --- |
| 40HQ of consumer goods | $60,000 | $6,000 | 45 | $88.77 (14.8 bps) |
| LCL trial shipment | $8,000 | $800 | 45 | $11.84 (14.8 bps) |
| Three containers, peak season | $180,000 | $18,000 | 90 | $532.60 (29.6 bps) |

**The counterintuitive result: the guarantee is cheap.** Fifteen basis points of shipment value over six weeks. An importer who treats the guarantee as the risk is protecting against the wrong number, and will under-invest in the thing that actually costs money.

The expensive failure is the certificate that never verifies. If the electronic record is never transmitted, the guarantee does not evaporate — it converts into duty paid at the non-preferential rate, and the preferential margin is gone for that shipment. On the same $60,000 shipment at a 10% duty rate, the guarantee costs $88.77 while the duty it secures costs $6,000. The ratio is roughly 68 to one, and it runs the wrong way for anyone who optimises the cheap side.

**So do not manage the deadline. Manage the transmission.** The action that matters happens upstream, before the vessel sails: confirm that your supplier or trader has actually transmitted the certificate data for that specific shipment, and that the certificate number on the commercial documents matches the transmitted record. That is a five-minute check at the right moment and an expensive problem at the wrong one.

Two habits are worth building now, while the fallback still exists. First, ask for the certificate number as soon as it is issued, not when the goods arrive. Second, when you use a back-to-back certificate through a Malaysian trader, confirm which underlying certificate it references — the linkage is the part most likely to break, and it breaks silently. This is the same pattern as [the freight index publisher change](/blog/container-freight-index-publisher-change-2026/): a reference in a contract quietly stops pointing where it used to, and neither side notices until the invoice.

> Work it out: [the landed cost calculator](/calculator/)

> Different question, same method: [the step-by-step guides](/guide/)

## For you

- **First-time importers from Malaysia:** confirm before you book freight whether your supplier issues the certificate themselves or works through a trader. If it is a trader, the origin data path has one more party in it, and that party is not the one carrying the guarantee cost. Ask for the certificate number in writing before the goods leave.
- **Repeat importers with a standing supplier:** this is the cheap moment to fix a process that has been quietly broken for years. Request the last six certificates and check each one against what China's system shows. Any certificate that required manual entry in the past is a certificate that will require a guarantee in future.
- **Buyers using back-to-back certificates:** the intermediate certificate is the weak link. Confirm that the trader's back-to-back certificate references an underlying RCEP or ACFTA certificate that has itself been transmitted, because the exchange system verifies the chain, not just the document in your hand.

## The data point

<div class="callout">
<span class="callout-label">Data point</span>
Sixty-eight to one. On the worked example, the duty guarantee costs $88.77 and the preferential duty it secures is worth $6,000 — which is why the deadline is a supply-chain deadline, not a treasury one.
</div>

## FAQ

### What changes on 1 December 2026?

From that date, an importer who wants goods released before the electronic origin data is confirmed must apply for a duty guarantee rather than entering the missing origin data manually. Between 1 June and 30 November 2026, the manual route through the preferential trade agreement origin declaration system remains available, with the certificate uploaded electronically. From 1 December, the guarantee becomes the mechanism for advance release, and it is refunded once the data is confirmed as transmitted through the online certificate status query. Declarations filed on paper continue to require the paper certificate.

### How much does the duty guarantee actually cost?

Less than most importers assume. On a $60,000 shipment carrying a 10% duty rate, the guarantee is $6,000 lodged for however long the data takes to confirm. At a 12% annual funding cost over 45 days, that is $88.77 — about 15 basis points of shipment value. The guarantee is returned once the data is verified, so the cost is the funding cost of the cash, not the duty itself. The number to worry about is the $6,000, which becomes real duty if the certificate never verifies.

### Does this apply to imports from other ASEAN countries?

Announcement No. 74 of 2026 covers the China–Malaysia corridor specifically. It is the latest step in a sequence that began with paperless preferential origin declaration in 2021, and the mechanism is the one China has been building with free trade agreement partners individually. Importers in other ASEAN markets are not subject to this announcement today, and the operational end state it describes is the template those corridors are heading towards. Building the supplier-side verification habit now costs nothing and transfers directly.

### My supplier still issues paper certificates. Is that allowed?

Yes. The announcement explicitly preserves paper declaration, and an importer choosing that route submits the paper origin certificate at the time of declaration. What paper does not do is exempt you from the data question. The electronic exchange concerns the data behind the certificate, not the medium you file in, and a paper certificate whose underlying record has not been transmitted runs into the same verification problem. The safe assumption is that the data requirement is independent of the filing format.

## The point

The deadline is 30 November 2026, and it closes a fallback rather than opening a restriction. The guarantee that replaces it is inexpensive enough to be a rounding error, which is precisely why it is the wrong thing to prepare for. Prepare for the certificate that does not verify, because that is where the money is — and it is decided weeks earlier, by whether somebody transmitted a record before the ship left.
