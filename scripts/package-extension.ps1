# Package the browser extensions for delivery. Chrome still installs them as
# unpacked extensions: the user unzips each archive and selects its folder.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$extensions = @(
  @{
    Name = 'Flow Queue'
    Slug = 'flow-queue'
    Version = '0.1.0'
    Path = Join-Path $root 'extensions\flow-queue'
    Items = @('manifest.json', 'README.md', 'src', 'icons')
  },
  @{
    Name = 'Editor IA Descargar'
    Slug = 'editor-ia-downloader'
    Version = '1.0.0'
    Path = Join-Path $root 'extensions\editor-ia-downloader'
    Items = @('manifest.json', 'README.md', 'background.js', 'popup.html', 'popup.css', 'popup.js', 'icons')
  }
)

foreach ($extension in $extensions) {
  if (-not (Test-Path (Join-Path $extension.Path 'manifest.json'))) {
    throw "No encontré manifest.json en $($extension.Path)"
  }

  $zip = Join-Path $outDir ("{0}-{1}.zip" -f $extension.Slug, $extension.Version)
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }

  $stage = Join-Path ([System.IO.Path]::GetTempPath()) ("{0}-stage-{1}" -f $extension.Slug, [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage | Out-Null
  try {
    foreach ($item in $extension.Items) {
      $source = Join-Path $extension.Path $item
      if (-not (Test-Path $source)) { throw "Falta $source" }
      Copy-Item -LiteralPath $source -Destination $stage -Recurse
    }
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
  } finally {
    Remove-Item -LiteralPath $stage -Recurse -Force
  }

  $hash = Get-FileHash -LiteralPath $zip -Algorithm SHA256
  $size = (Get-Item -LiteralPath $zip).Length
  Write-Host ("{0}: {1} ({2} bytes)" -f $extension.Name, $zip, $size)
  Write-Host ("SHA256: {0}" -f $hash.Hash)
}
