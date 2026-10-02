# scripts/uninstall-service.ps1
# Unregisters Windows Task Scheduler task for Antigravity Push Notifier
# English comments only.

$ErrorActionPreference = "Continue"

$taskName = "Antigravity_Notifier"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Uninstalling Antigravity Push Notifier Windows Task      " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Stop task if running
Write-Host "Stopping task $taskName..." -ForegroundColor Yellow
schtasks.exe /end /tn $taskName 2>$null

# 2. Delete task
Write-Host "Deleting task $taskName..." -ForegroundColor Yellow
schtasks.exe /delete /tn $taskName /f 2>$null

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nAntigravity Push Notifier scheduled task removed successfully." -ForegroundColor Green
} else {
    Write-Host "`nTask was not registered or already removed." -ForegroundColor DarkGray
}
