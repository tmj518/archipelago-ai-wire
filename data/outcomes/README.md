# data/outcomes — one record per published piece

The evaluator (`tools/eval-loop.mjs`) reads only this directory. One JSON file per article per
locale, named `<locale>-<article_id>.json`. Keep it one record per file: a file that holds an array
cannot be appended to without rewriting it, and rewriting is how measurement histories get lost.

## The record

```jsonc
{
  "article_id": "malaysia-minimum-wage-rm1700-order-2024",  // the slug, stable
  "locale": "en",                                            // en | ms | zh
  "translation_key": "malaysia-minimum-wage-rm1700-order-2024",
  "published_at": "2026-10-26",                              // ISO date, required

  "provenance": "observed",   // "observed" | "simulated"
  "fixture": false,           // true ONLY for records written to test the tool

  "decision": {
    "selected_at": "2026-10-26",
    "selector": null,          // which selection run picked it, null if unrecorded
    "candidate_rank": null,    // where it ranked in the candidate list
    "candidates_considered": null
  },

  "generation": {
    "prompt_version": "writer-2026-10-26.a",  // null for anything written before 2026-10-26
    "model": null,
    "generated_at": null,
    "cost_usd": null,
    "tokens": null
  },

  "review": {
    "gates_first_pass": true,  // did the ten gates pass without a rework round?
    "rework_rounds": 0,
    "corrections": 0,          // published corrections recorded against this piece
    "qa_summary": "27 pass / 0 warn / 0 block"
  },

  "measurements": [
    { "window": "d7",  "captured_at": "2026-11-02", "clicks": null, "impressions": null, "ctr": null, "position": null, "source": "gsc" },
    { "window": "d28", "captured_at": "2026-11-23", "clicks": null, "impressions": null, "ctr": null, "position": null, "source": "gsc" }
  ]
}
```

## The rules that matter

**`null` is not zero.** A missing measurement is recorded as `null` and excluded from averages. A
zero is a measurement of nothing happening; `null` is the absence of a measurement. Collapsing them
turns an unmeasured corpus into one that looks like it is failing.

**`provenance: "simulated"` never counts.** Records marked simulated are excluded from every
performance metric, always. `--include-simulated` prints them next to the report so a reader can see
they exist; it does not let them into a rate.

**`fixture: true` never counts either.** The two flags are separate on purpose: a fixture is a test
artefact, a simulation is a modelled scenario, and neither is an observation.

**Maturity is computed, not declared.** A `d7` measurement counts only when
`captured_at >= published_at + 7 days`, and `d28` only when `captured_at >= published_at + 28 days`.
A record that carries a `d7` block captured the day after publication is a mislabelled record, and the
evaluator counts it as immature rather than believing the label.

**`prompt_version: null` is a fact.** Articles published before the version constant existed are
grouped as `unknown`. They are not backfilled with the current version: the instructions they were
written against did not have a version, and pretending otherwise would corrupt every comparison that
follows.

## Adding a record

Written by hand today. When `tools/gsc-report.mjs` and `tools/analytics.mjs` are confirmed working
with credentials, they append the `measurements` entries; until then the fields stay `null` and the
evaluator reports the coverage honestly.
