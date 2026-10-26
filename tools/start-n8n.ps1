<#
    Start n8n for Landed Math.

    n8n lives outside the repository, in %LOCALAPPDATA%\Programs\n8n, because
    it is a 1.6 GB dependency tree that has nothing to do with the site build.

    Node is taken from the DSH runtime: this machine has no standalone Node
    install, and n8n 2.x requires Node >= 24 (the runtime ships v24.21.0).

    Data, credentials and the SQLite database live in .n8n\ next to the
    install. Nothing in there belongs in git.
#>

$ErrorActionPreference = "Stop"

$n8nDir = "$env:LOCALAPPDATA\Programs\n8n"
$nodeBin = "C:\Users\tmj19\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin"

if (-not (Test-Path "$n8nDir\node_modules\n8n\bin\n8n")) {
    throw "n8n not installed at $n8nDir. See README 3.5."
}

$env:PATH = "$nodeBin;" + $env:PATH
$env:N8N_USER_FOLDER = "$n8nDir\.n8n"
$env:N8N_PORT = "5678"
# Local HTTP only; without this n8n sets a Secure cookie and the editor will
# not accept the session over plain http://localhost.
$env:N8N_SECURE_COOKIE = "false"
$env:N8N_DIAGNOSTICS_ENABLED = "false"
$env:N8N_VERSION_NOTIFICATIONS_ENABLED = "false"

# Credentials for Notion / Feishu / YouTube go here once created. The file is
# never committed and never pasted into a chat.
$envFile = Join-Path $n8nDir ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim('"'), "Process")
        }
    }
    Write-Host "Loaded credentials from $envFile"
}

Set-Location $n8nDir
Write-Host "Starting n8n on http://localhost:5678  (Ctrl+C to stop)"
Write-Host ""
node .\node_modules\n8n\bin\n8n start
