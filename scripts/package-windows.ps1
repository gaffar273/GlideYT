$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$report = Get-Content -Raw (Join-Path $root 'dist/android/build-report.json') | ConvertFrom-Json
$apk = Join-Path $root "dist/android/$($report.apk)"
if ($report.signing -ne 'GlideYT distribution key' -or !$report.verification.signatureVerified -or (Get-FileHash $apk).Hash -ne $report.sha256) {
    throw 'Build and verify the distribution APK before packaging.'
}
$stage = Join-Path $root ('.local/package-' + [guid]::NewGuid())
$files = @('GlideYT.exe', 'README.md', 'scripts/launch-windows.mjs', 'apps/companion',
    'apps/windows/MediaControl.exe', 'apps/windows/qr.cjs', 'packages/core', "dist/android/$($report.apk)")
foreach ($file in $files) {
    $destination = Join-Path $stage $file
    New-Item -Force -ItemType Directory (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $destination -Recurse
}
$output = Join-Path $root 'dist/GlideYT-Windows.zip'
Compress-Archive -Path "$stage/*" -DestinationPath $output -Force
Write-Output $output
