#ifndef StageDir
  #error StageDir must be supplied
#endif
#ifndef AppVersion
  #define AppVersion "2.1.2"
#endif

[Setup]
AppId={{D49A9095-89FB-48A6-A3C0-3D4D29AB6E56}
AppName=KODS Social Manager
AppVersion={#AppVersion}
AppPublisher=KODS
DefaultDirName={localappdata}\KODS\SocialManager
DefaultGroupName=KODS Social Manager
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
OutputBaseFilename=SocialManager-Setup-v{#AppVersion}
DisableProgramGroupPage=yes

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\Social Manager"; Filename: "{app}\Start-SocialManager.cmd"; WorkingDir: "{app}"
Name: "{group}\Social Manager"; Filename: "{app}\Start-SocialManager.cmd"; WorkingDir: "{app}"
Name: "{group}\Dang nhap Facebook Operator"; Filename: "{app}\Login-Facebook-Operator.cmd"; WorkingDir: "{app}"
Name: "{group}\Cau hinh Social Manager"; Filename: "{app}\Configure-SocialManager.cmd"; WorkingDir: "{app}"
Name: "{group}\Kiem tra Social Manager"; Filename: "{app}\Doctor-SocialManager.cmd"; WorkingDir: "{app}"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\windows\post-install.ps1"" -InstallDir ""{app}"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated
Filename: "{app}\Start-SocialManager.cmd"; Description: "Mo Social Manager"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\windows\uninstall-runtime.ps1"" -InstallDir ""{app}"""; Flags: runhidden waituntilterminated
