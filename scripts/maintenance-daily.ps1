# Daily data archive for Task Scheduler
# Action: powershell -File scripts/maintenance-daily.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..
npm run trading:archive
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Archive OK at $(Get-Date -Format o)"
