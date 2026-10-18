$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

function Invoke-Checked([string]$Name, [string]$Executable, [string[]]$Arguments) {
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

Invoke-Checked "npm verify" "npm" @("run", "verify")
Invoke-Checked "Rust formatting" "cargo" @("fmt", "--all", "--", "--check")
Invoke-Checked "Rust project tests" "cargo" @("test", "-p", "editor-ia-desktop")
Write-Host "Editor IA verification completed." -ForegroundColor Green
