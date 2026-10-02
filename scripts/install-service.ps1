# scripts/install-service.ps1
# Registers Windows Task Scheduler task for Antigravity Push Notifier
# Runs silently at logon with zero windows.
# English comments only.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$vbsPath = Join-Path $scriptDir "run-hidden.vbs"
$taskName = "Antigravity_Notifier"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Installing Antigravity Push Notifier Windows Task        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not (Test-Path $vbsPath)) {
    Write-Error "Error: run-hidden.vbs not found at $vbsPath"
    exit 1
}

# 1. Stop existing task if running
try {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
} catch {}

# 2. Register scheduled task using PowerShell ScheduledTasks cmdlets
try {
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "//B `"$vbsPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    Write-Host "Registering task: $taskName..." -ForegroundColor Yellow
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Host "Task registered successfully." -ForegroundColor Green

    # 3. Start task immediately
    Write-Host "Starting Notifier task immediately in background..." -ForegroundColor Yellow
    Start-ScheduledTask -TaskName $taskName
    Write-Host "Task started successfully." -ForegroundColor Green

    Write-Host "`nAntigravity Push Notifier installed successfully!" -ForegroundColor Green
    Write-Host "It will automatically start at Windows logon and monitor Antigravity silently."
    Write-Host "Task Name: $taskName"
} catch {
    Write-Host "PowerShell cmdlet failed, attempting fallback to schtasks.exe..." -ForegroundColor DarkYellow
    $actionArg = "\`"wscript.exe\`" //B \`"$vbsPath\`""
    & schtasks.exe /create /tn "$taskName" /tr "$actionArg" /sc onlogon /f | Out-Null
    & schtasks.exe /run /tn "$taskName" | Out-Null
    Write-Host "`nTask created via schtasks fallback." -ForegroundColor Green
}
