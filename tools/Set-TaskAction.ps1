# Set-TaskAction.ps1 - fix the registered task's action to match the working tasks.
#
# schtasks /TR mangles quoting: the registered command came back as "powershell.exe"
# with a trailing quote and no working directory. Set-ScheduledTask takes the action
# as fields, so there is nothing to mis-parse.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\Set-TaskAction.ps1
[CmdletBinding()]
param(
    [string]$TaskName = "LandedMath-Daily"
)

$ErrorActionPreference = "Continue"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$wrapper = Join-Path $root "tools\run-daily.ps1"
$ps = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

Write-Output "task    : $TaskName"
Write-Output "command : $ps"
Write-Output "args    : -NoProfile -ExecutionPolicy Bypass -File `"$wrapper`""
Write-Output "workdir : $root"
Write-Output ""

$action = New-ScheduledTaskAction `
    -Execute $ps `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`"" `
    -WorkingDirectory $root

Set-ScheduledTask -TaskName $TaskName -Action $action | Out-Null
Write-Output "action set"

$t = Get-ScheduledTask -TaskName $TaskName
Write-Output ""
Write-Output "VERIFY"
Write-Output "  Execute          : $($t.Actions[0].Execute)"
Write-Output "  Arguments        : $($t.Actions[0].Arguments)"
Write-Output "  WorkingDirectory : $($t.Actions[0].WorkingDirectory)"
Write-Output "  WakeToRun        : $($t.Settings.WakeToRun)"
Write-Output "  StartWhenAvailable: $($t.Settings.StartWhenAvailable)"
Write-Output "  ExecutionLimit   : $($t.Settings.ExecutionTimeLimit)"
Write-Output "  MultipleInstances: $($t.Settings.MultipleInstances)"
Write-Output "  State            : $($t.State)"
$i = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Output "  NextRunTime      : $($i.NextRunTime)"
