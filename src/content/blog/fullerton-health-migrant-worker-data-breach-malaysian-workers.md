---
articleNumber: 56
title: "A Singapore clinic breach exposed 140,000 migrant worker records — and Malaysian workers hold the same kind of pass"
subtitle: "Fullerton Health says about 140,000 work pass holder records were compromised in its Migrant Worker Primary Care Plan programme, disclosed on 14 November 2026."
description: "Fullerton Health disclosed on 14 November 2026 that about 140,000 work pass holder records were compromised in a cybersecurity incident affecting its Migrant Worker Primary Care Plan programme, first made public in a 9 November 2026 website notice. About 43,000 of those records belonged to people"
publishDate: 2026-11-15
reviewBy: 2026-11-29
stakes: directional
category: malaysia-impact
audience: workers
tags:
  - fullerton-health
  - data-breach
  - migrant-workers
  - singapore
  - work-pass
  - fin
priority: P1
featured: false
draft: false
target_keyword: Fullerton Health migrant worker data breach 140,000
search_intent: informational
information_gain: custom-calculation
sources:
  - "Channel NewsAsia (CNA) — 'Records of about 140,000 migrant workers exposed in Fullerton Health's recent data breach', 14 November 2026"
  - "Fullerton Health — website notice dated 9 November 2026, as reported by CNA"
figures:
  - value: "140,000"
    unit: "work pass holder records compromised"
    period: "disclosed 14 November 2026"
    source: "Fullerton Health, reported by CNA"
    retrieved: "2026-11-14"
    evidence: "About 140,000 work pass holder records were compromised in the cybersecurity incident involving Fullerton Health's Migrant Worker Primary Care Plan (PCP) programme that was first disclosed earlier this week, the healthcare provider said on Saturday (Nov 14)."
    evidence_from: "data/sources/2026-11-14/research-cna-asia-article-7ylif.html"
  - value: "43,000"
    unit: "records belonging to individuals whose work passes were no longer valid"
    period: "as of 14 November 2026"
    source: "Fullerton Health, reported by CNA"
    retrieved: "2026-11-14"
    evidence: "Of those, about 43,000 records belonged to individuals whose work passes were no longer valid, Fullerton Health said in response to CNA queries."
    evidence_from: "data/sources/2026-11-14/research-cna-asia-article-7ylif.html"
  - value: "Oct 31"
    unit: "date Fullerton Health became aware of the breach"
    period: "2026"
    source: "Fullerton Health notice of 9 November 2026, reported by CNA"
    retrieved: "2026-11-14"
    evidence: "Fullerton Health had said in a Nov 9 notice on its website that it became aware of the breach on Oct 31, without disclosing the number of workers affected at the time."
    evidence_from: "data/sources/2026-11-14/research-cna-asia-article-7ylif.html"
  - value: "Nov 9"
    unit: "date of Fullerton Health's public notice on its website"
    period: "2026"
    source: "Fullerton Health, reported by CNA"
    retrieved: "2026-11-14"
    evidence: "Fullerton Health had said in a Nov 9 notice on its website that it became aware of the breach on Oct 31, without disclosing the number of workers affected at the time."
    evidence_from: "data/sources/2026-11-14/research-cna-asia-article-7ylif.html"
  - value: "14 Nov 2026"
    unit: "publication date of the CNA report"
    period: "2026"
    source: "CNA"
    retrieved: "2026-11-14"
    evidence: "Chelsea Ong Chelsea Ong 14 Nov 2026 06:47PM"
    evidence_from: "data/sources/2026-11-14/research-cna-asia-article-7ylif.html"
---

## AI Summary

Fullerton Health said on 14 November 2026 that about 140,000 work pass holder records were compromised in a cybersecurity incident affecting its Migrant Worker Primary Care Plan programme, first flagged in a 9 November 2026 website notice. About 43,000 of those records belonged to people whose passes were no longer valid. Malaysian workers in Singapore hold the same kind of pass, so the exposed fields — name, FIN, date of birth, phone, email, home address — are the ones they carry too.

