# Run by the direct-download installer (installer.nsh) before it installs: replaces a Microsoft Store
# Guilded Companion with this version, keeping the member's settings and Discord link.
#
# Exit codes (the installer words them):
#   0  no Store version installed
#   10 Store version removed; its settings moved into this version's folder
#   11 Store version removed; this version already had settings, so the Store ones were kept
#      beside them in "store-settings-backup"
#   20 Store version found but could not be removed (the member removes it in Settings > Apps)
#
# Settings: the Store build keeps them in %APPDATA%\Guilded Companion Store, which Windows stores
# inside the package (LocalCache\Roaming). Removing the package deletes that folder, so the files
# that matter are copied out first. They are protected for this Windows user only (DPAPI), so the
# copy works for the same person on the same PC.
$ErrorActionPreference = 'Stop'
try {
  $package = Get-AppxPackage -Name 'Kcaron.GuildedCompanion' -ErrorAction SilentlyContinue | Select-Object -First 1
} catch { exit 0 }
if (-not $package) { exit 0 }

$target = Join-Path $env:APPDATA 'Guilded Companion'
$candidates = @(
  (Join-Path $env:LOCALAPPDATA ("Packages\" + $package.PackageFamilyName + "\LocalCache\Roaming\Guilded Companion Store")),
  (Join-Path $env:APPDATA 'Guilded Companion Store')
)
$source = $candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'config.secure') } | Select-Object -First 1
# Only the files that hold the member's setup; caches are rebuilt by themselves.
$keep = @('config.secure', 'Local State', 'language.json', 'hub-cache.json', 'startup.log')
$result = 10
try {
  if ($source) {
    $files = Get-ChildItem -LiteralPath $source -File | Where-Object { $keep -contains $_.Name -or $_.Name -like 'poe-journal*.json' -or $_.Name -like 'config.secure*.bak' }
    if (-not (Test-Path -LiteralPath (Join-Path $target 'config.secure'))) {
      New-Item -ItemType Directory -Force -Path $target | Out-Null
      foreach ($file in $files) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $target $file.Name) -Force }
    } else {
      $backup = Join-Path $target 'store-settings-backup'
      New-Item -ItemType Directory -Force -Path $backup | Out-Null
      foreach ($file in $files) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $backup $file.Name) -Force }
      $result = 11
    }
  }
} catch {
  # Copying failed: do not remove the Store version, or its settings would be lost.
  exit 20
}
try {
  Remove-AppxPackage -Package $package.PackageFullName
} catch { exit 20 }
exit $result
