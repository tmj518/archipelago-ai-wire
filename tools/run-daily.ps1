# run-daily.ps1 - the full daily job for Landed Math: review, write, gate, publish.
#
# Launched by Windows Task Scheduler as LandedMath-Daily, and safe to run by hand:
#     powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-daily.ps1
#
# The task text comes from daily-task.txt and is piped into `dsh headless -`.
#
# KEEP THIS FILE PURE ASCII, and keep the task file's NAME pure ASCII. No em dashes,
# no warning symbols, no Chinese, not even inside comments.
#
# Why, precisely. On 2026-10-08 the 08:10 run died on its second line with "task file
# not found", and the path in the error was mojibake. The task file was named in
# Chinese, this script had lost its UTF-8 BOM, and Windows PowerShell 5.1 therefore
# decoded the script as GBK on this locale. Run by hand it worked; run by Task
# Scheduler it did not, because the two entry points decode the file differently.
#
# So the durable fix is not "remember the BOM" - it is having no byte in this file
# whose meaning depends on the encoding. The task TEXT may be Chinese: it is read from
# its own file with an explicit UTF-8 decoding, which is unambiguous.
#
# Patterns taken from the working PolicyBriefEN job in this same DSH install, each
# one because it fixes a real failure observed here:
#
#   * $root from $MyInvocation, not a hardcoded path. The scheduled task was
#     registered with an empty WorkingDirectory, so anything relative resolved
#     against System32.
#   * $ErrorActionPreference = "Continue", never "Stop": with Stop, a native tool
#     writing to stderr raises a terminating NativeCommandError and aborts the run.
#     dsh writes per-step diagnostics to stderr, so it aborted every time.
#   * Output appended with Add-Content -Encoding UTF8, not Tee-Object. Tee-Object
#     -Append writes UTF-16 and garbled the log.
#   * node and git placed on PATH explicitly: `dsh headless` does not inherit a PATH
#     containing node, and every tool in this repository is a node script.
#   * Fail closed. Preflight runs first; if it does not clear, the reason is written
#     to the log and the agent is still invoked, because a run that reports nothing
#     is worse than one that reports a block.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-daily.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-daily.ps1 -PreflightOnly
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-daily.ps1 -TaskFile .\probe.txt

[CmdletBinding()]
param(
    [string]$TaskFile = "",
    [switch]$PreflightOnly,
    [switch]$NoPush
)

$ErrorActionPreference = "Continue"

# Encoding, set before anything is read or piped. PowerShell 5.1 encodes text sent
# to a native program with the ANSI code page, which on this machine is GBK, so the
# Chinese instructions reached the agent as question marks.
$utf8 = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = $utf8
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodeBin = "C:\Users\tmj19\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin"
$dsh = "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$log = Join-Path $logDir "daily-$stamp.log"

if (-not $TaskFile) { $TaskFile = Join-Path $root "daily-task.txt" }

function Say($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

<#
    Raise an alert.

    Added 2026-10-12. The audit found that this script wrote everything to a log and told nobody:
    thirteen daily logs sat in logs/ and the last one was four days old, which is exactly the
    failure a log cannot report on its own. A file named alert-<stamp>.txt is written to the same
    directory, so a person or a watcher can look for the newest alert rather than reading every
    daily log. It is deliberately a separate file and not a line in the log: a line is what got
    missed in the first place.

    No external service is called. Sending mail or a chat message needs a credential this project
    does not have, and the rail in force is that nothing leaves the machine without one.
#>
function Raise-Alert {
    param([string]$Reason, [string]$Detail = "")
    $alert = Join-Path $logDir "alert-$stamp.txt"
    $body = @(
        "Landed Math daily run - ATTENTION REQUIRED",
        "time    : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "reason  : $Reason",
        "detail  : $Detail",
        "log     : $log",
        "repo    : $root",
        "",
        "The run did not publish. The commits are local and nothing was pushed.",
        "Read the log above, then either fix and re-run, or push by hand:",
        "  git -C `"$root`" push origin main"
    ) -join "`r`n"
    Set-Content -Path $alert -Value $body -Encoding UTF8
    Say "ALERT RAISED -> $alert"
    Say "  reason: $Reason"
}

# Run a native command, return its exit code, append output to the log as UTF-8.
# Captured as an array and appended rather than piped to Tee-Object, which writes
# UTF-16 and garbles the log.
function Run-Cmd {
    param([string]$Exe, [string[]]$CmdArgs)
    $lines = & $Exe @CmdArgs 2>&1 | ForEach-Object { $_.ToString() }
    $code = $LASTEXITCODE
    if ($lines) { $lines | Add-Content -Path $log -Encoding UTF8 }
    return $code
}

Say "==================== daily run start ===================="
Say "root=$root"
Say "log=$log"

# ---------------------------------------------------------------- 0. environment
$gitCmd = "$env:LOCALAPPDATA\Programs\PortableGit\cmd"
if (Test-Path $gitCmd) { $env:PATH = "$gitCmd;$env:PATH" }
if (Test-Path $nodeBin) { $env:PATH = "$nodeBin;$env:PATH" }

$node = Get-Command node -ErrorAction SilentlyContinue
$git = Get-Command git -ErrorAction SilentlyContinue
Say "node : $(if ($node) { $node.Source } else { 'NOT FOUND' })"
Say "git  : $(if ($git) { $git.Source } else { 'NOT FOUND' })"
Say "dsh  : $(if (Test-Path $dsh) { $dsh } else { 'NOT FOUND' })"
Say "task : $(if (Test-Path $TaskFile) { $TaskFile } else { 'NOT FOUND' })"

if (-not $node) { Say "FATAL node not found. Nothing can run."; exit 2 }
if (-not (Test-Path $dsh)) { Say "FATAL dsh not found at $dsh"; exit 2 }
if (-not (Test-Path $TaskFile)) { Say "FATAL task file not found at $TaskFile"; exit 2 }

Set-Location $root
Say "cwd  : $(Get-Location)"

# ---------------------------------------------------------------- 1. preflight
Say "step 1/6  preflight (outside the agent sandbox)"
$pre = & node (Join-Path $root "tools\preflight.mjs") 2>&1 | ForEach-Object { $_.ToString() }
$preExit = $LASTEXITCODE
if ($pre) { $pre | Add-Content -Path $log -Encoding UTF8 }
foreach ($l in $pre) { if ($l -match "ALL CLEAR|BLOCKING|\[FAIL\]") { Say "  $l" } }
Say "preflight exit=$preExit"

if ($PreflightOnly) { Say "PreflightOnly set - finished."; exit $preExit }

# ---------------------------------------------------------------- 2. the agent
Say "step 2/6  invoking dsh headless (this can take a long time)"
$task = [System.IO.File]::ReadAllText($TaskFile, [System.Text.Encoding]::UTF8)
Say "task text: $($task.Length) chars"

$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    # Captured as an array of strings and appended, rather than piped to Tee-Object,
    # which writes UTF-16 and corrupts the log.
    $out = $task | & $dsh headless - 2>&1 | ForEach-Object { $_.ToString() }
    $agentExit = $LASTEXITCODE
    if ($out) { $out | Add-Content -Path $log -Encoding UTF8 }
} catch {
    Say "dsh threw: $_"
    $agentExit = 1
}
$sw.Stop()
Say "dsh finished in $([int]$sw.Elapsed.TotalMinutes) min, exit=$agentExit"

# ---------------------------------------------------------------- 3. commit
Say "step 3/6  committing the agent's work"
$dirty = (& git -C $root status --porcelain 2>&1 | Measure-Object -Line).Lines
Say "uncommitted files: $dirty"
if ($dirty -gt 0) {
    & git -C $root add -A 2>&1 | Out-Null
    $msg = "content: unattended run $stamp"
    & git -C $root commit -q -m $msg 2>&1 | ForEach-Object { $_.ToString() } | Add-Content -Path $log -Encoding UTF8
    Say "committed"
}
$headAfter = (& git -C $root rev-parse --short HEAD 2>&1) -join ""
Say "HEAD after: $headAfter"

$ahead = [int]((& git -C $root rev-list --count origin/main..HEAD 2>&1) -join "")
Say "commits ahead of origin: $ahead"

if ($ahead -eq 0) {
    Say "nothing new to publish - finished."
    Say "==================== daily run finished ===================="
    exit 0
}

if ($NoPush) {
    Say "NoPush set - $ahead commit(s) left local."
    Say "==================== daily run finished ===================="
    exit 0
}

# ---------------------------------------------------------------- 4. push
# The gate on publishing. A production build has to succeed here first: it cannot run
# inside the agent's sandbox, and this is the only place it can run before the work
# goes live. A build failure means nothing is pushed and the commits stay local.
Say "step 4/6  verifying the production build before pushing"
$buildExit = Run-Cmd "node" @((Join-Path $root "node_modules\astro\bin\astro.mjs"), "build")
Say "astro build exit=$buildExit"

if ($buildExit -ne 0) {
    Say "BUILD FAILED - refusing to push. The commits stay local."
    Say "  Fix the build, then: git push origin main"
    Raise-Alert -Reason "production build failed" -Detail "astro build exit=$buildExit"
    Say "==================== daily run finished ===================="
    exit 1
}

<#
    The gate on publishing, widened on 2026-10-12.

    Until today the only condition between the agent's output and the live site was that the build
    succeeded. The audit made the gap explicit: preflight runs BEFORE the agent and therefore cannot
    see what the agent wrote, and the seven gates run INSIDE the agent's turn as advisory checks. A
    run could therefore publish anything that compiled.

    Two conditions are added here, and a third is checked rather than assumed:

      1. every gate green - node tools/gate.mjs, which now covers structure, the reviewer, internal
         links, structured data, CSP, mobile layout and information gain
      2. a publish manifest that lists what is about to go live, written to logs/ so the decision
         can be reviewed afterwards rather than reconstructed

    A failure at either point refuses the push and raises an alert. The commits stay local, which is
    the same contract the build check already had: nothing reaches a reader without passing here.
#>
Say "step 4a/6  running the seven gates before any push"
$gateExit = Run-Cmd "node" @((Join-Path $root "tools\gate.mjs"))
Say "gate exit=$gateExit"

if ($gateExit -ne 0) {
    Say "GATES FAILED - refusing to push. The commits stay local."
    Say "  Run: node tools/gate.mjs   and read the failing gate."
    Raise-Alert -Reason "one or more gates failed" -Detail "node tools/gate.mjs exit=$gateExit"
    Say "==================== daily run finished ===================="
    exit 1
}

<#
    step 4b  the L1-L5 audit (audit_protocol.md)

    Runs after the gates and before the push, and it is the layer that decides whether a publish is
    allowed rather than whether the code is well-formed.

    The gates and the audit answer different questions. A gate asks "is this article constructed
    correctly". The audit asks "should this article go out" - L2 whether every figure points at a
    document the project has catalogued, L3 whether a figure resting on a single document says so, L4
    whether the piece narrates an experience that never happened, L5 whether anything in it is a
    political, legal, reputational or promotional risk. L1 is the gates restated, so a failure here
    means one of the four others.

    L5 defaults to "not sure". It is not a filter that opens when nothing matches a keyword; it is a
    layer that reports uncertainty as an alert, because the judgement it stands for is the one thing
    here that cannot be automated. Anything that is not AUTO-PUBLISH OK writes logs/alert-audit-* and
    stops the push, which is the protocol's whole purpose.
#>
Say "step 4b/6  running the L1-L5 audit before any push"
$auditExit = Run-Cmd "node" @((Join-Path $root "tools\audit.mjs"), "--published")
Say "audit exit=$auditExit"

if ($auditExit -ne 0) {
    Say "AUDIT NOT CLEAR - refusing to push. See logs/alert-audit-*.txt."
    Raise-Alert -Reason "the L1-L5 audit did not clear" -Detail "node tools/audit.mjs --published exit=$auditExit"
    Say "==================== daily run finished ===================="
    exit 1
}

<#
    The publish manifest.

    Written before the push so it describes what is about to go live rather than what did. Three
    lines are enough to answer the question a person asks afterwards - what changed, which articles
    are in it, and which commit - and anything longer would not be read.
#>
Say "step 4c/6  writing the publish manifest"
$manifest = Join-Path $logDir "publish-$stamp.txt"
$newArticles = (& git -C $root diff --name-only "origin/main..HEAD" -- "src/content/blog" 2>&1) |
    Where-Object { $_ -match "\.md$" } | ForEach-Object { "  " + $_ }
$articlesBlock = if ($newArticles) { $newArticles -join "`r`n" } else { "  (no article files changed)" }
$manifestBody = @(
    "Landed Math publish manifest",
    "time      : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "commit    : $headAfter",
    "commits   : $ahead ahead of origin/main",
    "gate      : every gate passed (exit 0)",
    "build     : astro build passed (exit 0)",
    "",
    "article files in this publish:",
    $articlesBlock,
    "",
    "changed files:",
    (((& git -C $root diff --name-only "origin/main..HEAD" 2>&1) | ForEach-Object { "  " + $_ }) -join "`r`n")
) -join "`r`n"
Set-Content -Path $manifest -Value $manifestBody -Encoding UTF8
Say "manifest: $manifest"
Say "  articles in this publish: $(if ($newArticles) { $newArticles.Count } else { 0 })"

Say "pushing to origin/main"
$pushExit = Run-Cmd "git" @("-C", $root, "push", "origin", "main")
Say "push exit=$pushExit"

if ($pushExit -ne 0) {
    # Distinguish the two failure modes, because the advice differs. A closed
    # accelerator is the common one and the operator can fix it. A server-side 500 is
    # GitHub's problem: pushing a fresh empty branch fails identically, reads work, and
    # the status page says operational, so retrying is pointless and the commits wait.
    $pushLog = Get-Content -Path $log -Tail 40 -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($pushLog -match "Internal Server Error|remote rejected") {
        Say "PUSH REJECTED BY GITHUB - this is server-side, not your accelerator."
        Say "  A test push of an empty branch fails the same way, so it is not the content."
        Say "  The commits are safe locally. The next run will retry automatically."
        Raise-Alert -Reason "push rejected by GitHub (server-side)" -Detail "commit $headAfter is local"
    } else {
        Say "PUSH FAILED - is the accelerator running? That is the usual cause."
        Raise-Alert -Reason "push failed (likely the accelerator)" -Detail "commit $headAfter is local"
    }
    Say "  Commits are safe locally. Push later with: git push origin main"
    Say "==================== daily run finished ===================="
    exit 1
}

# ---------------------------------------------------------------- 5. verify live
Say "step 5/6  waiting for the deploy, then verifying live"
Start-Sleep -Seconds 45
$verify = Run-Cmd "node" @((Join-Path $root "tools\verify-live.mjs"))
Say "live verification exit=$verify"

# ---------------------------------------------------------------- 6. tell engines, pull data
#
# IndexNow only, because there is no public Google API for submitting an ordinary article:
# the Indexing API accepts JobPosting and BroadcastEvent, and Google documents that using it
# for other content is against its terms. Google's channel is the sitemap, which now carries
# an accurate lastmod on every URL, derived from content rather than from the build clock.
#
# Both calls are advisory. Neither can fail the run: an endpoint being down says nothing about
# whether the article published, and marking it as a failure would train whoever reads the log
# to ignore a line that matters.
Say "step 6/6  submitting changed URLs, then pulling search data"
$submit = Run-Cmd "node" @((Join-Path $root "tools\submit-urls.mjs"), "--changed")
Say "url submission exit=$submit"
$gsc = Run-Cmd "node" @((Join-Path $root "tools\gsc-report.mjs"), "--allow-missing-credentials")
Say "search report exit=$gsc"
Say "  advisory only: a missing credential or an unreachable endpoint is not a failed run"

# The three platforms that need no credential are exported here rather than sent anywhere: a
# landing page is a file a static host serves, a deck is uploaded by hand, and the feed is already
# published by the site. Running it inside the daily job means the exports are as current as the
# renders, which is the only way they stay useful. Advisory, like the two steps above it.
Say "step 6b  exporting the no-credential platforms (landing pages, decks)"
$export = Run-Cmd "node" @((Join-Path $root "tools\export.mjs"))
Say "export exit=$export"

Say "==================== daily run finished ===================="
if ($verify -ne 0) { exit $verify }
exit $agentExit