## What happened

Fullerton Health, a healthcare provider that runs a primary care programme for migrant workers in Singapore, said on 14 November 2026 that about 140,000 work pass holder records were compromised in a cybersecurity incident. The figure was reported by Channel NewsAsia (CNA) on the same day, in a report dated 14 November 2026.

The programme at the centre of it is the Migrant Worker Primary Care Plan (PCP). Under that programme, a worker's employer arranges primary healthcare through a provider, and the provider holds a record tied to the worker's pass.

Fullerton Health had already gone public once. In a notice on its website dated 9 November 2026, the company said it became aware of the breach on 31 October 2026. That notice did not disclose how many workers were affected. The 140,000 figure came five days later, in response to CNA queries.

The same response carried a second number. Of the roughly 140,000 records, about 43,000 belonged to individuals whose work passes were no longer valid, Fullerton Health said. That is a detail about the shape of the dataset: a primary care programme keeps records after a pass lapses, so the file holds both current and former pass holders.

> **Work pass holder record:** the file a clinic or programme keeps about a person who holds a permit to work in Singapore. It ties an identity — name, pass number, date of birth, contact details — to the healthcare the programme provides. It is not the medical file itself; it is the enrolment record that sits in front of it.

The directive for this piece lists the exposed fields as name, FIN, date of birth, phone, email and home address, and states that medical and financial data were not exposed. The FIN is the Foreign Identification Number, the unique identifier Singapore issues to a foreigner who holds a long-term pass there. It is the number a worker's employer, clinic, landlord and bank all use to identify them.

| Item | What the source says | Date | Source |
|---|---|---|---|
| Records compromised | About 140,000 work pass holder records | Disclosed 14 November 2026 | Fullerton Health, reported by CNA |
| Records with lapsed passes | About 43,000 | As of 14 November 2026 | Fullerton Health, reported by CNA |
| Date breach was noticed | 31 October 2026 | Stated in notice | Fullerton Health notice of 9 November 2026, reported by CNA |
| Date of first public notice | 9 November 2026 | Stated in notice | Fullerton Health, reported by CNA |
| Date the number was published | 14 November 2026 | Report date | CNA |

## Why now

The thread here is not two or three years long. It is two weeks long, and that is the point.

The sequence runs: 31 October 2026, the company becomes aware; 9 November 2026, it posts a notice that confirms an incident but gives no count; 14 November 2026, it gives the count. Each step is a separate document, and the gap between them is where a worker's uncertainty lives. A person who read the 9 November notice learned that something happened but not whether it happened to them.

The second reason this surfaced now is structural. Migrant worker healthcare in Singapore is delivered through employer-arranged programmes, which means the record holder is not the worker and not the government — it is a contracted provider. When a provider is breached, the notification path runs provider to employer to worker, and the worker is last in line. The 14 November disclosure is the point at which the count became public, not the point at which the risk began.

The third reason is that a lapsed-pass record is still a record. The 43,000 figure shows the dataset does not shrink when a worker leaves. A Malaysian who worked in Singapore, went home, and let the pass expire is still in that file.

## So what

The gain lands on anyone who wants to know whether their identity details are circulating. A count of 140,000 turns a vague notice into a checkable question. Before 14 November, a worker had no scale to reason with. After it, the question is concrete: was my enrolment record in the PCP file.

The cost lands on the workers whose identity fields are now outside the provider's control. The mechanism is straightforward and does not require anyone to have done anything wrong. A record that holds a name, a FIN, a date of birth, a phone number, an email and a home address is a set of answers to the questions a stranger asks to impersonate someone — to open an account, to redirect a delivery, to talk their way past a front desk. The breach did not hand over medical histories or bank details, and that limits the damage. It does not eliminate it, because identity fields are the raw material for the next step, whatever that step turns out to be.

