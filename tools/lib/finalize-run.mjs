const QUIET_VERDICTS = new Set([
  "QUIET", "IDLE", "NO-SUBJECT", "CEILING", "DUPLICATE-SUBJECT", "NO-DIRECTIVE", "CHECK-ONLY", "QUOTA_MET",
]);

export function finalizeRunReport(input, context) {
  const runAttempt = Number(context.runAttempt);
  const validAttempt = Number.isInteger(runAttempt) && runAttempt > 0;
  const sameRun = Boolean(input && context.runId && String(input.runId) === String(context.runId));
  const sameAttempt = Boolean(sameRun && validAttempt && Number(input.runAttempt) === runAttempt);
  const report = sameAttempt ? { ...input } : {
    at: context.at,
    route: "script",
    steps: [],
    reasons: [sameRun ? "the report belongs to another or unknown workflow attempt" : "the workflow did not produce a report for this run"],
    reviewer: { status: "NOT_RUN" },
    registry: { status: "NOT_RUN" },
    article: null,
    commit: null,
  };
  const preparedVerdict = String(report.orchestratorVerdict ?? report.verdict ?? "FAILED");
  report.orchestratorVerdict = preparedVerdict;
  report.runId = context.runId || report.runId || null;
  report.runAttempt = validAttempt ? runAttempt : null;
  report.finalizationKey = report.runId && validAttempt ? `${report.runId}:${runAttempt}` : null;
  report.workflow = context.workflow || report.workflow || null;
  report.event = context.event || report.event || null;
  report.executionSha = context.executionSha || report.executionSha || null;
  report.finalizedAt = context.at;
  report.commit = context.publishCommit || null;
  report.publicationStatus = "FAILED";
  report.productionUrl = report.article ? `https://www.ghiblistyled.com/blog/${report.article}/` : null;
  report.executionConclusion = context.jobStatus;
  report.verifyOutcome = context.verifyOutcome;
  report.liveChecks = context.verifyOutcome === "success"
    ? { canonical: true, titleMatchesGeneratedArticle: true, bodyEvidenceMatches: true, sitemapContainsArticle: true, rssContainsArticle: true }
    : { status: context.verifyOutcome ?? "UNKNOWN" };
  const reportingStep = (outcome) => outcome === "RECORDED" ? "RECORDED" : outcome === "SKIPPED_NO_ARTICLE" ? "NOT_APPLICABLE" : outcome === "success" ? "RECORDED" : outcome === "failure" ? "FAILED" : "UNKNOWN";
  report.recording = {
    rejectionReport: reportingStep(context.rejectionReportOutcome),
    feishuRelease: reportingStep(context.feishuReleaseOutcome),
    feishuRunLedger: reportingStep(context.feishuRunLedgerOutcome),
    githubRunLedger: "UNKNOWN (commit/push follows this finalization step)",
  };
  report.recordingFailure = Object.values(report.recording).some((status) => status === "FAILED");

  const reviewerApproved = report.reviewer?.status === "APPROVED" && report.reviewer?.independent === true;
  const registryRebuilt = report.registry?.status === "REBUILT";
  if (!validAttempt) {
    report.verdict = "FAILED";
    report.reasons.push("workflow run_attempt is missing or invalid; refusing to finalize without an attempt identity");
  } else if (preparedVerdict === "READY_FOR_PUBLISH" && sameAttempt && reviewerApproved && registryRebuilt && context.jobStatus === "success" && context.verifyOutcome === "success" && /^[a-f0-9]{40}$/i.test(context.publishCommit ?? "") && report.article) {
    report.verdict = "PUBLISHED";
    report.publicationStatus = "PUBLISHED";
    report.liveVerifiedAt = context.at;
  } else if (sameAttempt && QUIET_VERDICTS.has(preparedVerdict) && context.jobStatus === "success") {
    report.verdict = "QUIET";
    report.publicationStatus = "QUIET";
    report.commit = null;
  } else {
    report.verdict = "FAILED";
    if (!Array.isArray(report.reasons)) report.reasons = [];
    if (preparedVerdict === "READY_FOR_PUBLISH" && !reviewerApproved) {
      report.reasons.push("publication not finalized: independent reviewer approval is missing");
    } else if (preparedVerdict === "READY_FOR_PUBLISH" && !registryRebuilt) {
      report.reasons.push("publication not finalized: registry rebuild is not confirmed");
    } else if (preparedVerdict === "READY_FOR_PUBLISH" && context.verifyOutcome !== "success") {
      report.reasons.push(`publication not verified live; verify step outcome=${context.verifyOutcome ?? "unknown"}`);
    } else if (preparedVerdict === "READY_FOR_PUBLISH" && !/^[a-f0-9]{40}$/i.test(context.publishCommit ?? "")) {
      report.reasons.push("publication commit SHA was not confirmed after remote push");
    } else if (!sameAttempt) {
      report.reasons.push("stale or missing run-attempt report was replaced with this failed workflow record");
    }
  }
  return report;
}

export function finalizeState(input, report) {
  const state = input && typeof input === "object" ? { ...input } : {};
  const runId = report.runId == null ? null : String(report.runId);
  const attempt = Number(report.runAttempt);
  const finalizedRuns = state.finalizedRuns && typeof state.finalizedRuns === "object" ? { ...state.finalizedRuns } : {};
  if (!state.finalizedRuns && state.lastFinalizedRunId != null) {
    finalizedRuns[String(state.lastFinalizedRunId)] = {
      runAttempt: Number(state.lastFinalizedRunAttempt) || null,
      verdict: state.lastVerdict ?? "UNKNOWN",
    };
  }
  const previous = runId ? finalizedRuns[runId] : null;
  const wasPublished = previous?.verdict === "PUBLISHED" || (!previous && runId != null && String(state.lastFinalizedRunId ?? "") === runId && state.lastVerdict === "PUBLISHED");
  const isPublished = report.verdict === "PUBLISHED" && Boolean(report.article && report.commit);
  const publishedRuns = new Set(Array.isArray(state.publishedRunIds) ? state.publishedRunIds.map(String) : []);
  if (!state.publishedRunIds && state.lastVerdict === "PUBLISHED" && state.lastFinalizedRunId != null) publishedRuns.add(String(state.lastFinalizedRunId));
  if (runId && isPublished) publishedRuns.add(runId);
  else if (runId) publishedRuns.delete(runId);
  const countDelta = Number(isPublished) - Number(wasPublished);
  if (runId) finalizedRuns[runId] = { runAttempt: Number.isInteger(attempt) ? attempt : null, verdict: report.verdict, finalizationKey: report.finalizationKey ?? null };
  state.lastRun = report.finalizedAt;
  state.lastVerdict = report.verdict;
  if (report.verdict === "PUBLISHED" && report.article) {
    state.lastArticle = report.article;
  }
  state.lastFinalizedRunId = report.runId ?? null;
  state.lastFinalizedRunAttempt = Number.isInteger(attempt) ? attempt : null;
  state.lastFinalizedKey = report.finalizationKey ?? null;
  state.finalizedRuns = finalizedRuns;
  state.publishedRunIds = [...publishedRuns];
  state.published = Math.max(0, (Number(state.published) || 0) + countDelta);
  state.lastCommit = report.verdict === "PUBLISHED" ? report.commit : null;
  state.lastReviewer = report.reviewer ?? { status: "NOT_RUN" };
  state.lastRegistry = report.registry ?? { status: "NOT_RUN" };
  state.lastRecording = report.recording ?? { status: "UNKNOWN" };
  return state;
}
