[Setup]
AppId={{96FB03BC-2750-4F99-86DD-2B94FFED139C}
AppName=GlideYT
AppVersion={#AppVersion}
AppPublisher=AGS Labs
AppPublisherURL=https://agslabs.tech/product/glideYT
AppSupportURL=https://github.com/gaffar273/GlideYT/issues
DefaultDirName={localappdata}\Programs\GlideYT
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
WizardStyle=modern
OutputDir={#OutputDir}
OutputBaseFilename=GlideYT-Setup
SetupIconFile={#SourceDir}\apps\windows\GlideYT.ico
UninstallDisplayIcon={app}\GlideYT.exe
Compression=lzma2
SolidCompression=yes
RestartApplications=no

[Files]
Source: "{#SourceDir}\GlideYT.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "{#SourceDir}\scripts\*.mjs"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "{#SourceDir}\apps\companion\*"; DestDir: "{app}\apps\companion"; Flags: ignoreversion recursesubdirs
Source: "{#SourceDir}\apps\windows\MediaControl.exe"; DestDir: "{app}\apps\windows"; Flags: ignoreversion
Source: "{#SourceDir}\apps\windows\qr.cjs"; DestDir: "{app}\apps\windows"; Flags: ignoreversion
Source: "{#SourceDir}\packages\core\*"; DestDir: "{app}\packages\core"; Flags: ignoreversion recursesubdirs
Source: "{#SourceDir}\dist\android\*.apk"; DestDir: "{app}\dist\android"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\GlideYT"; Filename: "{app}\GlideYT.exe"; WorkingDir: "{app}"
[Run]
Filename: "{app}\GlideYT.exe"; Description: "{cm:LaunchProgram,GlideYT}"; Flags: nowait postinstall skipifsilent
[UninstallRun]
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\scripts\stop-installed.mjs"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated

