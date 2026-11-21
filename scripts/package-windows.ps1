param([string]$Compiler)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$version = (Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version
$report = Get-Content -Raw (Join-Path $root 'dist/android/build-report.json') | ConvertFrom-Json
$apk = Join-Path $root "dist/android/$($report.apk)"
if ($report.signing -ne 'GlideYT distribution key' -or !$report.verification.signatureVerified -or (Get-FileHash $apk).Hash -ne $report.sha256) {
    throw 'Build and verify the distribution APK before packaging.'
}
if (!$Compiler) {
    $Compiler = @("$env:LOCALAPPDATA/Programs/Inno Setup 6/ISCC.exe", "${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (!$Compiler) { throw 'Install Inno Setup 6 or pass -Compiler with the path to ISCC.exe.' }

$stage = Join-Path $root ('.local/installer-' + [guid]::NewGuid())
$files = @('apps/windows', 'apps/companion', 'packages/core', 'scripts/launch-windows.mjs', 'scripts/stop-installed.mjs', 'dist/android/build-report.json', "dist/android/$($report.apk)")
foreach ($file in $files) {
    $destination = Join-Path $stage $file
    New-Item -Force -ItemType Directory (Split-Path $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $destination -Recurse
}
& (Join-Path $stage 'apps/windows/build.ps1')
if ($LASTEXITCODE) { throw 'Windows build failed.' }

$nodeVersion = 'v26.13.0'
$nodeSha = '14319838b3f355e0398c13569a90270bce4fc68f25189f58c59b03dadae0e6d5'
$runtime = New-Item -ItemType Directory -Path (Join-Path $stage 'runtime')
$bundled = Join-Path $runtime 'node.exe'
$localNode = (Get-Command node.exe).Source
if ((Get-FileHash $localNode).Hash -eq $nodeSha) {
    Copy-Item $localNode $bundled
} else {
    Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/win-x64/node.exe" -OutFile $bundled
}
if ((Get-FileHash $bundled).Hash -ne $nodeSha) { throw 'Node.js runtime checksum mismatch.' }
Invoke-WebRequest "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile (Join-Path $runtime 'LICENSE.txt')
& $Compiler "/DAppVersion=$version" "/DSourceDir=$stage" "/DOutputDir=$root/dist" (Join-Path $root 'apps/windows/installer.iss')
if ($LASTEXITCODE) { throw 'Installer compilation failed.' }
