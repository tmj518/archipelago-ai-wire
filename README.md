# Archipelago AI Wire

An independent Malaysian publication that helps people understand the world: what is happening, why it
is happening, and what it means for Malaysia.

**Canonical site:** https://www.toolsai.club

Every piece answers three questions — what happened, why now, and what it means here — and every figure
carries a value, a unit, a period, a named source and the date it was retrieved. A claim that cannot be
traced to a document does not run.

---

## How it is built

A static [Astro](https://astro.build) site. No server, no framework runtime, no database.

```
src/pages/          routes: home, four category silos, guide, topic, about, sources, contact, terms
src/layouts/        BaseLayout (head, JSON-LD, robots) and ArticleLayout (article shell)
src/components/     navigation, cards, sources block, analytics
src/lib/            taxonomy, schema rules, figures, prose, sources, archive state, analytics
src/content/        blog/ and guide/ collections (currently empty — the first pieces are being written)
public/             favicon, default OG image, _headers, _redirects, IndexNow key
tools/              the gate suite, the content pipeline, the sitemap integrations
tests/              fixture suite, build assertions, Feishu safety suite
```

### Content model

Two collections, defined in `src/content.config.ts`:

- **blog** — the explainers. Category, audience, five-part figures, sources, required section headings.
- **guide** — practical, procedure-shaped pieces. Steps, a unit, and the date each figure was checked.

The controlled vocabulary lives in exactly one place, `src/lib/taxonomy.json`: four categories
(`world`, `malaysia-impact`, `tech-ai`, `economy`), six audiences, six guide topics, and the seven
required article sections. `tools/check-schema-parity.mjs` fails the build if the schema, the constraint
list and the writer's prompt stop agreeing with it.

---

## Content standards

The full brief the writing pipeline reads is [`MASTER_PROMPT.md`](MASTER_PROMPT.md). In short:

1. **Three questions, or it does not run.** What happened; why now; what it means for Malaysia.
2. **Five parts per figure** — value, unit, period, named source, retrieval date. Currency goes in the
   unit field, not in the value.
3. **Never invent.** No number, quotation, person or experience that is not in the material.
4. **A world story with no Malaysian consequence still runs — and says so.** An invented consequence does
   not.
5. **Race, religion and royalty are reportable and reported carefully.** A piece touching them needs a
   named human reviewer recorded in the frontmatter before it can publish; without one it is quarantined.

---

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev            # local dev server
pnpm build          # static build to dist/
pnpm preview        # serve the built output
```

Environment variables (all optional; the build works without them):

```
PUBLIC_SITE_URL                   canonical origin override (default https://www.toolsai.club)
PUBLIC_GA_ENABLED                 "true" to emit analytics at all; off unless set
PUBLIC_GA_MEASUREMENT_ID          GA4 id, G-XXXXXXXXXX
PUBLIC_GOOGLE_SITE_VERIFICATION   Search Console verification value
```

Analytics is fail-closed: the tag is emitted only when the switch is on **and** the id is in GA4's format.
A missing, malformed or inherited id renders nothing. See `src/lib/analytics.mjs`.

---

## Tests and quality gates

Ten gates run on every push and pull request (`tools/gate.mjs`):

```bash
node tools/gate.mjs --fresh          # all ten; a failure blocks the build
```

| Gate | What it enforces |
|---|---|
| structural (`qa-check`) | frontmatter, figures, sections, sources, sensitive-term and 3R screening |
| reviewer | a second model reads the draft |
| internal links | no dead internal link |
| structured data | JSON-LD present on indexable pages, absent on noindex ones |
| contrast | text contrast against the design tokens |
| titles and descriptions | length and uniqueness across the site |
| CSP | the emitted policy matches the scripts actually emitted |
| SPA/SERP check | information gain against the sources |
| mobile layout | a real browser measures horizontal overflow |
| schema and vocabulary parity | schema, constraint list and prompt agree with `taxonomy.json` |

Other suites:

```bash
node tests/run-fixtures.mjs          # gate fixtures, taxonomy, figure classifier, prompt parity
node tests/build-assertions.mjs      # dist-level: canonical origin, sitemap, noindex, analytics
node tests/feishu-safety.mjs         # the ledger never creates a base without --create-base
```

`tests/build-assertions.mjs` needs a build first:

```bash
pnpm build && node tests/build-assertions.mjs
```

---

## Deployment

Static output for Cloudflare Pages: build command `pnpm build`, output directory `dist/`.
`public/_headers` and `public/_redirects` are copied verbatim. The bare domain 301s to www; the canonical
origin is a single constant in `src/consts.ts`.

No workflow in this repository deploys. Deployment is a hosting-provider action, deliberately kept out of
CI.

---

## Project history

This repository began as a different publication and was rebuilt for Malaysia in October 2026. The
previous project's working tree is preserved in a Git tag created at the moment of the migration; its
documentation and run records were moved out of the working tree to an archive outside this repository.
The current branch is `migration/archipelago-phase1`.
