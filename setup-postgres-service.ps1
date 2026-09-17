#Requires -Version 5
<#
  Registers and starts PostgreSQL 18 as a Windows service.

  WHY: the 'postgresql-x64-18' service was removed from this machine, so nothing
  starts the database automatically. Without it the API listens on :4000 but every
  database-backed route fails (health 200, everything else 500/503).

  RUN IT ELEVATED:
    1. Start menu -> type "PowerShell" -> right-click -> "Run as administrator"
    2. cd C:\Users\manue\Desktop\spiro
    3. .\setup-postgres-service.ps1

  Safe to re-run: it skips registration if the service already exists.
  Keep this file ASCII-only (see note at the bottom).
#>

$ErrorActionPreference = 'Stop'

$PgBin   = 'C:\Program Files\PostgreSQL\18\bin'
$PgData  = 'C:\Program Files\PostgreSQL\18\data'
$SvcName = 'postgresql-x64-18'
# The data directory grants FullControl to NetworkService, so the service must
# run as that account (this is what the PostgreSQL installer uses by default).
$SvcAcct = 'NT AUTHORITY\NetworkService'

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $pr = New-Object Security.Principal.WindowsPrincipal($id)
  return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---- 1. Must be elevated ----------------------------------------------------
if (-not (Test-Admin)) {
  Write-Host 'This script must run as Administrator.' -ForegroundColor Red
  Write-Host ''
  Write-Host '  Start menu -> PowerShell -> right-click -> "Run as administrator"'
  Write-Host '  cd C:\Users\manue\Desktop\spiro'
  Write-Host '  .\setup-postgres-service.ps1'
  exit 1
}
Write-Host "[1/4] Running elevated as $([Security.Principal.WindowsIdentity]::GetCurrent().Name)" -ForegroundColor Green

# ---- 2. Sanity-check the install -------------------------------------------
foreach ($p in @("$PgBin\pg_ctl.exe", "$PgData\PG_VERSION")) {
  if (-not (Test-Path $p)) { Fail "Missing required path: $p" }
}
Write-Host "[2/4] Install looks intact (data dir: $PgData)" -ForegroundColor Green

# ---- 3. Register the service if absent -------------------------------------
$svc = Get-Service -Name $SvcName -ErrorAction SilentlyContinue
if ($svc) {
  Write-Host "[3/4] Service '$SvcName' already exists (status: $($svc.Status)) - skipping registration" -ForegroundColor Yellow
} else {
  Write-Host "[3/4] Registering '$SvcName' to run as $SvcAcct ..." -ForegroundColor Cyan
  & "$PgBin\pg_ctl.exe" register -N $SvcName -D $PgData -S auto -U $SvcAcct 2>&1 | Write-Host

  if (-not (Get-Service -Name $SvcName -ErrorAction SilentlyContinue)) {
    Write-Host 'pg_ctl register did not create the service - falling back to sc.exe' -ForegroundColor Yellow
    # NOTE: sc.exe requires a space after every '=' and escaped inner quotes.
    $binPath = '"' + "$PgBin\pg_ctl.exe" + '" runservice -N "' + $SvcName + '" -D "' + $PgData + '" -w'
    & sc.exe create $SvcName binPath= $binPath start= auto obj= $SvcAcct DisplayName= $SvcName 2>&1 | Write-Host
    if (-not (Get-Service -Name $SvcName -ErrorAction SilentlyContinue)) {
      Fail 'Could not register the service. Re-run the PostgreSQL 18 installer and choose "Repair".'
    }
  }
  Write-Host '      registered' -ForegroundColor Green
}