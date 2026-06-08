<#
.SYNOPSIS
  Start the full DealFlow dev stack: API (:3001) + web (:5173) + ngrok tunnel.

.DESCRIPTION
  Launches the dev servers and the ngrok tunnel in their own windows so they
  survive editor/agent sessions, then waits until all three are reachable and
  opens the app in your browser.

  - API port and the public tunnel URL are read from apps/api/.env
    (DATABASE stays the single source of truth; nothing is hard-coded).
  - ngrok forwards the reserved domain to 127.0.0.1:<PORT> (IPv4, matching the
    API bind) so email open/click tracking pixels are publicly reachable.

.USAGE
  Right-click > Run with PowerShell, or:  ./start-dev.ps1
  Skip opening the browser:               ./start-dev.ps1 -NoBrowser
#>
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# --- Read PORT + PUBLIC_API_URL from apps/api/.env -------------------------
$envFile = Join-Path $root 'apps\api\.env'
$apiPort = '3001'
$publicUrl = $null
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*PORT\s*=\s*(.+?)\s*$')           { $apiPort   = $Matches[1].Trim() }
    if ($line -match '^\s*PUBLIC_API_URL\s*=\s*(.+?)\s*$')  { $publicUrl = $Matches[1].Trim() }
  }
} else {
  Write-Warning "apps/api/.env not found - using defaults (PORT=3001, no tunnel)."
}

# --- Locate ngrok.exe ------------------------------------------------------
$ngrok = Join-Path $env:APPDATA 'npm\node_modules\ngrok\bin\ngrok.exe'
if (-not (Test-Path $ngrok)) {
  $cmd = Get-Command ngrok -ErrorAction SilentlyContinue
  if ($cmd) { $ngrok = $cmd.Source }
}

Write-Host "DealFlow dev stack" -ForegroundColor Cyan
Write-Host "  repo : $root"
Write-Host "  API  : http://localhost:$apiPort"
Write-Host "  web  : http://localhost:5173"
if ($publicUrl) { Write-Host "  ngrok: $publicUrl -> 127.0.0.1:$apiPort" }
Write-Host ""

# --- 1) Dev servers (API + web) -------------------------------------------
Start-Process powershell -ArgumentList '-NoExit','-Command',
  "Set-Location '$root'; Write-Host 'DealFlow API + web - keep this window open' -ForegroundColor Cyan; pnpm dev"

# --- 2) ngrok tunnel -> API ------------------------------------------------
if ($publicUrl -and (Test-Path $ngrok)) {
  Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Process powershell -ArgumentList '-NoExit','-Command',
    "Write-Host 'ngrok -> 127.0.0.1:$apiPort - keep this window open' -ForegroundColor Green; & '$ngrok' http 127.0.0.1:$apiPort --url=$publicUrl"
} else {
  Write-Warning "ngrok not started (missing ngrok.exe or PUBLIC_API_URL). Email tracking from external devices will not work."
}

# --- 3) Wait for readiness -------------------------------------------------
Write-Host "Waiting for services to come up..." -NoNewline
$apiUp=$false; $webUp=$false; $ngUp = -not ($publicUrl -and (Test-Path $ngrok))
for ($i=0; $i -lt 40; $i++) {
  if (-not $apiUp) { try { Invoke-RestMethod "http://127.0.0.1:$apiPort/health" -TimeoutSec 2 -ErrorAction Stop | Out-Null; $apiUp=$true } catch {} }
  if (-not $webUp) { try { Invoke-WebRequest "http://localhost:5173/" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null; $webUp=$true } catch {} }
  if (-not $ngUp)  { try { $t = Invoke-RestMethod "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2 -ErrorAction Stop; if ($t.tunnels.Count -gt 0) { $ngUp=$true } } catch {} }
  if ($apiUp -and $webUp -and $ngUp) { break }
  Write-Host "." -NoNewline; Start-Sleep -Seconds 2
}
Write-Host ""
Write-Host ("  API   : " + ($(if($apiUp){'UP'}else{'DOWN'}))) -ForegroundColor $(if($apiUp){'Green'}else{'Red'})
Write-Host ("  web   : " + ($(if($webUp){'UP'}else{'DOWN'}))) -ForegroundColor $(if($webUp){'Green'}else{'Red'})
if ($publicUrl) { Write-Host ("  ngrok : " + ($(if($ngUp){'UP'}else{'DOWN'}))) -ForegroundColor $(if($ngUp){'Green'}else{'Red'}) }

# --- 4) Open the app -------------------------------------------------------
if ($webUp -and -not $NoBrowser) { Start-Process msedge "http://localhost:5173" }
Write-Host "`nDone. Leave the two new windows open while you work." -ForegroundColor Cyan
