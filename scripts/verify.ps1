# Corre las mismas puertas que el workflow de verificacion, en la misma
# direccion: typecheck y tests, build del escritorio, formato, build del
# binario Tauri (incluye los recursos de Windows) y tests del crate Rust.
# Corta al primer fallo y sale con el codigo de esa operacion, para que un
# verde signifique lo mismo en la maquina del desarrollador que en CI.

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$steps = @(
  [pscustomobject]@{
    display = 'npm run verify'
    exe     = 'npm'
    argv    = @('run', 'verify')
  },
  [pscustomobject]@{
    display = 'npm --workspace @editor-ia/desktop run build'
    exe     = 'npm'
    argv    = @('--workspace', '@editor-ia/desktop', 'run', 'build')
  },
  [pscustomobject]@{
    display = 'node scripts/rust-env.mjs -- cargo fmt --all -- --check'
    exe     = 'node'
    argv    = @('scripts/rust-env.mjs', '--', 'cargo', 'fmt', '--all', '--', '--check')
  },
  [pscustomobject]@{
    display = 'node scripts/rust-env.mjs -- cargo build -p editor-ia-desktop'
    exe     = 'node'
    argv    = @('scripts/rust-env.mjs', '--', 'cargo', 'build', '-p', 'editor-ia-desktop')
  },
  [pscustomobject]@{
    display = 'node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop'
    exe     = 'node'
    argv    = @('scripts/rust-env.mjs', '--', 'cargo', 'test', '-p', 'editor-ia-desktop')
  }
)

$failures = 0

foreach ($step in $steps) {
  Write-Host "==> $($step.display)"
  & $step.exe @($step.argv)
  $code = $LASTEXITCODE
  if ($null -eq $code) {
    $code = 0
  }
  if ($code -ne 0) {
    Write-Host "Fallo: $($step.display) devolvio $code"
    exit $code
  }
}

Write-Host 'Todo verde.'
exit $failures
