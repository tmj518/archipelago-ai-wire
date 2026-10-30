# docs/

Working documents for this project. Only what is still used to make decisions lives here.

| File | What it is |
|---|---|
| `选题计划_2026-10-26_首批10题.md` | The first ten candidate subjects: the question each answers, the primary sources, the figures that are already verifiable, and the evidence gap. A plan, not published content. |
| `MASTER_WRITER_PROMPT.md` | The full writing brief: evidence hierarchy, the kinds of writable subject, the fact/inference/unknown split, the pre-publication checklist. |

## The working rules, and the mistakes that produced them

Three days of building the cloud pipeline produced these. They are not preferences; each one is a
failure that cost an afternoon.

**1. Change one thing, push, run it in the cloud, read the log, then decide.** A local pass is not
evidence: two of the bugs below were green locally and broken in the runner. One change per push, or
the log cannot tell you which change did it.

**2. Prove the new code ran before saying it is fixed.** A repair block was written three times and
never executed, because it hung off a condition that was false; the log line it prints never appeared
and that was the tell. If you cannot point at a line of output produced by the new code, it did not run.

**3. A success state is a claim about the world, not a variable assignment.** `run.verdict = "PUBLISHED"`
was unconditional, so one run reported publication while the repository gained no file and the URL
answered 404. Every terminal state now has a precondition, and one function decides it.

**4. Ask git, not the journal.** The idempotency guard trusted a run journal that records "the draft was
written", not "the article shipped". A phantom entry made every later run exit in a second believing the
day was done. The collection is the fact; the journal is a note.

**5. An empty answer is a failure.** A model call that returned no content was treated as success, so
the retry and the provider failover never fired and the run reported a parse error about nothing.

**6. A dead endpoint is not a bad request.** `ETIMEDOUT` was retried three times against the same host.
Network faults and retryable 5xx switch provider; auth and parameter errors stop, because switching
would hide them.

**7. Format is assembled by code; the model writes prose.** Every rejection for a week was presentation:
no figures array, no table, no calculation fence, a hedging word, an FAQ section absent, a description
seven characters over the limit. The model is asked to say the thing; the frontmatter, the table, the
FAQ shell and the trimming are done here.

**8. Read one field's path before writing to it.** The figures injector opened `data/directive.json`
while the run passed `--directive-file=data/tmp/directive.json`; it found nothing, returned quietly, and
every draft went to review without figures.

**9. Gate the file this run wrote.** `--all` let a leftover draft from a failed attempt decide the fate
of a clean run.

**10. Feishu is the ledger, and a record is not correct because it exists.** One row was written with
the branch name as the slug and a URL that 404s. Read the record back, compare the fields, and correct
in place rather than deleting.

**11. A quiet day is not a failure.** When research reports no subject, the steps that follow skip; a
gate that ran anyway turned a clean day red.

The third rule in the operator's own words: *改一条 → 推一次 → 云端跑一次 → 读日志验证一次。*


The writing brief the pipeline actually reads is not here — it is [`../MASTER_PROMPT.md`](../MASTER_PROMPT.md),
because the automation reads one instruction file and that file has to be at the root.

## What is not here

The previous project's documentation — the handover, the retrospectives, the operations log, the old
roadmap, the source inventory, the pricing notes and the archived specifications — was moved out of this
working tree on 2026-10-26 and archived outside the repository. It remains in Git history, and the
migration decisions it drove are recorded in the commits on `migration/archipelago-phase1`.

It was removed rather than reorganised because a new publication that carries another publication's
operating records is not a clean project; it is a project with an attic. Keeping it in Git is enough for
anyone who needs to know how the current design was reached.
