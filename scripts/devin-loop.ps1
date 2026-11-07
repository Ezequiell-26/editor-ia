#Requires -Version 5.1
<#
.SYNOPSIS
  Una pasada del loop de mejora de Olyvia via Devin CLI (no interactivo).

.DESCRIPTION
  - Verifica auth de `devin` y sale limpio si no hay sesion.
  - Lock file para evitar pasadas solapadas (la tarea programada dispara
    cada N minutos; si la pasada anterior sigue viva, esta sale).
  - Limite de tiempo por pasada (default 45 min) para que un agente
    colgado no bloquee el loop para siempre.
  - Todo el output va a logs\devin-loop-YYYYMMDD.log junto al repo.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\devin-loop.ps1
#>
param(
  [int]$TimeoutMinutes = 45,
  [string]$PermissionMode = 'dangerous'
)

$ErrorActionPreference = 'Continue'
$Repo = Split-Path -Parent $PSScriptRoot
$Devin = 'D:\Devin\resources\app\extensions\windsurf\devin\bin\devin.exe'
$PromptFile = Join-Path $Repo 'scripts\devin-loop-prompt.md'
$LogDir = Join-Path $Repo 'logs'
$LockFile = Join-Path $env:TEMP 'olyvia-devin-loop.lock'
$LogFile = Join-Path $LogDir ('devin-loop-' + (Get-Date -Format 'yyyyMMdd') + '.log')

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# --- Lock: una sola pasada a la vez -------------------------------------
if (Test-Path $LockFile) {
  $lockPid = 0
  try { $lockPid = [int](Get-Content $LockFile -Raw).Trim() } catch {}
  $alive = $false
  if ($lockPid -gt 0) {
    $alive = [bool](Get-Process -Id $lockPid -ErrorAction SilentlyContinue)
  }
  if ($alive) {
    Write-Log "SKIP: pasada anterior en curso (PID $lockPid)"
    exit 0
  }
  Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}
Set-Content -Path $LockFile -Value $PID -Encoding ASCII

try {
  # --- Auth ---------------------------------------------------------------
  $auth = & $Devin auth status 2>&1 | Out-String
  if ($auth -match 'Not logged in') {
    Write-Log "SKIP: devin CLI sin sesion. Ejecuta 'devin.exe auth login' una vez."
    exit 2
  }

  if (-not (Test-Path $Devin)) { Write-Log "ERROR: no existe $Devin"; exit 3 }
  if (-not (Test-Path $PromptFile)) { Write-Log "ERROR: no existe $PromptFile"; exit 3 }

  Write-Log "START pasada (timeout ${TimeoutMinutes}m, modo $PermissionMode)"

  $promptText = Get-Content -Path $PromptFile -Raw -Encoding UTF8
  $exportPath = Join-Path $LogDir ('session-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.atif.json')
  $stdoutPath = Join-Path $LogDir 'devin-loop-stdout.tmp'
  $stderrPath = Join-Path $LogDir 'devin-loop-stderr.tmp'

  $proc = Start-Process -FilePath $Devin -PassThru -NoNewWindow `
    -WorkingDirectory $Repo `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -ArgumentList @(
      '--print',
      '--permission-mode', $PermissionMode,
      '--respect-workspace-trust', 'false',
      '--export', $exportPath,
      '--', $promptText
    )

  $finished = $proc.WaitForExit($TimeoutMinutes * 60 * 1000)
  if (-not $finished) {
    Write-Log "TIMEOUT tras ${TimeoutMinutes}m - matando PID $($proc.Id)"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    exit 4
  }

  $code = -1
  try { $code = $proc.ExitCode } catch {}
  foreach ($tmp in @('devin-loop-stdout.tmp','devin-loop-stderr.tmp')) {
    $p = Join-Path $LogDir $tmp
    if (Test-Path $p) {
      $tail = Get-Content $p -Tail 40 -ErrorAction SilentlyContinue
      if ($tail) { Write-Log ("OUTPUT[" + $tmp + "]: " + ($tail -join ' | ')) }
      Remove-Item $p -Force -ErrorAction SilentlyContinue
    }
  }
  Write-Log "END pasada exit=$code export=$exportPath"
  exit $code
}
finally {
  Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}