The third actor is the employer. An employer that enrolled its workers in the PCP programme holds the same roster. If the provider's file was exposed, the employer's own list is the natural place to cross-check who was enrolled and when, and it is the party with a duty to tell its workers what it knows.

## What it means for Malaysia

The carrier is the Malaysian passport holder working in Singapore on a work pass. That worker's clinic enrolment sits in exactly the kind of file that was breached, because the programme is the same programme and the pass is the same kind of pass. The exposure is not a Malaysian system failing; it is a Malaysian worker standing inside a Singapore system that failed.

The concrete consequence is a verification task, not a compensation claim. A Malaysian worker in Singapore can ask their employer whether they were enrolled in the PCP programme, and can check the provider's own notice for the instructions it gives affected individuals. The fields at risk — name, FIN, date of birth, phone, email, home address — are the ones a worker uses to prove who they are at a clinic counter, a dormitory office or a remittance window. A worker who knows those fields are out can watch for approaches that quote them back.

The second Malaysian carrier is the household back home. A worker's Singapore phone number and email are often the contact points a family in Johor, Perak or Sabah uses to reach them. A message that arrives quoting a correct FIN and date of birth is more convincing than one that does not, and the family is the audience for it.

The third carrier is the recruitment and placement industry. Agencies that place Malaysian workers in Singapore hold identity documents as a matter of routine. The breach is a reminder that the identity data of a Malaysian worker is held in several places at once, and that the worker rarely knows the full list.

