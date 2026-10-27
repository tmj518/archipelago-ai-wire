# data/reviews — one record per editorial review

The rubric is `docs/编辑评分表_v1.md`. This directory holds what reviewers actually concluded.
It is kept separate from `data/outcomes/` on purpose: a review is a judgement about a draft, an
outcome is a measurement of a published piece. Merging them would let a reviewer's score look like
performance data, which is exactly the blend the doctrine forbids.

## The record

```jsonc
{
  "review_id": "rev-2026-10-27-001",
  "article_id": "malaysia-minimum-wage-rm1700-order-2024",
  "locale": "en",
  "reviewer_id": "r-editor-a",          // pseudonymous; the mapping lives outside the repo
  "reviewed_at": "2026-10-27",

  "prompt_version": null,               // null when unknown - never backfilled
  "review_type": "blind",               // blind | normal
  "provenance": "observed",             // observed | simulated
  "fixture": false,

  // Six scores from the rubric. null means "not scored", and `na` must say why.
  "scores": {
    "conclusion": 3,
    "sourcing": 2,
    "mechanism": 2,
    "malaysia_impact": 2,
    "uncertainty": 2,
    "actionability": null
  },
  "na": { "actionability": "explanatory piece with no reader action; rubric allows N/A" },

  // Independent of the scores. Any true value blocks publication.
  "red_lines": {
    "unsourced_key_fact": false,
    "unverifiable_number": false,
    "fabricated_interview": false,
    "prediction_as_fact": false,
    "stale_source": false
  },
  "red_line_notes": [],

  "issues": [
    { "criterion": "sourcing", "problem": "rate table verified second-hand", "evidence": "gazette is a scanned PDF", "suggested_fix": "read the PDF and cite the schedule" }
  ],

  // Paired re-review. Both halves or neither; a lone `after` is not a delta.
  "revision": { "before": null, "after": null, "revised_at": null },

  // What the reviewer could not see at the time of scoring. Blind reviews must list at least
  // prompt_version, model, traffic and other_reviews.
  "blind_to": ["prompt_version", "model", "traffic", "other_reviews"]
}
```

## The rules that matter

**`null` is not zero.** A criterion left unscored is excluded from its mean and counted in the
missing rate. Averaging it as 0 would turn "we did not judge this" into "this was bad".

**`N/A` needs a reason.** If `scores.x` is null, `na.x` must be a sentence. The evaluator reports
those reasons rather than treating the gap as a defect.

**Simulated never counts.** `provenance: "simulated"` or `fixture: true` records are counted, printed
and excluded from every editorial metric - the same rule as `data/outcomes/`.

**Blind means blind.** `review_type: "blind"` may only be used when the reviewer scored before seeing
the prompt version, the model, the traffic numbers and any other reviewer's scores. Those four go in
`blind_to`. A record that lists fewer than those four is reported by the evaluator as a suspect blind
review rather than trusted.

**Inter-reviewer agreement needs two reviewers.** With one reviewer there is nothing to compare, and
the report says so instead of inventing a consistency figure.

**A delta needs a pair.** `revision.before` and `revision.after` must both be present and both real.
A single re-score is a new review, not an improvement.

## What is in this directory today

`example.fixture.json` only - a worked example with `provenance: "simulated"` and `fixture: true`, so
the evaluator has something to parse in a clean checkout and cannot mistake it for a real review.
**No article has been blind-reviewed yet.** The first real record appears when a reviewer files one.
