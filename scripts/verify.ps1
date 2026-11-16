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
    display = 'npm run audit:licenses'
    exe     = 'npm'
    argv    = @('run', 'audit:licenses')
  },
  [pscustomobject]@{
    display = 'npm run test:inventory'
    exe     = 'npm'
    argv    = @('run', 'test:inventory')
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
  },
  [pscustomobject]@{
    # Mismos crates livianos que corre el workflow: sin concat-render (wgpu),
    # concat-media (FFmpeg+resvg), concat-speech-min (whisper.cpp/cmake) ni
    # concat-text (test de emoji a color dependiente del sistema, falla local).
    display = 'node scripts/rust-env.mjs -- cargo test vendor/concat (crates livianos)'
    exe     = 'node'
    argv    = @('scripts/rust-env.mjs', '--', 'cargo', 'test', '--manifest-path', 'vendor/concat/Cargo.toml', '-p', 'concat-core', '-p', 'concat-project', '-p', 'concat-effects', '-p', 'concat-log')
  },
  [pscustomobject]@{
    # Mismo filtro que CI: css-audit queda fuera por sus snapshots
    # pixel-perfect atados a la build local de Chrome.
    display = 'npm --prefix apps/desktop run test:e2e -- --grep-invert css-audit'
    exe     = 'npm'
    argv    = @('--prefix', 'apps/desktop', 'run', 'test:e2e', '--', '--grep-invert', 'css-audit')
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
