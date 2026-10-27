# data/gsc - what these files are, and what they are not

**Provenance: `legacy_unverified`.** None of the files in this directory is a data export for
Archipelago AI Wire. They are run logs and failure markers produced on 2026-10-02 .. 2026-10-26 by the
**previous publication's** workspace, and they were already in the working directory when this project
was rebuilt.

| Marker | Meaning | Count |
|---|---|---|
| `.log` | a run log from the old workspace (`出淘官网更新工作流` in its own output paths) | 13 |
| `.failed` | the marker written when that run aborted | 13 |
| data files (`*.json`, `*.csv`) | **none** | 0 |

Every one of the 13 runs failed. Twelve report `GSC not configured. Set GSC_CREDENTIALS and
GSC_SITE_URL in .env.keywords`; one reports `DECODER routines::unsupported` (a malformed key). The logs
also claim `49 published articles`, which was true of the old site and is not true of this one.

## Rules for anything that reads this directory

1. These files **must not** enter any metric, trend, model input or demand-signal analysis. They are
   evidence that a job was attempted, not evidence about search performance.
2. A file's presence here says nothing about whether GSC is authorised, configured, or ever ran for
   *this* project. It did not.
3. Future real captures belong at `data/gsc/gsc-<site>-<window>-<captured_at>.json` and must carry
   `provenance: observed` plus the fields listed in `docs/成本与数据资产审计_2026-10-27.md`.
4. The failure counts are kept on purpose - they are the audit trail for "has this ever worked".