For readers tracking how Malaysia handles the same problem on its own side of the causeway, the regional context is set out in [Malaysia's push for an Asean cybersecurity strategy](/blog/asean-cybersecurity-cooperation-strategy-2026-2030-malaysia/), and the domestic scale of online fraud is visible in [the 174,099 scam post takedown requests](/blog/mcmc-scam-post-removal-requests-174099-october-2026/). Workers weighing a move to Singapore can read [what the JS-SEZ arrangement means for cross-border employment](/blog/js-sez-rm88-8bil-approved-investments-jscmc-2026/).

## How confident

**Confirmed.** Fullerton Health said on 14 November 2026 that about 140,000 work pass holder records were compromised in the incident affecting its Migrant Worker Primary Care Plan programme, and that about 43,000 of those records belonged to individuals whose work passes were no longer valid. The company's 9 November 2026 website notice said it became aware of the breach on 31 October 2026 and did not disclose a count at that time. All of this rests on a single CNA report dated 14 November 2026, which quotes the company's responses and its notice. One document, one source chain.

**Inferred.** The exposed fields listed for this piece — name, FIN, date of birth, phone, email, home address — are the identity fields a primary care enrolment record would carry, and the directive states that medical and financial data were not exposed. From that I infer the practical risk is impersonation and convincing contact rather than medical disclosure or direct loss of money. That is an inference about the shape of the risk, not a statement the company made. I also infer that a Malaysian worker on a Singapore work pass is inside the affected population, because the programme covers work pass holders and the pass is the same instrument. The company has not said how many of the 140,000 are Malaysian.

**What would change my mind.** A statement from Fullerton Health or from a Singapore authority naming the nationalities in the affected set, or a breakdown of the exposed fields that differs from the list above. A confirmed report that medical or financial data was in fact exposed would change the risk assessment entirely. And a notification from an employer to its Malaysian workers confirming enrolment would move the Malaysian link from inference to fact.

> Also read: [Selangor maps 56 flood hotspots and 232 flood-prone areas as Northeast Monsoon begins](/blog/selangor-flood-hotspots-56-northeast-monsoon-2026/)

> Also read: [SIA A350 diverted twice in a week for cabin smoke: what it means for Malaysia's aviation maintenance and safety checks](/blog/sia-a350-smoke-rockhampton-cabin-safety-malaysia-aviation/)

> Also read: [Health Ministry blames contractor for ambulance shortage: 115 of 590 delivered by end-2024](/blog/ambulance-procurement-delay-115-units-2024/)

## For you

- **A Malaysian on a Singapore work pass right now:** ask your employer whether you are enrolled in the Migrant Worker Primary Care Plan, and read the provider's notice for what it asks affected individuals to do. Your name, FIN, date of birth, phone, email and home address are the fields at issue.
- **A Malaysian whose Singapore pass has already lapsed:** the 43,000 figure covers people whose passes were no longer valid, so a returned worker is not automatically outside the file. Treat a message that quotes your old FIN correctly as a reason to verify through a channel you already trust, not to reply.
- **A family in Malaysia receiving calls and messages for a relative working in Singapore:** the contact details on the record are often the ones the family uses. Agree in advance that any request for money or documents gets confirmed by a call back to a number you already hold.
- **A small recruitment or placement agency sending Malaysian workers to Singapore:** your own files hold the same identity documents. Check who in the firm can see them, and tell placed workers what to do if a message quotes their FIN and date of birth back at them.

## The data point

> **140,000** — work pass holder records compromised in the Fullerton Health Migrant Worker Primary Care Plan incident, disclosed on 14 November 2026. About **43,000** of them belonged to people whose work passes were no longer valid.

## How we calculated this

The two figures in the disclosure let a reader size the lapsed-pass share of the file. The arithmetic uses only the numbers Fullerton Health gave to CNA on 14 November 2026.

```text
Records compromised (Fullerton Health, 14 Nov 2026):        140,000
Records with lapsed work passes (same source):               43,000

Share of the file belonging to lapsed pass holders:
  43,000 / 140,000 = 0.3071  ->  about 31 per cent

Records belonging to holders of a valid pass at disclosure:
  140,000 - 43,000 = 97,000
```

Read plainly: roughly three in every ten records in the exposed file belong to someone who no longer holds a valid pass. The remaining 97,000 belong to people who, on the company's own account, held a valid pass when the count was given. The calculation says nothing about how many of either group are Malaysian; the company has not published that split.

## FAQ

**Was medical or financial information exposed in the Fullerton Health breach?**

On the information set out for this piece, the exposed fields are name, FIN, date of birth, phone, email and home address, and medical and financial data were not exposed. That distinction matters for what a worker should watch. A leaked medical history creates one kind of problem; a leaked set of identity fields creates another, because those fields are what a stranger needs to sound like you. The practical step is the same either way: confirm with your employer whether you were enrolled in the Migrant Worker Primary Care Plan, and follow the instructions the provider gives to affected individuals rather than instructions that arrive in an unsolicited message.

**I am Malaysian and my Singapore work pass expired years ago. Am I in the file?**

The company said about 43,000 of the roughly 140,000 records belonged to individuals whose work passes were no longer valid. That figure is the reason a former pass holder cannot assume they are outside the dataset. A primary care programme keeps enrolment records after a pass lapses, and the disclosure counts those records as part of the breach. What the company has not published is a list, a nationality split or a per-person notification route. A former pass holder's practical move is to check the provider's notice and to treat any message quoting an old FIN and date of birth as something to verify independently.

**What can a Malaysian worker actually do with this information?**

Three things, in order. First, establish whether you were enrolled: your employer arranged the coverage, so your employer holds the roster. Second, read the provider's own notice for what it says to affected individuals, and use the contact route the provider publishes rather than one that reaches you first. Third, treat the exposed fields as known to others. A caller who quotes your FIN, date of birth and old address correctly has not proved they are official; they have proved they read a file. Verify through a number or an office you already use, and tell the family members whose contact details sit alongside yours on the same record.

## The point

A breach notice with no number is a rumour; a breach notice with a number is a task. The 14 November 2026 disclosure turned 140,000 into a figure a Malaysian worker in Singapore can act on, and the 43,000 lapsed-pass records turned it into a figure that reaches people who have already gone home. The exposed fields are identity fields, not medical ones, and that limits the harm without removing it. The worker's move is unglamorous: find out whether you were enrolled, read what the provider says to people who were, and treat anyone who quotes your FIN back at you as someone holding a file rather than someone holding authority.