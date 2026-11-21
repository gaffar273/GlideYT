$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot)
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$refs = 'PresentationCore','PresentationFramework','WindowsBase' | ForEach-Object { "/reference:$framework\WPF\$_.dll" }
$mediaRefs = 'Windows.Foundation','Windows.Media' | ForEach-Object { "/reference:$env:WINDIR\System32\WinMetadata\$_.winmd" }
& "$framework\csc.exe" /nologo /optimize+ /target:exe @mediaRefs "/reference:$framework\WPF\UIAutomationClient.dll" "/reference:$framework\WPF\UIAutomationTypes.dll" "/reference:$framework\WPF\WindowsBase.dll" /reference:System.Management.dll /reference:System.Runtime.WindowsRuntime.dll /reference:System.Runtime.dll /reference:System.Web.Extensions.dll "/out:$root\apps\windows\MediaControl.exe" "$PSScriptRoot\MediaControl.cs" "$PSScriptRoot\YouTubeTab.cs" "$PSScriptRoot\PlayerSettings.cs" "$PSScriptRoot\Playlists.cs"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& "$framework\csc.exe" /nologo /target:winexe "/win32icon:$PSScriptRoot\GlideYT.ico" /optimize+ @refs /reference:System.Xaml.dll /reference:System.Web.Extensions.dll "/resource:$PSScriptRoot\Window.xaml,Window.xaml" "/out:$root\GlideYT.exe" "$PSScriptRoot\LanTube.cs"
exit $LASTEXITCODE

