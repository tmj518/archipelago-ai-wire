<#
    Point command-line tools at the local proxy.

    Why this file exists
    --------------------
    This machine reaches Google, Reddit and Quora from a browser but not from
    curl, node fetch or Python requests. The cause is not the network: the
    Windows system proxy is enabled at 127.0.0.1:7890, and browsers read that
    setting while command-line tools do not. curl only honours HTTP_PROXY,
    HTTPS_PROXY and ALL_PROXY environment variables.

    Measured before and after, from this machine:

        target                no proxy        proxy + --ssl-no-revoke
        google.com            timeout         200
        trends.google.com     timeout         200
        searchconsole API     timeout         404 (reachable)
        reddit.com            timeout         403 (reachable)
        bing.com              200             200

    So the Search Console API and Google Trends can be reached from a script
    here, which is what makes the keyword feedback loop automatable at all.

    The second requirement is --ssl-no-revoke
    -----------------------------------------
    Through the proxy, schannel fails with 0x80092013, "the revocation server
    is offline" — the same failure that made `git ls-remote` hang for 300
    seconds until http.schannelCheckRevoke was turned off. For curl the
    equivalent is --ssl-no-revoke.

    Usage
    -----
        . .\tools\env-proxy.ps1            # dot-source: sets the current shell
        . .\tools\env-proxy.ps1 -Off       # unset

    Dot-source it (leading `.`), or the variables land in a child process and
    vanish. For Node, set NODE_OPTIONS or use undici's ProxyAgent; for Python
    requests, these variables are read automatically.
#>

param(
    [switch]$Off,
    [string]$Proxy = "http://127.0.0.1:7890"
)

if ($Off) {
    Remove-Item Env:HTTP_PROXY  -ErrorAction SilentlyContinue
    Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
    Remove-Item Env:ALL_PROXY   -ErrorAction SilentlyContinue
    Write-Host "proxy env cleared"
    return
}

# Fail loudly rather than silently producing timeouts: if the proxy client is
# not running, every fetch below looks like a network outage.
$port = 0
if ($Proxy -match ':(\d+)') { $port = [int]$Matches[1] }
$listening = $false
try {
    $listening = (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue)
} catch {
    $listening = (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) -ne $null
}

if (-not $listening) {
    Write-Warning "nothing is listening on 127.0.0.1:$port — start the proxy client, or pass -Proxy <url>"
}

$env:HTTP_PROXY  = $Proxy
$env:HTTPS_PROXY = $Proxy
$env:ALL_PROXY   = $Proxy

# curl cannot read the system proxy and also fails the CRL check through it.
# Aliasing curl keeps every ad-hoc call in this repo working without the flag
# being remembered each time.
function global:curl { & curl.exe --ssl-no-revoke @args }

Write-Host "proxy set: $Proxy"
Write-Host "  curl is wrapped with --ssl-no-revoke (schannel CRL check fails through the proxy)"
Write-Host "  Google / GSC API / Trends / Reddit are reachable from here now"
