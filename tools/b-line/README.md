# B线

The second automation line. **Dormant until switched on** - it runs nothing while
`B_LINE_ENABLED` is unset, so an unfinished line cannot fail three times a week.

## What it is for

One English deep-dive per scheduled day on a WordPress site: a real, checkable one-person business
case - who they are, what they built, how they got customers, how they make money, what it cost and
what it earns now, and what a reader can copy. Not team-funded startups.

## What is here

| File | What it does |
|---|---|
| `tools/b-line/publish-wp.mjs` | Lists the category's existing posts, refuses a duplicate slug, publishes one markdown file over the WP REST API, then fetches the public URL and checks the title is on the page. |
| `.github/workflows/b-line.yml` | Tuesday / Thursday / Saturday at 05:00 UTC (13:00 Malaysia), gated on `B_LINE_ENABLED`. |

## What is not here, deliberately

**The writing.** The script publishes a finished article; it does not choose a case or research one.
That is the part the first line already knows how to do badly and the second line must do well, and
inventing it inside a publish script would be the wrong shape.

**The credentials.** A WordPress site needs `WP_SITE`, `WP_USER`, `WP_APP_PASSWORD` and
`WP_CATEGORY_ID` as repository secrets. Until they exist the workflow stays off.

**The images.** Media upload is a separate concern; the first version publishes text and a title, and
the cover is added when the image step exists.

## Turning it on

1. Add the four secrets above.
2. Set the repository variable `B_LINE_ENABLED=1`.
3. Put a finished markdown file in place of `data/b-line/draft.md` - the workflow refuses to run
   without one rather than publishing a placeholder.

## How it differs from A线

| | A线 · 大马看世界出版线 | B线 |
|---|---|---|
| Site | Astro on Cloudflare Pages | WordPress over REST API |
| Cadence | daily 02:00 MYT | Tue / Thu / Sat 13:00 MYT |
| Language | English, Malaysian reader | English, global reader |
| Subject | one dated event or a named document | one verifiable one-person business case |
| Gate | 11 build gates before publishing | duplicate slug check, then live check after |
| Recorded as | `line: "A"` | `line: "B"` |
