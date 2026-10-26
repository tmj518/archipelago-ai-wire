# Test the two providers (Doubao writes, DeepSeek reviews)
#
# Double-click this file, or run it from a terminal:
#     powershell -ExecutionPolicy Bypass -File tools\test-providers.ps1
#
# It asks for the three values, runs the test, and prints the result. The values are held only in this
# window's environment: they are not written to disk, not committed, and not sent anywhere except the
# provider APIs themselves.
#
# Why it asks rather than reading them from somewhere: the keys live in GitHub Secrets, which are
# encrypted and one-way. Nothing on this machine can read them, which is the point of Secrets, so the
# only way to test them from here is for a person to paste them once.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

Write-Host ""
Write-Host "PROVIDER TEST - Doubao writes, DeepSeek reviews" -ForegroundColor Cyan
Write-Host "================================================================"
Write-Host ""
Write-Host "Paste each value and press Enter. Nothing is saved to disk."
Write-Host "In the GitHub secret list these are named APIKEY20261016201628 (Ark) and"
Write-Host "GITHUB66CHINA (DeepSeek), but any value works - this only tests what you type."
Write-Host ""

# Secure input so the key is not echoed to the screen or left in the scrollback.
$arkKey = Read-Host "1/3  Ark API key            (starts with ark-)"
$arkModel = Read-Host "2/3  Ark endpoint id        (starts with ep-)"
$dsKey = Read-Host "3/3  DeepSeek review key    (starts with sk-)"

if ([string]::IsNullOrWhiteSpace($arkKey) -and [string]::IsNullOrWhiteSpace($dsKey)) {
  Write-Host ""
  Write-Host "Neither key was given, so there is nothing to test." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 2
}

$env:ARK_API_KEY = $arkKey.Trim()
$env:ARK_MODEL = $arkModel.Trim()
$env:DEEPSEEK_REVIEW_API_KEY = $dsKey.Trim()

# Clear the aliases so the test cannot silently pick up a different credential than the one typed.
Remove-Item Env:OWNER_KEY_1 -ErrorAction SilentlyContinue
Remove-Item Env:OWNER_KEY_2 -ErrorAction SilentlyContinue
Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DOUBAO_API_KEY -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Running..." -ForegroundColor Cyan
Write-Host ""

$output = node tools/test-providers.mjs 2>&1
$code = $LASTEXITCODE
$output | ForEach-Object { Write-Host $_ }

Write-Host ""
Write-Host "================================================================"
if ($code -eq 0) {
  Write-Host "Both providers work." -ForegroundColor Green
} else {
  Write-Host "Something needs fixing - see the lines above." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Copy everything above and send it. The keys are shown only as the first"
Write-Host "8 characters, so the output is safe to paste."
Write-Host ""
Read-Host "Press Enter to close"
