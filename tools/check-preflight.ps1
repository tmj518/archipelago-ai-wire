# check-preflight.ps1 - the "sleep well" check for Landed Math.
#
# Run by DailyCheck.bat, or directly:
#     powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-preflight.ps1
#
# It answers one question: will the 08:10 unattended run complete?
#
# The single most forgettable prerequisite is the proxy. The working PolicyBriefEN
# job lists it as a hard requirement and it is the same here: the deploy step reaches
# GitHub and Cloudflare, and with the accelerator off the push fails. So the proxy is
# checked first and named in plain words, rather than buried in a log at 08:10.
#
# Exit 0 = clear, non-zero = the reason.

[CmdletBinding()]
param(
    [int]$ProxyPort = 7890
)

$ErrorActionPreference = "Continue"

$utf8 = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = $utf8
[Console]::OutputEncoding = $utf8

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodeBin = "C:\Users\tmj19\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin"
$gitCmd = "$env:LOCALAPPDATA\Programs\PortableGit\cmd"
if (Test-Path $gitCmd) { $env:PATH = "$gitCmd;$env:PATH" }
if (Test-Path $nodeBin) { $env:PATH = "$nodeBin;$env:PATH" }
Set-Location $root

function Line($s) { Write-Host $s }

Line ""
Line "Landed Math - daily health check"
Line "================================"
Line "  time : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Line "  root : $root"
Line ""

$fails = @()

# ---------------------------------------------------------------- 1. the proxy
# Checked first because it is the one that gets forgotten, and because a closed
# proxy also makes the https check below fail for a misleading reason.
$proxyUp = $false
try {
    $t = Test-NetConnection -ComputerName 127.0.0.1 -Port $ProxyPort -WarningAction SilentlyContinue
    $proxyUp = $t.TcpTestSucceeded
} catch {
    # Test-NetConnection is absent on some builds; fall back to a raw socket.
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect("127.0.0.1", $ProxyPort)
        $proxyUp = $c.Connected
        $c.Close()
    } catch { $proxyUp = $false }
}
if ($proxyUp) {
    Line "  [ ok ] proxy            127.0.0.1:$ProxyPort is listening"
} else {
    Line "  [FAIL] proxy            127.0.0.1:$ProxyPort is NOT listening"
    Line "         -> START THE ACCELERATOR. Without it the push to GitHub fails."
    $fails += "proxy"
}

# ---------------------------------------------------------------- 2. https
$https = $false
try {
    $r = Invoke-WebRequest -Uri "https://api.github.com" -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
    $https = $r.StatusCode -eq 200
} catch {
    $https = $false
}
if ($https) {
    Line "  [ ok ] https            api.github.com reachable"
} else {
    Line "  [FAIL] https            api.github.com not reachable"
    Line "         -> if the proxy above is green, this is the intermittent block; retry."
    $fails += "https"
}

# ---------------------------------------------------------------- 3. tools
# Every tool must parse: one gate was silently dead once because a file had been
# re-encoded and no longer parsed, while every other check still passed.
$tools = Get-ChildItem (Join-Path $root "tools\*.mjs") -ErrorAction SilentlyContinue
$broken = @()
foreach ($f in $tools) {
    & node --check $f.FullName 2>$null
    if ($LASTEXITCODE -ne 0) { $broken += $f.Name }
}
if ($broken.Count -eq 0) {
    Line "  [ ok ] tools            all $($tools.Count) scripts parse"
} else {
    Line "  [FAIL] tools            $($broken.Count) broken: $($broken -join ', ')"
    $fails += "tools"
}

# ---------------------------------------------------------------- 4. gate + build
Line ""
Line "  running preflight (this takes about 30 seconds)..."
$pre = & node (Join-Path $root "tools\preflight.mjs") 2>&1 | ForEach-Object { $_.ToString() }
$preExit = $LASTEXITCODE
foreach ($l in $pre) {
    if ($l -match "^\s*\[ ok \]|\[FAIL\]|BLOCKING|ALL CLEAR") { Line "    $($l.Trim())" }
}
if ($preExit -ne 0) { $fails += "preflight" }

# ---------------------------------------------------------------- 5. the task
Line ""
$t = Get-ScheduledTask -TaskName "LandedMath-Daily" -ErrorAction SilentlyContinue
if ($t) {
    $i = Get-ScheduledTaskInfo -TaskName "LandedMath-Daily"
    Line "  [ ok ] task            LandedMath-Daily state=$($t.State) next=$($i.NextRunTime)"
    if ($t.State -eq "Disabled") {
        Line "         -> THE TASK IS DISABLED. Enable it: schtasks /Change /TN LandedMath-Daily /ENABLE"
        $fails += "task-disabled"
    }
} else {
    Line "  [FAIL] task            LandedMath-Daily is not registered"
    $fails += "task-missing"
}

# ---------------------------------------------------------------- 6. work pending
$dirty = (& git status --porcelain 2>&1 | Measure-Object -Line).Lines
$ahead = (& git rev-list --count origin/main..HEAD 2>&1) -join ""
Line "  [info] uncommitted     $dirty file(s)"
Line "  [info] unpushed        $ahead commit(s)"
if ([int]$ahead -gt 0) {
    Line "         -> push them: git push origin main"
}

Line ""
if ($fails.Count -eq 0) {
    Line "ALL CLEAR - the unattended run should complete."
    exit 0
} else {
    Line "NOT CLEAR ($($fails -join ', ')) - fix the above before sleeping."
    exit 1
}
